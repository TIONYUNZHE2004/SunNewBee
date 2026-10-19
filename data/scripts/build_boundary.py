"""City of Elmina outline for the stylised map (display only).

Writes data/seed/elmina/base/boundary.geojson (one Polygon feature) and records it in site.json
under `boundary`. Routing, evaluation, flood and answers never read this file; the renderer only
clips the drawn city to it.

Source (A-T3b, 19 Oct 2026): the owner's City of Elmina master-plan map,
docs/03-product/elmina-masterplan.png (661 x 1012 px, north up; source "owner, City of Elmina
master plan"). OSM has no "City of Elmina" administrative or place relation (checked in A-T3).

1. Georeference: `CONTROL_POINTS` pair lakes drawn on the master plan (centroids of the blue
   blobs in the image, in pixels) with the same lakes in OSM (centroids of the water polygons in
   base/hydrology.geojson). A least-squares affine fit maps image pixels to lon/lat; the script
   prints the residual of each point in metres (19 Oct 2026: RMS 24 m, max 56 m, about 7.4 m/px).
2. Trace: `TRACE_PX` is the township edge (the outer edge of the coloured, green-bordered plan
   area) traced by hand on the image in pixels, clockwise from the north-west corner of Elmina
   Green. It is mapped through the affine, smoothed in metres (close then open, `SMOOTH_M`) and
   simplified to about 20 m.
3. Check: every inside anchor must be inside and every outside anchor outside, else the script
   fails. Anchors are OSM features, plus the master plan's own area labels (pixels, georeferenced).

No network. The OSM features used for the anchors were read once through overpass.py
(`GEOREF_QUERY`, cached in data/cache/); their positions are recorded here as data.
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np
from shapely import affinity
from shapely.geometry import Point, Polygon, mapping

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "seed" / "elmina"
SOURCE = "owner_master_plan"
IMAGE = "docs/03-product/elmina-masterplan.png"
SIMPLIFY_M = 20.0
SMOOTH_M = 40.0  # close then open radius: rounds the hand-traced corners, keeps the plan's steps
HARMONI_1 = "osm-way-909868201"  # demo route start (shared with test_boundary.py)
LAT0 = 3.18
KX = 111320.0 * math.cos(math.radians(LAT0))  # metres per degree of longitude at LAT0
KY = 110574.0  # metres per degree of latitude

# The one Overpass query for the named areas and the E35 expressway (cached in data/cache/).
GEOREF_QUERY = (
    "[out:json][timeout:180];("
    'nwr["name"~"Elmina|Denai Alam|Bukit Subang|Subang Baru|Melayu Subang|Jelutong|Kenanga",i]'
    '[!"highway"](3.10,101.43,3.27,101.57);'
    'way["highway"~"^motorway"](3.10,101.43,3.27,101.57);'
    ");out geom;"
)

# (name, image x px, image y px, lon, lat): lake on the master plan <-> the same lake in OSM.
CONTROL_POINTS: list[tuple[str, float, float, float, float]] = [
    ("Elmina Green north lake (OSM way 866518931)", 104.3, 24.9, 101.49746, 3.21229),
    ("Elmina Green mosque lake (OSM ways 866518966+967)", 112.4, 117.9, 101.49795, 3.20603),
    ("EG29 lake (OSM way 1493709518)", 222.1, 248.7, 101.50523, 3.19739),
    ("Elmina Hills retention pond (OSM way 404002712)", 284.0, 301.8, 101.50924, 3.19383),
    ("Elmina Wellness Centre lake (OSM ways 866518928+929)", 167.1, 616.1, 101.50125, 3.17232),
    ("Elmina Crescent lake (OSM way 866543375)", 521.7, 656.1, 101.52521, 3.17012),
    ("Elmina Crescent east lake (OSM way 866543376)", 570.3, 689.0, 101.52836, 3.16779),
    ("Denai Alam H1 lake (OSM way 383055767)", 381.3, 802.5, 101.51589, 3.16042),
    ("Elmina Peak lake (OSM way 378225629)", 165.4, 875.0, 101.50195, 3.15526),
    ("Denai Alam J16 lake (OSM way 378225630)", 305.4, 924.0, 101.51083, 3.15205),
]

# Township edge on the master plan (image pixels), clockwise from the NW corner of Elmina Green.
TRACE_PX: list[tuple[float, float]] = [
    (33, 7),  # NW corner of Elmina Green (above EG1)
    (140, 7),
    (228, 12),
    (246, 35),  # Elmina Green meets the expressway
    (247, 282),  # down the west side of the E35 to the power-line reserve
    (262, 279),  # across the E35: the east lobe starts at the Elmina Gardens latitude
    (532, 279),  # north edge of Elmina Gardens
    (532, 413),  # east of Elmina Gardens
    (573, 413),  # step east at Elmina City Square
    (576, 580),
    (580, 600),
    (580, 760),  # east edge of Elmina Central Park East / Crescent / Enterprise Park
    (500, 782),  # south edge of Elmina Enterprise Park (Kampung Melayu Subang is beyond)
    (450, 810),
    (433, 815),  # back to the E35
    (452, 880),  # down the west side of the E35 (Denai Alam, H1)
    (476, 935),
    (483, 979),  # "To Bukit Jelutong"
    (100, 979),  # south edge along the bottom road (J16, southern Denai Alam estates)
    (100, 958),
    (75, 950),
    (27, 920),  # south-west corner of Elmina Peak
    (27, 662),  # west edge of Elmina Ridge
    (133, 662),  # step in: west edge of Elmina Wellness Centre
    (133, 472),
    (80, 472),
    (23, 440),  # Elmina Hills west spur
    (23, 430),
    (37, 423),
    (37, 285),  # west edge of Elmina Hills
    (33, 282),  # west edge of Elmina Green (straight north-south line)
]

# Must be inside: (name, lon, lat, where the point comes from).
INSIDE: list[tuple[str, float, float, str]] = [
    ("Elmina Green 1", 101.4950, 3.2104, "OSM way 866518934 (seed precinct)"),
    ("Pangsapuri Harmoni Elmina", 101.4974, 3.2092, "OSM (seed precinct)"),
    ("Elmina Hills (future development)", 101.5064, 3.1911, "OSM relation, landuse=orchard"),
    ("Elmina Wellness Centre", 101.5022, 3.1765, "OSM ways 'Elmina Welness Centre'"),
    ("Elmina Central Park West", 101.5067, 3.1780, "OSM way 1564861412"),
    ("Elmina Valley", 101.5033, 3.1704, "OSM relation 11826937"),
    ("Taman Bukit Subang", 101.5128, 3.1712, "OSM (seed precinct)"),
    ("Elmina Ridge & Elmina Peak", 101.4980, 3.1609, "OSM way 220414885"),
    ("Denai Alam", 101.5130, 3.1636, "OSM relation 15550049"),
    ("Denai Alam Football Field", 101.5122, 3.1516, "OSM way 911429129 (south estates)"),
    ("Elmina Gardens", 101.5195, 3.1902, "OSM way 704723792 (seed precinct)"),
    ("Elmina City Square", 101.5257, 3.1839, "OSM way 1564861413"),
    ("Elmina Crescent", 101.5241, 3.1677, "OSM way 866543394"),
]
# Area labels printed on the master plan (image pixels, centre of the label text).
PLAN_LABELS_INSIDE: list[tuple[str, float, float]] = [
    ("Elmina Green (plan label)", 136, 180),
    ("Elmina Hills (plan label)", 128, 380),
    ("Elmina City Center (plan label)", 262, 470),
    ("Elmina Wellness Centre (plan label)", 175, 560),
    ("Bukit Subang (plan label)", 340, 633),
    ("Elmina Ridge (plan label)", 66, 701),
    ("Elmina Peak (plan label)", 132, 830),
    ("Denai Alam (plan label)", 335, 843),
    ("Elmina Gardens (plan label)", 432, 340),
    ("Elmina City Square (plan label)", 520, 474),
    ("Elmina Crescent (plan label)", 480, 615),
    ("Elmina Enterprise Park (plan label)", 509, 758),
]
# Labelled outside the edge on the master plan, or clearly beyond it.
OUTSIDE: list[tuple[str, float, float, str]] = [
    ("Kampung Melayu Subang", 101.5316, 3.1566, "seed precinct centroid"),
    ("Taman Subang Baru", 101.5264, 3.1539, "seed precinct centroid"),
    ("Kampung Merbau Sempak", 101.5144, 3.2149, "seed precinct centroid (north, east of E35)"),
    ("Kampung Kubu Gajah", 101.5178, 3.2012, "seed precinct centroid (east of E35)"),
    ("Kenanga Gardens", 101.4917, 3.1975, "seed precinct (west of Elmina Green column)"),
    ("Subang Bestari", 101.5434, 3.1764, "seed precinct centroid (east)"),
]
PLAN_LABELS_OUTSIDE: list[tuple[str, float, float]] = [
    ("Kampung Melayu Subang (plan label)", 555, 797),
    ("Taman Subang Baru (plan label)", 545, 875),
]


def fit_affine() -> tuple[np.ndarray, list[float]]:
    """2x3 matrix M with [lon, lat] = M @ [x, y, 1], and each control point's residual in metres."""
    xy1 = np.array([[x, y, 1.0] for _, x, y, _, _ in CONTROL_POINTS])
    ll = np.array([[lon, lat] for *_, lon, lat in CONTROL_POINTS])
    a, *_ = np.linalg.lstsq(xy1, ll, rcond=None)
    d = xy1 @ a - ll
    res = [math.hypot(dx * KX, dy * KY) for dx, dy in d]
    return a.T, res


