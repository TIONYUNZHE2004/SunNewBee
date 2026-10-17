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
import re
from dataclasses import dataclass, field

import numpy as np
from scipy.spatial import cKDTree

from ..world import World
from .population import Population, Resident, _xy

# Place types per purpose. "work" is a township exit on a main road (commuters leave Elmina).
PRIMARY_AGE = (7, 12)  # Standard 1-6
SECONDARY_AGE = (13, 17)  # Form 1-5
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
    "School starts about 07:30; children under 13 are collected at 13:30 and teenagers leave "
    "at 14:15.",
    "Commuters leave between 07:00 and 08:00 and set off home between 17:30 and 19:00; those "
    "without a car take a ride-hail or a lift (the driving profile).",
    "Friday prayers: Muslim men aged 15 to 74 who are in the township that day.",
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
    until_min: int | None = None  # absolute time to leave (school ends, office hours)
    kids_out: bool = True  # the children are on the outward leg
    kids_back: bool = True  # the children are on the way home
    chain_next: bool = False  # the next plan starts from here (no trip home in between)
    chained: bool = False  # this plan starts where the previous one ended


NOT_SCHOOL = re.compile(r"\b(?:tadika|taska|tuition|kindergarten|nursery)\b", re.IGNORECASE)
PRIMARY = re.compile(r"^(?:SK|SJK|SRII?)\b|sekolah (?:kebangsaan|rendah)", re.IGNORECASE)
SECONDARY = re.compile(r"^SMK\b|menengah|maahad", re.IGNORECASE)


def _places_by_purpose(world: World, now=None) -> dict[str, list]:
    """Places per purpose; a place under a staff closure on the rehearsal day is left out."""
    from ..models import active_closures

    out: dict[str, list] = {}
    for purpose, types in PURPOSE_TYPES.items():
        out[purpose] = [
            p
            for p in world.places.values()
            if p.type in types
            and p.node_id
            and p.node_id in world.graph
            and p.kind == "place"
            and not (p.closures and now is not None and active_closures(p.closures, now))
            and not (purpose == "school" and NOT_SCHOOL.search(p.name or ""))
        ]
    # Pupils go to a school of their level by name (SK / SJK / sekolah rendah for children,
    # SMK / menengah for teenagers); other named or unnamed schools serve both.
    schools = out["school"]
    out["school_primary"] = [p for p in schools if not SECONDARY.search(p.name or "")]
    out["school_secondary"] = [p for p in schools if not PRIMARY.search(p.name or "")]
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
    def __init__(self, world: World, seed: int = 11, now=None):
        self.world = world
        self.rng = random.Random(seed)
        self.places = _places_by_purpose(world, now)
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
    world: World,
    pop: Population,
    day: str = "weekday",
    seed: int = 11,
    event: dict | None = None,
    now=None,
) -> list[Activity]:
    """Activities for every resident, in departure order. `event` = {place_id, start, end,
    share, radius_m} adds an evening event that `share` of carers within 3 km attend."""
    pl = Planner(world, seed, now)
    acts: list[Activity] = []
    by_house: dict[str, list[Resident]] = {}
    for r in pop.residents:
        by_house.setdefault(r.household, []).append(r)

    def add(
        r,
        purpose,
        place,
        depart,
        stay,
        companions=(),
        label="",
        until=None,
        kids_out=True,
        kids_back=True,
    ):
        if purpose == "work":
            targets = tuple(pl.exits)
            pid = None
        else:
            if place is None:
                return
            targets, pid = (place.node_id,), place.id
        acts.append(
            Activity(
                r.id,
                purpose,
                pid,
                targets,
                depart,
                stay,
                list(companions),
                label,
                until,
                kids_out,
                kids_back,
            )
        )

    for members in by_house.values():
        kids = [m for m in members if m.group == "child"]
        carers = [m for m in members if m.group in ("adult", "older")]
        carer = next((m for m in carers if not m.commuter), carers[0] if carers else None)
        for m in members:
            if m.group == "teen":
                add(m, "school", pl.pick("school_secondary", m), pl.minutes(395, 420), 0, until=855)
        # Primary school is Standard 1-6 (ages 7-12 in Malaysia): a school run happens only when
        # a child of that age lives here. Younger siblings ride along with the carer (and are
        # never counted as pupils). Calibration (Cycle 21) found every under-13, toddlers
        # included, doing a school run before this.
        if carer and any(PRIMARY_AGE[0] <= k.age <= PRIMARY_AGE[1] for k in kids):
            school = pl.pick("school_primary", carer)
            ids = [k.id for k in kids]
            # Drop-off: the children ride out, the carer comes home alone.
            add(
                carer, "school", school, pl.minutes(400, 430), 0, ids, "school run", kids_back=False
            )
            if not carer.commuter:
                # Pick-up: the carer goes alone, waits for 13:30 and brings the children home.
                add(
                    carer,
                    "school",
                    school,
                    pl.minutes(780, 795),
                    0,
                    ids,
                    "school pick-up",
                    until=810,
                    kids_out=False,
                )
        for m in carers:
            if m.commuter:
                add(
                    m,
                    "work",
                    None,
                    pl.minutes(420, 480),
                    0,
                    label="commute",
                    until=pl.minutes(1050, 1140),
                )
            if m.muslim and m.age >= 15:
                # Commuters pray near work; only residents in the township are simulated here.
                friday = day == "friday" and m.sex == "m" and not m.commuter and m.age < 75
                if friday and pl.rng.random() < 0.8:
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
                    add(m, "shops", pl.pick("shops", m), pl.minutes(600, 660), pl.minutes(30, 75))
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
                    # commuters go after they are home from work
                    pl.minutes(1170, 1200) if m.commuter else pl.minutes(1050, 1110),
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
    people = {r.id: r for r in pop.residents}

    def est(a: Activity) -> float:
        """Rough minutes there and back, for keeping plans apart (not used for any result)."""
        r = people[a.resident]
        x0, y0 = r.home_coord
        x1, y1 = world.node_coords[a.target_nodes[0]]
        d = ((x1 - x0) * 111_320) ** 2 + ((y1 - y0) * 110_540) ** 2
        pace = 500.0 if a.purpose == "work" or r.drives else 50.0
        return 2 * 1.8 * d**0.5 / pace + 15

    acts = _no_overlaps(acts, est)
    acts.sort(key=lambda a: (a.depart_min, a.resident))
    return acts


def _no_overlaps(acts: list[Activity], est) -> list[Activity]:
    """A resident's plans never overlap: a plan that would start before the previous one is
    over (its stay or absolute end, plus `est` minutes of travel) is moved later, or dropped
    when it would start after 22:00. A commuting parent drives to work straight from the school
    gate (the commute is chained to the drop-off; the engine starts it where the drop-off ended).
    """
    by: dict[str, list[Activity]] = {}
    for a in acts:
        by.setdefault(a.resident, []).append(a)
    out: list[Activity] = []
    for plans in by.values():
        plans.sort(key=lambda a: a.depart_min)
        free = 0.0
        prev: Activity | None = None
        for a in plans:
            if a.purpose == "work" and prev is not None and prev.label == "school run":
                prev.chain_next, a.chained = True, True
                a.depart_min = prev.depart_min  # the engine starts it on arrival at the school
            elif a.depart_min < free:
                a.depart_min = int(free)
            if a.depart_min > 22 * 60:
                continue
            end = a.until_min if a.until_min is not None else a.depart_min + a.stay_min
            if not a.chain_next:
                free = max(free, end + est(a))
            out.append(a)
            prev = a
    return out
