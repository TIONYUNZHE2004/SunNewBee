"""The PydanticAI agent: 10 deterministic spatial tools + the forced `final_answer` output tool.

Tool wrappers record evidence/routes/scenarios into the TurnRecord (what the validator checks)
and push ToolCall / ToolResultEvent / VerificationRequested onto the record's queue, which
`run.run_turn` streams to the client while the agent is still running.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic_ai import Agent, ModelRetry, RunContext, ToolOutput
from pydantic_ai.models import Model
from pydantic_ai.models.openrouter import OpenRouterModel
from pydantic_ai.providers.openrouter import OpenRouterProvider
from townshiplens_spatial import tools as sp

from .answer import FinalAnswer
from .events import ChatRequest, ToolCall, ToolResultEvent, VerificationRequested
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


async def call_tool(deps: Deps, name: str, **kwargs: Any) -> dict:
    """Run one spatial tool, record what it returned and stream its events."""
    rec = deps.rec
    call_id = f"{name}-{len(rec.tool_calls)}"
    rec.tool_calls.append(name)
    await _emit(deps, ToolCall(id=call_id, name=name, args=dict(kwargs)))
    if name == "plan_route":
        # Shown to staff on the VR: describe the request, never copy the user's words (PII).
        kwargs["question_summary"] = (
            f"{kwargs.get('profile')} route {kwargs.get('from_id')} -> {kwargs.get('to_id')}"
        )
    res: sp.ToolResult = sp.TOOLS[name](deps.ctx, **kwargs)
    for e in res.evidence:
        rec.evidence[e.id] = e
    if name == "plan_route" and isinstance(res.data, dict):
        for r in res.data.get("routes", []):
            rec.routes[r["id"]] = r
            rec.route_status[r["id"]] = r["status"]
        for vr in res.data.get("verification_requests", []):
            rec.vrs.append(vr)
            await _emit(deps, _vr_event(vr))
    if name == "create_verification_request" and res.ok:
        rec.vrs.append(res.data)
        await _emit(deps, _vr_event(res.data))
    sid = kwargs.get("scenario_id")
    if sid:  # plan_route / affected_places / list_evacuation_centres with a scenario
        rec.scenarios_used.add(sid)
    elif name == "list_flood_scenarios" and deps.request.scenario_id:
        rec.scenarios_used.add(deps.request.scenario_id)
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
        return f"UI context: profile={r.profile}; active_scenario={r.scenario_id or 'none'}."

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
    async def get_closures(ctx: RunContext[Deps], scope_ids: list[str] | None = None) -> dict:
        """Active and upcoming closures."""
        return await call_tool(ctx.deps, "get_closures", scope_ids=scope_ids)

    @agent.tool
    async def create_verification_request(
        ctx: RunContext[Deps], target_id: str, attribute: str, reason: str, question_summary: str
    ) -> dict:
        """Log a gap for staff (reason: unknown|stale|contradicted|missing_place|user_report).
        No personal data in question_summary."""
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
