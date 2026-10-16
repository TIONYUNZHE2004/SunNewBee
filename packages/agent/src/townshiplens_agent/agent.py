"""The PydanticAI agent: 10 deterministic spatial tools + the forced `final_answer` output tool.

Tool wrappers record evidence/routes/scenarios into the TurnRecord (what the validator checks)
and push ToolCall / ToolResultEvent / VerificationRequested onto the record's queue, which
`run.run_turn` streams to the client while the agent is still running.
"""

import asyncio
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, get_args

from pydantic_ai import Agent, ModelRetry, RunContext, ToolOutput
from pydantic_ai.models import Model
from pydantic_ai.models.openrouter import OpenRouterModel, OpenRouterModelSettings
from pydantic_ai.providers.openrouter import OpenRouterProvider
from townshiplens_spatial import tools as sp
from townshiplens_spatial.models import Evidence, VerificationRequest
from townshiplens_spatial.routing import CENTRE_PREFIX
from townshiplens_spatial.scenario_meta import scenario_source

from .answer import FinalAnswer
from .events import (
    AnswerCheck,
    ChatRequest,
    ToolCall,
    ToolResultEvent,
    VerificationRequested,
)
from .labels import enrich_unknowns
from .mock import mock_model
from .record import TurnRecord
from .settings import AgentSettings
from .validate import issue_labels, repair_answer, validate_answer

SYSTEM = (Path(__file__).parent / "prompts" / "system.md").read_text(encoding="utf-8")


@dataclass
class Deps:
    ctx: sp.Ctx
    rec: TurnRecord
    request: ChatRequest


def model_for(settings: AgentSettings, escalate: bool = False) -> Model:
    """Mock (deterministic, keyless) or OpenRouter. Model names come from settings only."""
    if settings.provider == "mock":
        return mock_model()
    name = settings.llm_model_escalate if escalate else settings.llm_model_default
    provider = OpenRouterProvider(
        api_key=settings.openrouter_api_key or None, app_title="TownshipLens"
    )
    # Prompt caching (Anthropic via OpenRouter): the system prompt and the 10 tool schemas are
    # ~5k tokens resent on every request of a turn; caching them cuts input cost and latency.
    cache = OpenRouterModelSettings(
        openrouter_cache_instructions=True,
        openrouter_cache_tool_definitions=True,
        openrouter_cache_messages=True,
    )
    return OpenRouterModel(name, provider=provider, settings=cache)


async def _emit(deps: Deps, ev) -> None:
    if deps.rec.queue is not None:
        await deps.rec.queue.put(ev)


def _summarise(name: str, res: sp.ToolResult) -> str:
    d = res.data
    if not res.ok:
        return "; ".join(res.warnings) or "failed"
    if name == "plan_route" and isinstance(d, dict):
        return f"route {d.get('status')}"
    if name == "affected_places" and isinstance(d, dict):
        return (
            f"{d.get('likely_place_count', 0)} places and {d.get('likely_path_count', 0)} paths "
            f"likely, {d.get('possible_place_count', 0)} places and "
            f"{d.get('possible_path_count', 0)} paths possible"
        )
    if name == "simulate_what_if" and isinstance(d, dict):
        sm = d.get("summary") or {}
        before, after, total = sm.get("reach_before"), sm.get("reach_after"), sm.get("total")
        return f"what-if: {before} -> {after} of {total} reach"
    if name == "plan_verifications" and isinstance(d, dict):
        sm = d.get("summary") or {}
        return f"plan: {len(d.get('facts') or [])} checks -> {sm.get('confirmed_after')} confirmed"
    if name == "suggest_interventions" and isinstance(d, dict):
        return f"{len(d.get('candidates') or [])} candidate(s)"
    if isinstance(d, list):
        return f"{len(d)} result(s)"
    return "ok"


def _vr_event(vr: dict) -> VerificationRequested:
    return VerificationRequested(
        request_id=vr["id"],
        element_id=vr["element_id"],
        attribute=vr["attribute"],
        created=vr["created"],
        demand=vr["demand"],
        reason=vr.get("reason"),
    )


FLOOD_PHRASE = {"likely_flooded": "likely flooded", "possible": "possibly flooded"}


