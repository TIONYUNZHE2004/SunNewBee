"""T-022: clean existing seed places and evacuation candidates without downloading data.

Run after the normal seed build: uv run python -m data.scripts.cleanup_places
The owner's outline is approximate; the 200 m margin is a scope rule, not a survey.
Walk edges, overlay facts, flood edge classes and scenario polygons are preserved.
"""

import argparse
import copy
import json
from pathlib import Path

from shapely.geometry import shape
from shapely.ops import unary_union
from townshiplens_spatial.geo import haversine_m

from data.scripts.build_boundary import to_m

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "data/seed/elmina"
MARGIN_M = 200.0
DUPLICATE_M = 150.0
PRISON = "osm-node-13514128863"
TOLL = "osm-way-390964557"
EVAC_TYPES = {"school", "community_centre", "place_of_worship"}
# The first five are control's name-based corrections, not newly checked OSM tags.
# NakNak's amenity=restaurant is present in the existing cached Overpass response.
TYPE_FIXES = {
    "osm-way-910761003": "kindergarten",
    "osm-node-4296547789": "tuition_centre",
    "osm-way-910378225": "residential",
    "osm-way-447246011": "pitch",
    "osm-way-781364799": "playground",
    "osm-way-1308938142": "restaurant",
}


def _load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path, value):
    options = {"separators": (",", ":")} if path.suffix == ".geojson" else {"indent": 1}
    path.write_text(json.dumps(value, ensure_ascii=False, **options) + "\n", encoding="utf-8")


def within_scope(feature, boundary_m):
    return boundary_m.distance(to_m(shape(feature["geometry"]))) <= MARGIN_M


def clean_places(features, boundary_m):
    """Keep a connected record first, then the lowest stable id, for named nearby duplicates.

    Keep the canonical record's own coordinates, node and claims together. Another record's
    snapped node is not a surveyed entrance. Removed ids and corrections go in the report.
    """
    kept, removed, merged, corrections = [], {}, {}, []
    for feature in sorted(
        copy.deepcopy(features),
        key=lambda f: (f["properties"].get("node_id") is None, f["properties"]["id"]),
    ):
        props = feature["properties"]
        pid = props["id"]
        if pid in TYPE_FIXES and props["type"] != TYPE_FIXES[pid]:
            corrections.append(
                {
                    "id": pid,
                    "name": props["name"],
                    "before": props["type"],
                    "after": TYPE_FIXES[pid],
                }
            )
            props["type"] = TYPE_FIXES[pid]
        if pid in (PRISON, TOLL):
            removed[pid] = "prison surau" if pid == PRISON else "toll plaza"
            continue
        if not within_scope(feature, boundary_m):
            removed[pid] = "outside boundary + 200 m"
            continue
        name = " ".join(props["name"].casefold().split())
        twin = next(
            (
                other
                for other in kept
                if name
                and "(unnamed, osm)" not in name
                and name == " ".join(other["properties"]["name"].casefold().split())
                and haversine_m(
                    feature["geometry"]["coordinates"], other["geometry"]["coordinates"]
                )
                < DUPLICATE_M
            ),
            None,
        )
        if twin is None:
            kept.append(feature)
        else:
            canonical = twin["properties"]["id"]
            merged[pid] = canonical
            removed[pid] = f"duplicate of {canonical}"
    return sorted(kept, key=lambda f: f["properties"]["id"]), removed, merged, corrections


def clean_centres(features, places, boundary_m, merged):
    by_id = {f["properties"]["id"]: f for f in places}
    kept, removed = {}, {}
    # Preserve an official source if it and an OSM candidate represent the same place.
    for feature in sorted(
        copy.deepcopy(features),
        key=lambda f: (f["properties"].get("source") != "official_pps", f["properties"]["id"]),
    ):
        props = feature["properties"]
        cid, original = props["id"], props["place_id"]
        pid = merged.get(original, original)
        place = by_id.get(pid)
        if original == PRISON:
            reason = "prison surau"
        elif not within_scope(feature, boundary_m):
            reason = "outside boundary + 200 m"
        elif place is None:
            reason = "place removed"
        elif place["properties"]["type"] not in EVAC_TYPES:
            reason = "corrected place type is not an evacuation candidate"
        elif pid in kept:
            reason = f"duplicate of {kept[pid]['properties']['id']}"
        else:
            if pid != original:
                props.update(
                    id=("pps-" if props["source"] == "official_pps" else "evc-") + pid,
                    place_id=pid,
                    node_id=place["properties"].get("node_id"),
                    node_inferred=place["properties"].get("node_inferred", False),
                )
                feature["geometry"] = copy.deepcopy(place["geometry"])
            kept[pid] = feature
            continue
        removed[cid] = reason
    return sorted(kept.values(), key=lambda f: f["properties"]["id"]), removed


def cleanup(data_dir):
    places_path = data_dir / "base/places.geojson"
    centres_path = data_dir / "flood/evac_centres.geojson"
    places, centres = _load(places_path), _load(centres_path)
    boundary = unary_union(
        [to_m(shape(f["geometry"])) for f in _load(data_dir / "base/boundary.geojson")["features"]]
    )
    before = {"places": len(places["features"]), "evacuation_candidates": len(centres["features"])}
    places["features"], removed, merged, corrections = clean_places(places["features"], boundary)
    centres["features"], removed_centres = clean_centres(
        centres["features"], places["features"], boundary, merged
    )
    # Drop stale place references, while retaining every edge assessment and scenario field.
    scenarios_path = data_dir / "flood/scenarios.json"
    scenarios = _load(scenarios_path)
    for classes in scenarios["place_classes"].values():
        for pid in removed:
            classes.pop(pid, None)
    coverage_path = data_dir / "flood/coverage.json"
    coverage = _load(coverage_path)
    for key in ("uncovered_places", "places_without_node"):
        coverage[key] = [pid for pid in coverage.get(key, []) if pid not in removed]
    coverage["places_snap_warnings"] = [
        row for row in coverage.get("places_snap_warnings", []) if row["id"] not in removed
    ]
    coverage["dropped_duplicate_centres"] = [
        row for row in coverage.get("dropped_duplicate_centres", []) if row[1] not in removed
    ]
    for path, value in (
        (places_path, places),
        (centres_path, centres),
        (scenarios_path, scenarios),
        (coverage_path, coverage),
    ):
        if _load(path) != value:
            _write(path, value)
    return {
        "boundary_margin_m": MARGIN_M,
        "duplicate_distance_m": DUPLICATE_M,
        "before": before,
        "after": {
            "places": len(places["features"]),
            "evacuation_candidates": len(centres["features"]),
        },
        "type_corrections": corrections,
        "merged_places": merged,
        "removed_places": removed,
        "removed_centres": removed_centres,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=SEED)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = cleanup(args.data_dir)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        _write(args.report, report)
    print(
        json.dumps({k: report[k] for k in ("before", "after", "type_corrections", "merged_places")})
    )


if __name__ == "__main__":
    main()
