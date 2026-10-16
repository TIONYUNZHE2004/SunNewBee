"""Counts, timelines and map tracks from a simulated day (Cycle 10). Every number the UI or the
assistant shows for Elmina Day comes from here: counted over the engine's trips, never estimated.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from .engine import DAY_END, DAY_START, DISCLAIMER, DRIVE_PACE, PACE, DayResult, Trip
from .population import summary as pop_summary
from .schedule import ASSUMPTIONS

BIN = 15
SEVERITY = {"stranded": 4, "cancelled": 3, "late": 2, "data_gap": 1, "on_time": 0}
GROUPS = (
    ("everyone", "Everyone", lambda r: True),
    ("children", "Children (under 13)", lambda r: r.group == "child"),
    ("teens", "Teenagers", lambda r: r.group == "teen"),
    ("older", "Older residents (65+)", lambda r: r.group == "older"),
    ("wheelchair", "Wheelchair users", lambda r: r.wheelchair),
    ("stroller", "Parents with a stroller", lambda r: r.toddler),
    ("no_car", "Households without a car", lambda r: not r.car),
)
PURPOSE_LABEL = {
    "school": "school",
    "work": "work",
    "worship": "prayers",
    "clinic": "the clinic",
    "park": "the park",
    "shops": "the shops",
    "event": "the event",
}


def _outcome_by_resident(res: DayResult) -> dict[str, str]:
    """Each resident's worst outcome of the day, including trips they made as a companion."""
    worst: dict[str, str] = {}

    def put(rid: str, st: str):
        if rid not in worst or SEVERITY[st] > SEVERITY[worst[rid]]:
            worst[rid] = st

    for t in res.trips:
        put(t.resident, t.status)
        for c in t.companions:
            put(c, t.status)
    return worst


def groups(res: DayResult) -> list[dict]:
    people = {r.id: r for r in res.day.pop.residents}
    worst = _outcome_by_resident(res)
    out = []
    for gid, label, pred in GROUPS:
        ids = [rid for rid, r in people.items() if pred(r) and rid in worst]
        c = Counter(worst[i] for i in ids)
        out.append(
            {
                "id": gid,
                "label": label,
                "residents": len(ids),
                "on_time": c.get("on_time", 0),
                "late": c.get("late", 0),
                "cancelled": c.get("cancelled", 0),
                "stranded": c.get("stranded", 0),
                "data_gap": c.get("data_gap", 0),
            }
        )
    return out


def school(res: DayResult) -> dict:
    """Children's and teenagers' morning trips to school."""
    kids = Counter()
    for t in res.trips:
        if t.purpose != "school" or t.direction != "out" or t.planned > 9 * 60:
            continue
        n = len(t.companions) if t.label == "school run" else 1
        kids[t.status] += n
    return {"pupils": sum(kids.values()), **{k: kids.get(k, 0) for k in SEVERITY}}


def timeline(res: DayResult) -> list[dict]:
    """Every 15 minutes: residents walking, driving, waiting on the way, and the river stage."""
    sc = res.day.scenario
    bins = list(range(DAY_START, DAY_END, BIN))
    walk = [0] * len(bins)
    drive = [0] * len(bins)
    wait = [0] * len(bins)
    for t in res.trips:
        n = 1 + len(t.companions)
        for s in t.segments:
            for i, b in enumerate(bins):
                mid = b + BIN / 2
                if s.t0 <= mid < s.t1:
                    if s.wait:
                        wait[i] += n
                    elif t.mode == "drive":
                        drive[i] += n
                    else:
                        walk[i] += n
    rain = sc.rain
    return [
        {
            "t": b,
            "walking": walk[i],
            "driving": drive[i],
            "waiting": wait[i],
            "stage": sc.stage_at(b + BIN / 2),
            "rain": any(a <= b + BIN / 2 < z for a, z in rain),
        }
        for i, b in enumerate(bins)
    ]


def places(res: DayResult, top: int = 8) -> list[dict]:
    """Busiest places: visitors, the peak number there at once, and residents from different
    households who were there at the same time for 15 minutes or more."""
    w = res.day.world
    by_place: dict[str, list] = defaultdict(list)
    for pid, rid, hh, t0, t1, n in res.stays:
        by_place[pid].append((rid, hh, t0, t1, n))
    out = []
    for pid, rows in by_place.items():
        visitors = sum(n for *_, n in rows)
        peak, peak_t = 0, None
        for b in range(DAY_START, DAY_END, BIN):
            here = sum(n for _, _, t0, t1, n in rows if t0 <= b < t1)
            if here > peak:
                peak, peak_t = here, b
        met = set()
        rows.sort(key=lambda x: x[2])  # by arrival: later rows cannot overlap once they start late
        for i, (r1, h1, a1, z1, _) in enumerate(rows):
            for r2, h2, a2, z2, _ in rows[i + 1 :]:
                if a2 > z1 - 15:
                    break
                if h1 != h2 and min(z1, z2) - max(a1, a2) >= 15:
                    met.add(r1)
                    met.add(r2)
        p = w.places.get(pid)
        out.append(
            {
                "place_id": pid,
                "name": p.name if p else pid,
                "type": p.type if p else "",
                "coord": p.coord if p else None,
                "visitors": visitors,
                "peak": peak,
                "peak_at": peak_t,
                "met_neighbours": len(met),
            }
        )
    out.sort(key=lambda x: (-x["visitors"], x["place_id"]))
    return out[:top]


