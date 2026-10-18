"""Test a change before building it (Cycle 13): the same simulated day, twice.

A planner picks an imagined change (close the busiest footway for works, rebuild busy steps as
a ramp). The engine runs the same day for the same synthetic residents with and without it, and
matches every trip by its stable id (resident, plan, direction). The result is who gains and who
loses, by group, in minutes and in trips that could or could not happen. Spotlight residents
whose day changed react at a "town hall", in words built from their own before/after.

Imagined, never a plan or a promise: the change is not real, and the people are synthetic.
"""

from __future__ import annotations

import dataclasses
from collections import Counter

from .. import twm
from .engine import Day, DayResult, Scenario
from .population import Population
from .spotlight import Spotlight, hhmm
from .summary import GROUPS, PURPOSE_LABEL, SEVERITY

WALK_TYPES = {"footway", "path", "pedestrian", "crossing", "steps", "ramp"}
CHANGED_MIN = 5
CUT = (
    "cancelled",
    "stranded",
    "turned_back",
)  # a trip "changed" when its delay moved by more than this, or its outcome did
DISCLAIMER = (
    "Imagined change on a rehearsal of synthetic residents: not a plan, not a promise and not a "
    "forecast. The real township is unchanged."
)


def _edge_use(res: DayResult) -> Counter:
    """People walking each edge over the day (children counted with their carer)."""
    d = res.day
    use: Counter = Counter()
    for t in res.trips:
        if t.mode == "drive":
            continue
        n = 1 + len(t.companions)
        for s in t.segments:
            if s.wait or len(s.nodes) < 2:
                continue
            r = d.router(t.mode, d.scenario.stage_at(s.t0))
            for x, y in zip(s.nodes, s.nodes[1:], strict=False):
                k = r.pair_edge.get((min(x, y), max(x, y)))
                if k is not None:
                    use[d.graph.edges[k].id] += n
    return use


def _candidates(res: DayResult, k: int = 3) -> list[dict]:
    """Changes worth testing on this day: the most-walked footways (what if they close for
    works?) and steps on walked routes (what if they were a ramp?). From the day's own trips."""
    w = res.day.world
    use = _edge_use(res)
    out = _flood_stretches(res)  # on a day with a river rise, the flood works come first
    paths = [(e, n) for e, n in use.most_common() if w.edges[e].type in WALK_TYPES - {"steps"}]
    nodes_used: set[str] = set()
    shown: set[tuple[str, str]] = set()  # two offers that read the same are one offer
    picked = 0
    for eid, n in paths:
        e = w.edges[eid]
        if picked >= k or {e.from_node, e.to_node} & nodes_used:
            continue  # a neighbour of one already offered: the same corridor
        nodes_used |= {e.from_node, e.to_node}
        a = twm.ClosePath(element_id=eid)
        label, why = f"{twm.describe(w, a)} all day for works", f"on {n} trips walked this day"
        if (label, why) in shown:
            continue  # a parallel piece of the same corridor: same name, same trips
        shown.add((label, why))
        picked += 1
        out.append({"action": a.model_dump(), "label": label, "why": why, "count": n})
    picked = 0
    for eid, n in use.most_common():
        if w.edges[eid].type != "steps":
            continue
        a = twm.BuildRamp(element_id=eid)
        label, why = twm.describe(w, a), f"on {n} trips walked this day"
        if picked >= k or (label, why) in shown:
            continue
        shown.add((label, why))
        picked += 1
        out.append({"action": a.model_dump(), "label": label, "why": why, "count": n})
    return out


def stretch_label(world, ids: list[str]) -> str:
    """A server-built name for a stretch (from its street names); never client text."""
    names = Counter(world.edges[x].name for x in ids if x in world.edges and world.edges[x].name)
    return (
        f"the flooded stretch on {names.most_common(1)[0][0]}"
        if names
        else ("a flooded stretch of path")
    )