def _flag_flooded_endpoints(deps: Deps, sid: str, place_ids: list[str], res: sp.ToolResult):
    """Routing may start or end inside a flooded place (you evacuate from where you are), so
    say so: add the place's flood class as evidence, a warning, and `endpoint_flood` data."""
    world = deps.ctx.world
    classes = world.flood.place_classes.get(sid, {})
    flagged = []
    for pid in dict.fromkeys(place_ids):
        cls = classes.get(pid)
        if cls not in FLOOD_PHRASE:
            continue
        name = world.places[pid].name if pid in world.places else pid
        flagged.append({"place_id": pid, "name": name, "flood_class": cls, "scenario_id": sid})
        res.evidence.append(
            Evidence(
                id=f"ev-scn-{sid}.{pid}",
                element_id=pid,
                attribute="flood",
                value=cls,
                status="indicative",
                source_type=scenario_source(deps.ctx.world, sid),
            )
        )
        res.warnings.append(f"{name} ({pid}) is {FLOOD_PHRASE[cls]} in scenario {sid}")
        deps.rec.flooded_endpoints[pid] = {"flood_class": cls, "name": name, "scenario_id": sid}
        deps.rec.place_names.add(name)
    if flagged:
        res.data["endpoint_flood"] = flagged
        deps.rec.scenarios_used.add(sid)


# Single source of truth: the VerificationRequest.reason literal.
VR_REASONS = set(get_args(VerificationRequest.model_fields["reason"].annotation))
_ATTRIBUTE = re.compile(r"^[a-z_]{1,40}$")


def safe_vr_args(world, kwargs: dict, source: str = "chat") -> dict:
    """PDPA: a VR is shown to staff and stored, so never persist model-written free text.
    Only known element ids, a constrained attribute and reason, and a fixed summary."""
    reason = kwargs.get("reason")
    reason = reason if reason in VR_REASONS else "unknown"
    attribute = kwargs.get("attribute")
    attribute = (
        attribute if isinstance(attribute, str) and _ATTRIBUTE.match(attribute) else "unknown"
    )
    target = kwargs.get("target_id")
    known = any(target in d for d in (world.edges, world.places, world.centres, world.waste))
    if reason == "missing_place" or not known:
        target = "unknown_place"
    summary = f"{source}: {reason} {attribute} on {target}"[:120]
    return {
        "target_id": target,
        "attribute": attribute,
        "reason": reason,
        "question_summary": summary,
    }


_safe_vr_args = safe_vr_args  # backwards-compatible alias


SCENARIO_TOOLS = ("plan_route", "list_evacuation_centres", "affected_places", "simulate_what_if")


def ui_scenario(deps: Deps) -> str | None:
    """The UI's active scenario, only if it exists in the loaded world."""
    sid = deps.request.scenario_id
    return sid if sid and any(s.id == sid for s in deps.ctx.world.flood.scenarios) else None


def _place_names(name: str, data: Any) -> set[str]:
    """Names of places/centres in a tool payload (for the validator's wording check)."""
    out: set[str] = set()
    items = data if isinstance(data, list) else [data] if isinstance(data, dict) else []
    if name == "affected_places" and isinstance(data, dict):
        items = [*(data.get("likely") or []), *(data.get("possible") or [])]
    for it in items:
        if not isinstance(it, dict):
            continue
        for d in (it, it.get("centre")):
            if isinstance(d, dict) and isinstance(d.get("name"), str):
                out.add(d["name"])
    return out


def route_summary(world, profile: str | None, from_id: str | None, to_id: str | None) -> str:
    """Staff-facing VR text: place and centre names, never the user's words or internal ids."""

    def label(i: str | None) -> str:
        i = i or ""
        if i.startswith(CENTRE_PREFIX):
            c = world.centres.get(i.removeprefix(CENTRE_PREFIX))
            return c.name if c else i.removeprefix(CENTRE_PREFIX)
        p = world.places.get(i)
        return p.name if p else i

    return f"{profile} route {label(from_id)} -> {label(to_id)}"


