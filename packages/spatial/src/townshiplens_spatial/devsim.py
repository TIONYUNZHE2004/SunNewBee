"""Development Simulation (developer lens): the plan the web player animates (spec 2026-10-21 §5.1).

Ported from the approved prototype's `build_scene.py` (docs/03-product/prototypes/developer-lens/).
A Hypothetical Development, a ~30-storey tower that is not an SDP project (ADR 0014), stands on the
north-east corner of the real OSM lot `way/1564861412`. Every number the playback shows is
computed here by the routing engine (`routing.plan_route`, default profile):

- the construction detour: an existing nearby home's walk to Lakeside Mall Car Park B before and
  after the hoarding closes the lot's frontage path (`twm.ClosePath`);
- the walks from the tower entrance to Elmina Urban Park and to Elmina Lakeside Mall.

Residents' lines, the crowd and the timeline are illustrative; `check_plan` keeps every number in
the copy equal to a computed fact. Places are looked up by name, not id (place ids moved with the
place-scoping update). Run `python -m townshiplens_spatial.devsim --dump <path>` from the repo root
to write the Elmina plan as JSON (then `pnpm exec biome check --write <path>` for the web
fixtures `plan.elmina.json` and `e2e/fixtures/devsim-plan.json`).

Geometry is computed in a local equirectangular frame (metres) centred on the parcel, the same
recipe as the prototype.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import math
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import networkx as nx
import numpy as np
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import nearest_points

from . import routing, twm
from .day import population
from .day import spotlight as spot
from .devsim_models import (
    Act,
    Bubble,
    DevelopmentBrief,
    DevelopmentEntrance,
    DevelopmentPlan,
    DevelopmentSite,
    DevsimAnchors,
    DevsimDetour,
    DevsimFacts,
    DevsimLabels,
    DevsimUnavailable,
    DevsimWalk,
    EndCard,
    EndCardItem,
    SpotlightCast,
)
from .models import LonLat, Place, Route
from .world import World

PARCEL_OSM = "way/1564861412"  # OSM landuse=construction lot beside Lakeside Mall
KANOPI_OSM = "way/1314193194"  # the real Kanopi Residences lot: the tower stays clear of it
MALL_BUILDING = "w1308938137"  # Elmina Lakeside Mall's building footprint
# Places, looked up by exact name (ids may change with place scoping).
TARGET_NAME = "Lakeside Mall Car Park B"  # the detour walk's destination (spec §5.1: park-b)
PARK_NAME = "Elmina Urban Park"
MALL_NAME = "Elmina Lakeside Mall"
PROFILE = "default"
PROVENANCE = "routing engine, default profile"
STOREYS = 30
MIN_KANOPI_M = 200.0
MIN_DETOUR_MIN = 2
INSET_M = 40.0  # tower centre, in from the lot edge nearest the mall (prototype)
MAX_EXTRA_INSET_M = 40
PARCEL_MARGIN_M = 1.0  # the footprint keeps this far inside the lot outline
TOWER_HALF = (19.0, 13.0)  # 38 x 26 m footprint (prototype `box(-19, -13, 19, 13)`)
PODIUM_M = 5.0  # the podium/lobby band around the tower
SITE_BUFFER_M = 26.0  # the hoarded construction site around the tower
LOBBY_OUT_M = 8.0
HOME_RADIUS_M = 600.0
FRONTAGE_M = 25.0  # a walk path this close to the hoarded site is "beside the site"
PED_TYPES = frozenset({"sidewalk", "footway", "path", "pedestrian"})
ROAD_TYPES = frozenset({"street", "major_road"})
FIRST_EDGE = "seg-910300105-0"  # the prototype's hoarded frontage sidewalk: searched first
HOUSEHOLD_SIZE = 3.8  # population.HOUSEHOLD_SIZES mean (DOSM, Census 2020)
CAST_SEED = 21


# ---- local frame -------------------------------------------------------------------------------
@dataclass(frozen=True)
class _Frame:
    lon0: float
    lat0: float

    @property
    def kx(self) -> float:
        return 111_320 * math.cos(math.radians(self.lat0))

    ky: float = 110_574.0

    def xy(self, c) -> tuple[float, float]:
        return ((c[0] - self.lon0) * self.kx, (c[1] - self.lat0) * self.ky)

    def ll(self, x: float, y: float) -> LonLat:
        return [round(self.lon0 + x / self.kx, 7), round(self.lat0 + y / self.ky, 7)]

    def line(self, coords) -> LineString:
        return LineString([self.xy(c) for c in coords])

    def geom(self, g):
        """A lon/lat shapely Polygon (exterior only) or LineString in local metres."""
        if g.geom_type == "Polygon":
            return Polygon([self.xy(c) for c in g.exterior.coords])
        if g.geom_type == "MultiPolygon":
            return max((self.geom(p) for p in g.geoms), key=lambda p: p.area)
        return self.line(g.coords)

    def path(self, g: LineString) -> list[LonLat]:
        return [self.ll(x, y) for x, y in g.coords]


@dataclass
class _Layout:
    """Everything derived from the world and the site (recomputed, deterministic)."""

    fr: _Frame
    parcel: Polygon
    kanopi: Polygon
    mall_bld: Polygon
    tower: Polygon
    centre: Point
    site_area: Polygon  # the hoarded construction site
    front_edge: str  # the walk path the footprint aligns with
    lobby: Point


def _features(world: World, name: str) -> list[dict]:
    path = (world.data_dir or Path("/nonexistent")) / "base" / name
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def _landcover(world: World, osm: str):
    return next(
        (
            shape(f["geometry"])
            for f in _features(world, "landcover.geojson")
            if f["properties"].get("osm") == osm
        ),
        None,
    )


def _frame_and_parcel(world: World):
    parcel_ll = _landcover(world, PARCEL_OSM)
    kanopi_ll = _landcover(world, KANOPI_OSM)
    if parcel_ll is None or kanopi_ll is None:
        raise DevsimUnavailable(f"the world has no parcel {PARCEL_OSM}")
    fr = _Frame(parcel_ll.centroid.x, parcel_ll.centroid.y)
    blds = {f["properties"]["id"]: f for f in _features(world, "buildings.geojson")}
    if MALL_BUILDING not in blds:
        raise DevsimUnavailable("the world has no Lakeside Mall building")
    mall = fr.geom(shape(blds[MALL_BUILDING]["geometry"]))
    return fr, fr.geom(parcel_ll), fr.geom(kanopi_ll), mall


def _nearest_ped_edge(world: World, fr: _Frame, pt: Point) -> str:
    near = [
        (fr.line(e.coords).distance(pt), e.id)
        for e in world.edges.values()
        if e.type in PED_TYPES
        and abs(e.coords[0][0] - fr.lon0) < 0.01
        and abs(e.coords[0][1] - fr.lat0) < 0.01
    ]
    if not near:
        raise DevsimUnavailable("no walk path beside the parcel")
    return min(near)[1]


def _layout(world: World, site: DevelopmentSite | None = None) -> _Layout:
    fr, parcel, kanopi, mall = _frame_and_parcel(world)
    edge_pt = nearest_points(parcel.boundary, mall.centroid)[0]
    c = parcel.centroid
    vx, vy = c.x - edge_pt.x, c.y - edge_pt.y
    vl = math.hypot(vx, vy)
    if site is None:
        # The prototype's 40 m inset leaves a corner of the footprint just outside the lot; step
        # further in (1 m at a time) until the whole footprint fits inside it (AC-H5).
        for inset in range(int(INSET_M), int(INSET_M) + MAX_EXTRA_INSET_M + 1):
            centre = Point(edge_pt.x + vx / vl * inset, edge_pt.y + vy / vl * inset)
            front = _nearest_ped_edge(world, fr, centre)
            fl = fr.line(world.edges[front].coords)
            (ax, ay), (bx, by) = fl.coords[0], fl.coords[-1]
            ang = math.atan2(by - ay, bx - ax)
            tower = affinity.rotate(
                box(-TOWER_HALF[0], -TOWER_HALF[1], *TOWER_HALF),
                ang,
                origin=(0, 0),
                use_radians=True,
            )
            tower = affinity.translate(tower, centre.x, centre.y)
            if parcel.buffer(-PARCEL_MARGIN_M).contains(tower):
                break
    else:
        tower = Polygon([fr.xy(p) for p in site.footprint])
        centre = tower.centroid
        front = _nearest_ped_edge(world, fr, centre)
    site_area = tower.buffer(SITE_BUFFER_M, join_style="mitre").intersection(parcel.buffer(-2))
    fl = fr.line(world.edges[front].coords)
    lp = nearest_points(tower.exterior, fl)[0]
    fp = nearest_points(fl, lp)[0]
    dl = math.hypot(fp.x - lp.x, fp.y - lp.y)
    lobby = Point(lp.x + (fp.x - lp.x) / dl * LOBBY_OUT_M, lp.y + (fp.y - lp.y) / dl * LOBBY_OUT_M)
    return _Layout(fr, parcel, kanopi, mall, tower, centre, site_area, front, lobby)


class _Snapper:
    """Nearest graph node in the main connected walk network (as the prototype snaps)."""

    def __init__(self, world: World, fr: _Frame):
        comp = max(nx.connected_components(world.graph), key=len)
        self.ids = sorted(comp)
        self.xy = np.array([fr.xy(world.node_coords[n]) for n in self.ids])

    def __call__(self, pt: Point) -> tuple[str, float]:
        d = np.hypot(self.xy[:, 0] - pt.x, self.xy[:, 1] - pt.y)
        i = int(np.argmin(d))
        return self.ids[i], float(d[i])


def _place_by_name(world: World, name: str) -> str:
    ids = sorted(p.id for p in world.places.values() if (p.name or "").lower() == name.lower())
    if not ids:
        raise DevsimUnavailable(f"the world has no place named {name!r}")
    return ids[0]


# ---- BE1: site placement -----------------------------------------------------------------------
def place_tower(world: World, brief: DevelopmentBrief | None = None) -> DevelopmentSite:
    """The Hypothetical Development on the north-east corner of the lot, door facing its walk node.

    Raises DevsimUnavailable when the world lacks the parcel (e.g. the tiny fixture)."""
    brief = brief or DevelopmentBrief()
    lay = _layout(world)
    fr, tower = lay.fr, lay.tower
    if not lay.parcel.contains(tower):
        raise DevsimUnavailable("the tower footprint does not fit inside the parcel")
    clearance = tower.distance(lay.kanopi)
    if clearance < MIN_KANOPI_M:
        raise DevsimUnavailable(f"the tower is only {clearance:.0f} m from the Kanopi lot")
    snap_id, _ = _Snapper(world, fr)(lay.lobby)
    snap = Point(fr.xy(world.node_coords[snap_id]))
    podium = tower.buffer(PODIUM_M, join_style="mitre")
    door = nearest_points(podium.exterior, snap)[0]
    facing = math.degrees(math.atan2(snap.x - door.x, snap.y - door.y)) % 360
    return DevelopmentSite(
        parcel_id=PARCEL_OSM,
        footprint=[fr.ll(x, y) for x, y in tower.exterior.coords[:-1]],
        storeys=brief.storeys,
        homes=brief.homes,
        entrance=DevelopmentEntrance(
            door=fr.ll(door.x, door.y),
            facing_deg=round(facing, 1),
            path=[fr.ll(door.x, door.y), [round(v, 7) for v in world.node_coords[snap_id][:2]]],
        ),
        kanopi_clearance_m=round(clearance, 1),
    )


# ---- BE2: facts --------------------------------------------------------------------------------
def _round_min(x: float) -> int:
    return int(math.floor(x + 0.5))


def walk_minutes(world: World, route: Route) -> float:
    """Unrounded walking minutes: the route's distance at the profile's pace.

    `Route.est_minutes` is rounded to 0.1 min, so a difference of two of them can overstate a
    detour by a rounding step (41.8 - 38.3 = 3.5 for a real 3.41); facts use this instead."""
    return route.distance_m / routing._pace_m_per_min(world.profiles[PROFILE])


def _node_at(world: World, coord) -> str:
    for n, c in world.node_coords.items():
        if abs(c[0] - coord[0]) < 1e-6 and abs(c[1] - coord[1]) < 1e-6:
            return n
    raise DevsimUnavailable("the entrance is not on the walk network")


def _route_path(route: Route) -> list[LonLat]:
    return [[round(c[0], 7), round(c[1], 7)] for c in route.geometry["coordinates"]]


def _first(world: World, from_id: str, to_id: str) -> Route | None:
    r = routing.plan_route(world, from_id, to_id, PROFILE)
    return r.routes[0] if r.routes else None


def _walk(world: World, from_id: str, to_id: str) -> DevsimWalk:
    r = _first(world, from_id, to_id)
    if r is None:
        raise DevsimUnavailable(f"no walk from the tower to {to_id}")
    return DevsimWalk(
        m=round(r.distance_m),
        min=max(1, _round_min(walk_minutes(world, r))),
        path=_route_path(r),
    )


def frontage_edges(world: World, site: DevelopmentSite) -> list[str]:
    """Walk paths beside the hoarded site (the ones the hoarding could close), sorted."""
    lay = _layout(world, site)
    out = [
        e.id
        for e in world.edges.values()
        if e.type in PED_TYPES
        and abs(e.coords[0][0] - lay.fr.lon0) < 0.01
        and abs(e.coords[0][1] - lay.fr.lat0) < 0.01
        and lay.fr.line(e.coords).distance(lay.site_area) <= FRONTAGE_M
    ]
    return sorted(out, key=lambda e: (e != FIRST_EDGE, e))


def _side_switch(world: World, lay: _Layout, edge_id: str, before: Route, after: Route) -> bool:
    """True when the detour leaves the closed path for a walk path across a carriageway.

    The prototype checked this for its hard-coded far-side sidewalk; here any walk path the detour
    adds near the closed one counts when it lies farther from the lot than the closed path and the
    shortest line between them crosses a street."""
    fr = lay.fr
    closed = fr.line(world.edges[edge_id].coords)
    d_closed = closed.distance(lay.parcel)
    before_ids = {s.edge_id for s in before.segments}
    roads = [
        fr.line(e.coords)
        for e in world.edges.values()
        if e.type in ROAD_TYPES
        and abs(e.coords[0][0] - fr.lon0) < 0.01
        and abs(e.coords[0][1] - fr.lat0) < 0.01
    ]
    roads = [g for g in roads if g.distance(closed) < 100]
    for eid in sorted({s.edge_id for s in after.segments} - before_ids):
        e = world.edges[eid]
        if e.type not in PED_TYPES:
            continue
        g = fr.line(e.coords)
        if g.distance(closed) > 80 or g.distance(lay.parcel) <= d_closed + 5:
            continue
        a, b = nearest_points(g, closed)
        link = LineString([a, b])
        if any(link.crosses(r) or link.intersects(r) for r in roads):
            return True
    return False


def _homes_near(world: World, lay: _Layout) -> list[tuple[float, str, Point]]:
    """(distance to the tower centre, building id, centroid) of residential buildings nearby."""
    out = []
    for f in _features(world, "buildings.geojson"):
        p = f["properties"]
        if p.get("kind") != "residential":
            continue
        c = lay.fr.geom(shape(f["geometry"])).centroid
        d = c.distance(lay.centre)
        if d <= HOME_RADIUS_M:
            out.append((round(d, 3), p["id"], c))
    return sorted(out, key=lambda t: (t[0], t[1]))


def _temp_place(pid: str, name: str, world: World, node: str) -> Place:
    return Place(id=pid, type="building", name=name, coord=world.node_coords[node], node_id=node)


def _with_places(world: World, places: Iterable[Place]) -> World:
    return dataclasses.replace(world, places={**world.places, **{p.id: p for p in places}})


TOWER_PLACE = "devsim-tower"


def _detour(world: World, site: DevelopmentSite, lay: _Layout, target: str) -> DevsimDetour | None:
    snapper = _Snapper(world, lay.fr)
    homes = _homes_near(world, lay)
    by_node: dict[str, list[tuple[float, str]]] = {}
    for d, hid, c in homes:
        by_node.setdefault(snapper(c)[0], []).append((d, hid))
    nodes = sorted(by_node)
    places = [_temp_place(f"devsim-home-{n}", "Existing home", world, n) for n in nodes]
    w0 = _with_places(world, places)
    best: tuple | None = None
    with routing.eval_memo():
        before = {n: _first(w0, f"devsim-home-{n}", target) for n in nodes}
        for eid in frontage_edges(world, site):
            w1 = _with_places(twm.apply(world, [twm.ClosePath(element_id=eid)]).world, places)
            for n in nodes:
                b = before[n]
                if b is None or eid not in {s.edge_id for s in b.segments}:
                    continue
                a = _first(w1, f"devsim-home-{n}", target)
                if a is None or eid in {s.edge_id for s in a.segments}:
                    continue
                mins = _round_min(walk_minutes(world, a) - walk_minutes(world, b))
                if mins < MIN_DETOUR_MIN:
                    continue
                d, hid = min(by_node[n])
                key = (-mins, d, hid, eid)
                if best is None or key < best[0]:
                    best = (key, hid, eid, b, a, mins)
    if best is None:
        return None
    _, hid, eid, b, a, mins = best
    return DevsimDetour(
        home_id=hid,
        edge_id=eid,
        before_m=round(b.distance_m),
        after_m=round(a.distance_m),
        detour_min=mins,
        before_path=_route_path(b),
        after_path=_route_path(a),
        detour_side_switch=_side_switch(world, lay, eid, b, a),
    )


def detour_home_node(world: World, site: DevelopmentSite, home_id: str) -> str:
    """The walk node a home snaps to (as the detour search snaps it); for tests and anchors."""
    lay = _layout(world, site)
    for _, hid, c in _homes_near(world, lay):
        if hid == home_id:
            return _Snapper(world, lay.fr)(c)[0]
    raise KeyError(home_id)


def tower_world(world: World, site: DevelopmentSite) -> World:
    """The world plus a transient place at the tower entrance's snapped walk node."""
    node = _node_at(world, site.entrance.path[-1])
    return _with_places(world, [_temp_place(TOWER_PLACE, "Hypothetical tower", world, node)])


