"""The PydanticAI agent: 10 deterministic spatial tools + the forced `final_answer` output tool.

Tool wrappers record evidence/routes/scenarios into the TurnRecord (what the validator checks)
and push ToolCall / ToolResultEvent / VerificationRequested onto the record's queue, which
`run.run_turn` streams to the client while the agent is still running.
"""

import asyncio
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, get_args

from pydantic_ai import Agent, ModelRetry, RunContext, ToolOutput
from pydantic_ai.capabilities import SelectModel
from pydantic_ai.messages import ModelRequest, RetryPromptPart
from pydantic_ai.models import Model, ModelSelectionContext
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openrouter import OpenRouterModel, OpenRouterModelSettings
from pydantic_ai.providers.openrouter import OpenRouterProvider
from townshiplens_spatial import tools as sp
from townshiplens_spatial.devsim_models import DevelopmentPlan
from townshiplens_spatial.models import Evidence, VerificationRequest
from townshiplens_spatial.routing import CENTRE_PREFIX
from townshiplens_spatial.scenario_meta import scenario_source

from .answer import FinalAnswer
from .event_course import (
    ClosureInput,
    ClosureReason,
    CourseError,
    course_segments,
    event_window,
)
from .events import (
    AnswerCheck,
    ChatRequest,
    ToolCall,
    ToolResultEvent,
    VerificationRequested,
)
from .facts import categories, merge, tool_values
from .journeys import PLAYABLE, journey_facts, journey_vr_targets, plan_for
from .labels import crossing_note, enrich_unknowns, road_note
from .mock import mock_model
from .record import TurnRecord
from .route_binding import (
    RouteSelectionError,
    canonical_id,
    effective_profile,
    effective_scenario,
    entities,
    generic_kind,
    guard_endpoints,
    guard_origin,
    mentions,
    requested_radius,
)
from .scope import ACCESS_FLOOD_TOOLS, scoped_instructions
from .settings import AgentSettings
from .validate import issue_labels, repair_answer, validate_answer

SYSTEM = (Path(__file__).parent / "prompts" / "system.md").read_text(encoding="utf-8")


@dataclass
class Deps:
    ctx: sp.Ctx
    rec: TurnRecord
    request: ChatRequest


def model_for(settings: AgentSettings, escalate: bool = False) -> Model:
    """Mock (deterministic, keyless) or OpenRouter. Model names come from settings only.
    With LLM_MODEL_FALLBACK set, the default model fails over to it on a provider error."""
    if settings.provider == "mock":
        return mock_model()
    if escalate:
        return _openrouter(settings, settings.llm_model_escalate)
    primary = _openrouter(settings, settings.llm_model_default)
    if settings.llm_model_fallback and settings.llm_model_fallback != settings.llm_model_default:
        return FallbackModel(primary, _openrouter(settings, settings.llm_model_fallback))
    return primary


def _openrouter(settings: AgentSettings, name: str) -> Model:
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


def answer_rejected(messages: list) -> bool:
    """True when the request being sent carries the validator's rejection of final_answer."""
    last = messages[-1] if messages else None
    return isinstance(last, ModelRequest) and any(
        isinstance(p, RetryPromptPart) and p.tool_name == "final_answer" for p in last.parts
    )


def escalation(stronger: Model) -> SelectModel:
    """Send the rewrite after a validator rejection (and every later step) to `stronger`."""

    def select(ctx: ModelSelectionContext[Deps]) -> Model | None:
        if ctx.deps.rec.escalated or answer_rejected(ctx.messages):
            ctx.deps.rec.escalated = True
            return stronger
        return ctx.model

    return SelectModel(select)


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
    if name == "simulate_marathon" and isinstance(d, dict):
        imp, course = d.get("impact") or {}, d.get("course") or {}
        return (
            f"marathon: {round((course.get('length_m') or 0) / 1000, 1)} km course; "
            f"{imp.get('trips_affected')} of {imp.get('trips_total')} sample trips affected"
        )
    if name in ("simulate_event", "simulate_closure") and isinstance(d, dict):
        kind = "event" if name == "simulate_event" else "closures"
        return f"{kind}: {d.get('trips_affected')} of {d.get('trips_total')} sample trips affected"
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
        keys = ("likely", "possible", "flooded_places", "cut_off_places")
        items = [row for k in keys for row in data.get(k) or []]
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


