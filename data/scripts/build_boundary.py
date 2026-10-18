"""City of Elmina outline for the stylised map (display only).

Writes data/seed/elmina/base/boundary.geojson (one Polygon feature) and records it in site.json
under `boundary`. Routing, evaluation, flood and answers never read this file; the renderer only
clips the drawn city to it.

Source order:
1. OSM: an administrative/census boundary or place relation named exactly "City of Elmina" or
   "Elmina" (one cached Overpass query through data/scripts/overpass.py).
2. Fallback (used when OSM has none, as in the 19 Oct 2026 run): the union of the precinct
   polygons whose name contains "Elmina", the Urban Park / Lakeside Mall / Harmoni area, and a
   250 m disc around each deep-spot centre (so the flood corridor centre sits inside), buffered
   60 m, interior holes dropped, simplified to about 5 m.
"""

import argparse
import json
import math
import sys
from pathlib import Path

from shapely import affinity
from shapely.geometry import Point, Polygon, box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.scripts import overpass  # noqa: E402

OUT = ROOT / "data" / "seed" / "elmina"
BUFFER_M = 60.0
SIMPLIFY_M = 5.0
DISC_M = 250.0
LAT0 = 3.18
KX = 111320.0 * math.cos(math.radians(LAT0))  # metres per degree of longitude at LAT0
KY = 110574.0  # metres per degree of latitude

OSM_QUERY = (
    "[out:json][timeout:120];("
    'relation["boundary"~"administrative|census"]["name"~"Elmina",i](3.10,101.40,3.30,101.60);'
    'relation["place"]["name"~"Elmina",i](3.10,101.40,3.30,101.60);'
    'relation["landuse"]["name"~"Elmina",i](3.10,101.40,3.30,101.60);'
    ");out tags bb;"
)
OSM_NAMES = {"city of elmina", "elmina"}


def to_m(g):
    return affinity.scale(g, KX, KY, origin=(0, 0))


def to_deg(g):
    return affinity.scale(g, 1 / KX, 1 / KY, origin=(0, 0))


def area_km2(g_deg) -> float:
    return to_m(g_deg).area / 1e6


def osm_boundary_relations(elements: list[dict]) -> list[dict]:
    """Relations that are an actual city boundary (not a landuse patch named Elmina ...)."""
    out = []
    for e in elements:
        t = e.get("tags", {})
        is_boundary = t.get("boundary") in ("administrative", "census") or "place" in t
        if is_boundary and t.get("name", "").strip().lower() in OSM_NAMES:
            out.append(e)
    return out


def outline(
    precinct_geoms: list,
    focus_geoms: list,
    centres: list[tuple[float, float]],
) -> Polygon:
    """Union of the parts, buffered and simplified in metres, as one hole-free polygon."""
    parts = [to_m(g) for g in precinct_geoms + focus_geoms]
    parts += [to_m(Point(c)).buffer(DISC_M) for c in centres]
    u = unary_union(parts).buffer(BUFFER_M).simplify(SIMPLIFY_M)
    if u.geom_type == "MultiPolygon":
        u = max(u.geoms, key=lambda p: p.area)
    return to_deg(Polygon(u.exterior))


def _features(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def fallback_parts(site: dict) -> tuple[list, list, list[tuple[float, float]]]:
    precincts = [
        shape(f["geometry"])
        for f in _features(OUT / "base" / "precincts.geojson")
        if "elmina" in f["properties"]["name"].lower() and f["geometry"]["type"] != "Point"
    ]
    focus = []
    for spot in site["deep_spots"]:
        if spot["id"] == "urban-park":
            focus.append(box(*spot["bbox"]))
    for f in _features(OUT / "base" / "landmarks.geojson"):
        if "Lakeside Mall" in str(f["properties"].get("name")):
            focus.append(shape(f["geometry"]))
    for f in _features(OUT / "base" / "places.geojson"):
        if f["properties"].get("id") == "osm-way-909868201" or f["properties"].get("name") in (
            "Elmina Urban Park",
        ):
            focus.append(shape(f["geometry"]))
    centres = [
        ((s["bbox"][0] + s["bbox"][2]) / 2, (s["bbox"][1] + s["bbox"][3]) / 2)
        for s in site["deep_spots"]
    ]
    return precincts, focus, centres


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-requests", type=int, default=3)
    args = ap.parse_args(argv)
    overpass.MAX_REQUESTS = args.max_requests
    site_path = OUT / "site.json"
    site = json.loads(site_path.read_text(encoding="utf-8"))
    try:
        found = osm_boundary_relations(overpass.query(OSM_QUERY).get("elements", []))
    except overpass.OverpassError as exc:
        print(f"BLOCKED: {exc}; using the fallback outline")
        found = []
    if found:
        # No usable OSM boundary has been seen for Elmina; handling one needs geometry, so stop.
        raise SystemExit(
            f"OSM boundary relation(s) found: {[e['id'] for e in found]}; extend the script"
        )
    geom = outline(*fallback_parts(site))
    km2 = area_km2(geom)
    feature = {
        "type": "Feature",
        "properties": {
            "name": "City of Elmina (outline)",
            "source": "fallback_union",
            "buffer_m": BUFFER_M,
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
        "source": "fallback_union",
        "method": (
            "No OSM boundary relation named City of Elmina. Union of Elmina-named precinct "
            "polygons + Urban Park / Lakeside Mall / Harmoni area + 250 m around deep-spot "
            "centres, buffered 60 m, simplified ~5 m. Display only."
        ),
        "area_km2": round(km2, 2),
        "as_of": site.get("data_as_of"),
    }
    site_path.write_text(
        json.dumps(site, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
    )
    print(
        f"boundary: {km2:.2f} km2, {len(text)} bytes; "
        f"overpass HTTP requests: {overpass.REQUESTS_MADE}"
    )


if __name__ == "__main__":
    main()
