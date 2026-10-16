"""Synthetic residents of Elmina for the day rehearsal (Cycle 10).

Every resident is synthetic: households are placed in real OSM residential buildings, and their
make-up follows public national statistics. Nothing here describes a real person. Each figure is
listed in `SOURCES` and returned with the population, so the UI can show where it came from.

Assumptions, not data, are marked "assumption"; they are the knobs a pilot would replace with
SDP's own resident data (with consent).
"""

from __future__ import annotations

import json
import math
import random
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from ..world import World

# Public statistics (DOSM) and stated assumptions. Shown in the UI as "how the residents were made".
SOURCES = [
    {
        "fact": "Ages: 21.2% aged 0-14, 70.4% aged 15-64, 8.4% aged 65+ (the generated "
        "households match these within about 2 points)",
        "source": "DOSM, Current Population Estimates, Malaysia 2026",
    },
    {"fact": "3.8 people per household on average", "source": "DOSM, Census 2020"},
    {"fact": "92.3% of households own a car", "source": "DOSM, household survey 2024"},
    {
        "fact": "2.4% of people are registered persons with disabilities (OKU); 35.6% of them "
        "with a physical disability",
        "source": "DOSM, Persons with Disabilities Statistics, Malaysia 2024",
    },
    {
        "fact": "60% of adults aged 20-60 commute out of the township on a weekday; 65% of "
        "residents attend a surau or masjid; a quarter of physically disabled residents use a "
        "wheelchair",
        "source": "assumption (no public figure for Elmina; replace with SDP resident data)",
    },
]

AGE_SHARES = (("child", 0.212), ("adult", 0.704), ("older", 0.084))
HOUSEHOLD_SIZES = ((1, 0.08), (2, 0.16), (3, 0.19), (4, 0.22), (5, 0.18), (6, 0.17))  # mean 3.8
CAR_SHARE = 0.923
OKU_SHARE = 0.024
PHYSICAL_SHARE = 0.356
WHEELCHAIR_OF_PHYSICAL = 0.25  # assumption
MUSLIM_SHARE = 0.65  # assumption
COMMUTER_SHARE = 0.6  # of adults aged 20-60 commute out on a weekday, assumption
OLDER_NEEDS_REST = 0.5  # of residents 65+, assumption


@dataclass
class Resident:
    id: str
    household: str
    age: int
    group: str  # child | teen | adult | older
    sex: str  # f | m (half each, assumption)
    persona: str  # routing profile: default | stroller | wheelchair | older_adult_rest
    home_node: str
    home_coord: list[float]
    car: bool  # the household owns a car
    drives: bool
    commuter: bool
    muslim: bool
    oku: bool
    wheelchair: bool
    toddler: bool = False  # an adult who walks with a child under 3 (stroller)
    tags: list[str] = field(default_factory=list)


@dataclass
class Population:
    residents: list[Resident]
    households: int
    seed: int
    sources: list[dict]

    def to_json(self) -> dict:
        return {
            "households": self.households,
            "seed": self.seed,
            "sources": self.sources,
            "residents": [asdict(r) for r in self.residents],
        }


def _weighted(rng: random.Random, pairs) -> object:
    x, acc = rng.random(), 0.0
    for v, w in pairs:
        acc += w
        if x <= acc:
            return v
    return pairs[-1][0]


def _homes(world: World) -> list[tuple[list[float], float]]:
    """(centroid, weight) of residential buildings, weighted by footprint area. Building
    heights are display-only (AGENTS.md) and mostly defaults, so they are not used. Worlds
    without buildings (the tiny fixture) use parking places as homes."""
    path = (world.data_dir or Path(".")) / "base" / "buildings.geojson"
    out: list[tuple[list[float], float]] = []
    if path.exists():
        for f in json.loads(path.read_text(encoding="utf-8"))["features"]:
            p = f["properties"]
            if p.get("kind") != "residential":
                continue
            ring = f["geometry"]["coordinates"][0]
            if f["geometry"]["type"] == "MultiPolygon":
                ring = ring[0]
            xs = [c[0] for c in ring]
            ys = [c[1] for c in ring]
            cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
            # Footprint area in m^2 (equirectangular), times floors (3.2 m each).
            k = 111_320 * math.cos(math.radians(cy))
            area = 0.5 * abs(
                sum(
                    (xs[i] * k) * (ys[i + 1] * 110_540) - (xs[i + 1] * k) * (ys[i] * 110_540)
                    for i in range(len(xs) - 1)
                )
            )
            out.append(([cx, cy], max(area, 40.0)))
    if not out:
        out = [(p.coord, 1.0) for p in world.places.values() if p.type in ("parking", "building")]
    if not out:
        out = [(c, 1.0) for c in list(world.node_coords.values())[:50]]
    return out