async def _file_journey_vrs(deps: Deps, data: dict, summary: str) -> None:
    """D-T10: every unchecked place the played walk stops at gets a verification request, so its
    card can honestly say "verification request filed". Only the first route (the one
    journey.play plays, mock and template alike) and only when it is playable and has no reported
    closure. That includes evacuation routes (list_evacuation_centres -> plan_route), where no walk
    is played: call_tool cannot know whether the answer will play one, and these are real route
    unknowns (journey_vr_targets, at most MAX_JOURNEY_VRS). Sanitised like any
    chat VR (safe_vr_args) with plan_route's own name-only summary (PDPA). Appended to the tool's
    verification_requests, so the answer's request count and the SSE events include them.

    Every pair asked here is a non-flood route unknown plan_route did not file, i.e. one it
    counted in verification_requests_truncated: that count drops by one per pair filed here, so
    "N more checks pending" never overstates what is left unfiled."""
    routes = data.get("routes") or []
    r0 = routes[0] if routes else None
    plan = deps.rec.journeys.get(r0["id"]) if r0 else None
    if plan is None or r0.get("status") not in PLAYABLE or data.get("closures"):
        return
    vrs = data.setdefault("verification_requests", [])
    filed = {(v["element_id"], v["attribute"]) for v in vrs}
    world = deps.ctx.world
    for element_id, attribute, reason in journey_vr_targets(plan, r0, filed):
        args = safe_vr_args(
            world, {"target_id": element_id, "attribute": attribute, "reason": reason}
        )
        if args["target_id"] != element_id:  # not a known element: nothing to ask about
            continue
        vr, created = await asyncio.to_thread(
            deps.ctx.vrs.request, args["target_id"], args["attribute"], args["reason"], summary
        )
        vrs.append({**vr.model_dump(mode="json"), "created": created})
        if data.get("verification_requests_truncated"):
            data["verification_requests_truncated"] -= 1


