"""One chat turn as a stream of ChatEvents. Always ends with Done, whatever the model does."""

import asyncio
import logging
import re
import uuid
from collections.abc import AsyncIterator

from pydantic_ai.exceptions import UnexpectedModelBehavior, UsageLimitExceeded
from pydantic_ai.usage import UsageLimits
from townshiplens_spatial import tools as sp
from townshiplens_spatial.journey import JourneyEvidenceError, build_journey
from townshiplens_spatial.models import Route

from . import agent as agent_mod
from . import demo
from .answer import FinalAnswer
from .canonical import canonical_route_answer
from .draft import DraftStreamer
from .events import (
    AnswerSceneIntent,
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
from .facts import extract_facts
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
from .localize import localize
from .memory import DEFAULT as DEFAULT_MEMORY
from .memory import SessionMemory
from .record import TurnRecord
from .redact import redact
from .scope import is_greeting, outside_scope
from .settings import AgentSettings
from .steps import maneuver_steps
from .template import _top_stage, greeting_answer, scope_answer, template_answer
from .validate import PLACEHOLDER_CAVEAT, validate_answer

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


# Scope B+ (T-013): routes and places anywhere in Elmina are answered; outside the access deep
# spot (the detailed study area) the facts are OpenStreetMap's only. Server-added after the
# check, so no model can forget or reword it.
OUTSIDE_NOTE = {
    "en": "Outside the detailed study area ({name}), path and place facts come from "
    "OpenStreetMap only",
    "ms": "Di luar kawasan kajian terperinci ({name}), maklumat laluan dan tempat hanya "
    "daripada OpenStreetMap",
    "zh": "重点研究区域（{name}）以外的路线和地点信息仅来自 OpenStreetMap",
}


# T-024: every river-rise answer says what the scenarios leave out (added after the check).
FLASH_FLOOD_NOTE = {
    "en": "Flash floods from heavy rain are not shown.",
    "ms": "Banjir kilat akibat hujan lebat tidak ditunjukkan.",
    "zh": "未显示暴雨引起的突发洪水。",
}
_FLASH_SAID = re.compile(r"flash flood|banjir kilat|突发洪水", re.IGNORECASE)


def flash_flood_note(ans: FinalAnswer, rec: TurnRecord, lang: str = "en") -> str | None:
    """The flash-flood line for an answer that used a river stage, unless it already says so
    (a question back to the resident, cannot_answer, states no flood facts)."""
    if ans.answer_status == "cannot_answer" or not any(
        s.startswith("stage_") for s in rec.scenarios_used | {ans.scenario_id or ""}
    ):
        return None
    if _FLASH_SAID.search(" ".join([ans.summary, *ans.caveats])):
        return None
    return FLASH_FLOOD_NOTE.get(lang, FLASH_FLOOD_NOTE["en"])


# T-025: every event answer says what its numbers are (added after the check).
EVENT_NOTE = {
    "en": "Estimate from mapped roads and sample trips, not traffic counts.",
    "ms": "Anggaran daripada jalan yang dipetakan dan perjalanan sampel, bukan kiraan trafik.",
    "zh": "根据已绘制的道路和样本出行估算，并非交通流量统计。",
}
_EVENT_SAID = re.compile(r"not traffic counts|bukan kiraan trafik|并非交通流量", re.IGNORECASE)


def event_note(ans: FinalAnswer, rec: TurnRecord, lang: str = "en") -> str | None:
    if not rec.events or ans.answer_status == "cannot_answer":
        return None
    if _EVENT_SAID.search(" ".join([ans.summary, *ans.caveats])):
        return None
    return EVENT_NOTE.get(lang, EVENT_NOTE["en"])


def outside_note(ans: FinalAnswer, rec: TurnRecord, world, lang: str = "en") -> str | None:
    """The caveat when the answered route (else every route this turn) or a cited place lies
    outside the access deep spot; None inside it, or when the world defines no such spot."""
    spots = [d for d in world.site.deep_spots if d.lens == "access"]
    if not spots:
        return None
    routes = [rec.routes[ans.route_id]] if ans.route_id in rec.routes else rec.routes.values()
    points = [c for r in routes for c in (r.get("geometry") or {}).get("coordinates") or []]
    for eid in (i for c in ans.claims for i in c.evidence_ids):
        ev = rec.evidence.get(eid)
        if ev is not None and (place := world.places.get(ev.element_id)) is not None:
            points.append(place.coord)

    def inside(pt) -> bool:
        return any(w <= pt[0] <= e and s <= pt[1] <= n for w, s, e, n in (d.bbox for d in spots))

    if all(inside(pt) for pt in points):
        return None
    return OUTSIDE_NOTE.get(lang, OUTSIDE_NOTE["en"]).format(name=spots[0].name)


MANDATORY_WARNING = re.compile(r"distance and time stop at the road|not modelled; indicative only")
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
        c = localize(c, lang)  # fixed English lines in the answer's language (T-019)
        if c.endswith((".", "!", "?", "。", "！", "？")):
            return c
        return c + ("。" if lang == "zh" and re.search(r"[\u3400-\u9fff）]$", c) else ".")

    parts = [label] if label else []
    parts += [f"{URGENT_MARK} {dot(c)}" for c in urgent]
    parts.append(localize(summary, lang))
    if ans.steps:
        parts.append("\n".join(f"{i}. {localize(s, lang)}" for i, s in enumerate(ans.steps, 1)))
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
    # T-021: steps come from the answered route's maneuvers only (never model-written turns).
    answered = rec.routes.get(ans.route_id or "") or (
        next(iter(rec.routes.values())) if len(rec.routes) == 1 else {}
    )
    if (steps := maneuver_steps(answered, lang)) and ans.answer_status != "cannot_answer":
        ans = ans.model_copy(update={"steps": steps})
    # Engine warnings an answer may never drop: the route stops short of the place, and the
    # driving limits (legal turns, changing directions). Added after the check if missing.
    have = " ".join(_norm(c) for c in ans.caveats)
    missing = [
        w
        for w in rec.route_warnings.get(answered.get("id", ""), [])
        if MANDATORY_WARNING.search(w)
        and not any(_norm(localize(w, lg)) in have for lg in ("en", "ms", "zh"))
    ]
    if missing:
        ans = ans.model_copy(update={"caveats": [*ans.caveats, *missing]})
    for note in (flash_flood_note(ans, rec, lang), event_note(ans, rec, lang)):
        if note:
            ans = ans.model_copy(update={"caveats": [*ans.caveats, note]})
    if note := outside_note(ans, rec, ctx.world, lang):
        ans = ans.model_copy(update={"caveats": [*ans.caveats, note]})
    text = answer_text(ans, _route_status_line(ans, rec, lang), rec, lang)
    evs += [TextDelta(delta=text[i : i + CHUNK]) for i in range(0, len(text), CHUNK)]

    intents = list(ans.scene_intents)
    # day.show / day.trip are only ever built by the server
    intents = [i for i in intents if i.kind not in ("day.show", "day.trip")]
    calls = rec.tool_calls

    def last(name: str) -> int:
        return max((i for i, n in enumerate(calls) if n == name), default=-1)

    if rec.my_trips and last("rehearse_my_trip") > max(
        last("day_rehearsal"), last("day_test_change")
    ):
        # A resident's own trip: the map opens the rehearsal at the time they leave, with the
        # river stage of that minute, and draws their trip (Cycle 19).
        t = rec.my_trips[-1]
        hh, _, mm = str(t.get("leave") or "").partition(":")
        intents = [i for i in intents if i.kind != "flood.set_level"]
        intents.insert(
            0,
            SceneIntent(
                kind="day.trip",
                day=(t.get("scenario") or {}).get("id"),
                t_min=int(hh) * 60 + int(mm) if hh.isdigit() and mm.isdigit() else None,
                scenario_id=t.get("stage_at_leave"),
                geojson=_trip_geojson(t),
            ),
        )
    elif rec.days or rec.day_changes:
        # The map opens the rehearsal the answer came from, paused at its peak, with that day's
        # own river stage. day.show carries the stage, so no separate flood.set_level is sent
        # (the client remembers what was on screen before the day and restores it on close).
        # the day the turn ended on, by call order (review C17)
        d = (
            rec.day_changes[-1]
            if rec.day_changes and last("day_test_change") > last("day_rehearsal")
            else (rec.days or rec.day_changes)[-1]
        )
        hh, _, mm = str(d.get("show_at") or "").partition(":")
        intents = [i for i in intents if i.kind != "flood.set_level"]
        # first: it sets the day's river level, which would clear a what-if diff drawn before it
        intents.insert(
            0,
            SceneIntent(
                kind="day.show",
                day=(d.get("scenario") or {}).get("id"),
                t_min=int(hh) * 60 + int(mm) if hh.isdigit() and mm.isdigit() else None,
                scenario_id=_top_stage(d.get("river_stages") or []),
            ),
        )
    diff = next((w["diff_geojson"] for w in reversed(rec.what_ifs) if w.get("diff_geojson")), None)
    if rec.day_changes and rec.day_changes[-1].get("changed_geojson"):
        diff = rec.day_changes[-1]["changed_geojson"]  # the imagined change, drawn on the map
    if diff and not any(i.kind == "whatif.diff" for i in intents):
        intents.append(SceneIntent(kind="whatif.diff"))  # a what-if is always drawn as a diff
    if rec.rollouts and not any(i.kind == "river.rollout" for i in intents):
        intents.append(SceneIntent(kind="river.rollout"))  # the map plays the rollout
    for it in intents:
        # Only what the model may write; every server-attached field is rebuilt below.
        intent = SceneIntent(**it.model_dump(include=set(AnswerSceneIntent.model_fields)))
        intent.route_status = intent.distance_m = intent.est_minutes = None
        if intent.kind == "flood.set_level":
            selected_route = rec.routes.get(ans.route_id or "") or (
                next(iter(rec.routes.values())) if len(rec.routes) == 1 else {}
            )
            allowed = rec.scenarios_used | {
                e.element_id for e in rec.evidence.values() if e.attribute == "scenario"
            }
            if (
                intent.scenario_id != ans.scenario_id
                or intent.scenario_id not in allowed
                or (
                    "scenario_id" in selected_route
                    and (selected_route["scenario_id"] or "baseline") != intent.scenario_id
                )
            ):
                continue
        if intent.kind == "route.highlight":
            selected = ans.route_id or (next(iter(rec.routes)) if len(rec.routes) == 1 else None)
            if (
                ans.answer_status == "cannot_answer"
                or rec.selection_error
                or intent.route_id != selected
            ):
                continue
            route = rec.routes.get(intent.route_id or "")
            if route is None:
                continue  # nothing to draw: the route was not returned this turn
            intent.geojson = route["geometry"]
            intent.route_status = route.get("status")
            intent.distance_m = route.get("distance_m")
            intent.est_minutes = route.get("est_minutes")
        if intent.kind == "journey.play":
            intent.journey = _journey(ctx, rec, intent)
            if intent.journey is None:
                continue  # no route returned this turn, no start time, or a plan bug (logged)
        if intent.kind == "river.rollout" and not rec.rollouts:
            continue  # nothing was simulated this turn
        if intent.kind == "whatif.diff":
            if diff is None:
                continue  # no simulation ran this turn
            intent.geojson = diff
        evs.append(SceneIntentEvent(intent=intent))

    ref = 0
    cited: set[str] = set()
    evidence_ids = [eid for c in ans.claims for eid in c.evidence_ids]
    selected_route = rec.routes.get(ans.route_id or "") or (
        next(iter(rec.routes.values())) if len(rec.routes) == 1 else {}
    )
    # Place existence can qualify the selected route even when the model only cited the
    # evacuation centre/scenario. Preserve those badges; never cite unrelated search hits.
    evidence_ids += [
        eid
        for eid in selected_route.get("evidence_ids", [])
        if eid.startswith("ev-place-")
        and eid in rec.evidence
        and rec.evidence[eid].source_type == "team_survey_placeholder"
    ]
    for eid in evidence_ids:
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

    if rec.what_ifs or rec.day_changes:  # before the flood disclaimer, the last word
        last = (rec.day_changes or rec.what_ifs)[-1]
        evs.append(Disclaimer(lens="whatif", text=last.get("disclaimer") or WHATIF_NOTE))
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


def _journey(ctx: sp.Ctx, rec: TurnRecord, intent: SceneIntent):
    """The JourneyPlan for a journey.play intent, built from the route plan_route returned this
    turn (the same route POST /journeys plans for the same endpoints, profile and scenario)."""
    route = rec.routes.get(intent.route_id or "")
    if route is None:
        log.warning("journey.play dropped: route %r was not returned this turn", intent.route_id)
        return None
    if intent.start_time is None:
        log.warning("journey.play dropped: no start_time for route %s", intent.route_id)
        return None
    try:
        r = Route.model_validate(route)
        return build_journey(ctx.world, r, r.profile, intent.start_time)
    except (JourneyEvidenceError, ValueError) as e:
        log.error("journey.play dropped for %s: %s", intent.route_id, e)
        return None


def _trip_geojson(t: dict) -> dict | None:
    """A rehearsed trip for the map: one feature per segment (a wait is a point), with its start
    and end minute and the asked outcome. Built from the engine's track, never by the model."""
    feats = []
    for seg in t.get("track") or []:
        coords = seg.get("coords") or []
        if not coords:
            continue
        geom = (
            {"type": "Point", "coordinates": coords[0]}
            if seg.get("wait") or len(coords) == 1
            else {"type": "LineString", "coordinates": coords}
        )
        props = {
            "kind": "trip",
            "t0": seg.get("t0"),
            "t1": seg.get("t1"),
            "wait": bool(seg.get("wait")),
        }
        feats.append({"type": "Feature", "geometry": geom, "properties": props})
    if t.get("normal_route"):
        feats.insert(
            0,
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": t["normal_route"]},
                "properties": {"kind": "normal"},
            },
        )
    feats += [
        {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": c},
            "properties": {"kind": "cut"},
        }
        for c in t.get("cut_lines") or []
    ]
    if not feats:
        return None
    asked = t.get("asked") or {}
    meta = {
        # everything the answer card's departure strip shows, copied from the rehearsal
        "day": (t.get("scenario") or {}).get("id"),
        "day_label": (t.get("scenario") or {}).get("label"),
        "profile": t.get("profile"),
        "from": (t.get("from") or {}).get("name"),
        "to": (t.get("to") or {}).get("name"),
        "from_id": (t.get("from") or {}).get("id"),
        "to_id": (t.get("to") or {}).get("id"),
        "leave": t.get("leave"),
        "outcome": asked.get("outcome"),
        "arrive": asked.get("arrive"),
        "minutes": asked.get("minutes"),
        "unchecked": asked.get("unchecked"),
        "normal_minutes": t.get("normal_minutes"),
        "cut_by": t.get("cut_by") or [],
        "last_ok_leave_before": t.get("last_ok_leave_before"),
        "next_clear_leave": t.get("next_clear_leave"),
        "sweep": [
            {"leave": x.get("leave"), "outcome": x.get("outcome"), "arrive": x.get("arrive")}
            for x in t.get("sweep") or []
        ],
    }
    return {"type": "FeatureCollection", "features": feats, "meta": meta}


