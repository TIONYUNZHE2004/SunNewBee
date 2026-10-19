"""Malformed source identity/geometry must fail before a graph can route across it."""

import copy
import json
import shutil

import pytest
from tests_support import TINY
from townshiplens_spatial.routing import plan_route
from townshiplens_spatial.world import WorldDataError, load_world


@pytest.fixture
def data_dir(tmp_path):
    path = tmp_path / "world"
    shutil.copytree(TINY, path)
    return path


def _edit(path, change):
    collection = json.loads(path.read_text())
    change(collection["features"])
    path.write_text(json.dumps(collection))


@pytest.mark.parametrize(
    "filename",
    [
        "base/walk.geojson",
        "base/places.geojson",
        "flood/evac_centres.geojson",
        "waste/points.geojson",
    ],
)
def test_duplicate_source_ids_are_rejected_instead_of_silently_shadowing(data_dir, filename):
    def duplicate(features):
        other = copy.deepcopy(features[0])
        other["geometry"]["coordinates"] = copy.deepcopy(features[-1]["geometry"]["coordinates"])
        features.append(other)

    _edit(data_dir / filename, duplicate)
    with pytest.raises(WorldDataError, match="duplicate feature id"):
        load_world(data_dir)


def test_overlay_duplicate_ids_are_rejected_but_cross_file_replacement_remains_valid(data_dir):
    walk = json.loads((data_dir / "base/walk.geojson").read_text())["features"]
    edge = copy.deepcopy(next(f for f in walk if f["properties"]["id"] == "seg-cf"))
    overlay = data_dir / "access/overlay.geojson"
    overlay.write_text(json.dumps({"features": [edge]}))
    assert load_world(data_dir).edges["seg-cf"].id == "seg-cf"
    overlay.write_text(json.dumps({"features": [edge, edge]}))
    with pytest.raises(WorldDataError, match="duplicate feature id seg-cf"):
        load_world(data_dir)


def test_edge_place_id_collision_is_ambiguous_and_rejected(data_dir):
    def collide(features):
        features[0]["properties"]["id"] = "seg-ab"

    _edit(data_dir / "base/places.geojson", collide)
    with pytest.raises(WorldDataError, match="edge/place ids overlap: seg-ab"):
        load_world(data_dir)


@pytest.mark.parametrize("in_overlay", [False, True])
def test_shared_node_cannot_jump_between_different_endpoint_coordinates(data_dir, in_overlay):
    walk = data_dir / "base/walk.geojson"
    collection = json.loads(walk.read_text())
    edge = next(f for f in collection["features"] if f["properties"]["id"] == "seg-bc")
    assert edge["properties"]["from"] == "n-b"
    edge["geometry"]["coordinates"][0] = [101.52, 3.19]  # same ID, roughly 1 km away
    if in_overlay:
        (data_dir / "access/overlay.geojson").write_text(json.dumps({"features": [edge]}))
    else:
        walk.write_text(json.dumps(collection))
    with pytest.raises(WorldDataError, match="node n-b: inconsistent endpoint position"):
        load_world(data_dir)


def test_equal_coordinates_never_merge_different_node_ids(data_dir):
    def add_disconnected_edge(features):
        edge = copy.deepcopy(features[0])
        edge["properties"].update({"id": "seg-overpass", "from": "upper-a", "to": "upper-b"})
        features.append(edge)

    def add_place(features):
        place = copy.deepcopy(features[0])
        place["properties"].update({"id": "upper-place", "node_id": "upper-a"})
        features.append(place)

    _edit(data_dir / "base/walk.geojson", add_disconnected_edge)
    _edit(data_dir / "base/places.geojson", add_place)
    world = load_world(data_dir)
    assert world.node_coords["upper-a"] == world.node_coords["n-a"]
    assert plan_route(world, "park-b", "upper-place", "default").status == "no_data"


@pytest.mark.parametrize("endpoint", ["from", "to"])
def test_missing_endpoint_identity_cannot_become_a_shared_junction(data_dir, endpoint):
    def change(features):
        features[0]["properties"][endpoint] = ""

    _edit(data_dir / "base/walk.geojson", change)
    with pytest.raises(WorldDataError, match="nonempty node ids"):
        load_world(data_dir)


def test_polygon_cannot_be_interpreted_as_a_walk_line(data_dir):
    def change(features):
        features[0]["geometry"]["type"] = "Polygon"

    _edit(data_dir / "base/walk.geojson", change)
    with pytest.raises(WorldDataError, match="geometry must be a LineString"):
        load_world(data_dir)


@pytest.mark.parametrize(
    "coordinates",
    [
        [],
        [[101.509, 3.181]],
        [[101.509], [101.51, 3.181]],
        [[float("nan"), 3.181], [101.51, 3.181]],
        [[101.509, 91], [101.51, 3.181]],
    ],
)
def test_unusable_line_geometry_cannot_enter_the_routing_graph(data_dir, coordinates):
    def change(features):
        features[0]["geometry"]["coordinates"] = coordinates

    _edit(data_dir / "base/walk.geojson", change)
    with pytest.raises(WorldDataError):
        load_world(data_dir)


@pytest.mark.parametrize("coordinate", [[], [101.5], [181, 3.18], [101.5, float("inf")]])
def test_unusable_place_position_is_rejected(data_dir, coordinate):
    def change(features):
        features[0]["geometry"]["coordinates"] = coordinate

    _edit(data_dir / "base/places.geojson", change)
    with pytest.raises(WorldDataError, match="finite WGS84"):
        load_world(data_dir)