def compute_facts(world: World, site: DevelopmentSite) -> DevsimFacts:
    """Detour, park and mall walks from the routing engine (default profile)."""
    lay = _layout(world, site)
    target = _place_by_name(world, TARGET_NAME)
    park, mall = _place_by_name(world, PARK_NAME), _place_by_name(world, MALL_NAME)
    tw = tower_world(world, site)
    with routing.eval_memo():
        park_walk = _walk(tw, TOWER_PLACE, park)
        mall_walk = _walk(tw, TOWER_PLACE, mall)
    return DevsimFacts(
        detour=_detour(world, site, lay, target),
        park=park_walk,
        mall=mall_walk,
        profile=PROFILE,
        provenance=PROVENANCE,
    )


# ---- BE3: cast and households ------------------------------------------------------------------
COLOURS = {
    "halim": "#5c6bc0",
    "farid": "#ef8f5a",
    "meiling": "#e8644f",
    "zainab": "#37a07a",
    "arjun": "#c4900f",
}
BASELINE_NAMES = {
    "halim": "Pak Cik Halim",
    "farid": "Farid",
    "meiling": "Mei Ling",
    "zainab": "Mak Cik Zainab",
    "arjun": "Arjun",
}


def _pick(rs, pred):
    return next((r for r in sorted(rs, key=lambda r: spot._h(r.id)) if pred(r)), None)


