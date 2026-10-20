# ruff: noqa: E501
"""Build scene.js for the developer-lens (Development Simulation) prototype.

Places a Hypothetical Development (a ~30-storey tower) on the north-east corner of a real OSM
construction lot near Elmina Lakeside Mall, then computes every number the playback shows with
the real routing engine:
- the construction detour: a nearby resident's walk to Lakeside Mall Car Park B, before and after
  the hoarding closes the frontage sidewalk (twm.ClosePath);
- walking minutes from the tower to the mall and to Elmina Urban Park.

Run from the repo root:

    uv run python docs/03-product/prototypes/developer-lens/build_scene.py
"""

import dataclasses
import json
import math
import random
import warnings
from pathlib import Path

import networkx as nx
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import nearest_points, transform, unary_union
from townshiplens_spatial import routing, twm
from townshiplens_spatial.models import Place
from townshiplens_spatial.world import load_world

warnings.filterwarnings("ignore", category=DeprecationWarning)

SEED = Path("data/seed/elmina")
HERE = Path(__file__).resolve().parent
OUT = HERE / "scene.js"
PARCEL_OSM = "way/1564861412"  # OSM landuse=construction lot beside the mall (candidate A)
KANOPI_OSM = "way/1314193194"  # real Kanopi Residences lot: the tower must stay clear of it
MALL = "park-b"  # Lakeside Mall Car Park B: the resident's walk target
MALL_PLACE = "lakeside-mall"
PARK_PLACE = "osm-way-1309457596"  # Elmina Urban Park
HOARDED = ["seg-910300105-0"]  # sidewalk along the lot's frontage on Persiaran Alstonia
# The detour's sidewalk on the far side of both Persiaran Alstonia carriageways (checked below).
FAR_SIDE = "seg-1343835668-0"
CARRIAGEWAYS = ["seg-866518974-0", "seg-1242852915-4"]
OLD_HOME = "w909835115"  # an existing home south of the lot whose mall walk uses that sidewalk
PROFILE = "default"
STOREYS, STOREY_H = 30, 3.3

world = load_world(SEED, Path("config/profiles"))


def load(name):
    return json.loads((SEED / name).read_text(encoding="utf-8"))


lc = load("base/landcover.geojson")["features"]
parcel_ll = next(shape(f["geometry"]) for f in lc if f["properties"].get("osm") == PARCEL_OSM)
kanopi_ll = next(shape(f["geometry"]) for f in lc if f["properties"].get("osm") == KANOPI_OSM)
lon0, lat0 = parcel_ll.centroid.x, parcel_ll.centroid.y
KX = 111320 * math.cos(math.radians(lat0))
KY = 110574


def proj(x, y, z=None):
    return ((x - lon0) * KX, (y - lat0) * KY)


def P(g):
    return transform(proj, g)


def xy(c):
    return list(proj(c[0], c[1]))


parcel = P(parcel_ll)
mall_bld = next(
    P(shape(f["geometry"]))
    for f in load("base/buildings.geojson")["features"]
    if f["properties"]["id"] == "w1308938137"
)

# ---------- the hypothetical tower: NE corner of the lot, 40 m in from the edge nearest the mall
edge_pt = nearest_points(parcel.boundary, mall_bld.centroid)[0]
c = parcel.centroid
vx, vy = c.x - edge_pt.x, c.y - edge_pt.y
vl = math.hypot(vx, vy)
T = Point(edge_pt.x + vx / vl * 40, edge_pt.y + vy / vl * 40)
assert parcel.contains(T)
kanopi_d = T.distance(P(kanopi_ll))
assert kanopi_d > 200, kanopi_d
# Align the footprint with the frontage street.
fr = P(LineString(world.edges[HOARDED[0]].coords))
(ax, ay), (bx, by) = fr.coords[0], fr.coords[-1]
ang = math.atan2(by - ay, bx - ax)
tower = affinity.rotate(box(-19, -13, 19, 13), ang, origin=(0, 0), use_radians=True)
tower = affinity.translate(tower, T.x, T.y)
site = tower.buffer(26, join_style="mitre").intersection(parcel.buffer(-2))
podium = tower.buffer(5, join_style="mitre")
# Lobby: the tower face nearest the frontage sidewalk, a few metres out.
lp = nearest_points(tower.exterior, fr)[0]
fp = nearest_points(fr, lp)[0]
dl = math.hypot(fp.x - lp.x, fp.y - lp.y)
lobby = Point(lp.x + (fp.x - lp.x) / dl * 8, lp.y + (fp.y - lp.y) / dl * 8)