def walk_nodes(world: World) -> tuple[list[str], cKDTree]:
    """Graph nodes touched by a walkable edge, with a KD-tree for snapping homes to them."""
    ids = sorted({n for e in world.edges.values() for n in (e.from_node, e.to_node)})
    pts = np.array([_xy(world.node_coords[n]) for n in ids])
    return ids, cKDTree(pts)


def _xy(c) -> tuple[float, float]:
    """Local metres (equirectangular around Elmina's latitude), for nearest-neighbour search."""
    return (c[0] * 111_320 * 0.9984, c[1] * 110_540)


def synthesize(world: World, n_residents: int = 5000, seed: int = 11) -> Population:
    """Deterministic synthetic population: same world, size and seed give the same residents."""
    rng = random.Random(seed)
    homes = _homes(world)
    weights = [w for _, w in homes]
    ids, tree = walk_nodes(world)
    residents: list[Resident] = []
    h = 0
    while len(residents) < n_residents:
        h += 1
        hid = f"h{h:05d}"
        coord, _ = rng.choices(homes, weights=weights)[0]
        _, j = tree.query(_xy(coord))
        node = ids[int(j)]
        size = int(_weighted(rng, HOUSEHOLD_SIZES))
        car = rng.random() < CAR_SHARE
        members = _household(rng, size)
        has_toddler = any(a < 3 for a in members)
        for k, age in enumerate(members):
            if len(residents) >= n_residents:
                break
            group = (
                "child" if age < 13 else "teen" if age < 18 else "older" if age >= 65 else "adult"
            )
            sex = "f" if rng.random() < 0.5 else "m"
            oku = rng.random() < OKU_SHARE
            wheelchair = oku and rng.random() < PHYSICAL_SHARE * WHEELCHAIR_OF_PHYSICAL
            persona = "default"
            toddler = False
            if wheelchair:
                persona = "wheelchair"
            elif group == "older" and rng.random() < OLDER_NEEDS_REST:
                persona = "older_adult_rest"
            elif group == "adult" and has_toddler and k == 0:
                persona, toddler = "stroller", True
            drives = car and group in ("adult", "older") and not wheelchair and age < 75
            commuter = group == "adult" and 20 <= age <= 60 and rng.random() < COMMUTER_SHARE
            residents.append(
                Resident(
                    id=f"r{len(residents) + 1:05d}",
                    household=hid,
                    age=age,
                    group=group,
                    sex=sex,
                    persona=persona,
                    home_node=node,
                    home_coord=[round(coord[0], 6), round(coord[1], 6)],
                    car=car,
                    drives=drives,
                    commuter=commuter and not toddler,
                    muslim=rng.random() < MUSLIM_SHARE,
                    oku=oku,
                    wheelchair=wheelchair,
                    toddler=toddler,
                )
            )
    return Population(residents=residents, households=h, seed=seed, sources=SOURCES)


def _household(rng: random.Random, size: int) -> list[int]:
    """Ages in one household: adults first (the first adult is the main carer), then children,
    adult children living at home, sometimes a grandparent. Tuned so that, across households,
    the age shares match AGE_SHARES (checked in tests)."""
    if size == 1:
        return [rng.randint(66, 88) if rng.random() < 0.3 else rng.randint(22, 64)]
    if size == 2:
        x = rng.random()
        if x < 0.2:
            return [rng.randint(65, 85), rng.randint(65, 85)]
        if x < 0.35:
            return [rng.randint(35, 60), rng.randint(66, 88)]
        if x < 0.5:
            return [rng.randint(26, 45), rng.randint(0, 17)]
        return [rng.randint(24, 64), rng.randint(24, 64)]
    ages = [rng.randint(26, 50), rng.randint(26, 52)]
    if rng.random() < 0.3:
        ages.append(rng.randint(65, 88))
    while len(ages) < size:
        ages.append(rng.randint(0, 17) if rng.random() < 0.62 else rng.randint(18, 29))
    return ages


def summary(pop: Population) -> dict:
    rs = pop.residents
    n = len(rs) or 1

    def share(pred) -> float:
        return round(100 * sum(1 for r in rs if pred(r)) / n, 1)

    return {
        "residents": len(rs),
        "households": pop.households,
        "children_pct": share(lambda r: r.group in ("child", "teen")),
        "older_pct": share(lambda r: r.group == "older"),
        "wheelchair_users": sum(r.wheelchair for r in rs),
        "older_needing_rest": sum(r.persona == "older_adult_rest" for r in rs),
        "parents_with_strollers": sum(r.toddler for r in rs),
        "no_car_households_pct": round(
            100 * len({r.household for r in rs if not r.car}) / max(1, pop.households), 1
        ),
    }
