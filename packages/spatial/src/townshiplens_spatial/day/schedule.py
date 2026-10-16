"""Daily plans for synthetic residents (Cycle 10).

A plan is a list of activities, in the shape of AgentSociety v2's day "story" (segments with a
purpose and a place). Rules write the plans, not a language model. Spotlight residents may change
theirs at decision moments (see `spotlight.py`), and only to options the engine offers.

Times are typical Malaysian weekday patterns, stated as assumptions: school starts about 07:30,
office hours, and prayer times approximate for Shah Alam in October (JAKIM e-Solat).
Destinations follow a gravity rule (nearby places much more likely; AgentSociety's
`gravity_model`, weight 1 / distance^2 over the 3 nearest of the right type).
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

import numpy as np
from scipy.spatial import cKDTree

from ..world import World
from .population import Population, Resident, _xy

# Place types per purpose. "work" is a township exit on a main road (commuters leave Elmina).
PURPOSE_TYPES = {
    "school": ("school",),
    "worship": ("place_of_worship",),
    "clinic": ("clinic",),
    "park": ("park", "playground"),
    "shops": ("mall", "community_centre"),
    "event": (),  # set by the scenario
}
PRAYER = {
    "subuh": 5 * 60 + 50,
    "zohor": 13 * 60 + 5,
    "jumaat": 12 * 60 + 50,
    "maghrib": 19 * 60 + 10,
}
ASSUMPTIONS = [
    "School starts about 07:30 and ends 13:30 (primary) or 14:15 (secondary).",
    "Commuters leave between 07:00 and 08:00 and return between 17:30 and 19:00.",
    "Prayer times are approximate for Shah Alam in October (JAKIM e-Solat).",
    "Walking paces: 75 m/min, 65 with a stroller, 60 in a wheelchair, 50 for older residents "
    "who need rests; driving 500 m/min (30 km/h, the drive profile).",
    "Children under 13 travel with a carer; teenagers walk on their own.",
]


@dataclass
class Activity:
    resident: str
    purpose: str  # school | work | worship | clinic | park | shops | event
    place_id: str | None  # a place, or None for "work" (an exit node)
    target_nodes: tuple[str, ...]
    depart_min: int
    stay_min: int
    companions: list[str] = field(default_factory=list)  # children travelling with this carer
    label: str = ""


def _places_by_purpose(world: World) -> dict[str, list]:
    out: dict[str, list] = {}
    for purpose, types in PURPOSE_TYPES.items():
        out[purpose] = [
            p
            for p in world.places.values()
            if p.type in types and p.node_id and p.node_id in world.graph and p.kind == "place"
        ]
    return out


def work_exits(world: World, k: int = 6) -> list[str]:
    """Nodes on main roads nearest the edges of the site's bounding box: where commuters leave."""
    bbox = world.site.bbox
    roads = [
        n for e in world.edges.values() if e.type == "major_road" for n in (e.from_node, e.to_node)
    ] or [n for e in world.edges.values() if e.type == "street" for n in (e.from_node, e.to_node)]
    if not roads:
        return list(world.graph.nodes)[:1]
    roads = sorted(set(roads))

    def edge_dist(n):
        x, y = world.node_coords[n]
        return min(x - bbox[0], bbox[2] - x, y - bbox[1], bbox[3] - y)

    return sorted(roads, key=lambda n: (edge_dist(n), n))[:k]


class Planner:
    def __init__(self, world: World, seed: int = 11):
        self.world = world
        self.rng = random.Random(seed)
        self.places = _places_by_purpose(world)
        self.trees = {
            p: cKDTree(np.array([_xy(x.coord) for x in xs])) if xs else None
            for p, xs in self.places.items()
        }
        self.exits = work_exits(world)

    def pick(self, purpose: str, r: Resident):
        """A place for this purpose near home: gravity choice among the 3 nearest."""
        xs, tree = self.places.get(purpose) or [], self.trees.get(purpose)
        if not xs or tree is None:
            return None
        k = min(3, len(xs))
        d, j = tree.query(_xy(r.home_coord), k=k)
        d, j = np.atleast_1d(d), np.atleast_1d(j)
        w = [1.0 / max(dd, 50.0) ** 2 for dd in d]
        return xs[int(self.rng.choices(list(j), weights=w)[0])]

    def minutes(self, lo: int, hi: int) -> int:
        return self.rng.randint(lo, hi)