# ---------- facts from the routing engine ----------
comp = max(nx.connected_components(world.graph), key=len)


def nearest_node(pt: Point) -> tuple[str, float]:
    return min(
        ((n, P(Point(cc)).distance(pt)) for n, cc in world.node_coords.items() if n in comp),
        key=lambda t: t[1],
    )


def temp_place(pid, name, pt):
    n, d = nearest_node(pt)
    return Place(id=pid, type="building", name=name, coord=world.node_coords[n], node_id=n), d


home_bld = next(
    P(shape(f["geometry"]))
    for f in load("base/buildings.geojson")["features"]
    if f["properties"]["id"] == OLD_HOME
)
home_pl, home_snap = temp_place("prototype-old-home", OLD_HOME, home_bld.centroid)
tower_pl, tower_snap = temp_place("prototype-tower", "Hypothetical tower", lobby)
w0 = dataclasses.replace(world, places={**world.places, home_pl.id: home_pl, tower_pl.id: tower_pl})
base = routing.plan_route(w0, home_pl.id, MALL, PROFILE).routes[0]
assert any(s.edge_id in HOARDED for s in base.segments), "the old route must use the hoarded path"
im = twm.apply(w0, [twm.ClosePath(element_id=e) for e in HOARDED])
w1 = dataclasses.replace(im.world, places=w0.places)
det_r = routing.plan_route(w1, home_pl.id, MALL, PROFILE)
detour = det_r.routes[0]
assert not any(s.edge_id in HOARDED for s in detour.segments)
detour_min = detour.est_minutes - base.est_minutes
N = int(detour_min + 0.5)
assert N >= 2, detour_min
# Fact for the speech bubble: the detour leaves the lot-side sidewalk for the sidewalk across the
# road. "Cross the road" alone would not be news: the old route crossed the road too.
before_ids = {s.edge_id for s in base.segments}
after_ids = {s.edge_id for s in detour.segments}
assert FAR_SIDE in after_ids and FAR_SIDE not in before_ids
far_d = P(LineString(world.edges[FAR_SIDE].coords)).distance(parcel)
assert all(far_d > P(LineString(world.edges[e].coords)).distance(parcel) for e in CARRIAGEWAYS)
to_mall = routing.plan_route(w0, tower_pl.id, MALL_PLACE, PROFILE).routes[0]
to_park = routing.plan_route(w0, tower_pl.id, PARK_PLACE, PROFILE).routes[0]
K = max(1, int(to_mall.est_minutes + 0.5))
M = max(1, int(to_park.est_minutes + 0.5))

# ---------- entrance: a ground-floor door facing the walk node the tower snaps to ----------
snap = Point(xy(tower_pl.coord))
door = nearest_points(podium.exterior, snap)[0]
nx_, ny_ = snap.x - door.x, snap.y - door.y
nl = math.hypot(nx_, ny_)
door_n = (nx_ / nl, ny_ / nl)
forecourt = Point(door.x + door_n[0] * 7, door.y + door_n[1] * 7)
# Passer-by: beside the closed sidewalk, at the point nearest the tower.
fp_near = nearest_points(fr, T)[0]
fx, fy = fp_near.x - T.x, fp_near.y - T.y
fl = math.hypot(fx, fy)
farid = Point(fp_near.x + fx / fl * 5, fp_near.y + fy / fl * 5)

# ---------- clip and base layers (same recipe as the resident-journey prototype) ----------
CLIP = box(T.x - 330, T.y - 520, T.x + 420, T.y + 330)


def polys(g):
    g = g.intersection(CLIP)
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    return [p for p in getattr(g, "geoms", []) if p.geom_type == "Polygon" and p.area > 4]


def ring(p):
    return {
        "ext": [list(c) for c in p.exterior.coords[:-1]],
        "holes": [[list(c) for c in r.coords[:-1]] for r in p.interiors],
    }


def line_xy(coords):
    return [xy(c) for c in coords]


def clipped(coords):
    g = LineString(line_xy(coords)).intersection(CLIP)
    if g.is_empty:
        return []
    parts = [g] if g.geom_type == "LineString" else list(getattr(g, "geoms", []))
    return [[list(c) for c in p.coords] for p in parts if p.geom_type == "LineString"]


