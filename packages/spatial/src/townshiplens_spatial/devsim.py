"""Development Simulation (developer lens): the plan the web player animates (spec 2026-10-21 §5.1).

Ported from the approved prototype's `build_scene.py` (docs/03-product/prototypes/developer-lens/).
A Hypothetical Development, a ~30-storey tower that is not an SDP project (ADR 0014), stands on the
north-east corner of the real OSM lot `way/1564861412`. Every number the playback shows is
computed here by the routing engine (`routing.plan_route`, default profile):

- the construction detour: an existing nearby home's walk to Lakeside Mall (the mall or its Car
  Park B, whichever is nearer) before and after the hoarding closes the lot's frontage path
  (`twm.ClosePath`);
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
import calendar
import dataclasses
import itertools
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
    Banner,
    BriefRow,
    BriefSection,
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
    EstimateSource,
    ImpactBrief,
    MonsoonSetPiece,
    Schedule,
    SpotlightCast,
    TimedTag,
)
from .models import LonLat, Place, Route
from .world import World

PARCEL_OSM = "way/1564861412"  # OSM landuse=construction lot beside Lakeside Mall
KANOPI_OSM = "way/1314193194"  # the real Kanopi Residences lot: the tower stays clear of it
MALL_BUILDING = "w1308938137"  # Elmina Lakeside Mall's building footprint
# Places, looked up by exact name (ids may change with place scoping).
MALL_LABEL = "Lakeside Mall"  # copy name of the mall walk arriving at the mall place
CAR_PARK_LABEL = "Lakeside Mall (Car Park B)"  # ... arriving at its Car Park B (ruling R18)
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


def _first_any(world: World, from_id: str, to_ids: list[str]) -> Route | None:
    """The shortest first route to any of these places (ruling R18: the mall is reached at the
    mall or at its Car Park B, whichever walk is shorter)."""
    routes = [r for t in to_ids if (r := _first(world, from_id, t)) is not None]
    return min(routes, key=lambda r: (r.distance_m, r.to_place), default=None)


def _detour(
    world: World, site: DevelopmentSite, lay: _Layout, targets: list[str]
) -> DevsimDetour | None:
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
        before = {n: _first_any(w0, f"devsim-home-{n}", targets) for n in nodes}
        for eid in frontage_edges(world, site):
            w1 = _with_places(twm.apply(world, [twm.ClosePath(element_id=eid)]).world, places)
            for n in nodes:
                b = before[n]
                if b is None or eid not in {s.edge_id for s in b.segments}:
                    continue
                a = _first_any(w1, f"devsim-home-{n}", targets)
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
    park, mall = _place_by_name(world, PARK_NAME), _place_by_name(world, MALL_NAME)
    # The mall walk arrives at the mall or its Car Park B, whichever is nearer (ruling R18).
    mall_arrivals = [mall, _place_by_name(world, TARGET_NAME)]
    tw = tower_world(world, site)
    with routing.eval_memo():
        park_walk = _walk(tw, TOWER_PLACE, park)
        mall_route = _first_any(tw, TOWER_PLACE, mall_arrivals)
    if mall_route is None:
        raise DevsimUnavailable("no walk from the tower to the mall")
    mall_walk = DevsimWalk(
        m=round(mall_route.distance_m),
        min=max(1, _round_min(walk_minutes(world, mall_route))),
        path=_route_path(mall_route),
        arrival_id=mall_route.to_place,
        label=MALL_LABEL if mall_route.to_place == mall else CAR_PARK_LABEL,
    )
    return DevsimFacts(
        detour=_detour(world, site, lay, mall_arrivals),
        park=park_walk,
        mall=mall_walk,
        profile=PROFILE,
        provenance=PROVENANCE,
    )


# ---- BE3: cast and households ------------------------------------------------------------------
COLOURS = {
    "halim": "#5c6bc0",
    "farid": "#ef8f5a",
    "worker": "#f2a516",
    "meiling": "#e8644f",
    "zainab": "#37a07a",
    "arjun": "#c4900f",
}
BASELINE_NAMES = {
    "halim": "Pak Cik Halim",
    "farid": "Farid",
    "worker": "Site worker",
    "meiling": "Mei Ling",
    "zainab": "Mak Cik Zainab",
    "arjun": "Arjun",
}


def _pick(rs, pred):
    return next((r for r in sorted(rs, key=lambda r: spot._h(r.id)) if pred(r)), None)


def tower_population(world: World, site: DevelopmentSite, seed: int = CAST_SEED):
    """The tower's synthetic households (population generator, seeded), with per-household
    child counts: (population, children per household, primary-school children per household)."""
    from .day.schedule import PRIMARY_AGE

    pop = population.synthesize(world, n_residents=round(site.homes * HOUSEHOLD_SIZE), seed=seed)
    kids: dict[str, int] = {}
    school: dict[str, int] = {}
    for r in pop.residents:
        if r.group == "child":
            kids[r.household] = kids.get(r.household, 0) + 1
            if PRIMARY_AGE[0] <= r.age <= PRIMARY_AGE[1]:
                school[r.household] = school.get(r.household, 0) + 1
    return pop, kids, school


def cast_residents(rs, school: dict[str, int]) -> dict[str, object]:
    """The generator residents behind the three new residents (None when none matches)."""
    return {
        "meiling": _pick(
            rs, lambda r: r.sex == "f" and r.group == "adult" and school.get(r.household)
        ),
        "zainab": _pick(rs, lambda r: r.sex == "f" and r.group == "older" and r.muslim),
        "arjun": _pick(rs, lambda r: r.sex == "m" and r.group == "adult" and r.commuter),
    }


def build_cast(
    world: World, site: DevelopmentSite, seed: int = CAST_SEED
) -> tuple[int, list[SpotlightCast]]:
    """The tower's households (population generator, seeded) and the Spotlight Residents.

    The generator gives the household count and the three new residents' make-up and roles
    (`spotlight._role`); their names are the prototype's baseline names, which win over the
    generator's naming (a ruling in the ledger). Halim is an existing neighbour (the detour home)
    and Farid a passer-by; neither lives in the tower."""
    pop, kids, school = tower_population(world, site, seed)
    rs = pop.residents

    def role(r, fallback: str) -> str:
        if r is None:
            return fallback
        text = spot._role(r, kids.get(r.household, 0), school.get(r.household, 0))
        return text[0].upper() + text[1:]

    picks = cast_residents(rs, school)
    meiling, zainab, arjun = picks["meiling"], picks["zainab"], picks["arjun"]
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
            id="worker",
            name="Site worker",
            role="site worker",
            persona="Works on the tower site through the build",
            home="site",
            colour=COLOURS["worker"],
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


# ---- BE4: beats, copy and check (demo polish spec §6.3: the 45 s building timeline) -----------
ACTS = [
    Act(name="Brief", t0=0, t1=3),
    Act(name="Construction", t0=3, t1=27),
    Act(name="Handover", t0=27, t1=33),
    Act(name="Daily Life", t0=33, t1=45),
]
TOTAL_S = 45.0
# Spec §6.3 windows (screen s).
MONTHS_FROM = 3.0  # months start advancing
RAYA_HOLD = (11.0, 13.0)  # Hari Raya hold: the month stands still
MONSOON_SLOW = (18.5, 23.0)  # the slow monsoon stretch
HANDOVER_AT = 27.0  # the handover month is reached
DETOUR_TAG = (4.0, 9.5)
LORRY_TAG = (8.5, 12.5)
HANDOVER_BANNER = (27.0, 30.5)
DATA_ORDER_SLOW = 2  # monsoon months play this much slower in the data-order fallback
EXTRA_MIN = 2  # "2+ min longer" (devsim_impact.EXTRA_MIN)
SENSITIVE_M = 50  # lorry-route sensitive radius (devsim_impact.SENSITIVE_M)
BUBBLE1_SIDE = "Footpath closed lah, must walk the other side now"
# Truthful without the side claim (used when the detour stays on the lot's side).
BUBBLE1_PLAIN = "Footpath closed lah, must walk the long way now"
BUBBLE1_NO_DETOUR = "Footpath closed lah, so leceh"
WORKER_LINE = "Hujan lagi, crane stop."
BRIEF_TITLE = "Impact brief"
BRIEF_SUBTITLE = (
    "Hypothetical tower on a real parcel · facts from the world model, estimates labelled"
)
FLOOD_NOTE = "Indicative scenario, not a forecast. Follow official MBSA / JPS / NADMA guidance."
UNCHECKED_NOTE = "? = a path on the way is not checked yet (did not count for or against)"
GAP_NOTE = "gap = no mapped connection (data gap)"
BLOCKED_NOTE = "blocked = every mapped path crosses a known barrier"
MONTH_ABBR = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
SCHOOLISH = ("school", "kindergarten")


def _n(v: int) -> str:
    return f"{v:,}"


def _month_label(iso: str) -> str:
    """ "2029-03-21" -> "Mar 2029"."""
    return f"{MONTH_ABBR[int(iso[5:7]) - 1]} {iso[:4]}"


def _mall_line(mins: int) -> tuple[str, str]:
    """Bubble 7 (spec §4.3 copy rule): (text, tone)."""
    if mins <= 5:
        return "Mall's right downstairs!", "pos"
    if mins <= 12:
        return f"Mall's a {mins} min walk, not bad!", "pos"
    return f"Mall's a {mins} min walk from here", "neg"


def _bubbles(facts: DevsimFacts) -> list[Bubble]:
    """Seven bubbles in time order (§6.3). The school-run complaint is gone (no envelope)."""
    d = facts.detour
    if d is None:
        b1_text, b1_tag = BUBBLE1_NO_DETOUR, None
    else:
        b1_text = BUBBLE1_SIDE if d.detour_side_switch else BUBBLE1_PLAIN
        b1_tag = f"ROUTE ENGINE · +{d.detour_min} min walk · {_n(d.before_m)} → {_n(d.after_m)} m"
    p, m = facts.park, facts.mall
    mall_text, mall_tone = _mall_line(m.min)
    mall_to = f" to {m.label}" if m.label else ""
    rows = [
        (1, "halim", 5.5, 9.0, "neg", b1_text, b1_tag),
        (2, "farid", 14.0, 16.5, "neg", "So noisy lah", None),
        (3, "worker", 19.5, 22.5, "neg", WORKER_LINE, None),
        (4, "meiling", 28.5, 31.5, "pos", "We got our keys!", None),
        (5, "halim", 31.0, 33.0, "pos", "Eh, new neighbours ah? Welcome!", None),
        (
            6,
            "zainab",
            34.0,
            37.0,
            "pos",
            f"Park in {p.min} min, love it",
            f"ROUTE ENGINE · {_n(p.m)} m · {p.min} min walk",
        ),
        (
            7,
            "arjun",
            36.5,
            39.0,
            mall_tone,
            mall_text,
            f"ROUTE ENGINE · {_n(m.m)} m · {m.min} min walk{mall_to}",
        ),
    ]
    return [
        Bubble(n=n, who=who, t0=t0, t1=t1, tone=tone, text=text, tag=tag)
        for n, who, t0, t1, tone, text, tag in rows
    ]


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
    # The site worker: inside the hoarding, beside the tower on the side away from the street.
    off = TOWER_HALF[1] + 6
    wp = Point(lay.centre.x - fx / fl * off, lay.centre.y - fy / fl * off)
    if not lay.site_area.contains(wp):
        wp = nearest_points(lay.site_area.buffer(-1), wp)[0]
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
        worker=fr.ll(wp.x, wp.y),
        junction=fr.ll(jp.x, jp.y),
        park=list(park),
        mall=fr.ll(mp.x, mp.y),
    )


def build_beats(world: World, site: DevelopmentSite, facts: DevsimFacts):
    """(acts, bubbles, anchors) per spec §6.3, with facts substituted."""
    return list(ACTS), _bubbles(facts), _anchors(world, site, facts)


# ---- C7: month keys, tags, banners, Impact Brief -----------------------------------------------
def _month_of(start: str, iso: str) -> float:
    """Fractional month of a date: months after the start of the start month."""
    y0, m0 = int(start[:4]), int(start[5:7])
    y, m, d = int(iso[:4]), int(iso[5:7]), int(iso[8:10])
    return (y - y0) * 12 + (m - m0) + (d - 1) / calendar.monthrange(y, m)[1]


def month_keys(schedule: Schedule) -> tuple[list[tuple[float, float]], str]:
    """Playback second -> fractional project month (ruling R25; the prototype's `KEYS` shape).

    Baseline (the spec §6.3 windows): months 0 -> Hari Raya over 3-11 s, a hold at the Raya date
    11-13 s, on to the monsoon set piece's first month by 18.5 s, slowly through it to 23 s, and
    the handover point (the handover date, inside the last month) at 27 s, held to the end. When
    the data puts Hari Raya after the monsoon stretch starts, "data-order": months advance over
    3-27 s with monsoon months played slower and the 2 s Raya hold at the Raya date. The same
    rules as the web's `schedulePlayback.buildPlayback`."""
    h = min(_month_of(schedule.start, schedule.handover), schedule.months_total - 1e-6)
    rp, mp = schedule.raya_set_piece, schedule.monsoon_set_piece
    raya = _month_of(schedule.start, rp.date) if rp else None
    mon = (mp.months[0].month_index, mp.months[-1].month_index + 1) if mp and mp.months else None
    head = [(0.0, 0.0), (MONTHS_FROM, 0.0)]
    tail = [(HANDOVER_AT, h), (TOTAL_S, h)]

    def out(keys):
        return [(round(t, 4), round(m, 4)) for t, m in keys]

    if (raya is None or raya < (mon[0] if mon else h)) and (mon is None or mon[0] < h):
        keys = list(head)
        if raya is not None:
            keys += [(RAYA_HOLD[0], raya), (RAYA_HOLD[1], raya)]
        if mon is not None:
            keys += [(MONSOON_SLOW[0], mon[0]), (MONSOON_SLOW[1], min(mon[1], h))]
        return out(keys + tail), "baseline"
    hold = 0.0 if raya is None else RAYA_HOLD[1] - RAYA_HOLD[0]

    def weight(a: float, b: float) -> float:
        if b <= a:
            return 0.0
        if mon is None:
            return b - a
        inside = max(0.0, min(b, mon[1]) - max(a, mon[0]))
        return b - a - inside + inside * DATA_ORDER_SLOW

    per = (HANDOVER_AT - MONTHS_FROM - hold) / weight(0, h)
    stops = sorted({0.0, h, *(mon or ()), *(() if raya is None else (raya,))})
    stops = [m for m in stops if 0 <= m <= h]
    keys, t = list(head), MONTHS_FROM
    for a, b in itertools.pairwise(stops):
        t += weight(a, b) * per
        keys.append((t, b))
        if raya is not None and b == raya:
            t += hold
            keys.append((t, b))
    keys.append((TOTAL_S, h))
    return out(keys), "data-order"


def _point_on(path: list[LonLat], along_m: float | None = None) -> LonLat:
    """A point on a lon/lat path: `along_m` metres from its start, else its middle."""
    fr = _Frame(path[0][0], path[0][1])
    line = fr.line(path)
    p = line.interpolate(line.length / 2 if along_m is None else min(along_m, line.length))
    return fr.ll(p.x, p.y)


def _tags(world: World, impact, lorry, facts: DevsimFacts) -> list[TimedTag]:
    out = []
    edge = facts.detour.edge_id if facts.detour else (impact.closed_edges or [None])[0]
    if edge is not None:
        coords = [list(c[:2]) for c in world.edges[edge].coords]
        if impact.homes_2min_plus:
            text = (
                f"Footpath closed · {impact.homes_2min_plus} homes walk {EXTRA_MIN}+ min longer"
                f" · up to +{impact.max_extra_min} min"
            )
        else:
            text = f"Footpath closed · no nearby home walks {EXTRA_MIN}+ min longer"
        out.append(
            TimedTag(
                kind="detour",
                t0=DETOUR_TAG[0],
                t1=DETOUR_TAG[1],
                title="Detour",
                text=text,
                at=_point_on(coords),
            )
        )
    # Ruling R16: the tag names the first sensitive place on the route and its kind; it never
    # claims a school that is not there.
    if lorry.sensitive:
        s = lorry.sensitive[0]
        text = f"Passes a {s.type}: {s.name}"
        if s.type in SCHOOLISH:
            text += f" · {lorry.school_run_note}"
        at = _point_on(lorry.path, s.along_m)
    else:
        text = f"{_n(lorry.distance_m)} m from the main road to the site gate"
        at = _point_on(lorry.path)
    out.append(
        TimedTag(
            kind="lorry", t0=LORRY_TAG[0], t1=LORRY_TAG[1], title="Lorry route", text=text, at=at
        )
    )
    return out


def _wet_range(mp: MonsoonSetPiece) -> list[int]:
    wet = [m.wet_days for m in mp.months]
    return sorted({min(wet), max(wet)})


def _monsoon_lost_a_month(mp: MonsoonSetPiece) -> int:
    lost = [m.days_lost for m in mp.months if m.days_lost > 0]
    return _round_min(sum(lost) / len(lost)) if lost else 0


def _banners(site: DevelopmentSite, sch: Schedule) -> list[Banner]:
    out = []
    if (rp := sch.raya_set_piece) is not None:
        out.append(
            Banner(
                kind="raya",
                t0=RAYA_HOLD[0],
                t1=RAYA_HOLD[1],
                title=f"Hari Raya Aidilfitri · site closed ~{rp.days} days",
                text=f"Most workers travel home · schedule +{rp.days} working days (assumption)",
                badges=["CALENDAR", "ESTIMATE"],
            )
        )
    if (mp := sch.monsoon_set_piece) is not None:
        wet = "–".join(str(v) for v in _wet_range(mp))
        if per := _monsoon_lost_a_month(mp):
            text = (
                f"Rain stops the crane on wet days · {wet} wet days a month"
                f" · ~{per} days lost a month"
            )
        else:  # the staged band falls in fit-out: rain is only counted against structure work
            text = (
                f"{wet} wet days a month (typical) · rain cost the structure work "
                f"~{sch.rain_days_lost} days in all"
            )
        out.append(
            Banner(
                kind="monsoon",
                t0=MONSOON_SLOW[0],
                t1=MONSOON_SLOW[1],
                title="Northeast monsoon",
                text=text,
                badges=["CALENDAR", "ESTIMATE"],
            )
        )
    out.append(
        Banner(
            kind="handover",
            t0=HANDOVER_BANNER[0],
            t1=HANDOVER_BANNER[1],
            title=f"Handover · keys to ~{site.homes} homes",
            text="Hoarding down · footpath reopens",
        )
    )
    return out


def _cost_m(rm: int) -> int:
    return _round_min(rm / 1_000_000)


def _stage_m(scenario: str) -> int:
    """ "stage_p3m" -> 3 (the river-rise scenario in metres)."""
    m = re.fullmatch(r"stage_p(\d+)m", scenario)
    if m is None:
        raise ValueError(f"not a river-rise scenario: {scenario}")
    return int(m.group(1))


def _brief(impact, lorry, sch: Schedule, flood, matrix) -> ImpactBrief:
    side_row = None
    if impact.best_side is not None:
        if len(impact.options) > 1:
            best = next(o for o in impact.options if o.side == impact.best_side)
            value = f"{best.side} ({best.homes_2min_plus} homes {EXTRA_MIN}+ min longer)"
        else:
            value = f"{impact.best_side} (only side hoarded)"
        side_row = BriefRow(
            key="best_side", label="Best hoarding side", value=value, badges=["ROUTE"]
        )
    if lorry.sensitive:
        s = lorry.sensitive[0]
        value = s.name + (f" · {lorry.school_run_note}" if s.type in SCHOOLISH else "")
        lorry_row = BriefRow(
            key="lorry", label=f"Lorry route passes a {s.type}", value=value, badges=["ROUTE"]
        )
    else:
        lorry_row = BriefRow(
            key="lorry",
            label="Lorry route",
            value=f"{_n(lorry.distance_m)} m · no school or park within {SENSITIVE_M} m",
            badges=["ROUTE"],
        )
    construction = [
        BriefRow(
            key="homes_2min_plus",
            label=f"Homes with a {EXTRA_MIN}+ min longer walk",
            value=f"{impact.homes_2min_plus} of {impact.homes_considered}"
            f" · up to +{impact.max_extra_min} min",
            badges=["ROUTE"],
        ),
        BriefRow(
            key="wheelchair_links_cut",
            label="Step-free links cut (wheelchair)",
            value=f"{impact.wheelchair_links_cut} homes",
            badges=["ROUTE"],
        ),
        *([side_row] if side_row else []),
        lorry_row,
        BriefRow(
            key="duration",
            label="Duration",
            value=f"{sch.months_total} months · handover {_month_label(sch.handover)}",
            badges=["ESTIMATE"],
        ),
        BriefRow(
            key="days_lost",
            label="Days lost: holidays · Hari Raya · rain",
            value=f"{sch.holiday_days_lost} · {sch.raya_shutdown_days} · {sch.rain_days_lost}",
            badges=["CALENDAR", "ESTIMATE"],
        ),
        BriefRow(
            key="cost",
            label="Construction cost",
            value=f"RM {_cost_m(sch.cost_total_rm)} M",
            badges=["ESTIMATE"],
        ),
    ]
    # Ruling R17: "not cut up to +{max} m" quotes the highest scenario actually checked.
    if flood.cut_from_scenario is not None:
        cut = f"+{_stage_m(flood.cut_from_scenario)} m scenario"
    elif flood.scenarios_checked:
        cut = f"Not cut up to +{_stage_m(flood.scenarios_checked[-1])} m"
    else:
        cut = "No river-rise scenario mapped"
    handover = [
        BriefRow(
            key="flood_cut", label="Walk to the main road cut from", value=cut, badges=["FLOOD"]
        )
    ]
    ev = flood.evacuation
    if ev is not None:
        label = (
            "Nearest official evacuation centre"
            if ev.source == "official_pps"
            else "Nearest evacuation candidate (OSM, not official)"
        )
        value = f"{ev.name} · {ev.min} min walk"
    else:
        label, value = "Nearest evacuation candidate", "None on the mapped walk network"
    handover.append(BriefRow(key="evacuation", label=label, value=value, badges=["ROUTE"]))
    values = {c.value for r in matrix.rows for c in r.cells if isinstance(c.value, str)}
    notes = [UNCHECKED_NOTE] if "?" in values else []
    notes += [GAP_NOTE] if "gap" in values else []
    notes += [BLOCKED_NOTE] if "blocked" in values else []
    return ImpactBrief(
        title=BRIEF_TITLE,
        subtitle=BRIEF_SUBTITLE,
        sections=[
            BriefSection(key="construction", title="During construction", rows=construction),
            BriefSection(key="handover", title="At handover", rows=handover, notes=[FLOOD_NOTE]),
            BriefSection(key="daily_life", title="Daily life (walk minutes)", rows=[], notes=notes),
        ],
    )


# ---- check -------------------------------------------------------------------------------------
DIGITS = re.compile(r"\d(?:[\d,]*\d)?")
BANNED = re.compile(
    r"\b(?:safe(?:ly|ty)?|selamat|depths?|flood(?:s|ed|ing)?)\b|安全", re.IGNORECASE
)


def fact_numbers(facts: DevsimFacts) -> set[int]:
    vals = {facts.park.m, facts.park.min, facts.mall.m, facts.mall.min}
    if (d := facts.detour) is not None:
        vals |= {d.before_m, d.after_m, d.detour_min}
    return vals


def plan_names(plan: DevelopmentPlan) -> list[str]:
    """Place names the copy may quote (data, not numbers): removed before digits are read."""
    names = {s.name for s in plan.lorry_route.sensitive}
    names |= {r.target.name for r in plan.access_matrix.rows}
    names |= {c.label for r in plan.access_matrix.rows for c in r.cells}
    if plan.facts.mall.label:
        names.add(plan.facts.mall.label)
    if plan.flood.evacuation is not None:
        names.add(plan.flood.evacuation.name)
    return sorted((n for n in names if n), key=len, reverse=True)


def expected_numbers(plan: DevelopmentPlan) -> dict[str, list[int] | tuple[list[int], ...]]:
    """Per copy slot, the values it must quote, in order (a tuple lists the allowed
    alternatives), recomputed from the plan's data fields. Slots not listed hold no digits."""
    f, d = plan.facts, plan.facts.detour
    out: dict[str, list[int] | tuple[list[int], ...]] = {
        "bubble 6": [f.park.min],
        "bubble 6 tag": [f.park.m, f.park.min],
        "bubble 7": ([f.mall.min], []),  # "Mall's right downstairs!" quotes none
        "bubble 7 tag": [f.mall.m, f.mall.min],
        "labels hypothetical": [plan.site.storeys, plan.site.homes],
    }
    if d is not None:
        out["bubble 1 tag"] = [d.detour_min, d.before_m, d.after_m]
    im, lr, sch, fl = plan.impact, plan.lorry_route, plan.schedule, plan.flood
    note = [int(x) for x in re.findall(r"\d+", lr.school_run_note)]
    school = bool(lr.sensitive) and lr.sensitive[0].type in SCHOOLISH
    out["tag detour"] = (
        [im.homes_2min_plus, EXTRA_MIN, im.max_extra_min] if im.homes_2min_plus else [EXTRA_MIN]
    )
    out["tag lorry"] = (note if school else []) if lr.sensitive else [lr.distance_m]
    if (rp := sch.raya_set_piece) is not None:
        out["banner raya"] = [rp.days, rp.days]
    if (mp := sch.monsoon_set_piece) is not None:
        per = _monsoon_lost_a_month(mp)
        out["banner monsoon"] = [*_wet_range(mp), per if per else sch.rain_days_lost]
    out["banner handover"] = [plan.site.homes]
    rows: dict[str, list[int]] = {
        "homes_2min_plus": [EXTRA_MIN, im.homes_2min_plus, im.homes_considered, im.max_extra_min],
        "wheelchair_links_cut": [im.wheelchair_links_cut],
        "lorry": (note if school else []) if lr.sensitive else [lr.distance_m, SENSITIVE_M],
        "duration": [sch.months_total, int(sch.handover[:4])],
        "days_lost": [sch.holiday_days_lost, sch.raya_shutdown_days, sch.rain_days_lost],
        "cost": [_cost_m(sch.cost_total_rm)],
        "evacuation": [fl.evacuation.min] if fl.evacuation is not None else [],
    }
    if im.best_side is not None:
        best = next((o for o in im.options if o.side == im.best_side), None)
        rows["best_side"] = (
            [best.homes_2min_plus, EXTRA_MIN] if best is not None and len(im.options) > 1 else []
        )
    if fl.cut_from_scenario is not None:
        rows["flood_cut"] = [_stage_m(fl.cut_from_scenario)]
    elif fl.scenarios_checked:
        rows["flood_cut"] = [_stage_m(fl.scenarios_checked[-1])]
    else:
        rows["flood_cut"] = []
    for k, v in rows.items():
        out[f"brief {k}"] = v
    return out


def plan_texts(plan: DevelopmentPlan) -> list[tuple[str, str]]:
    """(where, text) for every copy string check_plan reads."""
    out = []
    for b in plan.bubbles:
        out.append((f"bubble {b.n}", b.text))
        if b.tag:
            out.append((f"bubble {b.n} tag", b.tag))
    for t in plan.tags:
        out.append((f"tag {t.kind}", f"{t.title} · {t.text}"))
    for b in plan.banners:
        out.append((f"banner {b.kind}", f"{b.title} · {b.text}"))
    out.append(("brief title", f"{plan.brief.title} · {plan.brief.subtitle}"))
    for s in plan.brief.sections:
        out.append((f"brief section {s.key}", s.title))
        for r in s.rows:
            out.append((f"brief {r.key}", f"{r.label} · {r.value}"))
        for i, n in enumerate(s.notes, 1):
            out.append((f"brief {s.key} note {i}", n))
    out.append(("labels hypothetical", plan.labels.hypothetical))
    return out


def _impact_errors(plan: DevelopmentPlan) -> list[str]:
    errs = []
    im, hs = plan.impact, plan.impact.homes
    if im.homes_considered != len(hs):
        errs.append("impact: homes_considered is not the number of homes")
    if im.homes_2min_plus != sum(1 for h in hs if h.extra_min >= EXTRA_MIN or h.cut_off):
        errs.append("impact: homes_2min_plus does not count the homes")
    if im.max_extra_min != max((h.extra_min for h in hs), default=0):
        errs.append("impact: max_extra_min is not the largest extra walk")
    if im.wheelchair_links_cut != sum(1 for h in hs if h.wheelchair_cut):
        errs.append("impact: wheelchair_links_cut does not count the homes")
    if im.best_side is not None and im.best_side not in {o.side for o in im.options}:
        errs.append("impact: best_side is not an option")
    if (d := plan.facts.detour) is not None:
        row = next((h for h in hs if h.home_id == d.home_id), None)
        if row is None or row.extra_min != d.detour_min:
            errs.append("impact: Halim's home row does not show his detour minutes")
    lr = plan.lorry_route
    if lr.distance_m <= 0 or lr.minutes < 1 or lr.status == "confirmed":
        errs.append("lorry route: distance, minutes or status out of range")
    order = sorted(lr.sensitive, key=lambda s: (s.along_m, s.distance_m, s.place_id))
    if lr.sensitive != order or any(s.distance_m > SENSITIVE_M for s in lr.sensitive):
        errs.append("lorry route: sensitive places are not ordered along the route within 50 m")
    return errs


def _schedule_errors(plan: DevelopmentPlan) -> list[str]:
    errs = []
    s, n = plan.schedule, plan.schedule.months_total
    series = (s.months, s.floors_by_month, s.cost_by_month, s.days_lost_by_month)
    if any(len(x) != n for x in series):
        errs.append("schedule: a monthly series is not months_total long")
    for name in ("floors_by_month", "cost_by_month", "days_lost_by_month"):
        if any(b < a for a, b in itertools.pairwise(getattr(s, name))):
            errs.append(f"schedule: {name} goes down")
    if s.floors_by_month and s.floors_by_month[-1] != s.storeys:
        errs.append("schedule: the last month does not top out")
    if s.cost_by_month and s.cost_by_month[-1] != s.cost_total_rm:
        errs.append("schedule: the cost S-curve does not end at the total")
    total = s.holiday_days_lost + s.raya_shutdown_days + s.rain_days_lost
    if s.days_lost_by_month and abs(s.days_lost_by_month[-1] - total) > 0.5:
        errs.append("schedule: days lost by month do not add up to the totals")
    if s.holiday_days_lost != len(s.holidays_lost):
        errs.append("schedule: holiday_days_lost is not the lost holidays")
    if s.raya_set_piece is not None and s.raya_set_piece.days != s.raya_shutdown_days:
        errs.append("schedule: the Raya set piece is not the shutdown length")
    if [r.id for r in plan.estimate_sources] != s.source_ids:
        errs.append("estimate_sources are not the schedule's source rows")
    keys = plan.month_keys
    if (
        not keys
        or keys[0] != (0.0, 0.0)
        or keys[-1][0] != plan.total_s
        or any(b[0] < a[0] or b[1] < a[1] for a, b in itertools.pairwise(keys))
        or any(m > n for _, m in keys)
    ):
        errs.append("month_keys: not monotone from (0, 0) to the end")
    elif plan.month_keys_mode == "baseline":
        at = dict(keys)
        if at.get(HANDOVER_AT) != keys[-1][1] or at.get(MONTHS_FROM) != 0:
            errs.append("month_keys: the handover month is not reached at 27 s")
        if s.raya_set_piece is not None and at.get(RAYA_HOLD[0]) != at.get(RAYA_HOLD[1]):
            errs.append("month_keys: no hold at Hari Raya")
    return errs


def _flood_matrix_errors(plan: DevelopmentPlan) -> list[str]:
    errs = []
    fl = plan.flood
    if fl.cut_from_scenario is not None and fl.cut_from_scenario not in fl.scenarios_checked:
        errs.append("flood: cut_from_scenario was not checked")
    if (fl.cut_from_scenario is None) != (not fl.cut_edges):
        errs.append("flood: cut edges disagree with cut_from_scenario")
    if fl.evacuation is not None and fl.evacuation.min < 1:
        errs.append("flood: evacuation walk out of range")
    mx = plan.access_matrix
    if [r.target.kind for r in mx.rows] != ["park", "mall", "clinic", "school"]:
        errs.append("access matrix: rows are not park, mall, clinic, school")
    words = {"partly_unverified": "?", "no_data": "gap", "blocked": "blocked"}
    for r in mx.rows:
        if [c.profile for c in r.cells] != mx.profiles:
            errs.append(f"access matrix {r.target.kind}: not one cell per profile")
        for c in r.cells:
            want = words.get(c.status)
            if want is not None and c.value != want:
                errs.append(f"access matrix {r.target.kind}/{c.profile}: must show {want}")
            if want is None and not (isinstance(c.value, int) and c.value >= 1 and c.m):
                errs.append(f"access matrix {r.target.kind}/{c.profile}: minutes missing")
    by = {r.target.kind: r for r in mx.rows}
    if "default" in mx.profiles and {"park", "mall"} <= set(by):
        i = mx.profiles.index("default")
        for kind, walk in (("park", plan.facts.park), ("mall", plan.facts.mall)):
            c = by[kind].cells[i]
            if isinstance(c.value, int) and (c.value, c.m) != (walk.min, walk.m):
                errs.append(f"facts.{kind} is not the access matrix's default {kind} walk")
        if by["mall"].cells[i].arrival_id != plan.facts.mall.arrival_id:
            errs.append("facts.mall arrives elsewhere than the matrix mall walk (ruling R18)")
    return errs


def _resident_errors(plan: DevelopmentPlan) -> list[str]:
    from .devsim_residents import N_NEIGHBOUR, N_TOWER, check_line

    errs = []
    mx, rs = plan.access_matrix, plan.residents.residents
    if [r.side for r in rs] != ["tower"] * N_TOWER + ["neighbour"] * N_NEIGHBOUR:
        errs.append("residents: not 20 tower then 20 neighbours")
    rows = {h.home_id: h for h in plan.impact.homes}
    for r in rs:
        for phase in ("construction", "handover", "daily_life"):
            bad = check_line(getattr(r.lines, phase), r.facts)
            errs += [f"resident {r.id} {phase}: {e}" for e in bad]
        if r.side == "tower" and r.facts.profile in mx.profiles:
            i = mx.profiles.index(r.facts.profile)
            want = {row.target.kind: row.cells[i].value for row in mx.rows}
            if {w.kind: w.value for w in r.facts.walks} != want:
                errs.append(f"resident {r.id}: walks are not the access matrix's")
        if r.side == "neighbour" and r.facts.extra_walk_min is not None:
            row = rows.get(r.facts.home_id or "")
            if row is None or row.extra_min != r.facts.extra_walk_min:
                errs.append(f"resident {r.id}: extra walk is not their home's hoarding row")
    return errs


def check_plan(plan: DevelopmentPlan) -> list[str]:
    """Reasons the plan's copy may not be shown (empty list = fine).

    Each copy slot (bubbles, tags, banners, Impact Brief rows and notes, the hypothetical label)
    quotes exactly its own values, in order (`expected_numbers`, recomputed from the plan's data;
    thousands separators and quoted place names removed); every other slot holds no digits. No
    banned words (spec §3) anywhere in the copy, the labels or the cast; no numbers spelled out
    in words. The data behind the copy agrees with itself (impact counts, schedule series, month
    keys, flood, matrix vs facts), and every resident line passes `devsim_residents.check_line`
    against that resident's facts."""
    errs = []
    expected = expected_numbers(plan)
    names = plan_names(plan)
    for where, text in plan_texts(plan):
        bare = text
        for nm in names:
            bare = re.sub(re.escape(nm), " ", bare, flags=re.IGNORECASE)
        got = [int(m.group(0).replace(",", "")) for m in DIGITS.finditer(bare)]
        want = expected.get(where, [])
        options = want if isinstance(want, tuple) else (want,)
        if got not in options:
            errs.append(f"{where}: numbers {got} are not the computed facts {list(options)}")
        if m := spot.NUMBER_WORDS.search(bare):
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
    errs += _impact_errors(plan)
    errs += _schedule_errors(plan)
    errs += _flood_matrix_errors(plan)
    errs += _resident_errors(plan)
    return errs


class DevsimCheckError(ValueError):
    """The built plan failed check_plan: a bug, never shown."""


def build_development_plan(world: World, brief: DevelopmentBrief | None = None) -> DevelopmentPlan:
    """The whole Development Simulation plan for this world (deterministic).

    Raises DevsimUnavailable when the world lacks the parcel or the facts can't be computed."""
    # Imported here: these modules import devsim (ruling R-C1d).
    from . import devsim_impact as di
    from . import devsim_schedule as ds
    from .devsim_residents import build_residents

    brief = brief or DevelopmentBrief()
    site = place_tower(world, brief)
    lay = _layout(world, site)
    facts = compute_facts(world, site)
    households, cast = build_cast(world, site)
    acts, bubbles, anchors = build_beats(world, site, facts)
    impact = di.hoarding_impact(world, site, lay)
    lorry = di.lorry_route(world, site, lay)
    sch = ds.schedule(site.storeys, site.homes)
    flood = di.flood_exposure(world, site, lay)
    matrix = di.daily_life_matrix(world, site)
    residents = build_residents(
        world, site, lay=lay, detour_home=facts.detour.home_id if facts.detour else None
    )
    keys, mode = month_keys(sch)
    by_id = {s.id: s for s in ds.SOURCES}
    plan = DevelopmentPlan(
        world=world.site.id,
        site=site,
        facts=facts,
        cast=cast,
        households=households,
        acts=acts,
        bubbles=bubbles,
        tags=_tags(world, impact, lorry, facts),
        banners=_banners(site, sch),
        anchors=anchors,
        impact=impact,
        lorry_route=lorry,
        schedule=sch,
        estimate_sources=[
            EstimateSource(
                id=i,
                value=by_id[i].value,
                unit=by_id[i].unit,
                kind=by_id[i].kind,
                label=by_id[i].label,
            )
            for i in sch.source_ids
        ],
        month_keys=keys,
        month_keys_mode=mode,
        flood=flood,
        access_matrix=matrix,
        residents=residents,
        brief=_brief(impact, lorry, sch, flood, matrix),
        labels=DevsimLabels(
            hypothetical=(
                f"Hypothetical tower · not an SDP project · {site.storeys} storeys"
                f" · ~{site.homes} homes"
            )
        ),
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
