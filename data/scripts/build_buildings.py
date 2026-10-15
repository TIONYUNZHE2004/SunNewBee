"""Import OSM building footprints and trees around the Elmina home point for the stylised 3D city.

Writes data/seed/elmina/base/buildings.geojson and trees.geojson and records them in site.json.
Display data only: heights are OSM tags or deterministic defaults, never derived from Google tiles.
Overpass goes through data/scripts/overpass.py (cache, backoff, request cap).
"""

import argparse
import hashlib
import json
import math
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.scripts import overpass  # noqa: E402

OUT = ROOT / "data" / "seed" / "elmina"
MAX_BYTES = 6_000_000
LEVEL_M = 3.2
MIN_AREA_M2 = 4.0
M_PER_DEG = 111320.0

_RESIDENTIAL = {
    "apartments",
    "house",
    "residential",
    "detached",
    "terrace",
    "semidetached_house",
    "dormitory",
    "bungalow",
    "semi",
    "villa",
    "townhouse",
}
_COMMERCIAL = {"retail", "commercial", "office", "hotel", "supermarket", "kiosk", "mall"}
_INDUSTRIAL = {"industrial", "warehouse", "factory", "manufacture", "storage_tank", "hangar"}
_CIVIC = {
    "school",
    "hospital",
    "church",
    "mosque",
    "temple",
    "public",
    "civic",
    "university",
    "college",
    "government",
    "kindergarten",
    "religious",
    "fire_station",
    "clinic",
    "community_centre",
    "chapel",
    "shrine",
    "train_station",
    "transportation",
}
_CIVIC_AMENITY = {
    "school",
    "hospital",
    "clinic",
    "place_of_worship",
    "community_centre",
    "townhall",
    "library",
    "kindergarten",
    "college",
    "university",
    "police",
    "fire_station",
}
_HEIGHT_RANGE = {
    "residential": (7, 12),
    "commercial": (12, 30),
    "industrial": (8, 14),
    "civic": (10, 18),
    "other": (6, 10),
}


def bbox_around(lon: float, lat: float, radius_m: float) -> tuple[float, float, float, float]:
    """(s, w, n, e) of a square of half-side radius_m around the point."""
    dlat = radius_m / M_PER_DEG
    dlon = radius_m / (M_PER_DEG * math.cos(math.radians(lat)))
    return (lat - dlat, lon - dlon, lat + dlat, lon + dlon)


def tiles(
    bbox: tuple[float, float, float, float], step_deg: float
) -> list[tuple[float, float, float, float]]:
    """Cut (s, w, n, e) into a grid of near-equal tiles no larger than step_deg."""
    s, w, n, e = bbox
    ny = max(1, math.ceil((n - s) / step_deg - 1e-9))
    nx = max(1, math.ceil((e - w) / step_deg - 1e-9))
    dy, dx = (n - s) / ny, (e - w) / nx
    return [
        (s + i * dy, w + j * dx, s + (i + 1) * dy, w + (j + 1) * dx)
        for i in range(ny)
        for j in range(nx)
    ]


def query_for(tile: tuple[float, float, float, float]) -> str:
    s, w, n, e = tile
    b = f"({s:.6f},{w:.6f},{n:.6f},{e:.6f})"
    return (
        "[out:json][timeout:180];"
        f"(way[building]{b};relation[building]{b};node[natural=tree]{b};);out geom tags;"
    )


def fetch_all(bbox, step: float, max_requests: int | None) -> list[dict]:
    """Concatenated Overpass elements for every tile (sequential, cached, request-capped)."""
    overpass.MAX_REQUESTS = max_requests
    elements: list[dict] = []
    for tile in tiles(bbox, step):
        elements.extend(overpass.query(query_for(tile)).get("elements", []))
    return elements


MAX_HEIGHT_M = 300.0


def _number(text) -> float | None:
    """Leading number of an OSM tag value; None when absent or in non-metre units (ft, ')."""
    m = re.match(r"^\s*(-?\d+(?:[.,]\d+)?)(.*)$", str(text or ""))
    if not m:
        return None
    rest = m.group(2).strip().lower()
    if "'" in rest or rest.startswith(("ft", "feet", "foot", "in", '"')):
        return None
    return float(m.group(1).replace(",", "."))


def kind_of(tags: dict) -> str:
    b = tags.get("building", "")
    if b in _RESIDENTIAL:
        return "residential"
    if b in _COMMERCIAL:
        return "commercial"
    if b in _INDUSTRIAL:
        return "industrial"
    if b in _CIVIC:
        return "civic"
    if tags.get("shop"):
        return "commercial"
    if tags.get("amenity") in _CIVIC_AMENITY:
        return "civic"
    if tags.get("amenity"):
        return "commercial"
    return "other"


def infer_height(tags: dict, id: str) -> tuple[float, str, float]:  # noqa: A002
    """(height_m, source, min_height_m). Deterministic: defaults hash the OSM id."""
    h = _number(tags.get("height"))
    if h is not None and 0 < h <= MAX_HEIGHT_M:
        height, source = h, "osm_height"
    else:
        levels = _number(tags.get("building:levels"))
        if levels is not None and 0 < levels * LEVEL_M <= MAX_HEIGHT_M:
            height, source = levels * LEVEL_M, "osm_levels"
        else:
            lo, hi = _HEIGHT_RANGE[kind_of(tags)]
            frac = int(hashlib.sha1(id.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
            height, source = lo + frac * (hi - lo), "default"
    height = round(height, 2)
    mn = _number(tags.get("min_height"))
    mn = 0.0 if mn is None or mn < 0 else mn
    if mn >= height:
        mn = max(0.0, height - 0.5)
    return height, source, round(mn, 2)


def _area_m2(ring: list[list[float]]) -> float:
    lat0 = sum(p[1] for p in ring) / len(ring)
    kx, ky = M_PER_DEG * math.cos(math.radians(lat0)), M_PER_DEG
    pts = [(p[0] * kx, p[1] * ky) for p in ring]
    pairs = zip(pts, pts[1:] + pts[:1], strict=True)
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in pairs)) / 2


