"""Canonical route answers (T-021 review): route text built from the route's checked fields.

When the answered route has maneuvers, the published summary and caveats come from that route's
fields, unknowns, notes and engine warnings, not from model prose: a direction, a reversal or a
dropped warning cannot reach the resident through wording. The model still picks tools and the
route, asks which place is meant, and refuses; the steps come from the maneuvers (steps.py).
"""

from .answer import FinalAnswer
from .labels import (
    LIKELY_OK_CAVEAT,
    STATUS_WORDS,
    closure_caveats,
    closure_summary_tail,
    rest_caveats,
    route_status_text,
    unchecked_caveats,
)
from .record import TurnRecord
from .template import inferred_caveats
from .validate import PLACEHOLDER_CAVEAT, PLACEHOLDER_SOURCE

# Engine warnings another canonical line already states (demo places, estimates, road and
# entrance notes); every other warning of the route is published as it is.
_COVERED = (
    "Demo value",
    "Likely OK sections are estimated",
    "About ",
    "Route starts at",
    "Route ends at",
)

CENTRE_SOURCE = {
    "official_pps": (
        "{name} is an official evacuation centre (PPS).",
        "{name} ialah pusat pemindahan rasmi (PPS).",
        "{name}是官方疏散中心（PPS）。",
    ),
    "osm_candidate": (
        "{name} is a candidate evacuation centre from OpenStreetMap, not an official PPS.",
        "{name} ialah calon pusat pemindahan daripada OpenStreetMap, bukan PPS rasmi.",
        "{name}是来自OpenStreetMap的候选疏散中心，不是官方PPS。",
    ),
}
_I = {"en": 0, "ms": 1, "zh": 2}


def selected_route(ans: FinalAnswer, rec: TurnRecord) -> tuple[str | None, dict]:
    if ans.route_id in rec.routes:
        return ans.route_id, rec.routes[ans.route_id]
    if len(rec.routes) == 1:
        rid = next(iter(rec.routes))
        return rid, rec.routes[rid]
    return None, {}


def _place_name(world, pid: str) -> str:
    if pid.startswith("__centre__"):
        c = world.centres.get(pid.removeprefix("__centre__"))
        return c.name if c else "the evacuation centre"
    p = world.places.get(pid)
    return p.name if p else pid


def _summary(world, route: dict, status: str, lang: str, closures: list[dict]) -> str:
    a = _place_name(world, route.get("from_place") or "")
    b = _place_name(world, route.get("to_place") or "")
    if lang == "en":
        words = closure_summary_tail(closures, status, route) or route_status_text(status, route)
    else:
        demo = status == "confirmed" and route.get("demo_evidence")
        words = (
            STATUS_WORDS[lang]["demo" if demo else status]
            if status in STATUS_WORDS[lang] or demo
            else route_status_text(status, route)
        )
    dist = route.get("distance_m")
    length = (
        {"en": f"{dist} m", "ms": f"{dist} m", "zh": f"{dist}米"}[lang] if dist is not None else ""
    )
    centre = (route.get("to_place") or "").startswith("__centre__")
    if lang == "ms":
        tail = f", {length}" if length else ""
        head = f"Laluan pemindahan dari {a} ke {b}" if centre else f"{a} ke {b}"
        return f"{head}: laluan {words}{tail}."
    if lang == "zh":
        tail = f"，{length}" if length else ""
        head = f"从{a}到疏散中心{b}" if centre else f"从{a}到{b}"
        return f"{head}：路线{words}{tail}。"
    tail = f", {length}" if length else ""
    head = f"Evacuation route from {a} to {b}" if centre else f"{a} to {b}"
    return f"{head}: route {words}{tail}."


SCENARIO_NOTE = (
    "{level}: indicative scenario, not a forecast. Follow official MBSA / JPS / NADMA guidance.",
    "{level}: senario indikatif, bukan ramalan. Ikut panduan rasmi MBSA / JPS / NADMA.",
    "{level}：示意情景，不是预报。请遵循MBSA / JPS / NADMA的官方指引。",
)
LEVEL = ("River +{n} m", "Sungai naik {n} m", "河水上涨{n}米")
BASELINE = ("Normal river level", "Paras sungai biasa", "正常水位")


def _level(world, sid: str, lang: str) -> str:
    sc = next((s for s in world.flood.scenarios if s.id == sid), None)
    if sc is None or sc.stage_m is None:
        return BASELINE[_I[lang]]
    n = int(sc.stage_m) if float(sc.stage_m).is_integer() else sc.stage_m
    return LEVEL[_I[lang]].format(n=n)


def canonical_route_answer(
    ans: FinalAnswer, rec: TurnRecord, world, lang: str = "en"
) -> FinalAnswer | None:
    """The published answer for a route with maneuvers, else None (the model's answer stays)."""
    lang = lang if lang in _I else "en"
    rid, route = selected_route(ans, rec)
    if not rid or not route.get("maneuvers") or ans.answer_status == "cannot_answer":
        return None
    if rec.selection_error:
        return None
    status = rec.route_status.get(rid, route.get("status") or "no_data")
    caveats: list[str] = [
        f"{i['name']} is {'likely' if i['flood_class'] == 'likely_flooded' else 'possibly'} "
        "flooded in this indicative scenario."
        for i in rec.flooded_endpoints.values()
    ]
    if route.get("access_metres", {}).get("likely_ok", 0) and status != "likely_ok":
        caveats.append("Likely OK sections are estimated from map data, not checked on site.")
    caveats += unchecked_caveats(route.get("unknowns", []), rec.vrs)
    if status == "likely_ok":
        caveats.append(f"{LIKELY_OK_CAVEAT}.")
    elif status == "partly_unverified" and route.get("unknowns"):
        caveats.append("Some segments are still unverified.")
    caveats += rest_caveats(route)
    caveats += [n for n in (route.get("crossing_note"), route.get("road_note")) if n]
    caveats += closure_caveats([*rec.route_closures, *rec.asked_closures])
    caveats += inferred_caveats(rec.inferred_notes)
    caveats += [w for w in rec.route_warnings.get(rid, []) if not w.startswith(_COVERED)]
    to = route.get("to_place") or ""
    if to.startswith("__centre__"):
        c = world.centres.get(to.removeprefix("__centre__"))
        row = CENTRE_SOURCE.get(getattr(c, "source", "") or "")
        if c and row:
            caveats.append(row[_I[lang]].format(name=c.name))
    if any(getattr(e, "source_type", None) == PLACEHOLDER_SOURCE for e in rec.evidence.values()):
        caveats.append(f"Some segment facts are {PLACEHOLDER_CAVEAT}.")
    if sid := route.get("scenario_id") or next(iter(sorted(rec.scenarios_used)), None):
        caveats.append(SCENARIO_NOTE[_I[lang]].format(level=_level(world, sid, lang)))
    return ans.model_copy(
        update={
            "summary": _summary(world, route, status, lang, rec.route_closures),
            "steps": [],
            "caveats": list(dict.fromkeys(caveats)),
            "route_id": rid,
        }
    )
