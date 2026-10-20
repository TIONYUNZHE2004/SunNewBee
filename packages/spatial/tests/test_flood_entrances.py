"""Flood component membership uses routing's entrances and profile-specific road snaps."""

from tests_support import add_roads
from townshiplens_spatial.flood import affected
from townshiplens_spatial.routing import plan_route


def _mapped_centre(world, entrances):
    world.centres = {"evc-hall": world.centres["evc-hall"].model_copy(update={"place_id": "kiosk"})}
    world.places["kiosk"].entrance_ids = entrances


def _sample_ids(result):
    return {pid for comp in result.isolated_components for pid in comp["sample_place_ids"]}


def test_centre_mapped_entrance_prevents_false_island_for_reachable_places(world):
    _mapped_centre(world, ["lakeside-mall"])
    route = plan_route(world, "park-b", "__centre__evc-hall", "stroller", "stage_p5m")
    assert route.routes[0].target_node == "n-b" and route.routes[0].distance_m == 55.6
    result = affected(world, "stage_p5m", "stroller")
    assert not {"park-b", "lakeside-mall", "kiosk"} & _sample_ids(result)
    assert "bench-1" in _sample_ids(result)  # the old centre node is now stranded


def test_one_reachable_entrance_excludes_a_place_from_isolated_samples(world):
    _mapped_centre(world, ["lakeside-mall"])
    world.places["toilet-1"].entrance_ids = ["lakeside-mall", "bench-1"]
    result = affected(world, "stage_p5m", "stroller")
    assert "toilet-1" not in _sample_ids(result)
    assert plan_route(world, "toilet-1", "__centre__evc-hall", "stroller", "stage_p5m").routes


def test_baseline_can_use_explicit_entrance_when_centre_has_no_legacy_node(world):
    _mapped_centre(world, ["lakeside-mall"])
    world.centres["evc-hall"].node_id = None
    result = affected(world, "stage_p5m", "stroller")
    assert "bench-1" in _sample_ids(result)
    assert "park-b" not in _sample_ids(result)


def test_invalid_explicit_centre_entrance_keeps_baseline_gap_out_of_flood_islands(world):
    _mapped_centre(world, ["lakeside-mall"])
    world.places["lakeside-mall"].node_id = "missing-node"
    assert plan_route(world, "park-b", "__centre__evc-hall", "stroller").status == "no_data"
    assert affected(world, "stage_p5m", "stroller").isolated_total == 0


def test_never_connected_place_is_still_a_data_gap(world):
    _mapped_centre(world, ["lakeside-mall"])
    assert "island-hut" not in _sample_ids(affected(world, "stage_p5m", "stroller"))


def test_drive_islands_use_the_same_road_snaps_as_routes(world):
    add_roads(world)
    world.centres = {"evc-hall": world.centres["evc-hall"]}
    world.flood.edge_classes["stage_p3m"]["rd-1"] = "likely_flooded"
    route = plan_route(world, "park-b", "__centre__evc-hall", "drive", "stage_p3m")
    assert route.status == "blocked"
    assert "park-b" in _sample_ids(affected(world, "stage_p3m", "drive"))
    assert affected(world, "baseline", "drive").isolated_total == 0