async def call_tool(deps: Deps, name: str, /, **kwargs: Any) -> dict:
    """Run one spatial tool, record what it returned and stream its events."""
    rec = deps.rec
    rec.place_entities = entities(deps.ctx.world)
    try:
        if name == "find_place" and (kind := generic_kind(kwargs.get("query", ""))):
            anchors = mentions(deps.request.message, rec.place_entities)
            if len(anchors) == 1 and not kwargs.get("near_place"):
                kwargs["near_place"] = next(iter(anchors))
                kwargs["types"] = kwargs.get("types") or ["facility" if kind == "kiosk" else kind]
        if name == "find_place" and kwargs.get("near_place"):
            guard_origin(
                deps.ctx.world,
                deps.request.message,
                kwargs["near_place"],
                context=rec.context_route,
                strict=rec.strict_selection,
            )
        if name in {"plan_route", "nearby_amenities", "list_evacuation_centres", "affected_places"}:
            kwargs["profile"] = effective_profile(
                deps.request.message, deps.request.profile, kwargs.get("profile")
            )
        if rec.strict_selection and name in {
            "plan_route",
            "list_evacuation_centres",
            "affected_places",
            "nearby_amenities",
        }:
            kwargs["scenario_id"] = effective_scenario(
                deps.request.message, deps.ctx.world, ui_scenario(deps), kwargs.get("scenario_id")
            )
        if name in {"nearby_amenities", "list_evacuation_centres"}:
            origin = kwargs.get("origin_id") or kwargs.get("near_place")
            if origin:
                guard_origin(
                    deps.ctx.world,
                    deps.request.message,
                    origin,
                    context=rec.context_route,
                    strict=rec.strict_selection,
                )
        if (
            name == "nearby_amenities"
            and (limit := requested_radius(deps.request.message)) is not None
            and kwargs.get("max_walk_m", 300) > limit
        ):
            raise RouteSelectionError(
                "Keep the amenity search within the requested distance; do not widen its radius."
            )
        if name == "plan_route":
            await asyncio.to_thread(
                guard_endpoints,
                deps.ctx.world,
                deps.request.message,
                kwargs,
                context=rec.context_route,
                strict=rec.strict_selection,
                centre_options=rec.centre_options,
            )
        if name in {"plan_route", "nearby_amenities", "list_evacuation_centres", "affected_places"}:
            rec.selection_error = None
    except RouteSelectionError as exc:
        rec.selection_error = str(exc)
        raise ModelRetry(str(exc)) from exc
    call_id = f"{name}-{len(rec.tool_calls)}"
    rec.tool_calls.append(name)
    if name == "create_verification_request":
        kwargs = _safe_vr_args(deps.ctx.world, kwargs)
    if name in SCENARIO_TOOLS and not kwargs.get("scenario_id") and ui_scenario(deps):
        # The scenario on screen applies to routing even if the model forgot to pass it.
        kwargs["scenario_id"] = ui_scenario(deps)
    await _emit(deps, ToolCall(id=call_id, name=name, args=dict(kwargs)))
    if name == "simulate_event":  # T-025: the window is built here, so the model never dates it
        kwargs.pop("road_names", None)
        kwargs["starts_at"], kwargs["ends_at"] = event_window(
            kwargs.pop("start"),
            kwargs.pop("end"),
            kwargs.pop("day", None),
            deps.ctx.world.site.timezone,
        )
    if name == "simulate_closure":  # T-026: windows are built here too, never by the model
        tz = deps.ctx.world.site.timezone
        kwargs["closures"] = [
            {"segment_ids": c["segment_ids"], "starts_at": s, "ends_at": e}
            for c in kwargs["closures"]
            for s, e in [event_window(c["start"], c["end"], c.get("day"), tz)]
        ]
    if name == "simulate_marathon":  # T-028: the window is built here, never by the model
        kwargs["starts_at"], kwargs["ends_at"] = event_window(
            kwargs.pop("start_time"),
            kwargs.pop("end_time"),
            kwargs.pop("day", None),
            deps.ctx.world.site.timezone,
        )
    if name == "plan_route":
        # Shown to staff on the VR: describe the request, never copy the user's words (PII).
        kwargs["question_summary"] = route_summary(
            deps.ctx.world, kwargs.get("profile"), kwargs.get("from_id"), kwargs.get("to_id")
        )
    # Spatial tools are sync (graph search, SQLite): keep the event loop free.
    t0 = time.perf_counter()
    res: sp.ToolResult = await asyncio.to_thread(sp.TOOLS[name], deps.ctx, **kwargs)
    if name == "list_evacuation_centres" and res.ok and kwargs.get("near_place"):
        rec.centre_options.extend(
            {
                "from_id": kwargs["near_place"],
                "to_id": "__centre__" + row["centre"]["id"],
                "profile": kwargs["profile"],
                "scenario_id": kwargs.get("scenario_id"),
            }
            for row in res.data
            if row.get("reachable")
        )
    rec.tool_seconds[name] = rec.tool_seconds.get(name, 0.0) + time.perf_counter() - t0
    rec.place_names |= _place_names(name, res.data)
    if name == "plan_route" and isinstance(res.data, dict) and kwargs.get("scenario_id"):
        sid = kwargs["scenario_id"]
        _flag_flooded_endpoints(deps, sid, [kwargs["from_id"], kwargs["to_id"]], res)
    for e in res.evidence:
        rec.evidence[e.id] = e
    if name == "plan_route" and isinstance(res.data, dict):
        for i, r in enumerate(res.data.get("routes", [])):
            rec.measurement_subjects.append(
                {
                    "place_ids": [
                        canonical_id(deps.ctx.world, r[k]) for k in ("from_place", "to_place")
                    ],
                    "route_id": r["id"],
                    "values": tool_values(
                        {"distance_m": r["distance_m"], "est_minutes": r["est_minutes"]}
                    ),
                }
            )
            enrich_unknowns(deps.ctx.world, r)  # readable element labels and notes
            if note := crossing_note(r):
                r["crossing_note"] = note  # the model copies it word for word (prompt 5h)
            if (plan := plan_for(deps.ctx.world, r)) is not None:
                rec.journeys[r["id"]] = plan
                r["journey"] = journey_facts(plan)  # counts the answer may state (prompt 9a)
            if i == 0 and (note := road_note(res.warnings)):
                # about the first route only (prompt 5j, T-019); "not verified" is not a
                # demo-safe phrase, so the note uses the product's "not checked yet"
                r["road_note"] = note.replace("is not verified", "is not checked yet")
            if i == 0:
                rec.route_warnings[r["id"]] = list(res.warnings)
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
        if kwargs.get("file_vrs", True):
            await _file_journey_vrs(deps, res.data, kwargs["question_summary"])
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
    if name == "simulate_marathon" and res.ok and isinstance(res.data, dict):
        # The course's impact is a closure simulation: the same trip, pressure and suggestion
        # checks apply. The course rides along for the course checks and the marathon card.
        course = res.data.get("course") or {}
        rec.events.append({**(res.data.get("impact") or {}), "course": course})
        rec.marathons.append({**res.data, "requested_km": kwargs.get("distance_km")})
        rec.place_names |= {r["name"] for r in course.get("roads") or []}
        rec.place_names |= {course.get("start") or "", course.get("finish") or ""} - {""}
        imp = res.data.get("impact") or {}
        rec.place_names |= {r["name"] for r in imp.get("detour_roads") or []}
        rec.place_names |= {p["name"] for p in imp.get("places_cut_off") or []}
    if name in ("simulate_event", "simulate_closure") and res.ok and isinstance(res.data, dict):
        rec.events.append(res.data)
        # road and place names hold digits ("Persiaran Elmina 1/1"): names, not counts
        rec.place_names |= {r["name"] for r in res.data.get("detour_roads") or []}
        rec.place_names |= {p["name"] for p in res.data.get("places_cut_off") or []}
        rec.place_names |= {(res.data.get("event") or {}).get("name") or ""} - {""}
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
                # T-024: the places the validator lets an answer call flooded or cut off
                "flooded": {p["id"]: p["name"] for p in d.get("flooded_places") or []},
                "possible": {
                    i["id"]: i["name"] for i in d.get("possible") or [] if i.get("kind") != "path"
                },
                "cut_off": {p["id"]: p["name"] for p in d.get("cut_off_places") or []},
            }
        )
    if name == "rising_river_rollout" and res.ok and isinstance(res.data, dict):
        res.data.pop("routes", None)  # geometry and per-resident rows stay out of the prompt
        res.data.pop("residents", None)
        rec.rollouts.append(res.data)
        # start places hold digits ("Harmoni 1 @ City of Elmina Show Units"): names, not counts
        rec.place_names |= {
            c["origin_name"] for c in res.data.get("first_cut_off") or [] if c.get("origin_name")
        }
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
    if name == "rehearse_my_trip" and res.ok and isinstance(res.data, dict):
        rec.my_trips.append(res.data)
        stage = res.data.get("stage_at_leave")
        if stage:  # the river stage at the time of leaving: flood disclaimer and guidance apply
            rec.scenarios_used.add(stage)
            rec.day_stages.add(stage)
        d = res.data
        # place names and street labels hold digits ("Jalan Hopea U15/17D"): names, not counts
        rec.place_names |= {x.get("name") for x in (d.get("from") or {}, d.get("to") or {})} - {
            None
        }
        rec.place_names |= set(d.get("cut_by") or [])
        rec.place_names |= {(d.get("scenario") or {}).get("label") or ""} - {""}
    if name == "day_test_change" and res.ok and isinstance(res.data, dict):
        rec.day_changes.append(res.data)
        stages = res.data.get("river_stages") or []
        if stages:
            by_m = {s.id: s.stage_m for s in deps.ctx.world.flood.scenarios}
            top = max(stages, key=lambda s: by_m.get(s, 0))
            rec.scenarios_used.add(top)
            rec.day_stages.add(top)
        # labels are server text with digits ("about 931 m", "of 1129 residents"): names
        rec.place_names |= {g["label"] for g in res.data.get("groups") or [] if g.get("label")}
        rec.place_names |= {
            t
            for o in [res.data, *(res.data.get("options") or [])]
            for t in (o.get("change"), o.get("why"))
            if t
        }
    if name == "simulate_development" and res.ok and isinstance(res.data, dict):
        # The plan is for the development.play intent (run.py), not for the model: only the
        # brief numbers and the computed facts stay in the record the validator checks.
        if plan := res.data.pop("plan", None):
            rec.development_plan = DevelopmentPlan.model_validate(plan)
        rec.developments.append(res.data)
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
    out = _for_model(name, _without_closure_notes(res.model_dump(mode="json")))
    world = deps.ctx.world
    subject = None
    if name == "nearby_amenities":  # each row is that amenity, measured from the origin
        if res.ok:
            rec.amenity_searches.append(
                {
                    "origin_id": kwargs["origin_id"],
                    "amenity": kwargs["amenity"],
                    "ids": [row["id"] for row in res.data],
                }
            )
            rec.measurement_subjects.extend(
                {
                    "place_ids": [kwargs["origin_id"], row["id"]],
                    "values": tool_values(row),
                }
                for row in res.data
            )
        subject = categories(str(kwargs.get("amenity", ""))) | place_categories(
            world, str(kwargs.get("origin_id", ""))
        )
    measures = tool_values(out, resolve=lambda pid: place_categories(world, pid), subject=subject)
    # The search radius the model chose ("no toilet within 300 m") is a length it may repeat,
    # tagged like the rows it bounded (live T-017 q05).
    args = {k: v for k, v in kwargs.items() if k == "max_walk_m"}
    if args:
        measures = merge(measures, tool_values({"data": [args]}, subject=subject))
    for unit, vals in measures.items():
        rec.tool_measures.setdefault(unit, set()).update(vals)
    return out