scene: dict = {"clip": list(CLIP.bounds)}
lcls: dict[str, list] = {}
for f in lc:
    for p in polys(P(shape(f["geometry"]))):
        lcls.setdefault(f["properties"]["class"], []).append(p)
for f in load("base/parks.geojson")["features"]:
    for p in polys(P(shape(f["geometry"]))):
        lcls.setdefault("grass", []).append(p)
water = []
for f in load("base/hydrology.geojson")["features"]:
    if f["geometry"]["type"] in ("Polygon", "MultiPolygon"):
        water += polys(P(shape(f["geometry"])))
water_u = unary_union(water) if water else Polygon()
green = unary_union(lcls.get("grass", []) + lcls.get("forest", []) + lcls.get("scrub", []))
green = green.difference(water_u).difference(parcel)
scene["green"] = [ring(p) for p in polys(green)]
scene["water"] = [ring(p) for p in polys(water_u)]
paved = unary_union(lcls.get("parking", []) + lcls.get("commercial", []))
scene["plaza"] = [ring(p) for p in polys(paved.difference(water_u))]
scene["lot"] = [ring(p) for p in polys(parcel.difference(site))]  # earthworks beyond the site
scene["site"] = [ring(p) for p in polys(site)]
scene["podium"] = ring(podium)
scene["tower"] = ring(tower)
scene["tower_c"] = [T.x, T.y]
scene["tower_ang"] = ang
scene["hoarding"] = [list(c) for c in site.exterior.coords]
scene["lobby"] = [forecourt.x, forecourt.y]
scene["entrance"] = {
    "door": [door.x, door.y],
    "normal": list(door_n),
    "node": [snap.x, snap.y],
    "path_m": round(nl),
}
scene["farid"] = [farid.x, farid.y]

W = {
    "major_road": 7.0,
    "street": 3.6,
    "crossing": 3.6,
    "footway": 1.3,
    "path": 1.3,
    "sidewalk": 1.2,
}
by: dict[str, list] = {}
roads = []
for f in load("base/walk.geojson")["features"]:
    t = f["properties"]["type"]
    g = P(shape(f["geometry"]))
    if not g.intersects(CLIP):
        continue
    key = "road" if t in ("major_road", "street", "crossing") else "foot"
    by.setdefault(key, []).append(
        g.buffer(W.get(t, 1.3), cap_style="flat" if key == "road" else "round")
    )
    if t in ("major_road", "street"):
        gc = g.intersection(CLIP)
        if gc.geom_type == "LineString" and gc.length > 40:
            roads.append({"t": t, "id": f["properties"]["id"], "c": [list(c) for c in gc.coords]})
road = unary_union(by.get("road", []))
foot = unary_union(by.get("foot", [])).difference(road)
scene["road"] = [ring(p) for p in polys(road)]
scene["kerb"] = [ring(p) for p in polys(road.buffer(2.2).difference(road).difference(water_u))]
scene["foot"] = [ring(p) for p in polys(foot.difference(water_u))]
scene["roads"] = roads
scene["closed"] = [
    ring(p) for e in HOARDED for p in polys(P(LineString(world.edges[e].coords)).buffer(1.6))
]

bl, blds = [], []
for f in load("base/buildings.geojson")["features"]:
    if f["geometry"]["type"] != "Polygon":
        continue
    g = P(shape(f["geometry"]))
    if not g.intersects(CLIP) or g.intersects(site):
        continue
    for p in polys(g):
        h = f["properties"].get("display_height_m") or 8
        bl.append(
            {**ring(p), "h": h, "kind": f["properties"].get("kind"), "id": f["properties"]["id"]}
        )
        blds.append(p)
scene["buildings"] = bl
bld_u = unary_union(blds) if blds else Polygon()

# Routes, clipped to the diorama.
scene["route_before"] = clipped(base.geometry["coordinates"])
scene["route_after"] = clipped(detour.geometry["coordinates"])
scene["route_tower_mall"] = clipped(to_mall.geometry["coordinates"])
scene["route_tower_park"] = clipped(to_park.geometry["coordinates"])
# The old resident walks the part of the detour nearest the site.
det_line = LineString(line_xy(detour.geometry["coordinates"]))
s0 = det_line.project(Point(lobby.x, lobby.y))  # the old frontage point, not the new door
walk = [
    det_line.interpolate(d)
    for d in range(int(max(0, s0 - 120)), int(min(det_line.length, s0 + 60)), 4)
]
scene["halim_walk"] = [[p.x, p.y] for p in walk]