def simplify_ring(coords: list[list[float]]) -> list[list[float]] | None:
    """Closed ring without duplicate or collinear vertices, 6 d.p.; None if degenerate or < 4 m2."""
    pts = [[round(c[0], 6), round(c[1], 6)] for c in coords]
    changed = True
    while changed and len(pts) >= 3:
        changed = False
        out: list[list[float]] = []
        for p in pts:
            if not out or out[-1] != p:
                out.append(p)
        while len(out) > 1 and out[0] == out[-1]:  # closing duplicate
            out.pop()
        pts = out
        n = len(pts)
        for i in range(n):
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % n]
            if abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-12:
                del pts[i]
                changed = True
                break
    if len(pts) < 3 or _area_m2(pts) < MIN_AREA_M2:
        return None
    return [*pts, pts[0]]


def build_features(elements: list[dict]) -> tuple[list[dict], list[dict], dict]:
    buildings: list[dict] = []
    trees: list[dict] = []
    seen_ways: set[int] = set()
    seen_nodes: set[int] = set()
    stats = {"skipped_relations": 0, "skipped_invalid": 0, "duplicates": 0}
    for el in elements:
        kind, tags = el.get("type"), el.get("tags", {})
        if kind == "relation":
            stats["skipped_relations"] += 1
        elif kind == "node" and tags.get("natural") == "tree":
            if el["id"] in seen_nodes:
                stats["duplicates"] += 1
                continue
            seen_nodes.add(el["id"])
            trees.append(
                {
                    "type": "Feature",
                    "properties": {"id": f"n{el['id']}"},
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(el["lon"], 6), round(el["lat"], 6)],
                    },
                }
            )
        elif kind == "way" and "building" in tags:
            if el["id"] in seen_ways:
                stats["duplicates"] += 1
                continue
            seen_ways.add(el["id"])
            ring = [[g["lon"], g["lat"]] for g in el.get("geometry") or [] if g]
            closed = len(ring) >= 4 and ring[0] == ring[-1]
            simple = simplify_ring(ring) if closed else None
            if simple is None:
                stats["skipped_invalid"] += 1
                continue
            oid = f"w{el['id']}"
            height, source, mn = infer_height(tags, oid)
            props = {
                "id": oid,
                "height_m": height,
                "min_height_m": mn,
                "kind": kind_of(tags),
                "height_source": source,
            }
            if tags.get("name"):
                props["name"] = tags["name"]
            buildings.append(
                {
                    "type": "Feature",
                    "properties": props,
                    "geometry": {"type": "Polygon", "coordinates": [simple]},
                }
            )
    return buildings, trees, stats


def _dump(feats: list[dict]) -> str:
    text = json.dumps(
        {"type": "FeatureCollection", "features": feats}, ensure_ascii=False, separators=(",", ":")
    )
    return text + "\n"


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--max-requests", type=int, default=None, help="hard cap on real Overpass requests"
    )
    ap.add_argument("--radius-m", type=float, default=3500)
    ap.add_argument("--step", type=float, default=0.02, help="tile size in degrees")
    ap.add_argument("--dry-run", action="store_true", help="print the plan, make no request")
    args = ap.parse_args(argv)

    site_path = OUT / "site.json"
    site = json.loads(site_path.read_text(encoding="utf-8"))
    home = site["scene"]["home"]
    bbox = bbox_around(home["lon"], home["lat"], args.radius_m)
    if args.dry_run:
        n_tiles = len(tiles(bbox, args.step))
        print(f"bbox s,w,n,e = {bbox}; {n_tiles} Overpass tile request(s); nothing fetched")
        raise SystemExit(0)
    try:
        elements = fetch_all(bbox, args.step, args.max_requests)
    except overpass.OverpassError as exc:
        print(f"BLOCKED: {exc}; overpass HTTP requests this run: {overpass.REQUESTS_MADE}")
        raise SystemExit(2) from None
    buildings, trees, stats = build_features(elements)
    b_text, t_text = _dump(buildings), _dump(trees)
    size = len(b_text.encode("utf-8"))
    t_size = len(t_text.encode("utf-8"))
    for name, n in (("buildings.geojson", size), ("trees.geojson", t_size)):
        if n > MAX_BYTES:
            print(f"{name} is {n} bytes (> {MAX_BYTES}); lower --radius-m")
            raise SystemExit(3)
    base = OUT / "base"
    base.mkdir(parents=True, exist_ok=True)
    (base / "buildings.geojson").write_text(b_text, encoding="utf-8", newline="\n")
    (base / "trees.geojson").write_text(t_text, encoding="utf-8", newline="\n")
    site["buildings"] = {
        "file": "base/buildings.geojson",
        "trees": "base/trees.geojson",
        "radius_m": args.radius_m,
        "count": len(buildings),
        "as_of": date.today().isoformat(),
    }
    site_path.write_text(
        json.dumps(site, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    print(f"buildings: {len(buildings)}  trees: {len(trees)}  {stats}  {size} bytes")
    print(f"overpass HTTP requests this run: {overpass.REQUESTS_MADE}")


if __name__ == "__main__":
    main()