def _course_refusal(deps: Deps, name: str, exc: CourseError) -> dict:
    """A course the engine cannot run (unknown, ambiguous or too long road): the reason goes
    back to the model, and its counts and road names count as this turn's tool output, so a
    reply that relays them ("51 mapped segments", "between Bulatan Elmina and ...") passes."""
    msg = str(exc)
    deps.rec.tool_calls.append(name)
    for unit, vals in tool_values({"warnings": [msg]}).items():
        deps.rec.tool_measures.setdefault(unit, set()).update(vals)
    for a, b in re.findall(r"(\d+) mapped segments.*?at most (\d+)", msg):
        deps.rec.tool_measures.setdefault("count", set()).update({float(a), float(b)})
    deps.rec.place_names |= {
        e.name for e in deps.ctx.world.edges.values() if e.name and e.name in msg
    }
    return {"ok": False, "data": None, "evidence": [], "warnings": [msg]}


def place_categories(world, place_id: str) -> set[str]:
    """What a place or centre is (facts.categories of its type and name), so a route's length
    is bound to its two ends ("the toilet is 440.6 m from the mall" needs a toilet end)."""
    if place_id.startswith("__centre__"):
        c = world.centres.get(place_id.removeprefix("__centre__"))
        return {"centre"} | categories(c.name if c else "")
    p = world.places.get(place_id)
    return categories(f"{p.type} {p.name} {' '.join(p.aliases)}") if p else set()


