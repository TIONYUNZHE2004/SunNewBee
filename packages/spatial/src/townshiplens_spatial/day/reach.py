"""Who a ticket's path or place matters to, in a rehearsed day (Cycle 23).

Staff verify facts one ticket at a time. This says, from the rehearsed day itself, how many
synthetic residents' trips cross the ticket's path (or go to its place), and what for: school
runs, work, the clinic, prayers. Routing in the rehearsal is lenient (residents use unchecked
paths, as they do), so a check on that path confirms or rules out a stretch those trips rely on.
Counts only; the residents are synthetic and the day is a rehearsal, not a forecast.
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


def reach(res: DayResult, element_id: str) -> dict:
    """Distinct residents (children counted with their carer) whose trips in this day cross the
    path `element_id`, or go to the place `element_id`; by purpose and by age group."""
    d = res.day
    age_group = {r.id: r.group for r in d.pop.residents}
    is_place = element_id in d.base_world.places and element_id not in d.base_world.edges
    residents: set[str] = set()
    trips = 0
    purposes: Counter = Counter()
    with d.lock:
        for t in res.trips:
            hit = False
            if is_place:
                hit = t.place_id == element_id
            else:
                for s in t.segments:
                    if s.wait or len(s.nodes) < 2:
                        continue
                    r = d.router(t.mode, d.scenario.stage_at(s.t0))
                    for x, y in zip(s.nodes, s.nodes[1:], strict=False):
                        k = r.pair_edge.get((min(x, y), max(x, y)))
                        if k is not None and d.graph.edges[k].id == element_id:
                            hit = True
                            break
                    if hit:
                        break
            if not hit:
                continue
            trips += 1
            who = {t.resident, *t.companions}
            residents |= who
            purposes[t.purpose if t.direction == "out" else "home"] += 1
    groups = Counter(age_group.get(r, "adult") for r in residents)
    return {
        "kind": "place" if is_place else "path",
        "residents": len(residents),
        "trips": trips,
        "by_purpose": [
            {"purpose": p, "words": PURPOSE_WORDS.get(p, p), "trips": n}
            for p, n in purposes.most_common()
        ],
        "by_group": {g: groups.get(g, 0) for g in ("child", "teen", "adult", "older")},
    }
