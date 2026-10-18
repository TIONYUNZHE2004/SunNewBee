"""Land cover for the stylised city: OSM areas first, ESA WorldCover fills only the empty land.

Writes data/seed/elmina/base/landcover.geojson. Display data only: nothing here feeds routing,
evaluation, flood or answers. Water here is decorative base water, never a flood scenario.
Parks stay in parks.geojson and are not duplicated. WorldCover class 50 (built-up) is never drawn.
Overpass goes through data/scripts/overpass.py (cache, backoff, request cap); the WorldCover
window is one public COG read over /vsicurl/ (free, no key), cached as data/cache/*.npy.
"""

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.scripts import overpass  # noqa: E402
from data.scripts.build_buildings import M_PER_DEG, bbox_around, tiles  # noqa: E402

OUT = ROOT / "data" / "seed" / "elmina"
CACHE = ROOT / "data" / "cache"
MAX_BYTES = 6_000_000
MIN_GAP_M2 = 2000.0
SIMPLIFY_M = 5.0
COORD_DP = 6
ATTRIBUTION = "ESA WorldCover 10 m 2021 v200 © ESA WorldCover project, CC-BY 4.0"
GAP_SOURCE = "esa_worldcover_2021"

CLASSES = (
    "forest",
    "scrub",
    "grass",
    "farmland",
    "oil_palm",
    "construction",
    "parking",
    "residential",
    "commercial",
    "industrial",
    "water",
    "wetland",
    "bare",
)
WORLDCOVER_URL = (
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
    "ESA_WorldCover_10m_2021_v200_N03E099_Map.tif"
)
# 50 (built-up) is deliberately absent: never drawn.
WORLDCOVER_CLASS = {
    10: "forest",
    20: "scrub",
    30: "grass",
    40: "farmland",
    60: "bare",
    80: "water",
    90: "wetland",
    95: "wetland",
}

_LANDUSE = {
    "forest": "forest",
    "grass": "grass",
    "meadow": "grass",
    "construction": "construction",
    "brownfield": "construction",
    "residential": "residential",
    "commercial": "commercial",
    "retail": "commercial",
    "industrial": "industrial",
    "reservoir": "water",
    "basin": "water",
}
_NATURAL = {
    "wood": "forest",
    "scrub": "scrub",
    "grassland": "grass",
    "water": "water",
    "wetland": "wetland",
    "bare_rock": "bare",
    "sand": "bare",
}
_CROPLAND = {"farmland", "orchard", "plantation"}


def landcover_query(tile: tuple[float, float, float, float]) -> str:
    s, w, n, e = tile
    b = f"({s:.6f},{w:.6f},{n:.6f},{e:.6f})"
    return (
        "[out:json][timeout:180];("
        'way["landuse"~"^(forest|grass|meadow|farmland|orchard|plantation|construction|'
        f'brownfield|residential|commercial|retail|industrial|reservoir|basin)$"]{b};'
        f'way["natural"~"^(wood|scrub|grassland|water|wetland|bare_rock|sand)$"]{b};'
        f"way[amenity=parking]{b};"
        ");out geom tags;"
    )


def osm_class(tags: dict) -> str | None:
    """Land-cover class of an OSM area, or None (parks and everything else are not land cover)."""
    landuse = tags.get("landuse")
    if landuse in _CROPLAND:
        crops = (tags.get("crop"), tags.get("produce"), tags.get("trees"))
        return "oil_palm" if any("oil_palm" in (c or "") for c in crops) else "farmland"
    if landuse in _LANDUSE:
        return _LANDUSE[landuse]
    if tags.get("natural") in _NATURAL:
        return _NATURAL[tags["natural"]]
    if tags.get("amenity") == "parking":
        return "parking"
    return None


def osm_polygons(elements: list[dict]) -> list[dict]:
    """Features for closed OSM ways with a land-cover class (tiled requests repeat ways)."""
    out: list[dict] = []
    seen: set[int] = set()
    for el in elements:
        if el.get("type") != "way" or el["id"] in seen:
            continue
        cls = osm_class(el.get("tags") or {})
        if cls is None:
            continue
        pts = [
            [round(p["lon"], COORD_DP), round(p["lat"], COORD_DP)] for p in el.get("geometry") or []
        ]
        if len(pts) < 4 or pts[0] != pts[-1]:
            continue
        seen.add(el["id"])
        out.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [pts]},
                "properties": {"class": cls, "source": "osm", "osm": f"way/{el['id']}"},
            }
        )
    return out


def _m2_per_deg2(lat: float) -> float:
    return M_PER_DEG * M_PER_DEG * math.cos(math.radians(lat))


def _polys(geom):
    if geom.is_empty:
        return []
    return list(geom.geoms) if hasattr(geom, "geoms") else [geom]


