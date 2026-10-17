"""Building archetypes, precincts and final heights for the stylised city.

Reads base/buildings.geojson (with its `osm` tag subset), base/landcover.geojson (land use),
base/height_samples.json (optional) and base/archetype_overrides.json, plus one Overpass query
for precincts. Writes the enriched base/buildings.geojson, base/precincts.geojson and
base/archetype_coverage.json, and records site.json["buildings"]["archetypes_as_of"].

Display data only: nothing here feeds routing, evaluation, flood or answers. Archetypes come from
OSM tags, footprint shape, OSM land use and OSM precinct names; a footprint that matches no rule
stays `generic` (better than a confident wrong guess). Google 3D-tile samples are used only as
`height_m` with `height_source` `google_3dtiles`, and to call a building a highrise (a sample
>= 30 m with coverage >= 0.5); they are display-only and never feed any fact.
Overpass goes through data/scripts/overpass.py (cache, backoff, request cap).
"""

import argparse
import json
import math
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.scripts import build_buildings as bb  # noqa: E402
from data.scripts import overpass  # noqa: E402

OUT = ROOT / "data" / "seed" / "elmina"
M_PER_DEG = bb.M_PER_DEG
PLACE_RADIUS_M = 1500.0

ARCHETYPES = (
    "link_intermediate",
    "link_long",
    "superlink",
    "semi_d",
    "bungalow",
    "townhouse",
    "shop_office",
    "highrise",
    "school",
    "mosque",
    "factory",
    "mall",
    "generic",
)
STOREY_HEIGHT_M = {
    "link_intermediate": 8.5,
    "link_long": 8.5,
    "superlink": 9.0,
    "semi_d": 9.0,
    "bungalow": 5.5,
    "townhouse": 6.0,
    "shop_office": 11.0,
    "school": 14.0,
    "mosque": 15.0,
    "factory": 10.0,
    "mall": 9.0,
}  # highrise and generic: none
LOW_RISE = set(STOREY_HEIGHT_M) - {"school", "mosque", "mall", "factory"}
OUTLIER_FACTOR = 3.0
HIGHRISE_M = 30.0
MIN_SAMPLE_COVERAGE = 0.5

_SCHOOL_NAME = re.compile(r"^(SK|SJK|SMK|SMA|Sekolah|Tadika)\b")
_RIDGE = re.compile(r"ridge", re.IGNORECASE)
_DETACHED = {"bungalow", "detached", "villa"}
_LANDUSE_CLASSES = {"residential", "commercial", "industrial"}


# --- geometry -----------------------------------------------------------------------


def _open_ring(ring: list[list[float]]) -> list[list[float]]:
    return ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else list(ring)


def _to_m(ring: list[list[float]], lat0: float) -> list[tuple[float, float]]:
    kx = M_PER_DEG * math.cos(math.radians(lat0))
    lon0 = ring[0][0]
    return [((p[0] - lon0) * kx, (p[1] - lat0) * M_PER_DEG) for p in ring]


def _area(pts: list[tuple[float, float]]) -> float:
    pairs = zip(pts, pts[1:] + pts[:1], strict=True)
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in pairs)) / 2


