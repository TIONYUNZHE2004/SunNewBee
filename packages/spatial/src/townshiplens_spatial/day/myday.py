"""Rehearse my trip (Cycle 19): one resident's own trip through an Elmina Day rehearsal.

The trip runs on the same rehearsed day as the 5,000 synthetic residents (the cached
rule-based `Day`): the same river stage minute by minute, the same staff closures, the same
re-planning when the water changes on the way (`Day.travel`). Nothing is predicted: the result
says what happened to that trip *in the rehearsal*, at the asked time and at every 10 minutes
around it, so a resident sees when it went through, when it was cut and when the way came back.

Rules (stated in the answer):
- It is not an essential trip: no way at the time of leaving means that time had no way.
- Lenient routing, as in Elmina Day: unchecked paths may be used, and the trip says how many
  unchecked stretches it crossed. Known barriers and likely-flooded paths are never used.
- No mapped connection even on a normal day is a data gap, never "not reachable".
"""

from __future__ import annotations

import threading

from .. import twm
from .engine import DAY_END, DAY_START, DRIVE_PACE, LATE_MIN, PACE, Day

STEP = 10  # minutes between rehearsed departures in the sweep
OUTCOMES = ("clear", "longer", "very_long", "rerouted", "turned_back", "stranded", "no_way")
BEFORE, AFTER = 60, 240  # the sweep around the asked time
MODES = ("default", "stroller", "wheelchair", "older_adult_rest", "drive")
# Day.travel shares routers and distance fields; one trip at a time on a given day.
_LOCK = threading.Lock()


def hhmm(t: float) -> str:
    m = int(round(t))
    return f"{m // 60:02d}:{m % 60:02d}"


def minutes(s: str) -> int | None:
    """'07:05' -> 425; None when it is not a clock time of the rehearsed day."""
    try:
        h, m = (int(x) for x in str(s).strip().split(":"))
    except ValueError:
        return None
    if not (0 <= h < 24 and 0 <= m < 60):
        return None
    t = h * 60 + m
    return t if DAY_START <= t <= DAY_END - 30 else None


SNAP_M = 300.0  # a tapped point is snapped to a mapped path node within this distance
_M_PER_DEG = (111_320 * 0.9984, 110_540)  # metres per degree of lon/lat near Elmina (3.2° N)


def nearest_node(day: Day, lon: float, lat: float, mode: str) -> tuple[str, float] | None:
    """The mapped path node nearest a tapped point that this mode can use on a normal day, and
    how far it is (metres). The point itself is never stored or returned."""
    import numpy as np

    usable = day.router(mode, None, base=True).usable_nodes
    ids = np.flatnonzero(usable)
    if not len(ids):
        return None
    d = (day.graph.coords[ids] - np.array([lon, lat])) * np.array(_M_PER_DEG)
    dist = np.hypot(d[:, 0], d[:, 1])
    j = int(np.argmin(dist))
    if dist[j] > SNAP_M:
        return None
    return day.graph.nodes[int(ids[j])], float(dist[j])


def _track(day: Day, tr) -> list[dict]:
    """The rehearsed trip for the map: each segment's coordinates with its start and end minute
    (a wait is one point held between them)."""
    out = []
    for seg in tr.segments:
        out.append(
            {
                "t0": round(seg.t0, 1),
                "t1": round(seg.t1, 1),
                "wait": seg.wait,
                "coords": _coords(day, seg.nodes),
            }
        )
    return out


def _outcome(tr, t0: float, normal_min: float) -> dict:
    """One rehearsed departure, classified from the engine's own result."""
    if tr.status == "arrived" and tr.arrive is not None:
        took = tr.arrive - t0
        if tr.rerouted or tr.waited > 0:
            kind = "rerouted"  # the water changed on the way: re-planned or waited
        elif took - normal_min < LATE_MIN:
            kind = "clear"
        elif took <= 2 * normal_min:
            kind = "longer"  # a longer way round the water from the start
        else:
            kind = "very_long"  # only a very long way round was left (counted as cut in the UI)
        return {
            "leave": hhmm(t0),
            "outcome": kind,
            "arrive": hhmm(tr.arrive),
            "minutes": round(took),
            "waited_min": round(tr.waited),
            "unchecked": tr.unknown,
        }
    kind = {"cancelled": "no_way", "turned_back": "turned_back", "stranded": "stranded"}.get(
        tr.status, "no_way"
    )
    return {
        "leave": hhmm(t0),
        "outcome": kind,
        "arrive": None,
        "minutes": None,
        "waited_min": round(tr.waited),
        "unchecked": tr.unknown,
    }