def build_cast(
    world: World, site: DevelopmentSite, seed: int = CAST_SEED
) -> tuple[int, list[SpotlightCast]]:
    """The tower's households (population generator, seeded) and the Spotlight Residents.

    The generator gives the household count and the three new residents' make-up and roles
    (`spotlight._role`); their names are the prototype's baseline names, which win over the
    generator's naming (a ruling in the ledger). Halim is an existing neighbour (the detour home)
    and Farid a passer-by; neither lives in the tower."""
    from .day.schedule import PRIMARY_AGE

    pop = population.synthesize(world, n_residents=round(site.homes * HOUSEHOLD_SIZE), seed=seed)
    rs = pop.residents
    kids: dict[str, int] = {}
    school: dict[str, int] = {}
    for r in rs:
        if r.group == "child":
            kids[r.household] = kids.get(r.household, 0) + 1
            if PRIMARY_AGE[0] <= r.age <= PRIMARY_AGE[1]:
                school[r.household] = school.get(r.household, 0) + 1

    def role(r, fallback: str) -> str:
        if r is None:
            return fallback
        text = spot._role(r, kids.get(r.household, 0), school.get(r.household, 0))
        return text[0].upper() + text[1:]

    meiling = _pick(rs, lambda r: r.sex == "f" and r.group == "adult" and school.get(r.household))
    zainab = _pick(rs, lambda r: r.sex == "f" and r.group == "older" and r.muslim)
    arjun = _pick(rs, lambda r: r.sex == "m" and r.group == "adult" and r.commuter)
    cast = [
        SpotlightCast(
            id="halim",
            name=BASELINE_NAMES["halim"],
            role="existing resident",
            persona="Retired neighbour who walks to the mall most mornings",
            home="existing",
            colour=COLOURS["halim"],
        ),
        SpotlightCast(
            id="farid",
            name=BASELINE_NAMES["farid"],
            role="passer-by",
            persona="Walks past the site on his way to work",
            home="existing",
            colour=COLOURS["farid"],
        ),
        SpotlightCast(
            id="meiling",
            name=BASELINE_NAMES["meiling"],
            role="new resident",
            persona=role(meiling, "Parent doing the school run") + "; moves in with her child",
            home="tower",
            colour=COLOURS["meiling"],
        ),
        SpotlightCast(
            id="zainab",
            name=BASELINE_NAMES["zainab"],
            role="new resident",
            persona=role(zainab, "Retiree") + "; enjoys a midday walk in the park",
            home="tower",
            colour=COLOURS["zainab"],
        ),
        SpotlightCast(
            id="arjun",
            name=BASELINE_NAMES["arjun"],
            role="new resident",
            persona=role(arjun, "Commuter") + "; shops at the mall after work",
            home="tower",
            colour=COLOURS["arjun"],
        ),
    ]
    return pop.households, cast