def _round(o):
    if isinstance(o, float):
        return round(o, COORD_DP)
    if isinstance(o, dict):
        return {k: _round(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_round(v) for v in o]
    return o


def gap_polygons(raster: np.ndarray, transform, covered) -> list[dict]:
    """WorldCover polygons for land that `covered` (shapely, lon/lat; or None) leaves empty."""
    from rasterio.features import shapes
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union

    tol = SIMPLIFY_M / M_PER_DEG
    out: list[dict] = []
    for code, cls in WORLDCOVER_CLASS.items():
        mask = raster == code
        if not mask.any():
            continue
        parts = [
            shape(g)
            for g, _ in shapes(mask.astype("uint8"), mask=mask, transform=transform, connectivity=8)
        ]
        geom = unary_union(parts)
        if covered is not None and not covered.is_empty:
            geom = geom.difference(covered)
        for poly in _polys(geom):
            if poly.area * _m2_per_deg2(poly.centroid.y) < MIN_GAP_M2:
                continue
            for piece in _polys(poly.simplify(tol, preserve_topology=True)):
                if piece.geom_type != "Polygon":
                    continue
                if piece.area * _m2_per_deg2(piece.centroid.y) < MIN_GAP_M2:
                    continue
                out.append(
                    {
                        "type": "Feature",
                        "geometry": _round(mapping(piece)),
                        "properties": {"class": cls, "source": GAP_SOURCE},
                    }
                )
    return out


def read_worldcover(bbox, refresh: bool = False):
    """(uint8 raster, Affine) for bbox (s, w, n, e), cached as data/cache/worldcover_<hash>.npy."""
    from affine import Affine

    tag = hashlib.sha1("_".join(f"{v:.5f}" for v in bbox).encode()).hexdigest()[:12]
    npy, meta = CACHE / f"worldcover_{tag}.npy", CACHE / f"worldcover_{tag}.json"
    if npy.exists() and meta.exists() and not refresh:
        return np.load(npy), Affine(*json.loads(meta.read_text(encoding="utf-8"))["transform"])
    import rasterio
    from rasterio.windows import Window, from_bounds

    s, w, n, e = bbox
    env = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "GDAL_HTTP_MAX_RETRY": "3"}
    with rasterio.Env(**env), rasterio.open("/vsicurl/" + WORLDCOVER_URL) as ds:
        win = from_bounds(w, s, e, n, transform=ds.transform)
        c0, r0 = math.floor(win.col_off), math.floor(win.row_off)
        win = Window(
            c0,
            r0,
            math.ceil(win.col_off + win.width) - c0,
            math.ceil(win.row_off + win.height) - r0,
        )
        arr = ds.read(1, window=win).astype("uint8")
        t = ds.window_transform(win)
    CACHE.mkdir(parents=True, exist_ok=True)
    np.save(npy, arr)
    meta.write_text(
        json.dumps({"url": WORLDCOVER_URL, "transform": list(t)[:6]}),
        encoding="utf-8",
        newline="\n",
    )
    return arr, t


def _dump(feats: list[dict]) -> str:
    text = json.dumps(
        {"type": "FeatureCollection", "features": feats}, ensure_ascii=False, separators=(",", ":")
    )
    return text + "\n"


def _fc_union(path: Path):
    from shapely.geometry import shape
    from shapely.ops import unary_union

    if not path.exists():
        return None
    feats = json.loads(path.read_text(encoding="utf-8"))["features"]
    return unary_union([shape(f["geometry"]).buffer(0) for f in feats])


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-requests", type=int, default=None, help="hard cap on Overpass requests")
    ap.add_argument("--step", type=float, default=0.02, help="tile size in degrees")
    ap.add_argument("--dry-run", action="store_true", help="print the plan, make no request")
    args = ap.parse_args(argv)

    site_path = OUT / "site.json"
    site = json.loads(site_path.read_text(encoding="utf-8"))
    home = site["scene"]["home"]
    bbox = bbox_around(home["lon"], home["lat"], site["buildings"]["radius_m"])
    if args.dry_run:
        n = len(tiles(bbox, args.step))
        print(
            f"bbox s,w,n,e = {bbox}; {n} Overpass tile request(s) + 1 WorldCover window; no fetch"
        )
        raise SystemExit(0)

    overpass.MAX_REQUESTS = args.max_requests
    try:
        els: list[dict] = []
        for tile in tiles(bbox, args.step):
            els.extend(overpass.query(landcover_query(tile)).get("elements", []))
    except overpass.OverpassError as exc:
        print(f"BLOCKED: {exc}; overpass HTTP requests this run: {overpass.REQUESTS_MADE}")
        raise SystemExit(2) from None
    osm = osm_polygons(els)

    from shapely.geometry import shape
    from shapely.ops import unary_union

    covered = unary_union([shape(f["geometry"]).buffer(0) for f in osm]) if osm else None
    parks = _fc_union(OUT / "base" / "parks.geojson")  # parks own their land: no fill under them
    if parks is not None and not parks.is_empty:
        covered = parks if covered is None else covered.union(parks)
    raster, transform = read_worldcover(bbox)
    gap = gap_polygons(raster, transform, covered)

    feats = osm + gap
    text = _dump(feats)
    size = len(text.encode("utf-8"))
    if size > MAX_BYTES:
        print(f"landcover.geojson is {size} bytes (> {MAX_BYTES}); not written")
        raise SystemExit(3)
    (OUT / "base").mkdir(parents=True, exist_ok=True)
    (OUT / "base" / "landcover.geojson").write_text(text, encoding="utf-8", newline="\n")
    if ATTRIBUTION not in site["attribution"]:
        site["attribution"].append(ATTRIBUTION)
        site_path.write_text(
            json.dumps(site, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
        )
    counts: dict[tuple[str, str], int] = {}
    for f in feats:
        key = (f["properties"]["class"], f["properties"]["source"])
        counts[key] = counts.get(key, 0) + 1
    for (cls, src), n in sorted(counts.items()):
        print(f"{cls:13s} {src:22s} {n}")
    print(f"features: {len(feats)} (osm {len(osm)}, gap {len(gap)})  {size} bytes")
    print(f"overpass HTTP requests this run: {overpass.REQUESTS_MADE}")


if __name__ == "__main__":
    main()
