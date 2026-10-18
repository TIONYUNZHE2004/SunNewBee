# ruff: noqa: E501
"""Build scene.js for the resident-journey prototype.

Plans the demo route (Harmoni 1 -> Lakeside Mall Car Park B, older_adult_rest) with the real
routing engine, then turns the corridor around it into local-metre geometry and an ordered event
list. Run from the repo root:

    uv run python docs/03-product/prototypes/resident-journey/build_scene.py
"""

import json
import math
import random
from pathlib import Path

from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import substring, transform, unary_union
from townshiplens_spatial import routing
from townshiplens_spatial.world import load_world

SEED = Path("data/seed/elmina")
HERE = Path(__file__).resolve().parent
OUT = HERE / "scene.js"
FROM, TO, PROFILE = "osm-way-909868201", "park-b", "older_adult_rest"

world = load_world(SEED, Path("config/profiles"))
rr = routing.plan_route(world, FROM, TO, PROFILE)
route_obj = rr.routes[0]
route = route_obj.model_dump(mode="json")
segs = [world.edges[s.edge_id].coords for s in route_obj.segments]

# Orient route segments into one travel-ordered polyline.
chain: list[list[float]] = []
for i, seg in enumerate(segs):
    seg = [tuple(c) for c in seg]
    if i == 0:
        nxt = [tuple(c) for c in segs[1]]
        if seg[0] in (nxt[0], nxt[-1]):
            seg = seg[::-1]
    elif chain and seg[0] != chain[-1] and seg[-1] == chain[-1]:
        seg = seg[::-1]
    elif chain and seg[0] != chain[-1]:
        d0 = math.dist(seg[0], chain[-1])
        d1 = math.dist(seg[-1], chain[-1])
        if d1 < d0:
            seg = seg[::-1]
    chain.extend(seg if not chain else seg[1:])

lon0 = sum(c[0] for c in chain) / len(chain)
lat0 = sum(c[1] for c in chain) / len(chain)
KX = 111320 * math.cos(math.radians(lat0))
KY = 110574


def proj(x, y, z=None):
    return ((x - lon0) * KX, (y - lat0) * KY)


def P(g):
    return transform(proj, g)


line = P(LineString(chain))
minx, miny, maxx, maxy = line.bounds
CLIP = box(minx - 140, miny - 140, maxx + 140, maxy + 140)


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


def load(name):
    return json.loads((SEED / name).read_text(encoding="utf-8"))


scene: dict = {"clip": list(CLIP.bounds)}

# Land cover by class.
lc: dict[str, list] = {}
for f in load("base/landcover.geojson")["features"]:
    cls = f["properties"]["class"]
    for p in polys(P(shape(f["geometry"]))):
        lc.setdefault(cls, []).append(p)
for f in load("base/parks.geojson")["features"]:
    for p in polys(P(shape(f["geometry"]))):
        lc.setdefault("grass", []).append(p)
water = []
for f in load("base/hydrology.geojson")["features"]:
    if f["geometry"]["type"] in ("Polygon", "MultiPolygon"):
        water += polys(P(shape(f["geometry"])))
water_u = unary_union(water) if water else Polygon()
green = unary_union(lc.get("grass", []) + lc.get("forest", []) + lc.get("scrub", []))
green = green.difference(water_u)
scene["green"] = [ring(p) for p in polys(green)]
scene["water"] = [ring(p) for p in polys(water_u)]
paved = unary_union(lc.get("parking", []) + lc.get("commercial", []))
scene["plaza"] = [ring(p) for p in polys(paved.difference(water_u))]

# Walk network as buffered ribbons.
W = {
    "major_road": 7.0,
    "street": 3.6,
    "crossing": 3.6,
    "footway": 1.3,
    "path": 1.3,
    "sidewalk": 1.2,
}
by: dict[str, list] = {}
crossings = []
for f in load("base/walk.geojson")["features"]:
    t = f["properties"]["type"]
    g = P(shape(f["geometry"]))
    if not g.intersects(CLIP):
        continue
    if t == "crossing":
        crossings.append(g)
    key = "road" if t in ("major_road", "street", "crossing") else "foot"
    by.setdefault(key, []).append(
        g.buffer(W.get(t, 1.3), cap_style="flat" if key == "road" else "round")
    )
road = unary_union(by.get("road", []))
foot = unary_union(by.get("foot", [])).difference(road)
kerb = road.buffer(2.2).difference(road)
scene["road"] = [ring(p) for p in polys(road)]
scene["kerb"] = [ring(p) for p in polys(kerb.difference(water_u))]
scene["foot"] = [ring(p) for p in polys(foot.difference(water_u))]
# Zebra stripes only where OSM maps a crossing (honesty: crossings are facts).
stripes = []
for c in crossings:
    if c.length < 3:
        continue
    n = max(3, int(c.length / 1.2))
    for i in range(1, n):
        pt = c.interpolate(i / n, normalized=True)
        a = c.interpolate(max(0, i / n - 0.01), normalized=True)
        b = c.interpolate(min(1, i / n + 0.01), normalized=True)
        ang = math.atan2(b.y - a.y, b.x - a.x)
        r = affinity.rotate(box(-0.3, -3.0, 0.3, 3.0), ang, origin=(0, 0), use_radians=True)
        stripes.append(ring(affinity.translate(r, pt.x, pt.y)))