# ---- BE4: beats, copy and check ----------------------------------------------------------------
ACTS = [
    Act(name="Brief", t0=0, t1=4),
    Act(name="Construction", t0=4, t1=32),
    Act(name="Handover", t0=32, t1=44),
    Act(name="Daily Life", t0=44, t1=63),
    Act(name="Summary", t0=63, t1=66),
]
TOTAL_S = 66.0
BUBBLE1_SIDE = "Footpath closed lah, must walk the other side now"
# Truthful without the side claim (used when the detour stays on the lot's side).
BUBBLE1_PLAIN = "Footpath closed lah, must walk the long way now"
BUBBLE1_NO_DETOUR = "Footpath closed lah, so leceh"
END_TITLE = "What residents raised"
END_LEGEND = (
    "ROUTE ENGINE numbers come from the mapped walk network. SIMULATED marks invented reactions."
)


def _n(v: int) -> str:
    return f"{v:,}"


def _mall_line(mins: int) -> tuple[str, str]:
    """Bubble 7 (spec §4.3 copy rule): (text, tone)."""
    if mins <= 5:
        return "Mall's right downstairs!", "pos"
    if mins <= 12:
        return f"Mall's a {mins} min walk, not bad!", "pos"
    return f"Mall's a {mins} min walk from here", "neg"


