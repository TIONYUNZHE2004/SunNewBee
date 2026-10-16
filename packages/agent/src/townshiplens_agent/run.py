"""One chat turn as a stream of ChatEvents. Always ends with Done, whatever the model does."""

import asyncio
import logging
import re
import uuid
from collections.abc import AsyncIterator

from pydantic_ai.exceptions import UnexpectedModelBehavior
from townshiplens_spatial import tools as sp

from . import agent as agent_mod
from . import demo
from .answer import FinalAnswer
from .draft import DraftStreamer
from .events import (
    ChatEvent,
    ChatRequest,
    Citation,
    Disclaimer,
    Done,
    ErrorEvent,
    SceneIntent,
    SceneIntentEvent,
    TextDelta,
    Uncertainty,
)
from .labels import (
    CLOSURE_WORDS,
    FRAME,
    closure_line,
    detect_language,
    element_label,
    rest_caveats,
    route_status_line,
    unknown_note,
)
from .memory import DEFAULT as DEFAULT_MEMORY
from .memory import SessionMemory
from .record import TurnRecord
from .settings import AgentSettings
from .template import template_answer
from .validate import PLACEHOLDER_CAVEAT

log = logging.getLogger(__name__)

CHUNK = 40
WHATIF_NOTE = "What-if simulation: imagined changes are not real; unverified facts stay unverified"
DEFAULT_DISCLAIMER = (
    "Indicative scenario, not a forecast. Follow official MBSA / JPS / NADMA guidance."
)


def _route_status_line(ans: FinalAnswer, rec: TurnRecord, lang: str = "en") -> str | None:
    # Same route the validator checked: the named one, else the only one. With several routes and
    # no route_id the label would name a route nobody verified, so it is left out.
    if ans.route_id in rec.routes:
        rid = ans.route_id
    elif len(rec.routes) == 1:
        rid = next(iter(rec.routes))
    else:
        return None
    return route_status_line(rec.route_status.get(rid, "no_data"), rec.routes[rid], lang)


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


CAVEAT_HEAD = "Worth knowing:"
URGENT_MARK = "⚠"


def _strip_label(text: str, label: str | None) -> str:
    """Remove an exact leading copy of the status label ("Route status: blocked." / "Route
    status: blocked —") and nothing else. Returns "" only when the text was just the label."""
    text = text.strip()
    if not label:
        return text
    m = re.match(rf"\s*{re.escape(label)}\s*(?:[.;,:\u2014\u2013-]\s*)?", text, re.IGNORECASE)
    if not m:
        return text
    rest = text[m.end() :].strip()
    if rest.startswith("(") and rest.endswith(")") and rest.count("(") == 1:
        rest = rest[1:-1].strip()
    return rest[:1].upper() + rest[1:]


# "flooded" in the three answer languages (Cycles 5-6 review A9).
FLOOD_WORDS = ("flooded", "dinaiki air", "dilanda air", "banjir", "被淹", "受淹", "淹没")


def _urgent(caveat: str, rec: TurnRecord | None) -> bool:
    """Caveats that change whether to go at all: a staff-reported closure, or the start or
    destination being flooded in the scenario. They are pinned above the summary."""
    if rec is None:
        return False
    low = caveat.lower()
    if CLOSURE_WORDS.lower() in low:
        return True
    names = {str(i.get("name", "")).lower() for i in rec.flooded_endpoints.values()}
    names |= {p.lower() for p in rec.flooded_endpoints}
    flooded = any(w in low for w in FLOOD_WORDS)
    return flooded and any(n and n in low for n in names)


def answer_text(
    ans: FinalAnswer, label: str | None, rec: TurnRecord | None = None, lang: str = "en"
) -> str:
    """Resident-facing text, answer first:

    1. the route status label (when a route was checked);
    2. urgent caveats (closures, a flooded start or destination), each on a "⚠" line;
    3. the summary and numbered steps;
    4. every other caveat under "Worth knowing:", one "•" line each.

    Presentation only: every caveat is printed in full (an exact copy of the label is the only
    text ever removed), so whatever the validator required is still in the text."""
    summary = _strip_label(ans.summary, label) or ans.summary
    urgent: list[str] = []
    rest: list[str] = []
    seen: set[str] = set()
    for raw in ans.caveats:
        c = _strip_label(raw, label)
        key = _norm(c)
        if not c or key in seen:
            continue  # empty only when the caveat was just the label, which line 1 says
        if key in _norm(summary) and not _urgent(c, rec):
            continue  # already said in the summary
        seen.add(key)
        if _urgent(c, rec):
            urgent.append(c)
        elif rest and c.startswith("and ") and rest[-1].lower().startswith("not checked yet"):
            rest[-1] = rest[-1].rstrip(".") + "; " + c  # "and N more unchecked items"
        else:
            rest.append(c)

    def dot(c: str) -> str:
        return c if c.endswith((".", "!", "?", "。", "！", "？")) else c + "."

    parts = [label] if label else []
    parts += [f"{URGENT_MARK} {dot(c)}" for c in urgent]
    parts.append(summary)
    if ans.steps:
        parts.append("\n".join(f"{i}. {s}" for i, s in enumerate(ans.steps, 1)))
    if rest:
        head = FRAME.get(lang, FRAME["en"])["worth"]
        parts.append(head + "\n" + "\n".join(f"• {dot(c)}" for c in rest))
    return "\n".join(parts)


