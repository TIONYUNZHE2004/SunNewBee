"""One chat turn as a stream of ChatEvents. Always ends with Done, whatever the model does."""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator

from pydantic_ai.exceptions import UnexpectedModelBehavior
from townshiplens_spatial import tools as sp

from . import agent as agent_mod
from .answer import FinalAnswer
from .events import (
    ChatEvent,
    ChatRequest,
    Citation,
    Disclaimer,
    Done,
    ErrorEvent,
    SceneIntentEvent,
    TextDelta,
    Uncertainty,
)
from .record import TurnRecord
from .settings import AgentSettings
from .template import template_answer

log = logging.getLogger(__name__)

CHUNK = 40
DEFAULT_DISCLAIMER = (
    "Indicative scenario, not a forecast. Follow official MBSA / JPS / NADMA guidance."
)


def _answer_events(ans: FinalAnswer, rec: TurnRecord, ctx: sp.Ctx) -> list[ChatEvent]:
    evs: list[ChatEvent] = []
    text = ans.summary
    if ans.steps:
        text += "\n" + "\n".join(f"{i}. {s}" for i, s in enumerate(ans.steps, 1))
    if ans.caveats:
        text = "⚠ " + " ".join(ans.caveats) + "\n" + text
    evs += [TextDelta(delta=text[i : i + CHUNK]) for i in range(0, len(text), CHUNK)]

    for it in ans.scene_intents:
        intent = it.model_copy()
        if intent.kind == "route.highlight":
            route = rec.routes.get(intent.route_id or "")
            if route is None:
                continue  # nothing to draw: the route was not returned this turn
            intent.geojson = route["geometry"]
        evs.append(SceneIntentEvent(intent=intent))

    ref = 0
    cited: set[str] = set()
    for c in ans.claims:
        for eid in c.evidence_ids:
            e = rec.evidence.get(eid)
            if e and eid not in cited:
                cited.add(eid)
                ref += 1
                evs.append(
                    Citation(
                        ref=ref,
                        evidence_id=eid,
                        element_id=e.element_id,
                        attribute=e.attribute,
                        status=str(e.status),
                        verified_at=e.verified_at,
                        source_type=e.source_type,
                    )
                )

    unknowns = [u for r in rec.routes.values() for u in r.get("unknowns", [])]
    level = "partial" if unknowns else "none"
    if ans.answer_status == "cannot_answer":
        level = "high"
    items = [
        {"element_id": u["element_id"], "attribute": u["attribute"], "note": u.get("why", "")}
        for u in unknowns
    ]
    evs.append(Uncertainty(level=level, items=items))

    if rec.scenarios_used or ans.scenario_id or "list_flood_scenarios" in rec.tool_calls:
        sid = ans.scenario_id or next(
            (s for s in sorted(rec.scenarios_used) if s.startswith("stage_")), None
        )
        sc = next((s for s in ctx.world.flood.scenarios if s.id == sid), None)
        evs.append(
            Disclaimer(text=sc.disclaimer, links=sc.links)
            if sc
            else Disclaimer(text=DEFAULT_DISCLAIMER)
        )
    return evs


def _scrub(msg: str, settings: AgentSettings) -> str:
    key = settings.openrouter_api_key
    if key:
        msg = msg.replace(key, "***")
    return msg[:200]


async def run_turn(
    ctx: sp.Ctx, req: ChatRequest, settings: AgentSettings | None = None
) -> AsyncIterator[ChatEvent]:
    settings = settings or AgentSettings()
    rec = TurnRecord(queue=asyncio.Queue())
    deps = agent_mod.Deps(ctx=ctx, rec=rec, request=req)
    msg_id = uuid.uuid4().hex[:12]
    model_name = "unknown"
    ans: FinalAnswer | None = None
    failure: Exception | None = None

    try:
        model = agent_mod.model_for(settings)
        model_name = getattr(model, "model_name", None) or "unknown"
        agent = agent_mod.build_agent(model)
    except Exception as exc:  # misconfiguration (e.g. no key): still answer from the template
        failure = exc
    else:
        task = asyncio.create_task(
            agent.run(req.message, deps=deps, retries={"output": settings.llm_output_retries})
        )
        getter: asyncio.Future | None = None
        try:
            # Stream tool events from the queue while the agent runs.
            while True:
                getter = asyncio.ensure_future(rec.queue.get())
                done, _ = await asyncio.wait({getter, task}, return_when=asyncio.FIRST_COMPLETED)
                if getter in done:
                    yield getter.result()
                    continue
                # Cancel before draining: a woken-but-pending getter could otherwise take an
                # item while we are suspended in a yield below, and that event would be lost.
                getter.cancel()
                break
            while not rec.queue.empty():
                yield rec.queue.get_nowait()
        finally:
            if getter is not None and not getter.done():
                getter.cancel()
            if not task.done():
                task.cancel()  # the client went away mid-turn
        try:
            ans = task.result().output
        except UnexpectedModelBehavior as exc:  # e.g. output retries exhausted by the validator
            log.info("model output rejected, using template: %s", type(exc).__name__)
        except Exception as exc:  # network / provider / tool error
            failure = exc

    used = model_name
    if failure is not None:
        log.warning("agent turn failed: %s", type(failure).__name__)
        yield ErrorEvent(code="agent_error", message=_scrub(str(failure), settings))
    if ans is None:
        ans = template_answer(rec, req.message)
        used = model_name + "+template"
    for ev in _answer_events(ans, rec, ctx):
        yield ev
    yield Done(message_id=msg_id, answer_status=ans.answer_status, model=used)
