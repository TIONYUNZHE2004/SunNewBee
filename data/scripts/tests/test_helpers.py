import json
from pathlib import Path

from data.scripts.build_overlay import add_existence_provenance, drop_duplicates, merge_claims
from data.scripts.import_osm import _claims, place_name

SEED = Path(__file__).resolve().parents[2] / "seed" / "elmina"


def _pt(pid, ptype, lon, lat):
    return {"properties": {"id": pid, "type": ptype}, "geometry": {"coordinates": [lon, lat]}}


def test_place_name_never_bare_type():
    assert place_name({}, "playground") == "Playground (unnamed, OSM)"
    assert place_name({"name": "Taman X"}, "park") == "Taman X"


def test_steps_default_provenance():
    c = _claims({"highway": "steps"}, "steps")["step_count"]
    assert c["value"] == 1 and c["evidence_type"] == "osm_highway_steps_default"
    c = _claims({"highway": "steps", "step_count": "3"}, "steps")["step_count"]
    assert c["evidence_type"] == "osm_import"


def test_drop_duplicates_same_type_within_radius():
    base = [
        _pt("a", "playground", 101.51053, 3.18077),
        _pt("b", "playground", 101.52, 3.19),
        _pt("c", "toilet", 101.51053, 3.18077),
    ]
    kept, removed = drop_duplicates(base, [_pt("playground", "playground", 101.51054, 3.18078)])
    assert removed == ["a"] and [k["properties"]["id"] for k in kept] == ["b", "c"]


def test_merge_claims_keeps_existing():
    merged = merge_claims(
        {"surface": {"value": "asphalt"}, "step_count": {"value": 9}}, {"step_count": {"value": 0}}
    )
    assert merged["surface"]["value"] == "asphalt" and merged["step_count"]["value"] == 0


def test_existence_regeneration_is_metadata_only_and_keeps_a_real_survey():
    import copy

    feature = {
        "properties": {"claims": {"seating": {"value": True}}},
        "geometry": {"type": "Point", "coordinates": [101.5, 3.18]},
    }
    original = copy.deepcopy(feature)
    assert add_existence_provenance([feature]) == 1
    existence = feature["properties"]["claims"].pop("existence")
    assert feature == original
    assert existence == {
        "value": True,
        "status": "unknown",
        "evidence_type": "team_survey_placeholder",
    }
    feature["properties"]["claims"]["existence"] = {
        "value": True,
        "status": "verified",
        "evidence_type": "field_survey",
    }
    assert add_existence_provenance([feature]) == 0
    assert feature["properties"]["claims"]["existence"]["evidence_type"] == "field_survey"


def test_seed_single_playground_near_hero():
    places = json.loads((SEED / "base" / "places.geojson").read_text(encoding="utf-8"))["features"]
    places += [
        f
        for f in json.loads((SEED / "access" / "overlay.geojson").read_text(encoding="utf-8"))[
            "features"
        ]
        if f["properties"]["kind"] == "place"
    ]
    near = [
        p
        for p in places
        if "playground" in p["properties"]["name"].lower()
        and abs(p["geometry"]["coordinates"][0] - 101.51053) < 0.0003
        and abs(p["geometry"]["coordinates"][1] - 3.18077) < 0.0003
    ]
    assert len(near) == 1
    assert all(p["properties"]["name"] != "Playground" for p in places)
