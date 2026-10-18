"""Sourced, text-only signage for the stylised city, from OSM names.

Writes data/seed/elmina/base/signage.geojson: one Point per real shop / amenity / office name,
attached to a building by id. Honesty rules (ADR 0013): the text is the OSM `name`, else `brand`,
verbatim (whitespace collapsed); no logos; every sign carries `source_url` and `as_of`. Mapper
notes ("Only seen in Google Maps. Not OSV.", "Clinic (unnamed, OSM)", fixme, todo, "?") and
tourism=information boards and street furniture are never signs. Display only: routing,
evaluation, flood and answers never read this file.
Overpass goes through data/scripts/overpass.py (cache, backoff, request cap).
"""

import argparse
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.scripts import overpass  # noqa: E402
from data.scripts.build_buildings import M_PER_DEG, _dump, bbox_around, tiles  # noqa: E402

OUT = ROOT / "data" / "seed" / "elmina"
MAX_PER_BUILDING = 4
ATTACH_MAX_M = 25.0
POI_KEYS = "shop|amenity|office|leisure|tourism|craft|healthcare"
# Mapper notes, never signs. Each alternative is a note marker, not a word a real business uses.
# "todo" matches as a whole word only, so names that merely contain those letters survive.
JUNK = re.compile(r"unnamed|not osv|google maps|fixme|\btodo\b|\?|^\W*$", re.I)
# Not a business or place name (ADR 0013): boards and street furniture never carry a shop sign.
NON_BUSINESS = {
    "amenity": {
        "parking",
        "bench",
        "toilets",
        "waste_basket",
        "bicycle_parking",
        "shelter",
        "drinking_water",
        "fountain",
        "playground",
    },
    "leisure": {"pitch", "playground"},
}


def signage_query(tile: tuple[float, float, float, float]) -> str:
    s, w, n, e = tile
    b = f"({s:.6f},{w:.6f},{n:.6f},{e:.6f})"
    keys = f'[~"^({POI_KEYS})$"~"."]'
    parts = "".join(
        f"{kind}{keys}[{tag}]{b};" for kind in ("node", "way") for tag in ("name", "brand")
    )
    return f"[out:json][timeout:180];({parts});out center tags;"


def sign_text(tags: dict) -> str | None:
    """Verbatim OSM name, else brand; None for blank text, a mapper note or a non-business tag."""
    if tags.get("tourism") == "information":
        return None  # boards, guideposts, maps
    if any(tags.get(k) in vals for k, vals in NON_BUSINESS.items()):
        return None
    for key in ("name", "brand"):
        raw = tags.get(key)
        if raw is None:
            continue
        text = " ".join(str(raw).split())
        if not text:
            continue  # blank name: fall back to brand
        return None if JUNK.search(text) else text
    return None


def _inside(p, ring) -> bool:
    x, y = p
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:], strict=False):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def _edge_dist(p, ring) -> float:
    px, py = p
    best = math.inf
    for (x1, y1), (x2, y2) in zip(ring, ring[1:], strict=False):
        dx, dy = x2 - x1, y2 - y1
        length2 = dx * dx + dy * dy
        t = 0.0 if length2 == 0 else max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / length2))
        best = min(best, math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)))
    return best


def attach(
    pt: tuple[float, float], buildings: list[dict], max_m: float = ATTACH_MAX_M
) -> str | None:
    """Id of the footprint containing pt (lon, lat), else the nearest within max_m metres."""
    lon0, lat0 = pt
    kx = M_PER_DEG * math.cos(math.radians(lat0))
    best_id, best_d = None, max_m
    for b in buildings:
        ring = [
            ((x - lon0) * kx, (y - lat0) * M_PER_DEG) for x, y in b["geometry"]["coordinates"][0]
        ]
        xs = [c[0] for c in ring]
        ys = [c[1] for c in ring]
        if min(xs) > max_m or max(xs) < -max_m or min(ys) > max_m or max(ys) < -max_m:
            continue
        if _inside((0.0, 0.0), ring):
            return b["properties"]["id"]
        d = _edge_dist((0.0, 0.0), ring)
        if d <= best_d:
            best_id, best_d = b["properties"]["id"], d
    return best_id


def _point(el: dict) -> tuple[float, float] | None:
    if el.get("type") == "node" and "lon" in el and "lat" in el:
        return el["lon"], el["lat"]
    c = el.get("center")
    return (c["lon"], c["lat"]) if c else None


def build_signs(elements, buildings: list[dict], as_of: str) -> tuple[list[dict], dict]:
    stats = {"kept": 0, "junk": 0, "unattached": 0, "capped": 0}
    seen: set[tuple[str, int]] = set()
    uniq = []
    for el in elements:
        key = (el.get("type"), el.get("id"))
        if key in seen or el.get("type") not in ("node", "way") or el.get("id") is None:
            continue
        seen.add(key)
        uniq.append(el)
    uniq.sort(key=lambda e: (e["id"], e["type"]))  # OSM id order decides who wins the cap
    per_building: dict[str, int] = {}
    feats = []
    for el in uniq:
        text = sign_text(el.get("tags") or {})
        if text is None:
            stats["junk"] += 1
            continue
        pt = _point(el)
        bid = attach(pt, buildings) if pt else None
        if pt is None or bid is None:
            stats["unattached"] += 1
            continue
        if per_building.get(bid, 0) >= MAX_PER_BUILDING:
            stats["capped"] += 1
            continue
        per_building[bid] = per_building.get(bid, 0) + 1
        kind, oid = el["type"], el["id"]
        feats.append(
            {
                "type": "Feature",
                "properties": {
                    "id": f"sign-{kind[0]}{oid}",
                    "text": text,
                    "building_id": bid,
                    "osm": f"{kind}/{oid}",
                    "source_url": f"https://www.openstreetmap.org/{kind}/{oid}",
                    "source_label": "OpenStreetMap",
                    "as_of": as_of,
                },
                "geometry": {"type": "Point", "coordinates": [round(pt[0], 7), round(pt[1], 7)]},
            }
        )
        stats["kept"] += 1
    return feats, stats


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-requests", type=int, default=None)
    ap.add_argument("--step", type=float, default=0.02, help="tile size in degrees")
    ap.add_argument("--dry-run", action="store_true", help="print the plan, make no request")
    args = ap.parse_args(argv)

    site = json.loads((OUT / "site.json").read_text(encoding="utf-8"))
    home = site["scene"]["home"]
    bbox = bbox_around(home["lon"], home["lat"], site["buildings"]["radius_m"])
    if args.dry_run:
        print(f"bbox {bbox}; {len(tiles(bbox, args.step))} Overpass tile request(s); no fetch")
        return
    path = OUT / "base" / "buildings.geojson"
    buildings = json.loads(path.read_text(encoding="utf-8"))["features"]
    overpass.MAX_REQUESTS = args.max_requests
    try:
        elements, as_of = overpass.fetch_elements(signage_query(t) for t in tiles(bbox, args.step))
    except overpass.OverpassError as exc:
        print(f"BLOCKED: {exc}; overpass HTTP requests this run: {overpass.REQUESTS_MADE}")
        raise SystemExit(2) from None
    if as_of is None:
        print("no OSM data date in the Overpass answers; nothing written")
        raise SystemExit(3)
    feats, stats = build_signs(elements, buildings, as_of)
    (OUT / "base" / "signage.geojson").write_text(_dump(feats), encoding="utf-8", newline="\n")
    print(f"signs: {stats}")
    print(f"overpass HTTP requests this run: {overpass.REQUESTS_MADE}")


if __name__ == "__main__":
    main()