def _bubbles(facts: DevsimFacts) -> list[Bubble]:
    d = facts.detour
    if d is None:
        b1_text, b1_tag = BUBBLE1_NO_DETOUR, None
    else:
        b1_text = BUBBLE1_SIDE if d.detour_side_switch else BUBBLE1_PLAIN
        b1_tag = f"ROUTE ENGINE · +{d.detour_min} min walk · {_n(d.before_m)} → {_n(d.after_m)} m"
    p, m = facts.park, facts.mall
    mall_text, mall_tone = _mall_line(m.min)
    rows = [
        (1, "halim", 18.4, 21.4, "neg", b1_text, b1_tag),
        (2, "farid", 23.4, 26.2, "neg", "So noisy lah", None),
        (3, "meiling", 35.4, 38.2, "pos", "We got our keys!", None),
        (4, "halim", 40.2, 43.2, "pos", "Eh, new neighbours ah? Welcome!", None),
        (5, "meiling", 47.6, 50.4, "neg", "School run jam again… haiz", None),
        (
            6,
            "zainab",
            53.2,
            56.2,
            "pos",
            f"Park in {p.min} min, love it",
            f"ROUTE ENGINE · {_n(p.m)} m · {p.min} min walk",
        ),
        (
            7,
            "arjun",
            58.6,
            61.6,
            mall_tone,
            mall_text,
            f"ROUTE ENGINE · {_n(m.m)} m · {m.min} min walk",
        ),
    ]
    return [
        Bubble(n=n, who=who, t0=t0, t1=t1, tone=tone, text=text, tag=tag)
        for n, who, t0, t1, tone, text, tag in rows
    ]


