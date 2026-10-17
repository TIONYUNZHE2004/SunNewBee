"""Whose rehearsed trips use a ticket's path or place (Cycle 23).

Staff verify facts one ticket at a time. This says, from the rehearsed day itself, how many
synthetic residents' trips use the ticket's path (or go to its place), on foot or by car, and
what for: school runs, work, the clinic, prayers. Routing in the rehearsal is lenient (residents
use unchecked paths, as they do), so a check on that path confirms or rules out a stretch those
trips rely on. Counts only; the residents are synthetic and the day a rehearsal, not a forecast.
"""

from __future__ import annotations

from collections import Counter

from .engine import DayResult

PURPOSE_WORDS = {
    "school": "school runs and school trips",
    "work": "trips to work",
    "clinic": "clinic visits",
    "shops": "shopping trips",
    "worship": "trips to prayers",
    "park": "park visits",
    "event": "trips to the evening event",
    "home": "trips home",
}
ARRIVED = ("on_time", "late")


def reach(res: DayResult, element_id: str) -> dict:
    """Distinct residents (children counted with their carer) whose trips in this day use the
    path `element_id` (any twin path between the same two junctions counts: the router keeps one
    of them), or arrive at the place `element_id`; on foot or by car, by purpose and age group."""
    d = res.day
    w = d.base_world
    age_group = {r.id: r.group for r in d.pop.residents}
    is_place = element_id in w.places and element_id not in w.edges
    pair = None
    if not is_place and element_id in w.edges:
        e = w.edges[element_id]
        a, b = d.graph.index.get(e.from_node), d.graph.index.get(e.to_node)
        if a is not None and b is not None:
            pair = (min(a, b), max(a, b))
    residents: set[str] = set()
    foot: set[str] = set()
    car: set[str] = set()
    trips = 0
    purposes: Counter = Counter()
    for t in res.trips:
        if is_place:
            # trips that went to the place and got there (not return trips, not cancelled ones)
            hit = t.place_id == element_id and t.direction == "out" and t.status in ARRIVED
        else:
            hit = pair is not None and any(
                not s.wait
                and any(
                    (min(x, y), max(x, y)) == pair
                    for x, y in zip(s.nodes, s.nodes[1:], strict=False)
                )
                for s in t.segments
            )
        if not hit:
            continue
        trips += 1
        who = {t.resident, *t.companions}
        residents |= who
        (car if t.mode == "drive" else foot).update(who)
        purposes[t.purpose if t.direction == "out" else "home"] += 1
    groups = Counter(age_group.get(r, "adult") for r in residents)
    return {
        "kind": "place" if is_place else "path",
        "residents": len(residents),
        "on_foot": len(foot),
        "by_car": len(car - foot),
        "trips": trips,
        "by_purpose": [
            {"purpose": p, "words": PURPOSE_WORDS.get(p, p), "trips": n}
            for p, n in purposes.most_common()
        ],
        "by_group": {g: groups.get(g, 0) for g in ("child", "teen", "adult", "older")},
    }