def _answer_events(
    ans: FinalAnswer,
    rec: TurnRecord,
    ctx: sp.Ctx,
    ui_scenario_id: str | None = None,
    lang: str = "en",
) -> list[ChatEvent]:
    evs: list[ChatEvent] = []
    text = answer_text(ans, _route_status_line(ans, rec, lang), rec, lang)
    evs += [TextDelta(delta=text[i : i + CHUNK]) for i in range(0, len(text), CHUNK)]

    intents = list(ans.scene_intents)
    day_stage = next(iter(sorted(rec.day_stages)), None)
    if day_stage and not any(i.kind == "flood.set_level" for i in intents):
        # a storm rehearsal shows its peak river stage on the map, as a scenario answer does
        intents.append(
            SceneIntent(kind="flood.set_level", scenario_id=ans.scenario_id or day_stage)
        )
    intents = [i for i in intents if i.kind != "day.show"]  # only ever built by the server
    if rec.days:
        # the map opens the rehearsal the answer came from, paused at its peak
        d = rec.days[-1]
        hh, _, mm = str(d.get("show_at") or "").partition(":")
        intents.append(
            SceneIntent(
                kind="day.show",
                day=(d.get("scenario") or {}).get("id"),
                t_min=int(hh) * 60 + int(mm) if hh.isdigit() and mm.isdigit() else None,
                scenario_id=day_stage,
            )
        )
    diff = next((w["diff_geojson"] for w in reversed(rec.what_ifs) if w.get("diff_geojson")), None)
    if diff and not any(i.kind == "whatif.diff" for i in intents):
        intents.append(SceneIntent(kind="whatif.diff"))  # a what-if is always drawn as a diff
    if rec.rollouts and not any(i.kind == "river.rollout" for i in intents):
        intents.append(SceneIntent(kind="river.rollout"))  # the map plays the rollout
    for it in intents:
        intent = it.model_copy()
        if intent.kind == "route.highlight":
            route = rec.routes.get(intent.route_id or "")
            if route is None:
                continue  # nothing to draw: the route was not returned this turn
            intent.geojson = route["geometry"]
        if intent.kind == "river.rollout" and not rec.rollouts:
            continue  # nothing was simulated this turn
        if intent.kind == "whatif.diff":
            if diff is None:
                continue  # no simulation ran this turn
            intent.geojson = diff
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
    if rec.what_ifs:
        items.append({"element_id": "whatif", "attribute": "whatif", "note": WHATIF_NOTE})
    # Partial whenever the answer carries any caveat (not only unchecked segments).
    level = "partial" if unknowns or items or ans.caveats else "none"
    if ans.answer_status == "cannot_answer":
        level = "high"
    evs.append(Uncertainty(level=level, items=items))

    if rec.what_ifs:  # before the flood disclaimer, which stays the last word when both apply
        evs.append(
            Disclaimer(lens="whatif", text=rec.what_ifs[-1].get("disclaimer") or WHATIF_NOTE)
        )
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


def _streams(model) -> bool:
    """Streaming drafts need a model that streams; a FunctionModel only does with stream_function
    (the mock has one; ad-hoc test models usually do not)."""
    from pydantic_ai.models.function import FunctionModel

    return not isinstance(model, FunctionModel) or model.stream_function is not None


def _scrub(msg: str, settings: AgentSettings) -> str:
    key = settings.openrouter_api_key
    if key:
        msg = msg.replace(key, "***")
    return msg[:200]


async def run_turn(
    ctx: sp.Ctx,
    req: ChatRequest,
    settings: AgentSettings | None = None,
    record: TurnRecord | None = None,
    memory: SessionMemory | None = None,
) -> AsyncIterator[ChatEvent]:
    """`record` lets an eval harness inspect the turn afterwards (validator errors, usage).
    `memory` (default: the process-wide store) gives follow-ups the session's earlier turns."""
    memory = memory if memory is not None else DEFAULT_MEMORY
    settings = settings or AgentSettings()
    # A recording cannot reflect a live closure (R33), so any active closure is a cache miss.
    if settings.demo_mode and not ctx.world.active_closures():
        cached = demo.load(demo.key(req), settings.demo_dir, ctx.world.site.id)
        if cached:
            async for ev in demo.replay(cached, ctx.vrs):
                yield ev
            return
    rec = record or TurnRecord()
    rec.queue = asyncio.Queue()
    rec.history_simulated = memory.simulated(req.session_id)
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
                    req.message,
                    message_history=memory.history(req.session_id) or None,
                    deps=deps,
                    retries={"output": settings.llm_output_retries},
                    usage=rec.usage,
                    event_stream_handler=DraftStreamer(deps) if _streams(model) else None,
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
        # The frame (status line, headings) follows the language the answer is written in (a
        # model that answered a BM question in English gets an English frame); template answers
        # (fallbacks) stay English.
        lang = (
            "en"
            if used.endswith("+template")
            else detect_language(" ".join([ans.summary, *ans.caveats]), rec.place_names)
        )
        events = _answer_events(ans, rec, ctx, req.scenario_id, lang)
    except Exception as exc:  # last resort: never leave the client without done
        log.warning("answer rendering failed: %s", type(exc).__name__)
        if rec.scenarios_used:
            yield Disclaimer(text=DEFAULT_DISCLAIMER)
        yield ErrorEvent(code="internal", message="could not build the answer")
        yield Done(message_id=msg_id, answer_status="cannot_answer", model=used)
        return
    # Follow-up context: the question and the answer as shown (template fallbacks included).
    shown = "".join(e.delta for e in events if isinstance(e, TextDelta))
    memory.add_turn(
        req.session_id, req.message, shown, simulated=bool(rec.what_ifs or rec.plans or rec.days)
    )
    for ev in events:
        yield ev
    yield Done(message_id=msg_id, answer_status=ans.answer_status, model=used)