scene["stripes"] = stripes

# Buildings.
bl = []
blds = []
for f in load("base/buildings.geojson")["features"]:
    if f["geometry"]["type"] != "Polygon":
        continue
    g = P(shape(f["geometry"]))
    if not g.intersects(CLIP):
        continue
    for p in polys(g):
        h = f["properties"].get("display_height_m") or 8
        bl.append(
            {**ring(p), "h": h, "kind": f["properties"].get("kind"), "id": f["properties"]["id"]}
        )
        blds.append(p)
scene["buildings"] = bl
bld_u = unary_union(blds) if blds else Polygon()

# Route with cumulative distance and per-span status.
pts = list(line.coords)
scene["route"] = [list(p) for p in pts]
spans = []
at = 0.0
for s in route["segments"]:
    L = s.get("length_m")
    spans.append({"edge": s["edge_id"], "eval": s["eval"]})
scene["route_eval"] = spans
seg_lens = []
for seg in segs:
    seg_lens.append(P(LineString(seg)).length)
cum = []
a = 0.0
for L, s in zip(seg_lens, route["segments"], strict=True):
    cum.append([a, a + L, s["eval"]])
    a += L
scene["route_spans"] = cum
scene["route_len"] = a


def node_xy(nid):
    lat, lon = nid[2:].split("_")
    lat = float(lat[:1] + "." + lat[1:]) if lat.startswith("3") else float(lat)
    lon = float(lon[:3] + "." + lon[3:])
    return list(proj(lon, lat))


scene["benches"] = [
    {
        "name": r["name"],
        "xy": node_xy(r["node_id"]),
        "at": line.project(Point(node_xy(r["node_id"]))),
    }
    for r in route["rest_points"]
]

# Decorative trees (illustrative) in green areas, away from paths, water and buildings.
rnd = random.Random(7)
avoid = unary_union([road.buffer(2.5), foot.buffer(1.8), water_u.buffer(1.5), bld_u.buffer(3)])
trees = []
gx0, gy0, gx1, gy1 = CLIP.bounds
tries = 0
while len(trees) < 520 and tries < 40000:
    tries += 1
    x, y = rnd.uniform(gx0, gx1), rnd.uniform(gy0, gy1)
    p = Point(x, y)
    if not green.contains(p) or avoid.contains(p):
        continue
    if any((x - tx) ** 2 + (y - ty) ** 2 < 49 for tx, ty, _ in trees):
        continue
    trees.append((x, y, rnd.uniform(0.8, 1.35)))
scene["trees"] = trees