def _end_card(facts: DevsimFacts) -> EndCard:
    items = []
    if (d := facts.detour) is not None:
        items.append(
            EndCardItem(
                text=(
                    "Building work closes the footpath beside the site: the walk to the mall gets "
                    f"about {d.detour_min} min longer ({_n(d.before_m)} m → {_n(d.after_m)} m)."
                ),
                badges=["ROUTE ENGINE"],
            )
        )
    items.append(
        EndCardItem(
            text="Parents complain about the morning school-run jam at the junction.",
            badges=["SIMULATED"],
        )
    )
    items.append(
        EndCardItem(
            text=(
                f"Residents like having Urban Park {facts.park.min} min and the mall "
                f"{facts.mall.min} min away on foot."
            ),
            badges=["ROUTE ENGINE", "SIMULATED"],
        )
    )
    return EndCard(
        title=END_TITLE,
        subtitle=DevsimLabels().end_card_subtitle,
        items=items,
        legend=END_LEGEND,
    )


def _anchors(world: World, site: DevelopmentSite, facts: DevsimFacts) -> DevsimAnchors:
    lay = _layout(world, site)
    fr = lay.fr
    closed_id = facts.detour.edge_id if facts.detour else lay.front_edge
    closed = fr.line(world.edges[closed_id].coords)
    # Halim walks the stretch of the detour nearest the site (prototype: 120 m before, 60 after).
    if facts.detour is not None:
        det = fr.line(facts.detour.after_path)
        s0 = det.project(lay.lobby)
        pts = [
            det.interpolate(s)
            for s in range(int(max(0, s0 - 120)), int(min(det.length, s0 + 60)), 4)
        ]
        halim = [fr.ll(p.x, p.y) for p in pts]
    else:  # no detour: he walks past the site along the open side (illustrative only)
        halim = fr.path(closed)
    # Farid stands beside the closed path at the point nearest the tower, by the hoarding.
    fp = nearest_points(closed, lay.centre)[0]
    fx, fy = fp.x - lay.centre.x, fp.y - lay.centre.y
    fl = math.hypot(fx, fy)
    farid = fr.ll(fp.x + fx / fl * 5, fp.y + fy / fl * 5)
    # The junction: where the entrance path meets the street (nearest point on a street).
    snap = Point(fr.xy(site.entrance.path[-1]))
    streets = [
        fr.line(e.coords)
        for e in world.edges.values()
        if e.type in ROAD_TYPES
        and abs(e.coords[0][0] - fr.lon0) < 0.01
        and abs(e.coords[0][1] - fr.lat0) < 0.01
    ]
    if not streets:
        raise DevsimUnavailable("no street beside the tower entrance")
    street = min(streets, key=lambda g: g.distance(snap))
    jp = nearest_points(street, snap)[0]
    # The park spot: where the park route arrives (on the walk network).
    park = facts.park.path[-1]
    # The mall spot: on the mall route just outside the building, not under its roof.
    ml = fr.line(facts.mall.path)
    s = ml.length
    while s > 0 and ml.interpolate(s).distance(lay.mall_bld) < 3:
        s -= 2
    mp = ml.interpolate(max(s, 0))
    return DevsimAnchors(
        halim_path=halim,
        farid=farid,
        junction=fr.ll(jp.x, jp.y),
        park=list(park),
        mall=fr.ll(mp.x, mp.y),
    )