def _flood_stretches(
    res: DayResult, k: int = 3, max_edges: int = 40, max_m: float = 900.0
) -> list[dict]:
    """Flooded stretches the most residents relied on. For every trip the water cut (cancelled,
    turned back, stuck, or late after waiting), its normal-day route is checked for path
    segments that were flooded at the river level of the trip's planned time; each segment
    counts the distinct residents (children with their carer) whose trip it was on. The most
    relied-on segment grows along neighbouring segments that people also relied on (up to 40
    segments / about 900 m). From the day's own trips; nothing is estimated."""
    d = res.day
    w = d.base_world
    if not any(sid for _, sid in d.scenario.stages):
        return []
    people: dict[str, set[str]] = {}
    for t in res.trips:
        cut = t.status in ("cancelled", "turned_back", "stranded") or (
            t.status == "late" and t.waited_min > 0
        )
        if not cut or t.src is None or not t.targets:
            continue
        stage = d.scenario.stage_at(t.planned)
        flooded = w.flood.edge_classes.get(stage or "", {})
        if not flooded:
            continue
        leg = d._leg(t.mode, None, True, t.src, t.targets)
        if leg is None:
            continue
        who = {t.resident, *t.companions}
        for eid in leg.edge_ids:
            if eid in flooded:
                people.setdefault(eid, set()).update(who)
    hit = Counter({e: len(p) for e, p in people.items()})
    by_node: dict[str, list[str]] = {}
    for eid in hit:
        e = w.edges[eid]
        by_node.setdefault(e.from_node, []).append(eid)
        by_node.setdefault(e.to_node, []).append(eid)
    out, used = [], set()
    for seed, _ in hit.most_common():
        if len(out) >= k:
            break
        if seed in used:
            continue
        stretch, metres, frontier, seen = [seed], w.edges[seed].length_m, [seed], {seed}
        while frontier and len(stretch) < max_edges and metres < max_m:
            e = w.edges[frontier.pop(0)]
            nbrs = sorted(
                {x for n in (e.from_node, e.to_node) for x in by_node.get(n, [])} - seen,
                key=lambda x: (-hit[x], x),
            )
            for x in nbrs:
                if len(stretch) >= max_edges or metres >= max_m:
                    break
                seen.add(x)
                stretch.append(x)
                frontier.append(x)
                metres += w.edges[x].length_m
        if len(set(stretch) & used) > len(stretch) / 2:
            continue  # mostly the same stretch as one already offered
        used |= set(stretch)
        residents = set().union(*(people[x] for x in stretch))
        a = twm.RaisePaths(element_ids=stretch, label=stretch_label(w, stretch))
        out.append(
            {
                "action": a.model_dump(),
                "label": twm.describe(w, a),
                "why": (
                    f"on the usual route of {len(residents)} residents whose trips the water cut"
                ),
                "count": len(residents),
            }
        )
    return out


def _by_id(res: DayResult) -> dict[str, object]:
    return {t.id: t for t in res.trips}


def compare(
    world,
    scenario: Scenario,
    actions: list,
    pop: Population,
    cast: list[Spotlight] | None = None,
    before: DayResult | None = None,
) -> dict:
    """Run the day with and without `actions` (imagined) and diff it trip by trip."""
    before = before or Day(world, scenario, pop=pop).run()
    imagined = dataclasses.replace(scenario, actions=[*scenario.actions, *actions])
    after = Day(world, imagined, pop=pop).run()
    b, a = _by_id(before), _by_id(after)
    people = {r.id: r for r in pop.residents}
    changed: dict[str, list[dict]] = {}
    gained = lost = 0
    for tid in sorted(set(b) | set(a)):
        tb, ta = b.get(tid), a.get(tid)
        sb = tb.status if tb else "not made"
        sa = ta.status if ta else "not made"
        db = (tb.arrive - tb.depart) if tb and tb.arrive is not None else None
        da = (ta.arrive - ta.depart) if ta and ta.arrive is not None else None
        delta = round(da - db, 1) if db is not None and da is not None else None
        if sb == sa and (delta is None or abs(delta) <= CHANGED_MIN):
            continue
        t = ta or tb
        row = {
            "trip": tid,
            "resident": t.resident,
            "purpose": t.purpose,
            "to": PURPOSE_LABEL.get(t.purpose, t.purpose),
            "direction": t.direction,
            "before": sb,
            "after": sa,
            "minutes_before": int(round(db)) if db is not None else None,
            "minutes_after": int(round(da)) if da is not None else None,
            "change_min": int(round(delta)) if delta is not None else None,
            "companions": len(t.companions),
            "with": list(t.companions),
        }
        row["verdict"] = _verdict(row)
        changed.setdefault(t.resident, []).append(row)
        gained += row["verdict"] > 0
        lost += row["verdict"] < 0
    # Each resident (children through the trips they are on) is better off, worse off or
    # mixed: the same rule for the headline and for every group.
    feel: dict[str, int] = {}
    for rows in changed.values():
        for x in rows:
            for rid in (x["resident"], *x["with"]):
                feel[rid] = feel.get(rid, 0) + x["verdict"]
    better_ids = {r for r, v in feel.items() if v > 0}
    worse_ids = {r for r, v in feel.items() if v < 0}
    groups = []
    for gid, label, pred in GROUPS:
        ids = {rid for rid, r in people.items() if pred(r)}
        groups.append(
            {
                "id": gid,
                "label": label,
                "residents": len(ids),
                "worse_off": len(ids & worse_ids),
                "better_off": len(ids & better_ids),
            }
        )
    cast_ids = {c.id: c for c in (cast or [])}
    town_hall = []
    for rid, rows in changed.items():
        c = cast_ids.get(rid)
        if c is None:
            continue
        # A trip that exists on only one side (made possible, or no longer reached) says little
        # on its own: speak about trips that exist in both days, outward ones first.
        both = [r for r in rows if "not made" not in (r["before"], r["after"])]
        if not both:
            continue
        x = max(both, key=lambda r: (r["direction"] == "out", _impact(r)))
        text = reaction(x)
        if text:
            town_hall.append(
                {
                    "author": rid,
                    "name": c.name,
                    "role": c.role,
                    "trip": x["trip"],
                    "row": x,
                    "text": text,
                    "voice": "template",
                }
            )
    biggest = sorted(
        (x for rows in changed.values() for x in rows if x["change_min"] is not None),
        key=lambda x: -abs(x["change_min"]),
    )[:8]
    return {
        "actions": [twm.describe(world, x) for x in actions],
        "trips_changed": sum(len(r) for r in changed.values()),
        "residents_changed": len(feel),
        "residents_better": len(better_ids),
        "residents_worse": len(worse_ids),
        "trips_better": gained,
        "trips_worse": lost,
        "groups": groups,
        "biggest": biggest,
        "town_hall": town_hall,
        "baseline": "the same day with residents following the rules (no spotlight choices)",
        "disclaimer": DISCLAIMER,
    }


