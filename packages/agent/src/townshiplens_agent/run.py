"""One chat turn as a stream of ChatEvents. Always ends with Done, whatever the model does."""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator

from pydantic_ai.exceptions import UnexpectedModelBehavior
from townshiplens_spatial import tools as sp

from . import agent as agent_mod
from . import demo
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
from .labels import closure_line, element_label, rest_caveats, route_status_text, unknown_note
from .record import TurnRecord
from .settings import AgentSettings
from .template import template_answer
from .validate import PLACEHOLDER_CAVEAT

log = logging.getLogger(__name__)

CHUNK = 40
DEFAULT_DISCLAIMER = (
    "Indicative scenario, not a forecast. Follow official MBSA / JPS / NADMA guidance."
)


def _route_status_line(ans: FinalAnswer, rec: TurnRecord) -> str | None:
    # Same route the validator checked: the named one, else the only one. With several routes and
    # no route_id the label would name a route nobody verified, so it is left out.
    if ans.route_id in rec.routes:
        rid = ans.route_id
    elif len(rec.routes) == 1:
        rid = next(iter(rec.routes))
    else:
        return None
    return (
        f"Route status: {route_status_text(rec.route_status.get(rid, 'no_data'), rec.routes[rid])}"
    )


_UNKNOWN_LINES = (
    "not checked yet",
    "and ",
    "asked the township",
    "some segments are still unverified",
    "route status:",
)


def _norm(text: str) -> str:
    return " ".join(text.lower().rstrip(". ").split())


def _covered(caveat: str, items: list[dict[str, str]], has_unknowns: bool) -> bool:
    low = _norm(caveat)
    if PLACEHOLDER_CAVEAT in low and any(i["attribute"] == "demo_values" for i in items):
        return True
    if has_unknowns and low.startswith(_UNKNOWN_LINES):
        return True
    return any(
        _norm(i["note"]) and (_norm(i["note"]) in low or low in _norm(i["note"])) for i in items
    )


def _caveat_items(rec: TurnRecord, ans: FinalAnswer) -> list[dict[str, str]]:
    """Uncertainty items for every caveat except unchecked segments: rest gap, unverified rest
    points, closures, inferred entrances and demo values, each in readable form."""
    out: list[dict[str, str]] = []
    for rid, route in rec.routes.items():
        if route.get("rest_limit_met") is False:
            if lines := rest_caveats(route):  # empty when the route carries no rest limit
                out.append({"element_id": rid, "attribute": "rest_gap", "note": lines[0]})
            continue
        needed = set(route.get("rest_points_unverified") or [])
        for p in route.get("rest_points") or []:
            if p.get("place_id") in needed:
                name = p.get("name") or "an unnamed rest point"
                out.append(
                    {
                        "element_id": p["place_id"],
                        "attribute": "rest_point",
                        "note": f"Rest point not checked yet: {name}",
                    }
                )
    on_route = {c["id"] for c in rec.route_closures}
    listed = [c for c in rec.closures.values() if c.get("active") and c["id"] not in on_route]
    out += [
        {"element_id": c["element_id"], "attribute": "closure", "note": closure_line(c)}
        for c in [*rec.route_closures, *listed]
    ]
    out += [
        {"element_id": "route", "attribute": "entrance", "note": n.rstrip(".")}
        for n in rec.inferred_notes
    ]
    if any(PLACEHOLDER_CAVEAT in c.lower() for c in ans.caveats):
        out.append(
            {
                "element_id": "route",
                "attribute": "demo_values",
                "note": f"Some segment facts are {PLACEHOLDER_CAVEAT}",
            }
        )
    return out


def _answer_events(
    ans: FinalAnswer, rec: TurnRecord, ctx: sp.Ctx, ui_scenario_id: str | None = None
) -> list[ChatEvent]:
    evs: list[ChatEvent] = []
    text = ans.summary
    if ans.steps:
        text += "\n" + "\n".join(f"{i}. {s}" for i, s in enumerate(ans.steps, 1))
    if ans.caveats:
        text = "⚠ " + "; ".join(c.rstrip(". ") for c in ans.caveats) + ".\n" + text
    # Fixed order: status label, then the caveat line, then the summary and steps.
    if label := _route_status_line(ans, rec):
        text = label + "\n" + text
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
                        photo_url=e.photo_url,
                    )
                )

    unknowns = [u for r in rec.routes.values() for u in r.get("unknowns", [])]

    def _note(u: dict) -> str:
        edge = ctx.world.edges.get(u["element_id"])
        return unknown_note(
            u, element_label(edge.name if edge else None, edge.type if edge else None)
        )

    items = [
        {"element_id": u["element_id"], "attribute": u["attribute"], "note": _note(u)}
        for u in unknowns
    ]
    items += _caveat_items(rec, ans)
    # Every caveat is an item: whatever no specific item covers gets a plain one, so "partial"
    # never comes with an empty list.
    items += [
        {"element_id": "answer", "attribute": "caveat", "note": c.rstrip(". ")}
        for c in ans.caveats
        if not _covered(c, items, bool(unknowns))
    ]
    # Partial whenever the answer carries any caveat (not only unchecked segments).
    level = "partial" if unknowns or items or ans.caveats else "none"
    if ans.answer_status == "cannot_answer":
        level = "high"
    evs.append(Uncertainty(level=level, items=items))

    if (
        rec.scenarios_used
        or ans.scenario_id
        or ui_scenario_id
        or "list_flood_scenarios" in rec.tool_calls
    ):
        sid = (
            ans.scenario_id
            or next((s for s in sorted(rec.scenarios_used) if s.startswith("stage_")), None)
            or ui_scenario_id
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
    if settings.demo_mode:
        cached = demo.load(demo.key(req), settings.demo_dir, ctx.world.site.id)
        if cached:
            async for ev in demo.replay(cached, ctx.vrs):
                yield ev
            return
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

        async def bounded_run():
            async with asyncio.timeout(settings.turn_timeout_s):
                return await agent.run(
                    req.message, deps=deps, retries={"output": settings.llm_output_retries}
                )

        task = asyncio.create_task(bounded_run())
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
    if isinstance(failure, TimeoutError):
        log.warning("agent turn timed out after %ss", settings.turn_timeout_s)
        yield ErrorEvent(
            code="agent_timeout", message=f"turn timed out after {settings.turn_timeout_s}s"
        )
    elif failure is not None:
        log.warning("agent turn failed: %s", type(failure).__name__)
        yield ErrorEvent(code="agent_error", message=_scrub(str(failure), settings))
    try:
        if ans is None:
            used = model_name + "+template"
            ans = template_answer(rec, req.message)
        events = _answer_events(ans, rec, ctx, req.scenario_id)
    except Exception as exc:  # last resort: never leave the client without done
        log.warning("answer rendering failed: %s", type(exc).__name__)
        if rec.scenarios_used:
            yield Disclaimer(text=DEFAULT_DISCLAIMER)
        yield ErrorEvent(code="internal", message="could not build the answer")
        yield Done(message_id=msg_id, answer_status="cannot_answer", model=used)
        return
    for ev in events:
        yield ev
    yield Done(message_id=msg_id, answer_status=ans.answer_status, model=used)
