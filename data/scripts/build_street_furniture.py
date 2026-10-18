"""Fact-bearing street furniture for the stylised city (display only).

Writes data/seed/elmina/base/street_furniture.geojson: one Point per OSM traffic signal, bus stop /
platform, shelter, bench and picnic table inside the Elmina outline (base/boundary.geojson), and
records it in site.json under `street_furniture`. A way is reduced to its centre point. The id is
the stable source id `osm-node-<id>` / `osm-way-<id>`; features are sorted by id. Crossings are not
here (they come from walk.geojson `crossing` edges). Routing, evaluation, flood and answers never
read this file. One Overpass query through data/scripts/overpass.py (cache, backoff, request cap).
"""

import argparse
import json
import math
import sys
from pathlib import Path

from shapely.geometry import Point, shape

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.scripts import overpass  # noqa: E402
from data.scripts.build_buildings import M_PER_DEG, _dump  # noqa: E402
from data.scripts.build_signage import _point  # noqa: E402

OUT = ROOT / "data" / "seed" / "elmina"
KINDS = ("traffic_signals", "bus_stop", "shelter", "bench", "picnic_table")
TAG_KEYS = (
    "highway",
    "public_transport",
    "bus",
    "amenity",
    "leisure",
    "shelter_type",
    "bench",
    "backrest",
    "covered",
    "material",
    "seats",
    "crossing",
    "ref",
)
DEDUP_M = 10.0
# seed place `type` -> street-furniture kind it can be drawn as (coordinator ruling for B-T7)
PLACE_KIND = {"shelter": "shelter", "seating": "bench"}
# a seed place is a duplicate of an OSM feature of a compatible kind
COMPAT = {"bench": {"bench", "picnic_table"}, "shelter": {"shelter", "bus_stop"}}


def furniture_query(bbox: tuple[float, float, float, float]) -> str:
    s, w, n, e = bbox
    b = f"({s:.6f},{w:.6f},{n:.6f},{e:.6f})"
    sel = (
        "[highway=traffic_signals]",
        "[highway=bus_stop]",
        "[public_transport=platform]",
        "[amenity=bench]",
        "[leisure=picnic_table]",
        "[amenity=shelter]",
    )
    parts = "".join(f"{kind}{x}{b};" for x in sel for kind in ("node", "way"))
    return f"[out:json][timeout:180];({parts});out center tags;"


def kind_of(tags: dict) -> str | None:
    if tags.get("highway") == "traffic_signals":
        return "traffic_signals"
    if tags.get("highway") == "bus_stop" or tags.get("public_transport") == "platform":
        return "bus_stop"
    if tags.get("amenity") == "shelter":
        return "shelter"
    if tags.get("amenity") == "bench":
        return "bench"
    if tags.get("leisure") == "picnic_table":
        return "picnic_table"
    return None


def build_features(elements: list[dict], boundary) -> tuple[list[dict], dict]:
    """Point features inside `boundary` (shapely polygon, lon/lat), unique ids, sorted by id."""
    stats = {"outside": 0, "no_kind": 0, "no_point": 0, "duplicate": 0}
    by_id: dict[str, dict] = {}
    for el in elements:
        if el.get("type") not in ("node", "way") or el.get("id") is None:
            continue
        sid = f"osm-{el['type']}-{el['id']}"
        if sid in by_id:
            stats["duplicate"] += 1
            continue
        tags = el.get("tags", {})
        kind = kind_of(tags)
        if kind is None:
            stats["no_kind"] += 1
            continue
        pt = _point(el)
        if pt is None:
            stats["no_point"] += 1
            continue
        if not boundary.covers(Point(pt)):
            stats["outside"] += 1
            continue
        props: dict = {"id": sid, "kind": kind}
        name = " ".join(str(tags.get("name", "")).split())
        if name:
            props["name"] = name
        props["osm_tags"] = {k: tags[k] for k in TAG_KEYS if k in tags}
        by_id[sid] = {
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "Point", "coordinates": [round(pt[0], 7), round(pt[1], 7)]},
        }
    return [by_id[k] for k in sorted(by_id)], stats


def _dist_m(a, b) -> float:
    kx = M_PER_DEG * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * M_PER_DEG)


def seed_places(places: list[dict]) -> list[dict]:
    """Seed places (base/places.geojson features) that can be drawn as street furniture, as
    furniture-shaped features with source `seed_place`."""
    out = []
    for f in places:
        kind = PLACE_KIND.get(f["properties"].get("type"))
        if kind is None or f["geometry"]["type"] != "Point":
            continue
        out.append(
            {
                "type": "Feature",
                "properties": {"id": f["properties"]["id"], "kind": kind, "source": "seed_place"},
                "geometry": f["geometry"],
            }
        )
    return out


def coincident(place: dict, furniture: list[dict], dist_m: float = DEDUP_M) -> bool:
    """True when the (furniture-shaped) seed place has the id of, or lies within dist_m of, an OSM
    feature of a compatible kind."""
    pid, kind = place["properties"]["id"], place["properties"]["kind"]
    return any(
        f["properties"]["id"] == pid
        or (
            f["properties"]["kind"] in COMPAT[kind]
            and _dist_m(f["geometry"]["coordinates"], place["geometry"]["coordinates"]) <= dist_m
        )
        for f in furniture
    )


def union_dedup(furniture: list[dict], places: list[dict], dist_m: float = DEDUP_M) -> list[dict]:
    """OSM street furniture plus the seed places that coincide with none of it, sorted by id."""
    extra = [p for p in seed_places(places) if not coincident(p, furniture, dist_m)]
    return sorted(furniture + extra, key=lambda f: f["properties"]["id"])


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-requests", type=int, default=3)
    args = ap.parse_args(argv)
    overpass.MAX_REQUESTS = args.max_requests
    site_path = OUT / "site.json"
    site = json.loads(site_path.read_text(encoding="utf-8"))
    boundary_fc = json.loads((OUT / "base" / "boundary.geojson").read_text(encoding="utf-8"))
    boundary = shape(boundary_fc["features"][0]["geometry"])
    w, s, e, n = boundary.bounds
    ql = furniture_query((s, w, n, e))
    try:
        elements, as_of = overpass.fetch_elements([ql])
    except overpass.OverpassError as exc:
        print(f"BLOCKED: {exc}; overpass HTTP requests this run: {overpass.REQUESTS_MADE}")
        raise SystemExit(2) from None
    if as_of is None:
        print("no OSM data date in the Overpass answer; nothing written")
        raise SystemExit(3)
    feats, stats = build_features(elements, boundary)
    counts = {k: sum(1 for f in feats if f["properties"]["kind"] == k) for k in KINDS}
    (OUT / "base" / "street_furniture.geojson").write_text(
        _dump(feats), encoding="utf-8", newline="\n"
    )
    site["street_furniture"] = {
        "file": "base/street_furniture.geojson",
        "count": len(feats),
        "counts": counts,
        "as_of": as_of,
        "source": "OpenStreetMap contributors (ODbL)",
    }
    site_path.write_text(
        json.dumps(site, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
    )
    print(f"street furniture: {len(feats)} {counts} dropped {stats}")
    print(f"overpass HTTP requests this run: {overpass.REQUESTS_MADE}")


if __name__ == "__main__":
    main()