def _streams(*models) -> bool:
    """Streaming drafts need every model the turn may use to stream; a FunctionModel only does
    with stream_function (the mock has one; ad-hoc test models usually do not)."""
    from pydantic_ai.models.fallback import FallbackModel
    from pydantic_ai.models.function import FunctionModel

    def one(m) -> bool:
        if isinstance(m, FallbackModel):
            return all(one(x) for x in m.models)
        return not isinstance(m, FunctionModel) or m.stream_function is not None

    return all(one(m) for m in models if m is not None)


def served_model(model, escalate_model, rec: TurnRecord, result) -> str:
    """The configured model that wrote the final answer: the escalation model once the turn was
    escalated, else, behind a fallback, the member whose name the last response carries."""
    from pydantic_ai.models.fallback import FallbackModel

    if rec.escalated and escalate_model is not None:
        return getattr(escalate_model, "model_name", None) or "unknown"
    if isinstance(model, FallbackModel):
        answered = getattr(getattr(result, "response", None), "model_name", None) or ""
        for m in model.models:
            if answered.startswith(m.model_name):
                return m.model_name
        return answered or model.model_name
    return getattr(model, "model_name", None) or "unknown"


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
    # Redact first, then enforce scope before cache/model construction or tool side effects.
    question = redact(req.message)
    # Scope B+: a bare greeting or thanks gets a fixed hello and what the assistant can do, and
    # only clearly removed features are refused; neither reaches the model or a tool. The
    # management panel (T-023) has every feature, whatever ASSISTANT_SCOPE says.
    scope = "all" if req.panel == "management" else settings.assistant_scope
    scoped = scope == "access_flood"
    greeting = (scoped or req.panel == "management") and is_greeting(question)
    if greeting or (scoped and outside_scope(question)):
        ans = greeting_answer(question, req.panel) if greeting else scope_answer(question)
        memory.add_turn(req.session_id, question, ans.summary)
        yield TextDelta(delta=ans.summary)
        yield Done(
            message_id=uuid.uuid4().hex[:12], answer_status="cannot_answer", model="scope-policy"
        )
        return
    # A recording cannot reflect a live closure (R33), so any active closure is a cache miss.
    if settings.demo_mode and not ctx.world.active_closures():
        cached = demo.load(
            demo.key(req), settings.demo_dir, ctx.world.site.id, demo.world_fingerprint(ctx.world)
        )
        if cached:
            shown = []
            route_calls = []
            async for ev in demo.replay(cached, ctx.vrs):
                if ev.type == "text.delta":
                    shown.append(ev.delta)
                if ev.type == "tool.call" and ev.name == "plan_route":
                    route_calls.append(ev.args)
                yield ev
            context = None
            if len(route_calls) == 1:
                args = route_calls[0]
                context = {
                    "from_place": args["from_id"],
                    "to_place": args["to_id"],
                    "profile": args.get("profile", req.profile),
                }
            memory.add_turn(req.session_id, question, "".join(shown), route=context)
            return
    rec = record or TurnRecord()
    rec.strict_selection = True
    rec.context_route = memory.route_context(req.session_id)
    # Stages the resident named, and the stages the world has scenarios for ("+1 m to +3 m").
    rec.asked_stages = {f.value for f in extract_facts(question) if f.kind == "stage"} | {
        float(s.stage_m) for s in ctx.world.flood.scenarios if s.stage_m is not None
    }
    rec.queue = asyncio.Queue()
    rec.history_simulated = memory.simulated(req.session_id)
    rec.panel = req.panel
    deps = agent_mod.Deps(ctx=ctx, rec=rec, request=req)
    msg_id = uuid.uuid4().hex[:12]
    model_name = "unknown"
    escalate_model = None
    ans: FinalAnswer | None = None
    failure: Exception | None = None

    try:
        model = agent_mod.model_for(settings)
        model_name = getattr(model, "model_name", None) or "unknown"
        escalate_model = (
            agent_mod.model_for(settings, escalate=True)
            if settings.llm_escalate_on_rewrite
            else None
        )
        agent = agent_mod.build_agent(
            model, escalate_to=escalate_model, assistant_scope=scope, panel=req.panel
        )
    except Exception as exc:  # misconfiguration (e.g. no key): still answer from the template
        failure = exc
    else:

        async def bounded_run():
            async with asyncio.timeout(settings.turn_timeout_s):
                return await agent.run(
                    question,
                    message_history=memory.history(req.session_id) or None,
                    deps=deps,
                    retries={"output": settings.llm_output_retries},
                    usage_limits=UsageLimits(request_limit=settings.llm_request_limit),
                    usage=rec.usage,
                    event_stream_handler=(
                        DraftStreamer(deps) if _streams(model, escalate_model) else None
                    ),
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
            result = task.result()
            ans = result.output
            model_name = served_model(model, escalate_model, rec, result)
        except UnexpectedModelBehavior as exc:  # e.g. output retries exhausted by the validator
            log.info("model output rejected, using template: %s", type(exc).__name__)
        except Exception as exc:  # network / provider / tool error
            failure = exc

    if rec.escalated and escalate_model is not None:
        model_name = getattr(escalate_model, "model_name", None) or model_name
    used = model_name
    if isinstance(failure, UsageLimitExceeded):
        log.warning("agent turn hit the request cap (%s)", settings.llm_request_limit)
        yield ErrorEvent(
            code="agent_limit",
            message=f"stopped after {settings.llm_request_limit} model requests",
        )
    elif isinstance(failure, TimeoutError):
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
            ans = template_answer(rec, question)
        # The frame (status line, headings) follows the language the answer is written in (a
        # model that answered a BM question in English gets an English frame); template answers
        # (fallbacks) stay English.
        lang = (
            "en"
            if used.endswith("+template")
            else detect_language(" ".join([ans.summary, *ans.caveats]), rec.place_names)
        )
        # T-021 review: a route with maneuvers is published from its checked fields, not from
        # model prose (no direction, reversal or dropped warning can pass through wording). The
        # canonical answer must pass the same check; else the deterministic template is used.
        if (canon := canonical_route_answer(ans, rec, ctx.world, lang)) is not None:
            if not validate_answer(canon, rec):
                ans = canon
            elif not validate_answer(fallback := template_answer(rec, question), rec):
                log.warning("canonical route answer failed its check; template used")
                ans, lang, used = fallback, "en", model_name + "+template"
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
    selected = rec.routes.get(ans.route_id or "") or (
        next(iter(rec.routes.values())) if len(rec.routes) == 1 else None
    )
    context_route = (
        {k: selected[k] for k in ("from_place", "to_place", "profile")}
        if selected
        and all(k in selected for k in ("from_place", "to_place", "profile"))
        and ans.answer_status != "cannot_answer"
        and not rec.selection_error
        else None
    )
    memory.add_turn(
        req.session_id,
        question,
        shown,
        simulated=bool(rec.what_ifs or rec.plans or rec.days or rec.day_changes),
        route=context_route,
    )
    for ev in events:
        yield ev
    yield Done(message_id=msg_id, answer_status=ans.answer_status, model=used)
