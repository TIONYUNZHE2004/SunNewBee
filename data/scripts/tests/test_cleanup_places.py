"""T-022: scope, identity and flood references survive offline place cleanup."""

import json

from shapely.geometry import Point, box, mapping

from data.scripts.build_boundary import to_deg, to_m
from data.scripts.cleanup_places import clean_centres, clean_places, cleanup, within_scope


def _place(pid, name, x=0, y=0, typ="school", node="n-a"):
    origin = to_m(Point(101.5, 3.18))
    return {
        "type": "Feature",
        "geometry": mapping(to_deg(Point(origin.x + x, origin.y + y))),
        "properties": {"id": pid, "name": name, "type": typ, "node_id": node, "claims": {}},
    }


BOUNDARY = to_m(box(101.49, 3.17, 101.5, 3.19))


def test_scope_uses_metres_and_polygon_distance_including_margin():
    assert within_scope(_place("inside", "School", -100), BOUNDARY)
    assert within_scope(_place("edge", "School", 0), BOUNDARY)
    assert within_scope(_place("margin", "School", 199), BOUNDARY)
    assert not within_scope(_place("outside", "School", 201), BOUNDARY)
    hole = to_m(box(101.48, 3.16, 101.52, 3.20)).difference(to_m(box(101.49, 3.17, 101.51, 3.19)))
    assert not within_scope(_place("hole", "School"), hole)


def test_duplicates_keep_connected_identity_and_do_not_merge_distant_or_unnamed_places():
    features = [
        _place("osm-node-1", "Dewan Test", -100, node=None),
        _place("osm-way-2", "  DEWAN   TEST ", -110),
        _place("osm-way-3", "Dewan Test", -400),
        _place("osm-way-4", "School (unnamed, OSM)", -100),
        _place("osm-way-5", "School (unnamed, OSM)", -105),
    ]
    kept, removed, merged, _ = clean_places(features, BOUNDARY)
    assert {f["properties"]["id"] for f in kept} == {
        "osm-way-2",
        "osm-way-3",
        "osm-way-4",
        "osm-way-5",
    }
    assert merged == {"osm-node-1": "osm-way-2"}
    assert removed["osm-node-1"] == "duplicate of osm-way-2"
    assert features[0]["properties"]["node_id"] is None


def _centre(place, source="osm_candidate"):
    return {
        "type": "Feature",
        "geometry": place["geometry"],
        "properties": {
            "id": f"evc-{place['properties']['id']}",
            "place_id": place["properties"]["id"],
            "name": place["properties"]["name"],
            "node_id": place["properties"]["node_id"],
            "source": source,
        },
    }


def test_centre_dedup_preserves_official_source_and_remaps_its_own_place():
    a, b = _place("a", "Dewan", -100), _place("b", "Dewan", -110)
    corrected = _place("tuition", "Tuition centre", -100, typ="tuition_centre")
    kept, removed = clean_centres(
        [_centre(a), _centre(b, "official_pps"), _centre(corrected)],
        [a, corrected],
        BOUNDARY,
        {"b": "a"},
    )
    assert len(kept) == 1
    assert kept[0]["properties"]["source"] == "official_pps"
    assert kept[0]["properties"]["place_id"] == "a"
    assert kept[0]["geometry"] == a["geometry"]
    assert removed["evc-tuition"] == "corrected place type is not an evacuation candidate"


def test_cleanup_prunes_place_references_preserves_edges_and_is_idempotent(tmp_path):
    inside = _place("inside", "School", -100)
    outside = _place("outside", "Other school", 201)
    scenarios = {
        "scenarios": [{"id": "stage_p1m", "disclaimer": "indicative"}],
        "edge_classes": {"stage_p1m": {"edge": "possible"}},
        "place_classes": {"stage_p1m": {"inside": "possible", "outside": "likely_flooded"}},
    }
    files = {
        "base/boundary.geojson": {"features": [{"geometry": mapping(to_deg(BOUNDARY))}]},
        "base/places.geojson": {"features": [inside, outside]},
        "flood/evac_centres.geojson": {"features": [_centre(inside), _centre(outside)]},
        "flood/scenarios.json": scenarios,
        "flood/coverage.json": {
            "uncovered_edges": ["edge"],
            "uncovered_places": ["outside"],
            "places_without_node": ["outside"],
            "places_snap_warnings": [{"id": "outside", "warning": "unmapped"}],
        },
    }
    for name, value in files.items():
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))
    walk = tmp_path / "base/walk.geojson"
    walk.write_text("walk graph must stay unchanged")
    report = cleanup(tmp_path)
    assert report["before"] == {"places": 2, "evacuation_candidates": 2}
    assert report["after"] == {"places": 1, "evacuation_candidates": 1}
    after = json.loads((tmp_path / "flood/scenarios.json").read_text())
    assert after["edge_classes"] == scenarios["edge_classes"]
    assert after["scenarios"] == scenarios["scenarios"]
    assert after["place_classes"] == {"stage_p1m": {"inside": "possible"}}
    assert walk.read_text() == "walk graph must stay unchanged"
    hashes = {p: p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    assert cleanup(tmp_path)["removed_places"] == {}
    assert all(p.read_bytes() == content for p, content in hashes.items())