# Id lists the model never needs: on the Elmina seed affected_places at +3 m lists 2,468 edge ids
# (825 KB), which pushed a live turn past its timeout (eval, Cycle 5). Totals stay.
_MODEL_DROP = {
    "affected_places": ("likely_edge_ids", "possible_edge_ids"),
    "day_test_change": ("changed_geojson",),  # for the map only
    "rehearse_my_trip": ("track", "normal_route", "cut_lines"),  # for the map only
}
_MODEL_CAP = {"affected_places": ("likely_place_ids", "possible_place_ids")}


MODEL_EVIDENCE_CAP = 60  # evidence rows sent to the model; the TurnRecord keeps them all


# Centre fields the model never needs (map position, graph node): the UI and TurnRecord keep them.
_CENTRE_DROP = ("coord", "node_id")


def _compact_centres(rows: list) -> tuple[list, str | None]:
    """list_evacuation_centres as the model sees it: one shared disclaimer instead of one per
    centre, no map coordinates or graph node ids, no empty fields. Ids, names, source,
    reachability, route status and closures stay, so answers and plan_route calls still work."""
    disclaimers = {r.get("disclaimer") for r in rows if isinstance(r, dict)}
    shared = disclaimers.pop() if len(disclaimers) == 1 else None
    out = []
    for r in rows:
        if not isinstance(r, dict):
            out.append(r)
            continue
        row = {k: v for k, v in r.items() if v is not None and not (shared and k == "disclaimer")}
        if isinstance(row.get("centre"), dict):
            row["centre"] = {
                k: v for k, v in row["centre"].items() if v is not None and k not in _CENTRE_DROP
            }
        out.append(row)
    return out, shared


def _for_model(name: str, out: dict) -> dict:
    if name == "list_evacuation_centres" and isinstance(out.get("data"), list):
        out["data"], shared = _compact_centres(out["data"])
        if shared:
            out["disclaimer"] = shared
        if isinstance(out.get("evidence"), list):
            out["evidence"] = [
                {k: v for k, v in e.items() if v is not None} if isinstance(e, dict) else e
                for e in out["evidence"]
            ]
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
        if name == "simulate_marathon":  # per-trip rows, ids, animation: map only
            data.pop("animation", None)
            course = data.get("course")
            if isinstance(course, dict):
                for k in ("segment_ids", "start_node", "finish_node"):
                    course.pop(k, None)
            imp = data.get("impact")
            if isinstance(imp, dict):
                imp.pop("trips", None)
                for c in (imp.get("event") or {}).get("closures") or []:
                    if isinstance(c, dict):
                        c.pop("segment_ids", None)
                for r in imp.get("detour_roads") or []:
                    if isinstance(r, dict):
                        r.pop("segment_ids", None)
        if name in ("simulate_event", "simulate_closure"):  # per-trip rows, ids: map only
            data.pop("trips", None)
            if isinstance(data.get("event"), dict):
                data["event"].pop("segment_ids", None)
            for r in [*(data.get("detour_roads") or []), *(data.get("closures") or [])]:
                if isinstance(r, dict):
                    r.pop("segment_ids", None)
        if name == "affected_places":  # T-024 marker rows: map positions are for the UI only
            for k in ("flooded_places", "cut_off_places"):
                if isinstance(data.get(k), list):
                    data[k] = [{f: p.get(f) for f in ("id", "name", "type")} for p in data[k]]
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


