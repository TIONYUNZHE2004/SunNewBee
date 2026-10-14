"""Placeholder waste points for the waste lens (replaced by the field survey).

OSM amenity=recycling|waste_basket from base/places.geojson within the analysis area, plus
hand-listed SDP programme sites that get coordinates ONLY when the exact name exists in OSM.
All points are status "unknown" (the OSM import does not carry check_date).

Usage: uv run python data/scripts/build_waste.py [--data-dir data/seed/elmina]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = ROOT / "data" / "seed" / "elmina"
AREA = (101.460, 3.150, 101.560, 3.240)  # w, s, e, n (same as build_flood.AREA)
MAX_POINTS = 10
OSM_TYPES = {"recycling": "recycling_drop_off", "waste_basket": "bin"}
# (display name, exact OSM names that locate it); skipped when no OSM name matches.
PROGRAMME_SITES = [
    (
        "Central Park community garden (programme site)",
        ["Elmina Valley Central Park", "Elmina Central Park", "Central Park"],
    ),
    ("Elmina Rainforest Knowledge Centre (programme site)", ["Elmina Rainforest Knowledge Centre"]),
]


def _osm_url(place_id: str) -> str | None:
    parts = place_id.split("-")  # osm-<node|way|relation>-<id>
    if len(parts) == 3 and parts[0] == "osm" and parts[1] in ("node", "way", "relation"):
        return f"https://www.openstreetmap.org/{parts[1]}/{parts[2]}"
    return None


def _in_area(c) -> bool:
    w, s, e, n = AREA
    return w <= c[0] <= e and s <= c[1] <= n


def waste_points(places: list[dict]) -> list[dict]:
    from townshiplens_spatial.models import WastePoint

    pts: list[WastePoint] = []
    by_name = {f["properties"].get("name"): f for f in places}
    for label, names in PROGRAMME_SITES:
        f = next((by_name[n] for n in names if n in by_name), None)
        if f is None:
            print(f"[waste] programme site skipped (no exact OSM name): {label}")
            continue
        pid = f["properties"]["id"]
        pts.append(
            WastePoint(
                id=f"wp-prog-{pid}",
                name=label,
                type="programme_site",
                coord=f["geometry"]["coordinates"][:2],
                source_url=_osm_url(pid),
            )
        )
    osm = sorted(
        (
            f
            for f in places
            if f["properties"].get("type") in OSM_TYPES and _in_area(f["geometry"]["coordinates"])
        ),
        key=lambda f: (f["properties"]["type"] != "recycling", f["properties"]["id"]),
    )
    for f in osm:
        p = f["properties"]
        pts.append(
            WastePoint(
                id=f"wp-{p['id']}",
                name=p.get("name") or "Waste point",
                type=OSM_TYPES[p["type"]],
                coord=f["geometry"]["coordinates"][:2],
                source_url=_osm_url(p["id"]),
            )
        )
    return [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(v, 6) for v in w.coord]},
            "properties": w.model_dump(exclude={"coord"}, exclude_none=True),
        }
        for w in pts[:MAX_POINTS]
    ]


def build_waste(data_dir: Path) -> list[dict] | None:
    places_p = data_dir / "base/places.geojson"
    if not places_p.exists():
        print(f"[waste] base layers missing; run import_osm.py first ({places_p}). Skipping.")
        return None
    feats = waste_points(json.loads(places_p.read_text())["features"])
    out = data_dir / "waste/points.geojson"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False, indent=1)
        + "\n"
    )
    print(f"[waste] {len(feats)} placeholder points -> {out}")
    return feats


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    build_waste(ap.parse_args(argv).data_dir.resolve())
    return 0


if __name__ == "__main__":
    sys.exit(main())