# Decorative people on footways near the park.
people = []
fl = [
    g
    for g in load("base/walk.geojson")["features"]
    if g["properties"]["type"] in ("footway", "path")
]
for f in fl:
    g = P(shape(f["geometry"]))
    if not CLIP.contains(g.centroid) or g.length < 15:
        continue
    for _ in range(int(g.length // 45)):
        q = g.interpolate(rnd.random(), normalized=True)
        people.append(
            (q.x + rnd.uniform(-0.6, 0.6), q.y + rnd.uniform(-0.6, 0.6), rnd.uniform(0, 6.28))
        )
scene["people"] = people[:70]

# Route ribbons by status: PASS solid, UNKNOWN dashed.

rib = []
for a0, a1, ev in cum:
    if ev == "PASS":
        rib.append({"s": ev, **ring(substring(line, a0, a1).buffer(0.45, cap_style="round"))})
    else:
        d = a0
        while d < a1:
            piece = substring(line, d, min(d + 1.2, a1))
            if piece.length > 0.3:
                rib.append({"s": ev, **ring(piece.buffer(0.32, cap_style="round"))})
            d += 2.4
scene["ribbons"] = rib

# Road centrelines for decorative cars.
roads = []
for f in load("base/walk.geojson")["features"]:
    t = f["properties"]["type"]
    if t in ("major_road", "street"):
        g = P(shape(f["geometry"])).intersection(CLIP)
        if g.geom_type == "LineString" and g.length > 30:
            roads.append({"t": t, "c": [list(c) for c in g.coords]})
scene["roads"] = roads
# Ordered journey events, each tied to a world-model element (what journey.py will compute).
events = []
edge_at = [(c[0], c[1], s.edge_id, s.eval) for c, s in zip(cum, route_obj.segments, strict=True)]


def claims_of(eid):
    e = world.edges[eid]
    return {
        k: {"value": c.value, "status": c.status, "evidence_type": c.evidence_type}
        for k, c in e.claims.items()
    }


first = edge_at[0]
if "covered" in world.edges[first[2]].claims:
    events.append(
        {
            "kind": "covered",
            "at": 0.0,
            "element_id": first[2],
            "status": world.edges[first[2]].claims["covered"].status,
            "title": "Covered walkway",
            "body": "Someone reported a roof here. Not checked yet.",
        }
    )
seen_major = False
for a0, _a1, eid, ev in edge_at:
    e = world.edges[eid]
    if e.type == "major_road" and ev == "UNKNOWN" and not seen_major:
        seen_major = True
        events.append(
            {
                "kind": "unknown",
                "at": a0,
                "element_id": eid,
                "status": "unknown",
                "title": f"Crossing {e.name or 'a main road'}",
                "body": "No mapped crossing or sidewalk here. Not checked yet. A verification request was sent to the township team.",
            }
        )
limit = route_obj.rest_limit_m
if limit and route_obj.max_gap_between_rest_m and route_obj.max_gap_between_rest_m > limit:
    first_rest = min((b["at"] for b in scene["benches"]), default=a)
    events.append(
        {
            "kind": "gap",
            "at": min(limit, first_rest),
            "element_id": None,
            "status": "gap",
            "title": "No mapped rest stop ahead",
            "body": f"The next mapped bench is about {round(first_rest - limit, -1):.0f} m further on. Her rule is a rest every {limit:.0f} m.",
        }
    )
# Longest named street stretch with no mapped sidewalk (UNKNOWN), reported once.
runs, cur = [], None
for a0, _a1, eid, ev in edge_at:
    e = world.edges[eid]
    if ev == "UNKNOWN" and e.type == "street" and e.name:
        if cur and cur["name"] == e.name and abs(cur["end"] - a0) < 1:
            cur["end"] = a1
        else:
            cur = {"name": e.name, "start": a0, "end": a1, "eid": eid}
            runs.append(cur)
if runs:
    r0 = max(runs, key=lambda r: r["end"] - r["start"])
    events.append(
        {
            "kind": "unknown",
            "at": r0["start"],
            "element_id": r0["eid"],
            "status": "unknown",
            "title": f"{r0['name']}",
            "body": f"About {round(r0['end'] - r0['start'], -1):.0f} m along the road with no mapped sidewalk. Not checked yet.",
        }
    )
first_pass = next((x for x in edge_at if x[3] == "PASS"), None)
if first_pass:
    a0, a1, eid, ev = first_pass
    events.append(
        {
            "kind": "verified",
            "at": a0,
            "element_id": eid,
            "status": "verified",
            "demo": True,
            "title": "Step-free path",
            "body": "No steps, gentle slope, 1.5 m wide.",
            "claims": claims_of(eid),
        }
    )
for a0, _a1, eid, ev in edge_at:
    if world.edges[eid].type == "ramp" and ev == "UNKNOWN":
        events.append(
            {
                "kind": "unknown",
                "at": a0,
                "element_id": eid,
                "status": "unknown",
                "title": "Ramp",
                "body": "No one has checked how steep this ramp is. A verification request was sent to the township team.",
            }
        )
for b in scene["benches"]:
    events.append(
        {
            "kind": "rest",
            "at": b["at"],
            "element_id": b["name"],
            "status": "verified",
            "demo": True,
            "title": b["name"],
            "body": "She sits for a minute. Rest stops keep each stretch short.",
        }
    )
events.append(
    {
        "kind": "arrive",
        "at": a,
        "element_id": TO,
        "status": "arrive",
        "title": "Lakeside Mall Car Park B",
        "body": f"About {round(a)} m. Est. {round(route_obj.est_minutes)} min at her pace, plus rests.",
    }
)
events.sort(key=lambda e: e["at"])
scene["events"] = events
scene["route_meta"] = {
    "status": route_obj.status,
    "distance_m": route_obj.distance_m,
    "est_minutes": route_obj.est_minutes,
    "warnings": rr.warnings,
    "max_gap_between_rest_m": route_obj.max_gap_between_rest_m,
}
scene["meta"] = {"lon0": lon0, "lat0": lat0, "len": a, "from": FROM, "to": TO, "profile": PROFILE}
OUT.write_text(
    "// Generated by build_scene.py. Do not edit.\nwindow.JOURNEY_SCENE = "
    + json.dumps(scene, separators=(",", ":"))
    + ";\n"
)
print(
    "route m",
    round(a),
    "trees",
    len(trees),
    "people",
    len(scene["people"]),
    "bld",
    len(bl),
    "stripes",
    len(stripes),
    "green",
    len(scene["green"]),
    "water",
    len(scene["water"]),
)