async def call_tool(deps: Deps, name: str, **kwargs: Any) -> dict:
    """Run one spatial tool, record what it returned and stream its events."""
    rec = deps.rec
    call_id = f"{name}-{len(rec.tool_calls)}"
    rec.tool_calls.append(name)
    if name == "create_verification_request":
        kwargs = _safe_vr_args(deps.ctx.world, kwargs)
    if name in SCENARIO_TOOLS and not kwargs.get("scenario_id") and ui_scenario(deps):
        # The scenario on screen applies to routing even if the model forgot to pass it.
        kwargs["scenario_id"] = ui_scenario(deps)
    await _emit(deps, ToolCall(id=call_id, name=name, args=dict(kwargs)))
    if name == "plan_route":
        # Shown to staff on the VR: describe the request, never copy the user's words (PII).
        kwargs["question_summary"] = route_summary(
            deps.ctx.world, kwargs.get("profile"), kwargs.get("from_id"), kwargs.get("to_id")
        )
    # Spatial tools are sync (graph search, SQLite): keep the event loop free.
    res: sp.ToolResult = await asyncio.to_thread(sp.TOOLS[name], deps.ctx, **kwargs)
    rec.place_names |= _place_names(name, res.data)
    if name == "plan_route" and isinstance(res.data, dict) and kwargs.get("scenario_id"):
        sid = kwargs["scenario_id"]
        _flag_flooded_endpoints(deps, sid, [kwargs["from_id"], kwargs["to_id"]], res)
    for e in res.evidence:
        rec.evidence[e.id] = e
    if name == "plan_route" and isinstance(res.data, dict):
        for r in res.data.get("routes", []):
            enrich_unknowns(deps.ctx.world, r)  # readable element labels and notes
            rec.routes[r["id"]] = r
            rec.route_status[r["id"]] = r["status"]
        for c in res.data.get("closures") or []:
            rec.route_closures.append(c)
            rec.closures[c["id"]] = c
        rec.inferred_notes += [
            w
            for w in res.warnings
            if w.startswith("Route ")
            and "entrance is not mapped" in w
            and w not in rec.inferred_notes
        ]
        for vr in res.data.get("verification_requests", []):
            rec.vrs.append(vr)
            await _emit(deps, _vr_event(vr))
    if name == "get_closures" and res.ok and isinstance(res.data, list):
        rec.closures.update({c["id"]: c for c in res.data})
        near = kwargs.get("near_place")
        rec.asked_closures += [
            c for c in res.data if c.get("active") and (not near or c["element_id"] == near)
        ]
    if name == "get_place_details" and res.ok and isinstance(res.data, dict):
        # A closure on the place asked about must be named (same rule as get_closures).
        for c in res.data.get("closures") or []:
            rec.closures[c["id"]] = c
            if c.get("active"):
                rec.asked_closures.append(c)
    if name == "simulate_what_if" and res.ok and isinstance(res.data, dict):
        d = res.data
        stages = [
            a["scenario_id"] for a in d.get("actions", []) if a.get("kind") == "set_river_stage"
        ]
        rec.what_ifs.append(
            {
                **{k: d.get(k) for k in ("summary", "counts_before", "counts_after", "scope")},
                "profile": d.get("profile"),
                "labels": d.get("action_labels") or [],
                "scenario_id": d.get("scenario_id"),
                "base_scenario_id": d.get("base_scenario_id"),
                "imagined": bool(d.get("imagined")),
                "diff_geojson": d.pop("diff_geojson", None),
                "disclaimer": d.get("disclaimer"),
            }
        )
        base = d.get("base_scenario_id")
        rec.scenarios_used |= {s for s in [*stages, base] if s and s != "baseline"}
        rec.place_names |= {
            n
            for o in d.get("journeys", [])
            for n in (
                o.get("from_name"),
                o["after"].get("target_name"),
                o["before"].get("target_name"),
            )
            if n
        }
    if name == "plan_verifications" and res.ok and isinstance(res.data, dict):
        rec.plans.append(res.data)
    if name == "affected_places" and res.ok and isinstance(res.data, dict):
        d = res.data
        rec.affected.append(
            {
                **{
                    k: int(d.get(k) or 0)
                    for k in (
                        "likely_place_count",
                        "likely_path_count",
                        "possible_place_count",
                        "possible_path_count",
                    )
                },
                "likely_listed": sum(1 for i in d.get("likely") or [] if i.get("kind") != "path"),
                "possible_listed": sum(
                    1 for i in d.get("possible") or [] if i.get("kind") != "path"
                ),
                "isolated_place_count": sum(
                    int(c.get("place_count") or 0) for c in d.get("isolated_components") or []
                ),
            }
        )
    if name == "rising_river_rollout" and res.ok and isinstance(res.data, dict):
        res.data.pop("routes", None)  # geometry and per-resident rows stay out of the prompt
        res.data.pop("residents", None)
        rec.rollouts.append(res.data)
    if name in ("rising_river_rollout", "river_tipping_point") and res.ok:
        # every stage was simulated: the flood disclaimer and scenario rules apply
        scs = sorted(deps.ctx.world.flood.scenarios, key=lambda sc: sc.stage_m)
        rec.scenarios_used |= {sc.id for sc in scs[-1:] if sc.id != "baseline"}
    if name == "find_fixes" and res.ok and isinstance(res.data, dict):
        # The best set is a what-if: every what-if rule (label, numbers, conditional) applies.
        best = res.data["best"]
        rec.fixes.append(res.data)
        rec.what_ifs.append(
            {
                "summary": best["summary"],
                "counts_before": {},
                "counts_after": {},
                "scope": res.data["scope"],
                "profile": res.data["profile"],
                "labels": best["labels"],
                "scenario_id": res.data.get("stage"),
                "base_scenario_id": res.data.get("stage"),
                "imagined": bool(best["actions"]),
                "diff_geojson": None,
                "disclaimer": res.data.get("disclaimer"),
                "fixit": {
                    "empty": not best["actions"],
                    "stopped": bool(res.data.get("stopped_early")) and not best["actions"],
                    "candidates": len(res.data["candidates"]),
                },
            }
        )
        if res.data.get("stage"):
            rec.scenarios_used.add(res.data["stage"])
    if name == "day_rehearsal" and res.ok and isinstance(res.data, dict):
        rec.days.append(res.data)
        stages = res.data.get("river_stages") or []
        if stages:  # a day with a river rise: the flood disclaimer and scenario rules apply
            by_m = {s.id: s.stage_m for s in deps.ctx.world.flood.scenarios}
            top = max(stages, key=lambda s: by_m.get(s, 0))
            rec.scenarios_used.add(top)
            rec.day_stages.add(top)
        rec.place_names |= {
            p["name"] for p in res.data.get("busiest_places") or [] if p.get("name")
        }
        # group labels hold digits ("Older residents (65+)"): names, not counts
        rec.place_names |= {g["label"] for g in res.data.get("groups") or [] if g.get("label")}
    if name == "river_tipping_point" and res.ok and isinstance(res.data, dict):
        rec.tippings.append(res.data)
        rec.place_names |= {
            n for n in (res.data.get("from_name"), res.data.get("target_name")) if n
        }
    if name == "create_verification_request" and res.ok:
        rec.vrs.append(res.data)
        await _emit(deps, _vr_event(res.data))
    sid = kwargs.get("scenario_id")
    if sid:  # plan_route / affected_places / list_evacuation_centres with a scenario
        rec.scenarios_used.add(sid)
    elif name == "list_flood_scenarios" and ui_scenario(deps):
        rec.scenarios_used.add(ui_scenario(deps))
    await _emit(deps, ToolResultEvent(id=call_id, name=name, summary=_summarise(name, res)))
    return _for_model(name, _without_closure_notes(res.model_dump(mode="json")))