def build_beats(world: World, site: DevelopmentSite, facts: DevsimFacts):
    """(acts, bubbles, end card, anchors) per spec §4.2, §4.3 and §4.5, with facts substituted."""
    return list(ACTS), _bubbles(facts), _end_card(facts), _anchors(world, site, facts)


DIGITS = re.compile(r"\d(?:[\d,]*\d)?")
BANNED = re.compile(
    r"\b(?:safe(?:ly|ty)?|selamat|depths?|flood(?:s|ed|ing)?)\b|安全", re.IGNORECASE
)


def fact_numbers(facts: DevsimFacts) -> set[int]:
    vals = {facts.park.m, facts.park.min, facts.mall.m, facts.mall.min}
    if (d := facts.detour) is not None:
        vals |= {d.before_m, d.after_m, d.detour_min}
    return vals


def expected_numbers(plan: DevelopmentPlan) -> dict[str, list[int] | tuple[list[int], ...]]:
    """Per copy slot, the fact values it must quote, in order (a tuple lists the allowed
    alternatives). Slots not listed must hold no digits."""
    f, d = plan.facts, plan.facts.detour
    out: dict[str, list[int] | tuple[list[int], ...]] = {
        "bubble 6": [f.park.min],
        "bubble 6 tag": [f.park.m, f.park.min],
        "bubble 7": ([f.mall.min], []),  # "Mall's right downstairs!" quotes none
        "bubble 7 tag": [f.mall.m, f.mall.min],
    }
    items = plan.end_card.items
    if d is not None:
        out["bubble 1 tag"] = [d.detour_min, d.before_m, d.after_m]
        if items:
            out["end card item 1"] = [d.detour_min, d.before_m, d.after_m]
    if items:
        out[f"end card item {len(items)}"] = [f.park.min, f.mall.min]
    return out