def px_to_lonlat(m: np.ndarray, x: float, y: float) -> tuple[float, float]:
    lon, lat = m @ np.array([x, y, 1.0])
    return float(lon), float(lat)


def anchor_points(m: np.ndarray) -> tuple[list[tuple], list[tuple]]:
    """(inside, outside) anchors as (name, lon, lat, source), plan labels georeferenced."""
    inside = list(INSIDE) + [
        (n, *px_to_lonlat(m, x, y), f"master plan label at px ({x}, {y})")
        for n, x, y in PLAN_LABELS_INSIDE
    ]
    outside = list(OUTSIDE) + [
        (n, *px_to_lonlat(m, x, y), f"master plan label at px ({x}, {y})")
        for n, x, y in PLAN_LABELS_OUTSIDE
    ]
    return inside, outside


def to_m(g):
    return affinity.scale(g, KX, KY, origin=(0, 0))


def to_deg(g):
    return affinity.scale(g, 1 / KX, 1 / KY, origin=(0, 0))


def area_km2(g_deg) -> float:
    return to_m(g_deg).area / 1e6


def outline(trace: list[tuple[float, float]], stats: dict | None = None) -> Polygon:
    """Traced ring (lon/lat), closed, opened and simplified in metres; one hole-free polygon."""
    r = SMOOTH_M
    u = to_m(Polygon(trace)).buffer(r).buffer(-2 * r).buffer(r).simplify(SIMPLIFY_M)
    polys = list(u.geoms) if u.geom_type == "MultiPolygon" else [u]
    main = max(polys, key=lambda p: p.area)
    if stats is not None:
        stats["parts_discarded"] = len(polys) - 1
        stats["holes_discarded"] = len(main.interiors)
    return to_deg(Polygon(main.exterior))


