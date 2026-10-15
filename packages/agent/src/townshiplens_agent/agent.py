"""The PydanticAI agent: 10 deterministic spatial tools + the forced `final_answer` output tool.

Tool wrappers record evidence/routes/scenarios into the TurnRecord (what the validator checks)
and push ToolCall / ToolResultEvent / VerificationRequested onto the record's queue, which
`run.run_turn` streams to the client while the agent is still running.
"""

import asyncio
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, get_args

from pydantic_ai import Agent, ModelRetry, RunContext, ToolOutput
from pydantic_ai.models import Model
from pydantic_ai.models.openrouter import OpenRouterModel
from pydantic_ai.providers.openrouter import OpenRouterProvider
from townshiplens_spatial import tools as sp
from townshiplens_spatial.models import Evidence, VerificationRequest
from townshiplens_spatial.routing import CENTRE_PREFIX
from townshiplens_spatial.scenario_meta import scenario_source

from .answer import FinalAnswer
from .events import ChatRequest, ToolCall, ToolResultEvent, VerificationRequested
from .labels import enrich_unknowns
from .mock import mock_model
from .record import TurnRecord
from .settings import AgentSettings
from .validate import validate_answer

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
    return OpenRouterModel(name, provider=provider)


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
        return f"{d.get('likely_total', 0)} likely, {d.get('possible_total', 0)} possible"
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


SCENARIO_TOOLS = ("plan_route", "list_evacuation_centres", "affected_places")


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
            w for w in res.warnings if w.startswith("Route ") and "entrance is not mapped" in w
        ]
        for vr in res.data.get("verification_requests", []):
            rec.vrs.append(vr)
            await _emit(deps, _vr_event(vr))
    if name == "get_closures" and res.ok and isinstance(res.data, list):
        rec.closures.update({c["id"]: c for c in res.data})
    if name == "create_verification_request" and res.ok:
        rec.vrs.append(res.data)
        await _emit(deps, _vr_event(res.data))
    sid = kwargs.get("scenario_id")
    if sid:  # plan_route / affected_places / list_evacuation_centres with a scenario
        rec.scenarios_used.add(sid)
    elif name == "list_flood_scenarios" and ui_scenario(deps):
        rec.scenarios_used.add(ui_scenario(deps))
    await _emit(deps, ToolResultEvent(id=call_id, name=name, summary=_summarise(name, res)))
    return res.model_dump(mode="json")


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
        Lists are capped: use likely_total / possible_total for counts."""
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

    @agent.output_validator
    def check(ctx: RunContext[Deps], out: FinalAnswer) -> FinalAnswer:
        errs = validate_answer(out, ctx.deps.rec)
        if errs:
            raise ModelRetry(" ".join(errs))
        return out

    return agent