def plan_texts(plan: DevelopmentPlan) -> list[tuple[str, str]]:
    """(where, text) for every copy string check_plan reads."""
    out = []
    for b in plan.bubbles:
        out.append((f"bubble {b.n}", b.text))
        if b.tag:
            out.append((f"bubble {b.n} tag", b.tag))
    for i, it in enumerate(plan.end_card.items, 1):
        out.append((f"end card item {i}", it.text))
    for k in ("title", "subtitle", "legend"):
        out.append((f"end card {k}", getattr(plan.end_card, k)))
    return out


def check_plan(plan: DevelopmentPlan) -> list[str]:
    """Reasons the plan's copy may not be shown (empty list = fine).

    Each copy slot quotes exactly its own facts, in order (`expected_numbers`; thousands
    separators removed): bubble 6 the park minutes, bubble 7 the mall minutes, each tag and
    end-card item its own fields; every other slot (bubbles 1-5, titles) holds no digits at all.
    No banned words (spec §3) anywhere in the copy, the labels or the cast; no numbers spelled
    out in words."""
    errs = []
    expected = expected_numbers(plan)
    for where, text in plan_texts(plan):
        got = [int(m.group(0).replace(",", "")) for m in DIGITS.finditer(text)]
        want = expected.get(where, [])
        options = want if isinstance(want, tuple) else (want,)
        if got not in options:
            errs.append(f"{where}: numbers {got} are not the computed facts {list(options)}")
        if m := spot.NUMBER_WORDS.search(text):
            errs.append(f"{where}: number in words {m.group(0)!r}")
    for b in plan.bubbles:
        if 1 <= b.n <= 5 and re.search(r"\d", b.text):
            errs.append(f"bubble {b.n}: digits are not allowed")
    extra = [("labels", v) for v in plan.labels.model_dump().values()]
    extra += [(f"cast {c.id}", f"{c.name} {c.role} {c.persona}") for c in plan.cast]
    extra += [("act", a.name) for a in plan.acts]
    for where, text in [*plan_texts(plan), *extra]:
        if m := BANNED.search(text):
            errs.append(f"{where}: banned word {m.group(0)!r}")
    return errs


class DevsimCheckError(ValueError):
    """The built plan failed check_plan: a bug, never shown."""


def build_development_plan(world: World, brief: DevelopmentBrief | None = None) -> DevelopmentPlan:
    """The whole Development Simulation plan for this world (deterministic).

    Raises DevsimUnavailable when the world lacks the parcel or the facts can't be computed."""
    brief = brief or DevelopmentBrief()
    site = place_tower(world, brief)
    facts = compute_facts(world, site)
    households, cast = build_cast(world, site)
    acts, bubbles, end_card, anchors = build_beats(world, site, facts)
    plan = DevelopmentPlan(
        world=world.site.id,
        site=site,
        facts=facts,
        cast=cast,
        households=households,
        acts=acts,
        bubbles=bubbles,
        anchors=anchors,
        end_card=end_card,
        labels=DevsimLabels(),
        total_s=TOTAL_S,
    )
    if errs := check_plan(plan):
        raise DevsimCheckError("; ".join(errs))
    return plan


def main(argv: list[str] | None = None) -> None:
    from .world import load_world

    ap = argparse.ArgumentParser(description="Build the Development Simulation plan as JSON.")
    ap.add_argument("--world", default="data/seed/elmina", type=Path)
    ap.add_argument("--dump", type=Path, help="write the plan here (default: stdout)")
    args = ap.parse_args(argv)
    plan = build_development_plan(load_world(args.world))
    text = plan.model_dump_json(indent=1) + "\n"
    if args.dump:
        args.dump.parent.mkdir(parents=True, exist_ok=True)
        args.dump.write_text(text, encoding="utf-8")
        print(
            json.dumps(
                {
                    "detour": plan.facts.detour
                    and plan.facts.detour.model_dump(exclude={"before_path", "after_path"}),
                    "park": plan.facts.park.model_dump(exclude={"path"}),
                    "mall": plan.facts.mall.model_dump(exclude={"path"}),
                    "households": plan.households,
                },
                indent=1,
            )
        )
    else:
        print(text)


if __name__ == "__main__":
    main()