def check_anchors(geom: Polygon, m: np.ndarray) -> list[str]:
    """Names of anchors on the wrong side of the outline (empty when all agree with the plan)."""
    inside, outside = anchor_points(m)
    bad = [n for n, x, y, _ in inside if not geom.contains(Point(x, y))]
    bad += [n for n, x, y, _ in outside if geom.contains(Point(x, y))]
    return bad


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.parse_args(argv)
    site_path = OUT / "site.json"
    site = json.loads(site_path.read_text(encoding="utf-8"))
    m, res = fit_affine()
    for (name, *_), r in zip(CONTROL_POINTS, res, strict=True):
        print(f"  control point {name}: residual {r:.1f} m")
    rms = math.sqrt(sum(r * r for r in res) / len(res))
    print(f"affine fit: {len(res)} control points, RMS {rms:.1f} m, max {max(res):.1f} m")
    stats: dict = {}
    geom = outline([px_to_lonlat(m, x, y) for x, y in TRACE_PX], stats=stats)
    print(
        f"discarded: {stats['parts_discarded']} MultiPolygon part(s), "
        f"{stats['holes_discarded']} hole(s)"
    )
    bad = check_anchors(geom, m)
    if bad:
        raise SystemExit(f"outline disagrees with the master plan for: {bad}")
    km2 = area_km2(geom)
    feature = {
        "type": "Feature",
        "properties": {
            "name": "City of Elmina (outline)",
            "source": SOURCE,
            "smooth_m": SMOOTH_M,
            "simplify_m": SIMPLIFY_M,
        },
        "geometry": mapping(geom),
    }
    text = (
        json.dumps({"type": "FeatureCollection", "features": [feature]}, separators=(",", ":"))
        + "\n"
    )
    (OUT / "base" / "boundary.geojson").write_text(text, encoding="utf-8", newline="\n")
    site["boundary"] = {
        "file": "base/boundary.geojson",
        "source": SOURCE,
        "method": (
            f"Owner, City of Elmina master plan ({IMAGE}), georeferenced with an affine fit to "
            f"{len(res)} lakes matched in OSM (RMS {rms:.0f} m); township edge traced from the "
            f"image, smoothed ({SMOOTH_M:.0f} m close+open), simplified ~20 m. Display only."
        ),
        "area_km2": round(km2, 2),
        "as_of": site.get("data_as_of"),
    }
    site_path.write_text(
        json.dumps(site, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
    )
    bounds = [round(v, 4) for v in geom.bounds]
    bb = site["bbox"]
    if bounds[0] < bb[0] or bounds[1] < bb[1] or bounds[2] > bb[2] or bounds[3] > bb[3]:
        # site bbox drives routing tools (work exits, point checks), so it is not changed here.
        print(f"note: outline bounds {bounds} exceed site bbox {bb} (bbox left unchanged)")
    print(f"boundary: {km2:.2f} km2, {len(text)} bytes, bounds {bounds}")


if __name__ == "__main__":
    main()