def _verdict(x: dict) -> int:
    """+1 better, -1 worse, 0 neither: the outcome decides first (a trip made possible counts
    as better, one no longer made as worse), then the time."""
    order = {"not made": 6, **SEVERITY}
    sb, sa = order.get(x["before"], 0), order.get(x["after"], 0)
    if x["before"] == "not made" and x["after"] not in CUT:
        return 1
    if x["after"] == "not made" and x["before"] not in CUT:
        return -1
    if sa != sb:
        return 1 if sa < sb else -1
    d = x["change_min"] or 0
    return -1 if d > CHANGED_MIN else 1 if d < -CHANGED_MIN else 0


def _companions(t) -> list[str]:
    return list(getattr(t, "companions", []) or [])


def _worse(x: dict) -> bool:
    return (
        SEVERITY.get(x["after"], 0) > SEVERITY.get(x["before"], 0)
        or (x["change_min"] or 0) > CHANGED_MIN
    )


def _better(x: dict) -> bool:
    return (
        SEVERITY.get(x["after"], 0) < SEVERITY.get(x["before"], 0)
        or (x["change_min"] or 0) < -CHANGED_MIN
    )


def _impact(x: dict) -> float:
    return 100.0 * abs(SEVERITY.get(x["after"], 0) - SEVERITY.get(x["before"], 0)) + abs(
        x["change_min"] or 0
    )


def reaction(x: dict) -> str | None:
    """A spotlight resident's town-hall line, written from their own before/after (None when
    nothing worth saying changed)."""
    trip = "getting home" if x["direction"] == "back" else f"my trip to {x['to']}"
    if x["before"] in CUT and x["after"] not in CUT:
        return f"With this change I could make {trip}, which was cut before."
    if x["after"] in CUT and x["before"] not in CUT:
        return f"With this change I could not make {trip} at all."
    d = x["change_min"] or 0
    mins = int(round(abs(d)))
    if mins <= CHANGED_MIN:
        return None
    word = "longer" if d > 0 else "less"
    return f"{trip[0].upper()}{trip[1:]} would take {mins} minutes {word}."


def reaction_facts(x: dict) -> dict:
    """Facts for checking an AI-written town-hall line with spotlight.check_text: the only
    numbers it may use are this trip's minutes before, after, the change, and the children."""

    def entry(n):
        return {
            "id": x["trip"],
            "planned": None,
            "left": None,
            "arrived": None,
            "ended": None,
            "late_by_min": n,
            "waited_min": 0,
            "children_with_them": x["companions"],
            "place": None,
            "from": None,
        }

    nums = [abs(x["change_min"] or 0), x["minutes_before"] or 0, x["minutes_after"] or 0]
    return {"age": 0, "decisions": [], "trips": [entry(int(round(n))) for n in nums]}


def touched_geojson(world, actions: list) -> dict:
    """The imagined change on the map, in the what-if diff format (side "touched")."""
    ids: list[str] = []
    for a in actions:
        ids += list(getattr(a, "element_ids", None) or [getattr(a, "element_id", None)])
    feats = [
        {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": world.edges[e].coords},
            "properties": {
                "whatif": True,
                "side": "touched",
                "element_id": e,
                "label": twm.path_label(world, e),
            },
        }
        for e in ids
        if e and e in world.edges
    ]
    return {"type": "FeatureCollection", "features": feats}


__all__ = ["DISCLAIMER", "candidates", "compare", "hhmm", "reaction"]


def candidates(res: DayResult, k: int = 3) -> list[dict]:
    """Changes worth testing on this day (see `_candidates`), routed under the day's lock: the
    cached day's routers are shared with residents' own rehearsed trips (review C19)."""
    with res.day.lock:
        return _candidates(res, k)


def flood_stretches(res: DayResult, k: int = 3, max_edges: int = 40, max_m: float = 900.0):
    with res.day.lock:
        return _flood_stretches(res, k, max_edges, max_m)