def build_agent(
    model: Model,
    escalate_to: Model | None = None,
    assistant_scope: str | None = None,
    panel: str = "resident",
) -> Agent[Deps, FinalAnswer]:
    """`panel="management"` (T-023): every tool and no topic refusal, whatever the scope."""
    assistant_scope = "all" if panel == "management" else assistant_scope
    assistant_scope = assistant_scope or AgentSettings().assistant_scope
    agent = Agent(
        model,
        deps_type=Deps,
        output_type=ToolOutput(FinalAnswer, name="final_answer"),
        instructions=scoped_instructions(SYSTEM, assistant_scope, panel),
        capabilities=[escalation(escalate_to)] if escalate_to is not None else [],
    )

    def register_tool(fn):
        if assistant_scope == "all" or fn.__name__ in ACCESS_FLOOD_TOOLS:
            return agent.tool(fn)
        return fn

    @agent.instructions
    def ui_context(ctx: RunContext[Deps]) -> str:
        r = ctx.deps.request
        # Only ids that exist in the world are interpolated (never free text from the request).
        return (
            f"UI context: profile={r.profile}; active_scenario={ui_scenario(ctx.deps) or 'none'}; "
            f"assistant_scope={assistant_scope}; panel={panel}."
        )

    @register_tool
    async def find_place(
        ctx: RunContext[Deps],
        query: str,
        types: list[str] | None = None,
        limit: int = 5,
        near_place: str | None = None,
    ) -> dict:
        """Resolve exact place names. For a generic destination, resolve the origin first, then
        pass near_place=<origin id> to search only within 1 km. Multiple matches need clarification.
        Search proximity is straight-line context, never proof of a walkable route."""
        return await call_tool(
            ctx.deps, "find_place", query=query, types=types, limit=limit, near_place=near_place
        )

    @register_tool
    async def get_place_details(ctx: RunContext[Deps], place_id: str) -> dict:
        """All attributes of one place with status, evidence ids and verification dates."""
        return await call_tool(ctx.deps, "get_place_details", place_id=place_id)

    @register_tool
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
        Returns status confirmed|likely_ok|partly_unverified|blocked|no_data.
        likely_ok is estimated from map data, not checked on site."""
        return await call_tool(
            ctx.deps,
            "plan_route",
            from_id=from_id,
            to_id=to_id,
            profile=profile,
            scenario_id=scenario_id,
        )

    @register_tool
    async def nearby_amenities(
        ctx: RunContext[Deps],
        origin_id: str,
        amenity: str,
        max_walk_m: float = 300,
        profile: str | None = None,
        scenario_id: str | None = None,
    ) -> dict:
        """Amenities (toilet, seating, shelter, ...) within a walking distance along paths."""
        return await call_tool(
            ctx.deps,
            "nearby_amenities",
            origin_id=origin_id,
            amenity=amenity,
            max_walk_m=max_walk_m,
            profile=profile,
            scenario_id=scenario_id,
        )

    @register_tool
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

    @register_tool
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

    @register_tool
    async def list_flood_scenarios(ctx: RunContext[Deps]) -> dict:
        """Available indicative flood scenarios (river stage +N m) with disclaimers."""
        return await call_tool(ctx.deps, "list_flood_scenarios")

    @register_tool
    async def affected_places(
        ctx: RunContext[Deps], scenario_id: str, kind: str = "all", profile: str | None = None
    ) -> dict:
        """What is likely/possibly flooded under a scenario, plus isolated islands.
        Lists are capped. For counts use likely_place_count (places) and likely_path_count
        (path segments), and the possible_* pair: say "N places and M path segments", never
        likely_total as a number of places (it adds both). flooded_places are places likely
        flooded themselves; cut_off_places are not flooded but have no mapped way in or out;
        flooded_path_m is metres of likely flooded paths. Call a place flooded or cut off only
        when it is in that list."""
        return await call_tool(
            ctx.deps, "affected_places", scenario_id=scenario_id, kind=kind, profile=profile
        )

    @register_tool
    async def list_evacuation_centres(
        ctx: RunContext[Deps],
        scenario_id: str | None = None,
        profile: str | None = None,
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

    @register_tool
    async def find_waste_points(
        ctx: RunContext[Deps], type: str | None = None, near_place: str | None = None
    ) -> dict:
        """Recycling / e-waste / waste points with verification status."""
        return await call_tool(ctx.deps, "find_waste_points", type=type, near_place=near_place)

    @register_tool
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

    @register_tool
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

    @register_tool
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

    @register_tool
    async def river_tipping_point(
        ctx: RunContext[Deps], from_id: str, profile: str = "default", to_id: str | None = None
    ) -> dict:
        """At which river stage does a journey break? One journey (from_id -> to_id, or the
        nearest evacuation centre when to_id is omitted) across every precomputed stage: the
        status per stage, degrades_at and breaks_at (stage ids). Indicative, not a forecast."""
        return await call_tool(
            ctx.deps, "river_tipping_point", from_id=from_id, profile=profile, to_id=to_id
        )

    @register_tool
    async def rising_river_rollout(
        ctx: RunContext[Deps], profiles: list[str] | None = None, n: int = 30
    ) -> dict:
        """Synthetic residents per persona heading for the nearest evacuation centre at every
        river stage: counts per stage (reach, confirmed, cut_off, no_data) and who is cut off
        first. The app animates it on the map. Indicative simulation, not a forecast."""
        return await call_tool(ctx.deps, "rising_river_rollout", profiles=profiles, n=n)

    @register_tool
    async def rehearse_my_trip(
        ctx: RunContext[Deps],
        from_id: str,
        to_id: str,
        leave_at: str,
        day: Literal["weekday", "storm", "event", "friday"] = "storm",
        profile: str | None = None,
    ) -> dict:
        """A resident's own trip through an Elmina Day rehearsal: the same rehearsed day as the
        synthetic residents (river stage minute by minute, closures, re-planning on the way), at
        leave_at (HH:MM) and every 10 minutes around it. Says what happened to that trip in the
        rehearsal: got through, a longer way, only a very long way round, turned back, or no way,
        which flooded street cut it, and when the way came back. Place ids from find_place.
        profile: default|stroller|wheelchair|older_adult_rest|drive (default: the resident's)."""
        prof = profile or ctx.deps.request.profile or "default"
        return await call_tool(
            ctx.deps,
            "rehearse_my_trip",
            from_id=from_id,
            to_id=to_id,
            profile=prof,
            leave_at=str(leave_at).strip(),
            day=str(day).strip().lower(),
        )

    @register_tool
    async def day_test_change(
        ctx: RunContext[Deps],
        day: Literal["weekday", "storm", "event", "friday"] = "storm",
        option: int = 1,
    ) -> dict:
        """Test an imagined change on an Elmina Day rehearsal: the same day of 5,000 synthetic
        residents is run again with the change, and compared trip by trip (residents better and
        worse off, by group). Option 1 is the day's top suggestion (on a storm day the flooded
        stretch the most residents relied on); `options` in the result names them all, so call
        again with another number to test another. Imagined: never a plan or a forecast."""
        return await call_tool(
            ctx.deps, "day_test_change", day=str(day).strip().lower(), option=int(option)
        )

    @register_tool
    async def day_rehearsal(
        ctx: RunContext[Deps], day: Literal["weekday", "storm", "event", "friday"] = "storm"
    ) -> dict:
        """Elmina Day: a simulated day of 5,000 synthetic residents on the township model, in a
        built-in scenario: weekday, storm (the river rises during the school run), event (a
        night at the park) or friday (prayers). Trips by outcome, residents by group (children,
        older, wheelchair users, parents with strollers, households without a car), school
        and the busiest places. A rehearsal, not a forecast; residents are synthetic."""
        return await call_tool(ctx.deps, "day_rehearsal", day=str(day).strip().lower())

    @register_tool
    async def simulate_development(ctx: RunContext[Deps]) -> dict:
        """Developer lens: simulate the fixed demo brief, a hypothetical 30-storey, 500-home
        tower near Lakeside Mall, from construction to daily life. Call it only when the
        resident's message is that brief. It returns the brief numbers and `available`; the
        simulation itself is played on the map. Hypothetical: never an SDP project, never a
        forecast."""
        return await call_tool(ctx.deps, "simulate_development")

    @register_tool
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

    @register_tool
    async def simulate_event(
        ctx: RunContext[Deps],
        name: str,
        start: str,
        end: str,
        road_names: list[str] | None = None,
        segment_ids: list[str] | None = None,
        day: str | None = None,
        profiles: list[str] | None = None,
    ) -> dict:
        """Management: an event (marathon, parade) closes roads for a time window. Pass the
        roads as the user names them (road_names; one stretch as "<road> between <A> and <B>",
        A and B being roads that cross it), start and end as HH:MM local time, and day
        as YYYY-MM-DD only when the user gives a date. Compares everyday sample trips (walking,
        wheelchair, driving) without and with the closures: trips affected, trips that newly
        lose a route, places cut off, detour roads ranked by rerouted trips, and suggestions.
        An estimate from mapped roads and sample trips, not traffic counts."""
        world = ctx.deps.ctx.world
        try:
            segs = course_segments(world, road_names, segment_ids)
            event_window(start, end, day, world.site.timezone)
        except CourseError as exc:  # unknown or ambiguous road, too long a course, bad time
            return _course_refusal(ctx.deps, "simulate_event", exc)
        return await call_tool(
            ctx.deps,
            "simulate_event",
            name=name,
            road_names=road_names or [],
            segment_ids=segs,
            start=start,
            end=end,
            day=day,
            profiles=profiles,
        )

    async def simulate_closure(
        ctx: RunContext[Deps],
        name: str,
        reason: ClosureReason,
        closures: list[ClosureInput],
        profiles: list[str] | None = None,
    ) -> dict:
        """Management (T-026): any closure (event, works, accident, flooding, other), one or
        several, each with its window. Each closure: road_names as the user names them (one
        stretch as "<road> between <A> and <B>"), start and end as HH:MM local time, and day as
        a weekday ("tuesday"), "tomorrow" or YYYY-MM-DD only when the user gives one. Compares
        everyday sample trips (walking, wheelchair, driving) without and with the closures:
        trips affected, trips that newly lose a route, places cut off, detour roads with their
        detour pressure band (managers only), and suggestions. Detour pressure is estimated
        from mapped road class and sample trips, not traffic counts."""
        world = ctx.deps.ctx.world
        rows = []
        try:
            for c in closures:
                segs = course_segments(world, c.road_names, c.segment_ids)
                event_window(c.start, c.end, c.day, world.site.timezone)
                rows.append({**c.model_dump(), "segment_ids": segs})
        except CourseError as exc:  # unknown or ambiguous road, too long a course, bad time
            return _course_refusal(ctx.deps, "simulate_closure", exc)
        return await call_tool(
            ctx.deps, "simulate_closure", name=name, reason=reason, closures=rows, profiles=profiles
        )

    if "simulate_closure" in sp.TOOLS:  # the backend tool (T-026) is bound once it exists
        register_tool(simulate_closure)

    async def simulate_marathon(
        ctx: RunContext[Deps],
        start: str,
        distance_km: float,
        start_time: str,
        end_time: str,
        day: str | None = None,
        shape: Literal["loop", "point_to_point"] = "loop",
        finish: str | None = None,
        avoid_roads: list[str] | None = None,
        prefer_roads: list[str] | None = None,
    ) -> dict:
        """Management (T-028): propose a marathon or fun-run course on mapped roads and simulate
        closing it. start (and finish for point_to_point) is a mapped place id or its full name
        (resolve it with find_place first); distance_km as asked; start_time and end_time as
        HH:MM local time; day as a weekday ("sunday"), "tomorrow" or YYYY-MM-DD only when the
        user gives one. Edits from the manager ("avoid Persiaran Elmina", "make it 10 km",
        "finish at the mall") are a new call with avoid_roads, distance_km or finish. Returns
        the course (roads in order with lengths; a proposal, not an approved route) and the
        closure impact: sample trips affected, trips that start or end on the course, places
        cut off, detour roads with their detour pressure band (managers only), suggestions."""
        return await call_tool(
            ctx.deps,
            "simulate_marathon",
            start=start,
            distance_km=distance_km,
            start_time=start_time,
            end_time=end_time,
            day=day,
            shape=shape,
            finish=finish,
            avoid_roads=avoid_roads or [],
            prefer_roads=prefer_roads or [],
        )

    if "simulate_marathon" in sp.TOOLS:  # the backend tool (T-028)
        register_tool(simulate_marathon)

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
