"""B-T6: street furniture is one Point per OSM feature, inside the outline, valid and stable."""

import json
import math
from pathlib import Path

import pytest
from shapely.geometry import Point, shape

from data.scripts.build_street_furniture import (
    KINDS,
    build_features,
    furniture_query,
    kind_of,
    union_dedup,
)

ROOT = Path(__file__).resolve().parents[3]
SEED = ROOT / "data" / "seed" / "elmina"
FILE = SEED / "base" / "street_furniture.geojson"

seed_only = pytest.mark.skipif(not FILE.exists(), reason="street furniture seed missing")


def _fc(path):
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def _node(i, lon, lat, **tags):
    return {"type": "node", "id": i, "lon": lon, "lat": lat, "tags": tags}


BOX = shape({"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]})


def test_kind_of():
    assert kind_of({"highway": "traffic_signals"}) == "traffic_signals"
    assert kind_of({"highway": "bus_stop", "public_transport": "platform"}) == "bus_stop"
    assert kind_of({"public_transport": "platform"}) == "bus_stop"
    assert kind_of({"amenity": "shelter"}) == "shelter"
    assert kind_of({"amenity": "bench"}) == "bench"
    assert kind_of({"leisure": "picnic_table"}) == "picnic_table"
    assert kind_of({"amenity": "cafe"}) is None


def test_build_features_filters_and_sorts():
    way = {
        "type": "way",
        "id": 4,
        "center": {"lon": 0.4, "lat": 0.4},
        "tags": {"amenity": "shelter"},
    }
    els = [
        _node(9, 0.5, 0.5, amenity="bench"),
        _node(2, 5, 5, amenity="bench"),  # outside
        _node(3, 0.2, 0.2, shop="x"),  # no kind
        way,
        _node(9, 0.5, 0.5, amenity="bench"),  # duplicate
    ]
    feats, stats = build_features(els, BOX)
    assert [f["properties"]["id"] for f in feats] == ["osm-node-9", "osm-way-4"]
    assert feats[1]["geometry"]["type"] == "Point"
    assert stats["outside"] == 1 and stats["no_kind"] == 1 and stats["duplicate"] == 1


def test_query_lists_every_selector():
    q = furniture_query((0, 0, 1, 1))
    for sel in ("traffic_signals", "bus_stop", "platform", "bench", "picnic_table", "shelter"):
        assert sel in q


def test_union_dedup_by_id_and_proximity():
    osm = [
        {
            "type": "Feature",
            "properties": {"id": "osm-node-1", "kind": "bench"},
            "geometry": {"type": "Point", "coordinates": [101.5, 3.18]},
        }
    ]

    def place(pid, typ, dlon):
        return {
            "type": "Feature",
            "properties": {"id": pid, "type": typ},
            "geometry": {"type": "Point", "coordinates": [101.5 + dlon, 3.18]},
        }

    places = [
        place("osm-node-1", "seating", 0.0),  # same id
        place("p-near", "seating", 0.00003),  # ~3 m
        place("p-far", "seating", 0.001),  # ~110 m
        place("p-shelter", "shelter", 0.00003),  # shelter vs bench: not compatible
        place("p-clinic", "clinic", 0.0),  # not furniture
    ]
    out = union_dedup(osm, places)
    assert [f["properties"]["id"] for f in out] == ["osm-node-1", "p-far", "p-shelter"]


def test_union_dedup_filters_seed_places_by_the_boundary():
    """B-T7 carry-over: a seed place outside the outline is never added (>= 5 seed shelters lie
    outside the Elmina boundary)."""
    box = shape(
        {
            "type": "Polygon",
            "coordinates": [[[101.0, 3.0], [101.6, 3.0], [101.6, 3.3], [101.0, 3.3], [101.0, 3.0]]],
        }
    )
    places = [
        {
            "type": "Feature",
            "properties": {"id": pid, "type": "shelter"},
            "geometry": {"type": "Point", "coordinates": [lon, 3.18]},
        }
        for pid, lon in (("in", 101.5), ("out", 101.7))
    ]
    assert [f["properties"]["id"] for f in union_dedup([], places)] == ["in", "out"]
    out = union_dedup([], places, boundary=box)
    assert [f["properties"]["id"] for f in out] == ["in"]
    assert out[0]["properties"]["source"] == "seed_place"


@seed_only
def test_seed_inside_boundary_unique_valid_sorted():
    boundary = shape(_fc(SEED / "base" / "boundary.geojson")[0]["geometry"])
    feats = _fc(FILE)
    assert feats
    ids = [f["properties"]["id"] for f in feats]
    assert len(ids) == len(set(ids)) and ids == sorted(ids)
    for f in feats:
        p = f["properties"]
        assert p["kind"] in KINDS
        assert p["id"].startswith(("osm-node-", "osm-way-"))
        assert f["geometry"]["type"] == "Point"
        x, y = f["geometry"]["coordinates"]
        assert math.isfinite(x) and math.isfinite(y)
        assert boundary.covers(Point(x, y)), p["id"]


@seed_only
def test_seed_is_the_union_with_seed_places_inside_the_boundary():
    """Ruling (B-T6/B-T7): bench and shelter fact props = OSM features U seed seating / shelter
    places inside the outline, deduplicated. The committed file already holds that union."""
    boundary = shape(_fc(SEED / "base" / "boundary.geojson")[0]["geometry"])
    feats = _fc(FILE)
    osm = [f for f in feats if f["properties"].get("source") != "seed_place"]
    places = _fc(SEED / "base" / "places.geojson")
    want = [f["properties"]["id"] for f in union_dedup(osm, places, boundary=boundary)]
    assert [f["properties"]["id"] for f in feats] == want


@seed_only
def test_site_json_records_file_and_counts():
    sf = json.loads((SEED / "site.json").read_text(encoding="utf-8"))["street_furniture"]
    feats = _fc(FILE)
    assert sf["file"] == "base/street_furniture.geojson" and sf["count"] == len(feats)
    for k in KINDS:
        assert sf["counts"][k] == sum(1 for f in feats if f["properties"]["kind"] == k)
