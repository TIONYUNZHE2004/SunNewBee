"""A linked centre must use the same explicit entrances as its place route."""

import pytest
from tests_support import add_roads
from townshiplens_spatial.flood import centres_reachability
from townshiplens_spatial.routing import plan_route


def _linked(world, entrances):
    place = world.places["kiosk"]
    place.entrance_ids = entrances
    world.centres["evc-hall"] = world.centres["evc-hall"].model_copy(update={"place_id": place.id})
    return place


@pytest.mark.parametrize("profile", ["default", "stroller", "wheelchair"])
def test_centre_and_place_follow_the_explicit_entrance(world, profile):
    _linked(world, ["playground"])
    place = plan_route(world, "park-b", "kiosk", profile).routes[0]
    centre = plan_route(world, "park-b", "__centre__evc-hall", profile).routes[0]
    assert centre.target_node == place.target_node == "n-d"
    assert centre.distance_m == place.distance_m
    assert centre.segments == place.segments
    assert centre.geometry == place.geometry
    assert centre.maneuvers[-1].point == world.node_coords["n-d"]


@pytest.mark.parametrize("entrances", [[], ["missing-place"]])
def test_centre_node_is_kept_when_no_entrance_is_mapped(world, entrances):
    _linked(world, entrances)
    route = plan_route(world, "park-b", "__centre__evc-hall", "default").routes[0]
    assert route.target_node == world.centres["evc-hall"].node_id == "n-c"


@pytest.mark.parametrize("target", ["kiosk", "__centre__evc-hall"])
@pytest.mark.parametrize("profile", ["default", "drive"])
def test_missing_graph_node_in_explicit_entrance_is_a_gap(world, target, profile):
    add_roads(world)
    _linked(world, ["playground"])
    world.places["playground"].node_id = "missing-node"
    result = plan_route(world, "park-b", target, profile)
    assert result.status == "no_data" and result.routes == []


def test_drive_snaps_from_the_linked_entrance_not_the_old_centre(world):
    add_roads(world)
    _linked(world, ["park-c"])
    place = plan_route(world, "park-b", "kiosk", "drive").routes[0]
    centre = plan_route(world, "park-b", "__centre__evc-hall", "drive").routes[0]
    assert centre.target_node == place.target_node == "n-z"
    assert centre.segments == place.segments
    assert centre.geometry == place.geometry


def test_disconnected_entrance_does_not_hide_a_reachable_one(world):
    _linked(world, ["island-hut", "playground"])
    route = plan_route(world, "park-b", "__centre__evc-hall", "default").routes[0]
    assert route.target_node == "n-d"


def test_centre_row_and_preview_use_the_same_entrance(world):
    _linked(world, ["playground"])
    row = next(
        r
        for r in centres_reachability(world, None, "default", "park-b")
        if r.centre.id == "evc-hall"
    )
    route = plan_route(world, "park-b", "kiosk", "default").routes[0]
    assert row.reachable and row.route_status == route.status
    assert row.distance_m == route.distance_m


def test_flooded_linked_place_still_blocks_centre_destination(world):
    _linked(world, ["playground"])
    world.flood.place_classes["stage_p3m"]["kiosk"] = "likely_flooded"
    result = plan_route(world, "park-b", "__centre__evc-hall", "default", "stage_p3m")
    assert result.status == "blocked" and result.routes == []
