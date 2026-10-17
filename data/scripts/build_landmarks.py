"""Landmarks for the stylised city, placed from OSM matches.

Writes data/seed/elmina/base/landmarks.geojson: the matched building footprint of each named
landmark, with the bespoke model to draw. A landmark is placed only on a real OSM footprint:
first a building whose name matches, else an OSM POI whose name matches (containing footprint,
else the nearest within 30 m). Never invents a footprint: an unplaced landmark gets no feature
and is reported. Display only: routing, evaluation, flood and answers never read this file.
Overpass goes through data/scripts/overpass.py (cache, backoff, request cap).
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.scripts import overpass  # noqa: E402
from data.scripts.build_buildings import _dump, bbox_around  # noqa: E402
from data.scripts.build_signage import _point, attach  # noqa: E402

OUT = ROOT / "data" / "seed" / "elmina"
POI_MAX_M = 30.0

LANDMARKS = [
    {
        "id": "kanopi-residences",
        "name": "Kanopi Residences",
        "model": "kanopi",
        "match": r"kanopi",
        "info_url": "https://www.simedarbyproperty.com/city-of-elmina/elmina-city-centre/kanopi-residences/",
    },
    {
        "id": "elmina-lakeside-mall",
        "name": "Elmina Lakeside Mall",
        "model": "lakeside_mall",
        "match": r"elmina lakeside mall",
        "info_url": "https://www.starproperty.my/news/sdp-launches-elmina-lakeside-mall/130902",
    },
    {
        "id": "masjid-denai-alam",
        "name": "Masjid Denai Alam",
        "model": "masjid_denai_alam",
        "match": r"masjid\s+denai\s+alam",
        "info_url": None,
    },
]


def landmark_query(bbox: tuple[float, float, float, float]) -> str:
    s, w, n, e = bbox
    names = "|".join(spec["match"] for spec in LANDMARKS)
    return (
        f'[out:json][timeout:180];nwr[name~"{names}",i]({s:.6f},{w:.6f},{n:.6f},{e:.6f});'
        "out center tags;"
    )


def _result(spec: dict, building: dict, osm: str, as_of: str | None = None) -> dict:
    kind, oid = osm.split("/")
    return {
        "type": "Feature",
        "properties": {
            "id": spec["id"],
            "name": spec["name"],
            "model": spec["model"],
            "building_id": building["properties"]["id"],
            "osm": osm,
            "source_url": f"https://www.openstreetmap.org/{kind}/{oid}",
            "info_url": spec["info_url"],
            "as_of": as_of,
        },
        "geometry": building["geometry"],
    }


def resolve(spec: dict, buildings: list[dict], pois: list[dict]) -> dict | None:
    """Feature for the landmark, or None. as_of is stamped by build_landmarks."""
    rx = re.compile(spec["match"], re.I)
    for b in sorted(buildings, key=lambda b: b["properties"]["id"]):
        if rx.search(b["properties"].get("name") or ""):
            bid = b["properties"]["id"]
            return _result(spec, b, f"way/{bid[1:]}" if bid[:1] == "w" else bid)
    by_id = {b["properties"]["id"]: b for b in buildings}
    for el in sorted(pois, key=lambda e: (e.get("id", 0), e.get("type", ""))):
        if el.get("type") not in ("node", "way", "relation"):
            continue
        if not rx.search((el.get("tags") or {}).get("name") or ""):
            continue
        pt = _point(el)
        bid = attach(pt, buildings, POI_MAX_M) if pt else None
        if bid is not None:
            return _result(spec, by_id[bid], f"{el['type']}/{el['id']}")
    return None


def build_landmarks(
    specs: list[dict], buildings: list[dict], pois: list[dict], as_of: str
) -> tuple[list[dict], list[str]]:
    feats, unplaced = [], []
    for spec in specs:
        f = resolve(spec, buildings, pois)
        if f is None:
            unplaced.append(spec["id"])
            continue
        f["properties"]["as_of"] = as_of
        feats.append(f)
    return feats, unplaced


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-requests", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true", help="print the plan, make no request")
    args = ap.parse_args(argv)

    site = json.loads((OUT / "site.json").read_text(encoding="utf-8"))
    home = site["scene"]["home"]
    bbox = bbox_around(home["lon"], home["lat"], site["buildings"]["radius_m"])
    if args.dry_run:
        print(f"bbox {bbox}; 1 Overpass request; no fetch")
        return
    path = OUT / "base" / "buildings.geojson"
    buildings = json.loads(path.read_text(encoding="utf-8"))["features"]
    overpass.MAX_REQUESTS = args.max_requests
    try:
        pois = overpass.query(landmark_query(bbox)).get("elements", [])
    except overpass.OverpassError as exc:
        print(f"BLOCKED: {exc}; overpass HTTP requests this run: {overpass.REQUESTS_MADE}")
        raise SystemExit(2) from None
    feats, unplaced = build_landmarks(LANDMARKS, buildings, pois, date.today().isoformat())
    (OUT / "base" / "landmarks.geojson").write_text(_dump(feats), encoding="utf-8", newline="\n")
    print(f"placed: {[f['properties']['id'] for f in feats]}")
    print(f"unplaced: {unplaced}")
    print(f"overpass HTTP requests this run: {overpass.REQUESTS_MADE}")


if __name__ == "__main__":
    main()