def place_xy(pid):
    p = world.places[pid]
    return xy(p.coord)


# Where the routes arrive (on the mapped walk network: the park's place point sits in a lake).
# At the mall, stand on the route just outside the building so the resident is not under its roof.
ml = LineString(line_xy(to_mall.geometry["coordinates"]))
d = ml.length
while d > 0 and ml.interpolate(d).distance(mall_bld) < 3:
    d -= 2
mall_spot = ml.interpolate(d)
scene["spots"] = {
    "mall": [mall_spot.x, mall_spot.y],
    "park": xy(to_park.geometry["coordinates"][-1]),
    "carpark": place_xy(MALL),
    "home": [home_bld.centroid.x, home_bld.centroid.y],
    "mall_bld": [mall_bld.centroid.x, mall_bld.centroid.y],
}

# Decorative: trees, material stacks, worker paths, a few crowd walkers.
rnd = random.Random(11)
avoid = unary_union(
    [road.buffer(2.5), foot.buffer(1.8), water_u.buffer(1.5), bld_u.buffer(3), parcel]
)
trees = []
gx0, gy0, gx1, gy1 = CLIP.bounds
tries = 0
while len(trees) < 650 and tries < 50000:
    tries += 1
    x, y = rnd.uniform(gx0, gx1), rnd.uniform(gy0, gy1)
    p = Point(x, y)
    if not green.contains(p) or avoid.contains(p):
        continue
    if any((x - tx) ** 2 + (y - ty) ** 2 < 49 for tx, ty, _ in trees):
        continue
    trees.append((x, y, rnd.uniform(0.8, 1.35)))
scene["trees"] = trees
yard = site.buffer(-4).difference(podium.buffer(3))
stacks = []
while len(stacks) < 7:
    p = Point(rnd.uniform(*site.bounds[0::2]), rnd.uniform(*site.bounds[1::2]))
    if yard.contains(p) and all(p.distance(Point(s)) > 9 for s in stacks):
        stacks.append([p.x, p.y])
scene["stacks"] = stacks
crowd = []
for f in load("base/walk.geojson")["features"]:
    if f["properties"]["type"] not in ("footway", "path", "sidewalk"):
        continue
    g = P(shape(f["geometry"]))
    if not CLIP.contains(g.centroid) or g.length < 20 or g.distance(T) > 380:
        continue
    for _ in range(int(g.length // 70)):
        q = g.interpolate(rnd.random(), normalized=True)
        crowd.append((q.x, q.y, rnd.uniform(0, 6.28)))
scene["crowd"] = crowd[:40]
# The morning school-run queue (decorative): the street nearest the lobby.
queue_road = min(
    (r for r in roads if r["t"] == "street"),
    key=lambda r: LineString(r["c"]).distance(snap),
)
scene["queue_road"] = queue_road["c"]

scene["facts"] = {
    "detour_min": N,
    "detour_exact_min": round(detour_min, 2),
    "before_m": round(base.distance_m),
    "after_m": round(detour.distance_m),
    "before_min": round(base.est_minutes, 1),
    "after_min": round(detour.est_minutes, 1),
    "mall_min": K,
    "mall_m": round(to_mall.distance_m),
    "park_min": M,
    "park_m": round(to_park.distance_m),
    "tower_snap_m": round(tower_snap),
    "door_to_node_m": round(nl),
    "far_side_sidewalk": FAR_SIDE,
    "home_snap_m": round(home_snap),
    "kanopi_m": round(kanopi_d),
    "storeys": STOREYS,
    "storey_h": STOREY_H,
    "profile": PROFILE,
    "hoarded": HOARDED,
    "old_home": OLD_HOME,
    "mall_target": MALL,
    "parcel": PARCEL_OSM,
}
scene["meta"] = {"lon0": lon0, "lat0": lat0}
OUT.write_text(
    "// Generated by build_scene.py. Do not edit.\nwindow.DEVSIM_SCENE = "
    + json.dumps(scene, separators=(",", ":"))
    + ";\n"
)
print(json.dumps(scene["facts"], indent=1))
print("bld", len(bl), "trees", len(trees), "roads", len(roads), "crowd", len(scene["crowd"]))