def health(res: DayResult) -> dict:
    walk_min: Counter = Counter()
    for t in res.trips:
        if t.mode == "drive":
            continue
        mins = sum(s.t1 - s.t0 for s in t.segments if not s.wait)
        walk_min[t.resident] += mins
        for c in t.companions:
            walk_min[c] += mins
    n = len(res.day.pop.residents)
    active = sum(1 for v in walk_min.values() if v >= 20)
    trips = [t for t in res.trips if t.status != "cancelled"]
    car = sum(1 for t in trips if t.mode == "drive")
    return {
        "residents_walking_20_min": active,
        "residents": n,
        "car_trips": car,
        "walking_trips": len(trips) - car,
    }


def headline(res: DayResult) -> dict:
    trips = res.trips
    c = Counter(t.status for t in trips)
    caught = [t for t in trips if t.waited_min > 0 and t.arrive is not None]
    people_cut = {t.resident for t in trips if t.status in ("cancelled", "stranded")}
    return {
        "residents": len(res.day.pop.residents),
        "trips": len(trips),
        "on_time": c.get("on_time", 0),
        "late": c.get("late", 0),
        "cancelled": c.get("cancelled", 0),
        "stranded": c.get("stranded", 0),
        "data_gap": c.get("data_gap", 0),
        "rerouted": sum(t.rerouted for t in trips),
        "waited_on_the_way": len(caught),
        "residents_with_a_cancelled_trip": len(people_cut),
        "unchecked_stretches": sum(t.unknown for t in trips),
    }


def tracks(res: DayResult, sample: int = 1500, keep: set[str] | None = None) -> dict:
    """Map playback: a node table and, for a deterministic sample of residents (plus `keep`),
    each trip's segments as (t0, t1, node indices); a client moves the dot at constant speed
    along each segment. Waiting is a one-node segment."""
    keep = keep or set()
    people = res.day.pop.residents
    step = max(1, len(people) // sample)
    chosen = {r.id for i, r in enumerate(people) if i % step == 0} | keep
    remap: dict[int, int] = {}
    coords = res.day.graph.coords
    out_trips = []
    for t in res.trips:
        if t.resident not in chosen or not t.segments:
            continue
        segs = []
        for s in t.segments:
            idx = []
            for n in s.nodes:
                if n not in remap:
                    remap[n] = len(remap)
                idx.append(remap[n])
            segs.append([round(s.t0, 2), round(s.t1, 2), idx, int(s.wait)])
        out_trips.append(
            {
                "r": t.resident,
                "m": "drive" if t.mode == "drive" else "walk",
                "s": t.status,
                "k": 1 + len(t.companions),
                "seg": segs,
            }
        )
    nodes = [None] * len(remap)
    for n, i in remap.items():
        nodes[i] = [round(float(coords[n][0]), 6), round(float(coords[n][1]), 6)]
    return {"nodes": nodes, "trips": out_trips, "shown": len(chosen), "of": len(people)}


def trip_json(t: Trip, world) -> dict:
    p = world.places.get(t.place_id) if t.place_id else None
    return {
        "id": t.id,
        "purpose": t.purpose,
        "to": PURPOSE_LABEL.get(t.purpose, t.purpose),
        "place": p.name if p else ("a main road out of Elmina" if t.purpose == "work" else None),
        "label": t.label,
        "mode": "drive" if t.mode == "drive" else "walk",
        "direction": t.direction,
        "planned": t.planned,
        "depart": round(t.depart, 1),
        "arrive": round(t.arrive, 1) if t.arrive is not None else None,
        "status": t.status,
        "delay_min": t.delay_min,
        "normal_min": t.normal_min,
        "rerouted": t.rerouted,
        "waited_min": t.waited_min,
        "unchecked_stretches": t.unknown,
        "companions": len(t.companions),
        "stranded_at": t.stranded_at,
    }


def report(res: DayResult, keep: set[str] | None = None, sample: int = 1500) -> dict:
    d = res.day
    sc = d.scenario
    return {
        "scenario": {
            "id": sc.id,
            "label": sc.label,
            "summary": sc.summary,
            "hero": sc.hero,
            "day": sc.day,
            "stages": [[m, s] for m, s in sc.stages],
            "rain": [list(x) for x in sc.rain],
            "event": sc.event,
            "imagined": bool(sc.actions),
            "actions": [
                __import__("townshiplens_spatial.twm", fromlist=["describe"]).describe(
                    d.base_world, a
                )
                for a in sc.actions
            ],
        },
        "population": {**pop_summary(d.pop), "sources": d.pop.sources, "seed": d.pop.seed},
        "assumptions": ASSUMPTIONS
        + [
            "Routes may use unchecked paths, as residents do; known barriers and likely-flooded "
            "paths are never used.",
            "An essential trip with no way open waits up to 90 minutes, then is cancelled.",
        ],
        "paces_m_per_min": {**PACE, "drive": DRIVE_PACE},
        "headline": headline(res),
        "groups": groups(res),
        "school": school(res),
        "health": health(res),
        "places": places(res),
        "timeline": timeline(res),
        "tracks": tracks(res, sample, keep),
        "disclaimer": DISCLAIMER,
        "world_version": d.base_world.version,
    }
