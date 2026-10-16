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
CHANGED_MIN = 5  # a trip "changed" when its delay moved by more than this, or its outcome did
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


def candidates(res: DayResult, k: int = 3) -> list[dict]:
    """Changes worth testing on this day: the most-walked footways (what if they close for
    works?) and steps on walked routes (what if they were a ramp?). From the day's own trips."""
    w = res.day.world
    use = _edge_use(res)
    out = flood_stretches(res)  # on a day with a river rise, the flood works come first
    paths = [(e, n) for e, n in use.most_common() if w.edges[e].type in WALK_TYPES - {"steps"}]
    for eid, n in paths[:k]:
        a = twm.ClosePath(element_id=eid)
        out.append(
            {
                "action": a.model_dump(),
                "label": f"{twm.describe(w, a)} all day for works",
                "why": f"walked by {n} people on this day",
            }
        )
    steps = [(e, n) for e, n in use.most_common() if w.edges[e].type == "steps"]
    for eid, n in steps[:k]:
        a = twm.BuildRamp(element_id=eid)
        out.append(
            {
                "action": a.model_dump(),
                "label": twm.describe(w, a),
                "why": f"walked by {n} people on this day",
            }
        )
    return out


def flood_stretches(
    res: DayResult, k: int = 3, max_edges: int = 40, max_m: float = 900.0
) -> list[dict]:
    """Flooded stretches the most people relied on: for every trip the water cancelled or cut,
    the normal-day route is checked for path segments that are flooded at the day's highest
    river level. The most relied-on segment grows into a connected flooded stretch (up to 40
    segments / about 900 m). From the day's own trips; nothing is estimated."""
    d = res.day
    w = d.base_world
    stages = [sid for _, sid in d.scenario.stages if sid]
    if not stages:
        return []
    by_m = {s.id: s.stage_m for s in w.flood.scenarios}
    top = max(stages, key=lambda s: by_m.get(s, 0))
    flooded = w.flood.edge_classes.get(top, {})
    hit: Counter = Counter()
    for t in res.trips:
        if t.status not in ("cancelled", "turned_back", "stranded") and not (
            t.status == "late" and t.waited_min > 0
        ):
            continue
        if t.src is None or not t.targets:
            continue
        leg = d._leg(t.mode, None, True, t.src, t.targets)
        if leg is None:
            continue
        n = 1 + len(t.companions)
        for eid in leg.edge_ids:
            if eid in flooded:
                hit[eid] += n
    out, used = [], set()
    by_node: dict[str, list[str]] = {}
    for eid in flooded:
        e = w.edges.get(eid)
        if e:
            by_node.setdefault(e.from_node, []).append(eid)
            by_node.setdefault(e.to_node, []).append(eid)
    for seed, people in hit.most_common():
        if seed in used or len(out) >= k:
            continue
        stretch, metres, frontier = [seed], w.edges[seed].length_m, [seed]
        seen = {seed}
        while frontier and len(stretch) < max_edges and metres < max_m:
            e = w.edges[frontier.pop(0)]
            nbrs = sorted(
                {x for n in (e.from_node, e.to_node) for x in by_node.get(n, [])} - seen,
                key=lambda x: (-hit.get(x, 0), x),
            )
            for x in nbrs:
                if len(stretch) >= max_edges or metres >= max_m:
                    break
                seen.add(x)
                stretch.append(x)
                frontier.append(x)
                metres += w.edges[x].length_m
        used |= set(stretch)
        names = Counter(w.edges[x].name for x in stretch if w.edges[x].name)
        where = f"on {names.most_common(1)[0][0]}" if names else "nearby"
        label = f"the flooded stretch {where}"
        a = twm.RaisePaths(element_ids=stretch, label=label)
        out.append(
            {
                "action": a.model_dump(),
                "label": twm.describe(w, a),
                "why": f"on the usual route of {people} people whose trips the water cut",
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
        }
        changed.setdefault(t.resident, []).append(row)
        worse = SEVERITY.get(sa, 0) > SEVERITY.get(sb, 0) or (delta or 0) > CHANGED_MIN
        better = SEVERITY.get(sa, 0) < SEVERITY.get(sb, 0) or (delta or 0) < -CHANGED_MIN
        lost += worse
        gained += better
    groups = []
    for gid, label, pred in GROUPS:
        ids = [rid for rid, r in people.items() if pred(r)]
        worse = better = 0
        for rid in ids:
            rows = changed.get(rid, [])
            # children feel their carer's trips
            if not rows:
                rows = [
                    x
                    for rs in changed.values()
                    for x in rs
                    if rid in _companions(b.get(x["trip"]) or a.get(x["trip"]))
                ]
            if not rows:
                continue
            w = sum(1 for x in rows if _worse(x))
            g = sum(1 for x in rows if _better(x))
            worse += w > g
            better += g > w
        groups.append(
            {
                "id": gid,
                "label": label,
                "residents": len(ids),
                "worse_off": worse,
                "better_off": better,
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
        "residents_changed": len(changed),
        "trips_better": gained,
        "trips_worse": lost,
        "groups": groups,
        "biggest": biggest,
        "town_hall": town_hall,
        "disclaimer": DISCLAIMER,
    }


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


CUT = ("cancelled", "stranded", "turned_back")


def _impact(x: dict) -> float:
    return 100.0 * abs(SEVERITY.get(x["after"], 0) - SEVERITY.get(x["before"], 0)) + abs(
        x["change_min"] or 0
    )


def reaction(x: dict) -> str | None:
    """A spotlight resident's town-hall line, written from their own before/after (None when
    nothing worth saying changed)."""
    trip = "getting home" if x["direction"] == "back" else f"my trip to {x['to']}"
    if x["before"] in CUT and x["after"] not in CUT:
        return f"With this change I could make {trip}, which the water stopped before."
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