# Id lists the model never needs: on the Elmina seed affected_places at +5 m lists 2,468 edge ids
# (825 KB), which pushed a live turn past its timeout (eval, Cycle 5). Totals stay.
_MODEL_DROP = {"affected_places": ("likely_edge_ids", "possible_edge_ids")}
_MODEL_CAP = {"affected_places": ("likely_place_ids", "possible_place_ids")}


MODEL_EVIDENCE_CAP = 60  # evidence rows sent to the model; the TurnRecord keeps them all


def _for_model(name: str, out: dict) -> dict:
    ev = out.get("evidence")
    if isinstance(ev, list) and len(ev) > MODEL_EVIDENCE_CAP:
        # Scenario-level evidence first, then demo (placeholder) rows and place-level rows (the
        # caveats depend on them), then the rest in order: enough to cite; all stay citable.
        def rank(e: dict) -> int:
            i = str(e.get("id", ""))
            if i.startswith("ev-scn-") and "." not in i:
                return 0
            if e.get("source_type") == "team_survey_placeholder":
                return 1
            if i.startswith("ev-place-") or e.get("status") in ("unknown", "reported"):
                return 2
            return 3

        out["evidence"] = sorted(ev, key=rank)[:MODEL_EVIDENCE_CAP]
        out["evidence_truncated"] = len(ev) - len(out["evidence"])
    data = out.get("data")
    if isinstance(data, dict):
        for k in _MODEL_DROP.get(name, ()):
            data.pop(k, None)
        for k in _MODEL_CAP.get(name, ()):
            if isinstance(data.get(k), list):
                data[k] = data[k][:20]
    return out