def _coords(day: Day, nodes) -> list[list[float]]:
    return [[round(float(x), 6), round(float(y), 6)] for x, y in day.graph.coords[nodes]]


def _cut_lines(day: Day, leg, t: float) -> list[list[list[float]]]:
    """The flooded segments of the normal-day route at minute t, as lines for the map."""
    stage = day.scenario.stage_at(t)
    flooded = day.base_world.flood.edge_classes.get(stage or "", {})
    return [
        _coords(day, leg.nodes[k : k + 2]) for k, eid in enumerate(leg.edge_ids) if eid in flooded
    ][:40]


def _cut_by(day: Day, leg, t: float) -> list[str]:
    """Flooded streets on the normal-day route at the river stage of minute t, by name."""
    stage = day.scenario.stage_at(t)
    flooded = day.base_world.flood.edge_classes.get(stage or "", {})
    names: list[str] = []
    for eid in leg.edge_ids:
        if eid in flooded:
            label = twm.path_label(day.base_world, eid)
            if label not in names:
                names.append(label)
    return names[:3]


def rehearse(
    day: Day, from_node: str | None, to_node: str | None, mode: str, leave_at: int
) -> dict:
    """The trip at `leave_at` and every 10 minutes around it, on the rehearsed day."""
    idx = day.graph.index
    src, dst = idx.get(from_node or ""), idx.get(to_node or "")
    base = {
        "stage_at_leave": day.scenario.stage_at(leave_at),
        "leave": hhmm(leave_at),
        # the rehearsal's river: (clock time, stage id or None for the normal level)
        "river_changes": [[hhmm(m), sid] for m, sid in day.scenario.stages if m > 0],
    }
    if src is None or dst is None:
        return {**base, "status": "no_data", "reason": "a place has no mapped entrance node"}
    with _LOCK:
        normal = day._leg(mode, None, True, src, (dst,))
        if normal is None:
            return {**base, "status": "no_data", "reason": "no mapped connection on a normal day"}
        pace = DRIVE_PACE if mode == "drive" else PACE.get(mode, 75.0)
        normal_min = normal.length_m / pace

        def run(t: float) -> dict:
            tr = day.travel(mode, src, (dst,), t, essential=False)
            return _outcome(tr, t, normal_min)

        first = day.travel(mode, src, (dst,), leave_at, essential=False)
        asked = _outcome(first, leave_at, normal_min)
        track = _track(day, first)
        lo = max(DAY_START, leave_at - BEFORE)
        # long enough to see the way come back: past the last river change after leaving
        last = max((c for c in day.changes if c > leave_at), default=leave_at)
        hi = min(DAY_END - 30, max(leave_at + AFTER, last + 30))
        sweep = [run(t) for t in range(lo - lo % STEP, hi + 1, STEP) if t >= lo]
    ok = ("clear", "longer", "rerouted")
    later = [s for s in sweep if minutes(s["leave"]) > leave_at and s["outcome"] == "clear"]
    earlier = [s for s in sweep if minutes(s["leave"]) < leave_at and s["outcome"] in ok]
    cut = [] if asked["outcome"] == "clear" else _cut_by(day, normal, leave_at)
    cut_lines = [] if asked["outcome"] == "clear" else _cut_lines(day, normal, leave_at)
    return {
        **base,
        "status": "rehearsed",
        "mode": mode,
        "normal_minutes": round(normal_min),
        "normal_unchecked": normal.unknown,
        "asked": asked,
        "track": track,
        # for the map: the normal-day route and the flooded pieces of it at the time of leaving
        "normal_route": _coords(day, normal.nodes),
        "cut_lines": cut_lines,
        "cut_by": cut,
        "next_clear_leave": later[0]["leave"] if later else None,
        "last_ok_leave_before": earlier[-1]["leave"] if earlier else None,
        "sweep": sweep,
        "sweep_counts": {k: sum(1 for s in sweep if s["outcome"] == k) for k in OUTCOMES},
    }