def _hull(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Convex hull (monotone chain), counter-clockwise, no repeated first point."""
    pts = sorted(set(pts))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[tuple[float, float]] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def shape_metrics(ring: list[list[float]]) -> dict:
    """width_m (short side), length_m (long side) of the minimum rotated rectangle, area_m2 of
    the footprint and fill = area / rectangle area. Input is a lon/lat ring."""
    pts = _open_ring(ring)
    lat0 = sum(p[1] for p in pts) / len(pts)
    xy = _to_m(pts, lat0)
    area = _area(xy)
    hull = _hull(xy)
    best = None
    for i in range(len(hull)):
        (x1, y1), (x2, y2) = hull[i], hull[(i + 1) % len(hull)]
        theta = math.atan2(y2 - y1, x2 - x1)
        c, s = math.cos(theta), math.sin(theta)
        us = [x * c + y * s for x, y in hull]
        vs = [-x * s + y * c for x, y in hull]
        du, dv = max(us) - min(us), max(vs) - min(vs)
        if best is None or du * dv < best[0] * best[1]:
            best = (du, dv)
    du, dv = best or (0.0, 0.0)
    rect = du * dv
    return {
        "width_m": round(min(du, dv), 3),
        "length_m": round(max(du, dv), 3),
        "area_m2": round(area, 2),
        "fill": round(area / rect, 4) if rect > 0 else 0.0,
    }


def _in_ring(x: float, y: float, ring: list[list[float]]) -> bool:
    inside = False
    n = len(ring)
    for i in range(n):
        (x1, y1), (x2, y2) = ring[i - 1][:2], ring[i][:2]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def _in_polygon(x: float, y: float, rings: list) -> bool:
    return _in_ring(x, y, rings[0]) and not any(_in_ring(x, y, h) for h in rings[1:])


def _bbox(rings: list) -> list[float]:
    xs = [p[0] for p in rings[0]]
    ys = [p[1] for p in rings[0]]
    return [min(xs), min(ys), max(xs), max(ys)]


def _deg_area(rings: list) -> float:
    pts = [tuple(p[:2]) for p in _open_ring(rings[0])]
    return _area(pts)


def _centre(ring: list[list[float]]) -> tuple[float, float]:
    pts = _open_ring(ring)
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def _dist_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    kx = M_PER_DEG * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * M_PER_DEG)


# --- precincts ----------------------------------------------------------------------


def precincts_query(tile: tuple[float, float, float, float]) -> str:
    s, w, n, e = tile
    b = f"({s:.6f},{w:.6f},{n:.6f},{e:.6f})"
    return (
        "[out:json][timeout:180];("
        f'node["place"~"^(suburb|neighbourhood|quarter)$"]["name"]{b};'
        f'way["landuse"="residential"]["name"]{b};'
        ");out geom tags;"
    )


def build_precincts(elements: list[dict]) -> list[dict]:
    """Named residential polygons and named place nodes as GeoJSON features (deduped)."""
    out: list[dict] = []
    seen: set[str] = set()
    for el in elements:
        tags = el.get("tags") or {}
        name = (tags.get("name") or "").strip()
        key = f"{el.get('type')}/{el.get('id')}"
        if not name or key in seen:
            continue
        if el.get("type") == "node" and tags.get("place") in ("suburb", "neighbourhood", "quarter"):
            geom = {"type": "Point", "coordinates": [round(el["lon"], 6), round(el["lat"], 6)]}
            kind = tags["place"]
        elif el.get("type") == "way" and tags.get("landuse") == "residential":
            pts = [[round(p["lon"], 6), round(p["lat"], 6)] for p in el.get("geometry") or [] if p]
            if len(pts) < 4 or pts[0] != pts[-1]:
                continue
            geom = {"type": "Polygon", "coordinates": [pts]}
            kind = "landuse_residential"
        else:
            continue
        seen.add(key)
        feat = {
            "type": "Feature",
            "properties": {"name": name, "kind": kind, "osm": key},
            "geometry": geom,
        }
        if geom["type"] == "Polygon":
            feat["bbox"] = _bbox(geom["coordinates"])
        out.append(feat)
    return out


def precinct_of(lon: float, lat: float, precincts: list[dict]) -> str | None:
    """Name of the smallest named polygon containing the point, else the nearest place node
    within 1500 m, else None."""
    best_area, best_name = None, None
    nearest_d, nearest_name = PLACE_RADIUS_M, None
    for f in precincts:
        g = f["geometry"]
        if g["type"] == "Polygon":
            w, s, e, n = f.get("bbox") or _bbox(g["coordinates"])
            if not (w <= lon <= e and s <= lat <= n):
                continue
            if _in_polygon(lon, lat, g["coordinates"]):
                a = _deg_area(g["coordinates"])
                if best_area is None or a < best_area:
                    best_area, best_name = a, f["properties"]["name"]
        elif g["type"] == "Point":
            d = _dist_m(lon, lat, *g["coordinates"])
            if d <= nearest_d:
                nearest_d, nearest_name = d, f["properties"]["name"]
    return best_name if best_name is not None else nearest_name


def fetch_precincts(bbox, step: float, max_requests: int | None) -> list[dict]:
    overpass.MAX_REQUESTS = max_requests
    elements: list[dict] = []
    for tile in bb.tiles(bbox, step):
        elements.extend(overpass.query(precincts_query(tile)).get("elements", []))
    return elements


# --- land use -----------------------------------------------------------------------


def _landuse_index(landcover: list[dict]) -> list[tuple]:
    """(bbox, rings, class, rank, area) for residential/commercial/industrial polygons."""
    out = []
    for f in landcover:
        p, g = f.get("properties") or {}, f.get("geometry") or {}
        if p.get("class") not in _LANDUSE_CLASSES or g.get("type") != "Polygon":
            continue
        rank = 0 if p.get("source") == "osm" else 1
        out.append(
            (
                _bbox(g["coordinates"]),
                g["coordinates"],
                p["class"],
                rank,
                _deg_area(g["coordinates"]),
            )
        )
    return out


def landuse_of(lon: float, lat: float, index: list[tuple]) -> str | None:
    """Class of the containing land-use polygon (OSM first, then the smallest)."""
    best = None
    for (w, s, e, n), rings, cls, rank, area in index:
        inside = w <= lon <= e and s <= lat <= n and _in_polygon(lon, lat, rings)
        if inside and (best is None or (rank, area) < best[0]):
            best = ((rank, area), cls)
    return best[1] if best else None


# --- rules --------------------------------------------------------------------------


def _override(fid: str, overrides: dict | None) -> str | None:
    if not overrides or fid not in overrides:
        return None
    entry = overrides[fid]
    arch = entry.get("archetype") if isinstance(entry, dict) else entry
    if arch not in ARCHETYPES:
        raise ValueError(f"archetype_overrides.json: {fid}: unknown archetype {arch!r}")
    return arch


def _rule8_shape(w: float, ln: float, precinct: str | None) -> tuple[str, str] | None:
    """Residential shape bands; length bands are half-open so 23 m matches one band only.
    Where superlink and semi_d overlap (width 11.5-11.8, length 22-23) the more specific
    superlink (it also needs a ridge precinct) is tried first."""
    if 5.5 <= w <= 7.5 and 13 <= ln < 23:
        return "link_intermediate", "shape"
    if 5.5 <= w <= 7.5 and 23 <= ln <= 26.5:
        return "link_long", "shape"
    if 10.2 <= w <= 11.8 and 19 <= ln <= 23 and precinct and _RIDGE.search(precinct):
        return "superlink", "shape+precinct"
    if 11.5 <= w <= 13.5 and 22 <= ln <= 26.5:
        return "semi_d", "shape"
    if 18 <= w <= 26 and ln >= 2.5 * w:
        return ("link_intermediate" if w < 23 else "link_long"), "shape"
    return None


def assign(
    props: dict,
    m: dict,
    precinct: str | None,
    landuse: str | None,
    height: float | None,
    *,
    overrides: dict | None = None,
    sample: dict | None = None,
) -> tuple[str, str]:
    """(archetype, method); first matching rule wins, otherwise ("generic", "generic").

    `height` is the OSM tag height. A valid `sample` (a Google height sample with coverage
    >= 0.5) can only make a building a highrise (>= 30 m) or veto a residential shape match
    (> 3x its storey height); it is display-only data."""
    arch = _override(props.get("id", ""), overrides)
    if arch:
        return arch, "override"
    osm = props.get("osm") or {}
    kind = props.get("kind")
    name = (props.get("name") or "").strip()
    building, amenity = osm.get("building"), osm.get("amenity")
    w, ln, area, fill = m["width_m"], m["length_m"], m["area_m2"], m["fill"]
    bungalow_size = 150 <= area <= 600 and fill >= 0.6

    if building == "mosque":
        if name.lower().startswith("surau"):
            return "generic", "generic"  # surau stay generic
        return "mosque", "osm_tag"
    if amenity == "place_of_worship" and osm.get("religion") == "muslim":
        if name and not name.lower().startswith("surau"):
            return "mosque", "osm_tag"
        return "generic", "generic"  # unnamed or surau
    if (
        building in ("school", "kindergarten")
        or amenity in ("school", "kindergarten")
        or _SCHOOL_NAME.match(name)
    ):
        return "school", "osm_tag"
    if kind == "industrial":
        return "factory", "osm_tag"
    if landuse == "industrial":
        return "factory", "landuse"
    if height is not None and (height >= 30 or (building == "apartments" and height >= 20)):
        return "highrise", "height"
    valid = (
        sample
        and isinstance(sample.get("height_m"), (int, float))
        and (sample.get("coverage") or 0) >= MIN_SAMPLE_COVERAGE
    )
    sample_h = float(sample["height_m"]) if valid else None
    if sample_h is not None and sample_h >= HIGHRISE_M:
        return "highrise", "height"
    if kind == "commercial" or landuse == "commercial":
        if area >= 4000:
            return "mall", "osm_tag+size"
        if 15 <= w <= 26 and ln >= 2.5 * w and fill >= 0.8:
            return "shop_office", "shape"
    if building in _DETACHED and bungalow_size:
        return "bungalow", "osm_tag"
    if building == "townhouse":
        return "townhouse", "osm_tag"
    if kind in ("residential", "other") and landuse == "residential" and fill >= 0.8:
        shaped = _rule8_shape(w, ln, precinct)
        if shaped:
            cap = OUTLIER_FACTOR * STOREY_HEIGHT_M[shaped[0]]
            too_tall = any(h is not None and h > cap for h in (height, sample_h))
            if building == "apartments" or too_tall:
                return "generic", "generic"
            return shaped
    if building == "house" and bungalow_size:
        return "bungalow", "osm_tag"
    return "generic", "generic"


# --- heights ------------------------------------------------------------------------


def _tag_height(props: dict) -> tuple[float, str] | None:
    """OSM tag height (osm_height, then osm_levels), surviving earlier runs of this script."""
    if props.get("osm_height_m") is not None:
        return float(props["osm_height_m"]), "osm_height"
    src = props.get("height_source")
    if src in ("osm_height", "osm_levels"):
        return float(props["height_m"]), src
    levels = bb._number((props.get("osm") or {}).get("building:levels"))
    if levels is not None and 0 < levels * bb.LEVEL_M <= bb.MAX_HEIGHT_M:
        return round(levels * bb.LEVEL_M, 2), "osm_levels"
    return None


def _default(props: dict) -> float:
    if props.get("height_source") == "default":
        return float(props["height_m"])
    return round(bb.default_height(props.get("kind", "other"), props["id"]), 2)


def final_height(props: dict, archetype: str, sample: dict | None) -> tuple[float, str]:
    """(height_m, height_source): google_3dtiles > osm_height > osm_levels > archetype_storeys >
    default. A sample over 3x the storey height of a low-rise archetype is an outlier."""
    if sample and isinstance(sample.get("height_m"), (int, float)):
        h = float(sample["height_m"])
        outlier = archetype in LOW_RISE and h > OUTLIER_FACTOR * STOREY_HEIGHT_M[archetype]
        if not outlier:
            return round(h, 2), "google_3dtiles"
    tag = _tag_height(props)
    if tag is not None:
        return tag
    if archetype in STOREY_HEIGHT_M:
        return STOREY_HEIGHT_M[archetype], "archetype_storeys"
    return _default(props), "default"


# --- transform and coverage ---------------------------------------------------------


def transform(
    features: list[dict],
    precincts: list[dict],
    landcover: list[dict],
    samples: dict,
    overrides: dict,
) -> list[dict]:
    """Enriched copies of the building features: precinct, archetype, method, final height.
    Ids and geometry are never changed; running it on its own output gives the same output."""
    index = _landuse_index(landcover)
    out = []
    for f in features:
        p = dict(f["properties"])
        ring = f["geometry"]["coordinates"][0]
        lon, lat = _centre(ring)
        if p.get("height_source") == "osm_height":
            p["osm_height_m"] = p["height_m"]
        precinct = precinct_of(lon, lat, precincts)
        p.pop("precinct", None)
        if precinct is not None:
            p["precinct"] = precinct
        tag = _tag_height(p)
        arch, method = assign(
            p,
            shape_metrics(ring),
            precinct,
            landuse_of(lon, lat, index),
            tag[0] if tag else None,
            overrides=overrides,
            sample=samples.get(p["id"]),
        )
        h, src = final_height(p, arch, samples.get(p["id"]))
        mn = float(p.get("min_height_m") or 0.0)
        if mn >= h:
            p["min_height_m"] = round(max(0.0, h - 0.5), 2)
        p.update(height_m=h, height_source=src, archetype=arch, archetype_method=method)
        out.append({**f, "properties": p})
    return out


def _row(feats: list[dict]) -> dict:
    archs: dict[str, int] = {}
    methods: dict[str, int] = {}
    for f in feats:
        p = f["properties"]
        archs[p["archetype"]] = archs.get(p["archetype"], 0) + 1
        methods[p["archetype_method"]] = methods.get(p["archetype_method"], 0) + 1
    n = len(feats)
    return {
        "count": n,
        "archetypes": dict(sorted(archs.items())),
        "generic_share": round(archs.get("generic", 0) / n, 3) if n else 0.0,
        "methods": dict(sorted(methods.items())),
    }


def coverage(features: list[dict]) -> dict:
    """Counts by archetype and method, and the generic share, overall and per precinct."""
    groups: dict[str | None, list[dict]] = {}
    for f in features:
        groups.setdefault(f["properties"].get("precinct"), []).append(f)
    names = sorted(k for k in groups if k is not None) + ([None] if None in groups else [])
    return {
        "total": _row(features),
        "precincts": [{"precinct": k, **_row(groups[k])} for k in names],
    }


def summary(cov: dict) -> str:
    t = cov["total"]
    lines = [f"buildings: {t['count']}  generic share: {t['generic_share']:.1%}"]
    lines.append("archetypes: " + ", ".join(f"{k} {v}" for k, v in t["archetypes"].items()))
    lines.append("methods: " + ", ".join(f"{k} {v}" for k, v in t["methods"].items()))
    for r in cov["precincts"]:
        top = sorted(r["archetypes"].items(), key=lambda kv: -kv[1])[:4]
        lines.append(
            f"  {r['precinct'] or '(no precinct)'}: {r['count']}  generic "
            f"{r['generic_share']:.1%}  " + ", ".join(f"{k} {v}" for k, v in top)
        )
    return "\n".join(lines)


# --- main ---------------------------------------------------------------------------


def _read_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--max-requests", type=int, default=None, help="hard cap on Overpass requests (precincts)"
    )
    ap.add_argument("--step", type=float, default=1.0, help="precinct tile size in degrees")
    ap.add_argument("--dry-run", action="store_true", help="compute and print, write nothing")
    args = ap.parse_args(argv)

    site_path = OUT / "site.json"
    site = json.loads(site_path.read_text(encoding="utf-8"))
    base = OUT / "base"
    buildings = json.loads((base / "buildings.geojson").read_text(encoding="utf-8"))["features"]
    landcover = _read_json(base / "landcover.geojson", {"features": []})["features"]
    samples = _read_json(base / "height_samples.json", {}).get("samples", {})
    overrides = _read_json(base / "archetype_overrides.json", {})
    ids = [f["properties"]["id"] for f in buildings]
    if len(set(ids)) != len(ids):
        print("duplicate building ids in buildings.geojson; nothing written")
        raise SystemExit(3)
    unknown = sorted(set(overrides) - set(ids))
    if unknown:
        print(f"WARNING: overrides for unknown building ids: {unknown}")
    if not any("osm" in f["properties"] for f in buildings):
        print("WARNING: buildings.geojson has no `osm` tags; re-run build_buildings.py first")

    home = site["scene"]["home"]
    bbox = bb.bbox_around(home["lon"], home["lat"], site["buildings"]["radius_m"])
    try:
        precincts = build_precincts(fetch_precincts(bbox, args.step, args.max_requests))
    except overpass.OverpassError as exc:
        print(f"BLOCKED: {exc}; overpass HTTP requests this run: {overpass.REQUESTS_MADE}")
        raise SystemExit(2) from None

    out = transform(buildings, precincts, landcover, samples, overrides)
    if [f["properties"]["id"] for f in out] != ids:  # ids are stable: signs attach to them
        print("building ids changed during the transform; nothing written")
        raise SystemExit(3)
    cov = coverage(out)
    print(f"precincts: {len(precincts)}  height samples: {len(samples)}")
    print(summary(cov))
    print(f"overpass HTTP requests this run: {overpass.REQUESTS_MADE}")
    if args.dry_run:
        print("dry run: nothing written")
        return

    b_text = bb._dump(out)
    if len(b_text.encode("utf-8")) > bb.MAX_BYTES:
        print(f"buildings.geojson would exceed {bb.MAX_BYTES} bytes; nothing written")
        raise SystemExit(3)
    today = date.today().isoformat()
    (base / "buildings.geojson").write_text(b_text, encoding="utf-8", newline="\n")
    (base / "precincts.geojson").write_text(bb._dump(precincts), encoding="utf-8", newline="\n")
    (base / "archetype_coverage.json").write_text(
        json.dumps({"as_of": today, **cov}, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    site["buildings"]["archetypes_as_of"] = today
    site_path.write_text(
        json.dumps(site, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )


if __name__ == "__main__":
    main()