def _without_closure_notes(out: Any) -> Any:
    """Staff free text on a closure (`note`) can hold names or phone numbers: it never goes to
    the model provider. The UI and the recorded rows keep it."""
    if isinstance(out, dict):
        if "source_label" in out and out.get("source_label") == "Reported closure (staff)":
            return {k: _without_closure_notes(v) for k, v in out.items() if k != "note"}
        return {k: _without_closure_notes(v) for k, v in out.items()}
    if isinstance(out, list):
        return [_without_closure_notes(v) for v in out]
    return out


def build_agent(model: Model) -> Agent[Deps, FinalAnswer]:
    agent = Agent(
        model,
        deps_type=Deps,
        output_type=ToolOutput(FinalAnswer, name="final_answer"),
        instructions=SYSTEM,
    )

    @agent.instructions
    def ui_context(ctx: RunContext[Deps]) -> str:
        r = ctx.deps.request
        # Only ids that exist in the world are interpolated (never free text from the request).
        return (
            f"UI context: profile={r.profile}; active_scenario={ui_scenario(ctx.deps) or 'none'}."
        )

    @agent.tool
    async def find_place(
        ctx: RunContext[Deps], query: str, types: list[str] | None = None, limit: int = 5
    ) -> dict:
        """Resolve a place name (EN/BM/中文, nicknames) to candidate place ids. Never guess ids."""
        return await call_tool(ctx.deps, "find_place", query=query, types=types, limit=limit)

    @agent.tool
    async def get_place_details(ctx: RunContext[Deps], place_id: str) -> dict:
        """All attributes of one place with status, evidence ids and verification dates."""
        return await call_tool(ctx.deps, "get_place_details", place_id=place_id)

    @agent.tool
    async def plan_route(
        ctx: RunContext[Deps],
        from_id: str,
        to_id: str,
        profile: str,
        scenario_id: str | None = None,
    ) -> dict:
        """The only routing authority. profile: default|stroller|wheelchair|older_adult_rest|drive.
        to_id may be a place id or "__centre__<centre_id>" for an evacuation centre.
        Optional scenario_id applies a flood scenario.
        Returns status confirmed|partly_unverified|blocked|no_data."""
        return await call_tool(
            ctx.deps,
            "plan_route",
            from_id=from_id,
            to_id=to_id,
            profile=profile,
            scenario_id=scenario_id,
        )

    @agent.tool
    async def nearby_amenities(
        ctx: RunContext[Deps],
        origin_id: str,
        amenity: str,
        max_walk_m: float = 300,
        profile: str = "default",
    ) -> dict:
        """Amenities (toilet, seating, shelter, ...) within a walking distance along paths."""
        return await call_tool(
            ctx.deps,
            "nearby_amenities",
            origin_id=origin_id,
            amenity=amenity,
            max_walk_m=max_walk_m,
            profile=profile,
        )

    @agent.tool
    async def get_closures(
        ctx: RunContext[Deps], near_place: str | None = None, active_only: bool = True
    ) -> dict:
        """Staff-reported closures ("Reported closure (staff)"), soonest first. near_place is a
        place id from find_place: only closures on it or within about 300 m. active_only=False
        also lists closures that have not started yet. A closure is a staff report, not a
        guarantee: an empty list does not mean a path or place is open."""
        return await call_tool(
            ctx.deps, "get_closures", near_place=near_place, active_only=active_only
        )

    @agent.tool
    async def create_verification_request(
        ctx: RunContext[Deps], target_id: str, attribute: str, reason: str, question_summary: str
    ) -> dict:
        """Log a gap for staff (reason: unknown|stale|contradicted|no_route_unverified_segment|
        missing_place|user_report).
        target_id must be an id returned by a tool (for a missing place, any value: it is stored
        as "unknown_place"); attribute is snake_case. question_summary is not stored."""
        return await call_tool(
            ctx.deps,
            "create_verification_request",
            target_id=target_id,
            attribute=attribute,
            reason=reason,
            question_summary=question_summary,
        )

    @agent.tool
    async def list_flood_scenarios(ctx: RunContext[Deps]) -> dict:
        """Available indicative flood scenarios (river stage +N m) with disclaimers."""
        return await call_tool(ctx.deps, "list_flood_scenarios")

    @agent.tool
    async def affected_places(
        ctx: RunContext[Deps], scenario_id: str, kind: str = "all", profile: str = "default"
    ) -> dict:
        """What is likely/possibly cut off under a scenario, plus isolated islands.
        Lists are capped. For counts use likely_place_count (places) and likely_path_count
        (path segments), and the possible_* pair: say "N places and M path segments", never
        likely_total as a number of places (it adds both)."""
        return await call_tool(
            ctx.deps, "affected_places", scenario_id=scenario_id, kind=kind, profile=profile
        )

    @agent.tool
    async def list_evacuation_centres(
        ctx: RunContext[Deps],
        scenario_id: str | None = None,
        profile: str = "default",
        near_place: str | None = None,
    ) -> dict:
        """Evacuation centres with source (official_pps|osm_candidate) and reachability under a
        scenario. To route to one, call plan_route with to_id="__centre__<centre id>"."""
        return await call_tool(
            ctx.deps,
            "list_evacuation_centres",
            scenario_id=scenario_id,
            profile=profile,
            near_place=near_place,
        )

    @agent.tool
    async def find_waste_points(
        ctx: RunContext[Deps], type: str | None = None, near_place: str | None = None
    ) -> dict:
        """Recycling / e-waste / waste points with verification status."""
        return await call_tool(ctx.deps, "find_waste_points", type=type, near_place=near_place)

    @agent.tool
    async def suggest_interventions(
        ctx: RunContext[Deps], profile: str = "wheelchair", near_place: str | None = None
    ) -> dict:
        """What-if candidates from the township world model, with readable labels: ramps where
        steps block the profile, facts staff could verify, paths most journeys rely on (to
        imagine them closed), and the river stages. Use these actions; never invent ids.
        near_place is a place id from find_place."""
        return await call_tool(
            ctx.deps, "suggest_interventions", profile=profile, near_place=near_place
        )

    @agent.tool
    async def simulate_what_if(
        ctx: RunContext[Deps],
        actions: list[dict],
        profile: str = "default",
        scope: str = "journey",
        from_id: str | None = None,
        to_id: str | None = None,
        scenario_id: str | None = None,
    ) -> dict:
        """Imagine changes on a copy of the township and compare journeys before and after.
        actions: [{"kind": "set_river_stage", "scenario_id": "stage_p3m"},
        {"kind": "build_ramp", "element_id": ...}, {"kind": "close_path", "element_id": ...},
        {"kind": "verify_fact", "element_id": ..., "attribute": ..., "outcome": "pass"|"fail"},
        {"kind": "assume_fact", "element_id": ..., "attribute": ..., "value": ...}].
        scope: journey (from_id -> to_id; to_id may be "nearest_centre"), suite (sample
        resident journeys) or evacuation (sampled origins -> nearest reachable centre).
        Never changes the real township. Say only the numbers in summary and counts."""
        return await call_tool(
            ctx.deps,
            "simulate_what_if",
            actions=actions,
            profile=profile,
            scope=scope,
            from_id=from_id,
            to_id=to_id,
            scenario_id=scenario_id,
        )

    @agent.tool
    async def plan_verifications(
        ctx: RunContext[Deps],
        profile: str = "wheelchair",
        scope: str = "evacuation",
        budget: int = 15,
    ) -> dict:
        """Survey plan for staff: which unchecked facts to verify first (at most `budget`
        checks) so the most sample journeys would have a confirmed route if those facts pass.
        scope: evacuation (sampled origins -> nearest centre) or suite (everyday trips).
        Say only the numbers in summary, facts and places, always conditional on the checks."""
        return await call_tool(
            ctx.deps, "plan_verifications", profile=profile, scope=scope, budget=budget
        )

    @agent.tool
    async def river_tipping_point(
        ctx: RunContext[Deps], from_id: str, profile: str = "default", to_id: str | None = None
    ) -> dict:
        """At which river stage does a journey break? One journey (from_id -> to_id, or the
        nearest evacuation centre when to_id is omitted) across every precomputed stage: the
        status per stage, degrades_at and breaks_at (stage ids). Indicative, not a forecast."""
        return await call_tool(
            ctx.deps, "river_tipping_point", from_id=from_id, profile=profile, to_id=to_id
        )

    @agent.tool
    async def rising_river_rollout(
        ctx: RunContext[Deps], profiles: list[str] | None = None, n: int = 30
    ) -> dict:
        """Synthetic residents per persona heading for the nearest evacuation centre at every
        river stage: counts per stage (reach, confirmed, cut_off, no_data) and who is cut off
        first. The app animates it on the map. Indicative simulation, not a forecast."""
        return await call_tool(ctx.deps, "rising_river_rollout", profiles=profiles, n=n)

    @agent.tool
    async def day_rehearsal(
        ctx: RunContext[Deps], day: Literal["weekday", "storm", "event", "friday"] = "storm"
    ) -> dict:
        """Elmina Day: a simulated day of 5,000 synthetic residents on the township model, in a
        built-in scenario: weekday, storm (the river rises during the school run), event (a
        night at the park) or friday (prayers). Trips by outcome, residents by group (children,
        older, wheelchair users, parents with strollers, households without a car), school
        and the busiest places. A rehearsal, not a forecast; residents are synthetic."""
        return await call_tool(ctx.deps, "day_rehearsal", day=str(day).strip().lower())

    @agent.tool
    async def find_fixes(
        ctx: RunContext[Deps],
        profile: str = "wheelchair",
        scope: str = "evacuation",
        scenario_id: str | None = None,
        budget: int = 2,
        proposals: list[dict] | None = None,
    ) -> dict:
        """Fix-it search ("which 2 changes would help wheelchair users most at +3 m?"): beam
        search over imagined fixes (ramps, verifications) scored on the world model. proposals:
        extra legal actions you suggest (from suggest_interventions). Report the best set and
        the numbers in its summary; if best has no actions, say no candidate change helps."""
        return await call_tool(
            ctx.deps,
            "find_fixes",
            profile=profile,
            scope=scope,
            scenario_id=scenario_id,
            budget=budget,
            proposals=proposals,
        )

    @agent.output_validator
    async def check(ctx: RunContext[Deps], out: FinalAnswer) -> FinalAnswer:
        if ctx.partial_output:  # only whole answers are checked (drafts are guarded in draft.py)
            return out
        rec = ctx.deps.rec
        out, repairs = repair_answer(out, rec)
        rec.repairs += repairs
        errs = validate_answer(out, rec)
        # One verdict per attempt; attempts are numbered as the draft stream numbered them
        # (a model that does not stream has no drafts: count the checks instead).
        rec.checks = max(rec.checks + 1, rec.draft_attempt)
        await _emit(
            ctx.deps,
            AnswerCheck(
                attempt=rec.checks, ok=not errs, issues=issue_labels(errs), repairs=len(repairs)
            ),
        )
        if errs:
            rec.validator_errors.append(errs)
            raise ModelRetry(" ".join(errs))
        return out

    return agent