def plan_day(
    world: World, pop: Population, day: str = "weekday", seed: int = 11, event: dict | None = None
) -> list[Activity]:
    """Activities for every resident, in departure order. `event` = {place_id, start, end,
    share} adds an evening event that `share` of residents within 3 km attend."""
    pl = Planner(world, seed)
    acts: list[Activity] = []
    by_house: dict[str, list[Resident]] = {}
    for r in pop.residents:
        by_house.setdefault(r.household, []).append(r)

    def add(r, purpose, place, depart, stay, companions=(), label=""):
        if purpose == "work":
            targets = tuple(pl.exits)
            pid = None
        else:
            if place is None:
                return
            targets, pid = (place.node_id,), place.id
        acts.append(Activity(r.id, purpose, pid, targets, depart, stay, list(companions), label))

    for members in by_house.values():
        kids = [m for m in members if m.group == "child"]
        carers = [m for m in members if m.group in ("adult", "older")]
        carer = next((m for m in carers if not m.commuter), carers[0] if carers else None)
        for m in members:
            if m.group == "teen":
                add(m, "school", pl.pick("school", m), pl.minutes(395, 420), pl.minutes(400, 430))
        if kids and carer:
            school = pl.pick("school", carer)
            add(
                carer, "school", school, pl.minutes(400, 430), 0, [k.id for k in kids], "school run"
            )
            if not carer.commuter:
                add(
                    carer,
                    "school",
                    school,
                    pl.minutes(795, 815),
                    0,
                    [k.id for k in kids],
                    "school pick-up",
                )
        for m in carers:
            if m.commuter:
                add(m, "work", None, pl.minutes(420, 480), pl.minutes(570, 660), label="commute")
            if m.muslim and m.age >= 15:
                # Commuters pray near work; only residents in the township are simulated here.
                if day == "friday" and not m.commuter and m.age < 75 and pl.rng.random() < 0.8:
                    add(
                        m,
                        "worship",
                        pl.pick("worship", m),
                        PRAYER["jumaat"] - pl.minutes(10, 25),
                        70,
                        label="Friday prayers",
                    )
                elif m.group == "older" and pl.rng.random() < 0.35:
                    add(
                        m,
                        "worship",
                        pl.pick("worship", m),
                        PRAYER["maghrib"] - pl.minutes(10, 20),
                        pl.minutes(45, 80),
                        label="Maghrib at the surau",
                    )
            if not m.commuter:
                if pl.rng.random() < 0.3:
                    add(m, "shops", pl.pick("shops", m), pl.minutes(600, 690), pl.minutes(45, 120))
                if m.group == "older" and pl.rng.random() < 0.06:
                    add(m, "clinic", pl.pick("clinic", m), pl.minutes(540, 600), pl.minutes(40, 90))
                if m.group == "older" and pl.rng.random() < 0.25:
                    add(
                        m,
                        "park",
                        pl.pick("park", m),
                        pl.minutes(400, 440),
                        pl.minutes(30, 60),
                        label="morning walk",
                    )
            if pl.rng.random() < 0.18:
                add(
                    m,
                    "park",
                    pl.pick("park", m),
                    pl.minutes(1050, 1110),
                    pl.minutes(40, 80),
                    [k.id for k in kids] if m is carer else [],
                    "evening at the park",
                )
        if event:
            place = world.places.get(event["place_id"])
            for m in carers:
                if place is None or pl.rng.random() >= event.get("share", 0.15):
                    continue
                dx = (place.coord[0] - m.home_coord[0]) * 111_320 * 0.9984
                dy = (place.coord[1] - m.home_coord[1]) * 110_540
                if (dx * dx + dy * dy) ** 0.5 > event.get("radius_m", 3000):
                    continue
                add(
                    m,
                    "event",
                    place,
                    event["start"] - pl.minutes(10, 40),
                    event["end"] - event["start"],
                    [k.id for k in kids] if m is carer else [],
                    event.get("label", "community event"),
                )
    acts.sort(key=lambda a: (a.depart_min, a.resident))
    return acts
