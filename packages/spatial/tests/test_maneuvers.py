import pytest
from townshiplens_spatial.maneuvers import build_maneuvers, turn_action
from townshiplens_spatial.models import Edge, RouteSegment
from townshiplens_spatial.routing import plan_route
from townshiplens_spatial.tools import Ctx
from townshiplens_spatial.tools import plan_route as route_tool
from townshiplens_spatial.vr_store import VerificationStore


@pytest.mark.parametrize(
    "delta,expected",
    [
        (0, "continue"),
        (19.999, "continue"),
        (20, "slight_right"),
        (-20, "slight_left"),
        (59.999, "slight_right"),
        (-59.999, "slight_left"),
        (60, "turn_right"),
        (-60, "turn_left"),
        (150, "turn_right"),
        (-150, "turn_left"),
        (150.001, "u_turn"),
        (-150.001, "u_turn"),
        (180, "u_turn"),
        (359, "continue"),
    ],
)
def test_turn_thresholds_and_compass_wrap(delta, expected):
    assert turn_action(0, delta) == expected
    assert turn_action(350, 350 + delta) == expected


def _path(world, polylines, *, reverse_storage=False):
    nodes = [f"test-{i}" for i in range(len(polylines) + 1)]
    segments = []
    for i, points in enumerate(polylines):
        world.node_coords[nodes[i]] = points[0]
        world.node_coords[nodes[i + 1]] = points[-1]
        edge = Edge(
            id=f"edge-{i}",
            type="footway",
            from_node=nodes[i + 1] if reverse_storage else nodes[i],
            to_node=nodes[i] if reverse_storage else nodes[i + 1],
            coords=list(reversed(points)) if reverse_storage else points,
            length_m=40.04,
        )
        world.edges[edge.id] = edge
        segments.append(
            RouteSegment(
                edge_id=edge.id,
                eval="UNKNOWN",
                access_level="likely_ok",
                rule_id="paved_path_v1",
            )
        )
    return nodes, segments


def test_straight_path_merges_and_rounds_after_summing(world):
    nodes, segments = _path(world, [[[0, 0], [0, 0.001]], [[0, 0.001], [0, 0.002]]])
    steps = build_maneuvers(world, nodes, segments)
    assert [s.action for s in steps] == ["depart", "arrive"]
    assert steps[0].distance_m == 80.1
    assert steps[0].segment_ids == ["edge-0", "edge-1"]
    assert steps[0].bearing_deg == 0
    assert steps[0].street_name is None
    assert steps[-1].point == [0, 0.002]
    assert steps[-1].distance_m == 0 and steps[-1].segment_ids == []


@pytest.mark.parametrize("reverse_storage", [False, True])
@pytest.mark.parametrize(
    "lon,action,bearing", [(0.001, "turn_right", 90), (-0.001, "turn_left", 270)]
)
def test_l_shape_preserves_turn_even_with_same_road_metadata(
    world, reverse_storage, lon, action, bearing
):
    nodes, segments = _path(
        world,
        [[[0, 0], [0, 0.001]], [[0, 0.001], [lon, 0.001]]],
        reverse_storage=reverse_storage,
    )
    for segment in segments:
        world.edges[segment.edge_id].name = "Mapped name"
    steps = build_maneuvers(world, nodes, segments)
    assert [s.action for s in steps] == ["depart", action, "arrive"]
    assert steps[1].bearing_deg == bearing
    assert steps[1].point == [0, 0.001]
    # Traversing the same edges in reverse must reverse the turn side.
    reversed_steps = build_maneuvers(world, nodes[::-1], segments[::-1])
    opposite = "turn_left" if action == "turn_right" else "turn_right"
    assert reversed_steps[1].action == opposite
    assert reversed_steps[0].point == [lon, 0.001]


def test_turn_uses_local_tangents_not_edge_chords_and_skips_duplicate_points(world):
    nodes, segments = _path(
        world,
        [
            [[0, 0], [0, 0], [0, 0.001], [0.001, 0.001], [0.001, 0.001]],
            [[0.001, 0.001], [0.002, 0.001]],
        ],
    )
    steps = build_maneuvers(world, nodes, segments)
    assert [s.action for s in steps] == ["depart", "arrive"]
    assert steps[0].bearing_deg == 0
    assert steps[-1].bearing_deg == 90


@pytest.mark.parametrize("boundary", ["name", "type", "access_level", "rule_id"])
def test_straight_path_preserves_metadata_and_uncertainty_boundaries(world, boundary):
    nodes, segments = _path(world, [[[0, 0], [0, 0.001]], [[0, 0.001], [0, 0.002]]])
    if boundary == "name":
        world.edges["edge-1"].name = "Exact OSM street"
    elif boundary == "type":
        world.edges["edge-1"].type = "sidewalk"
    elif boundary == "access_level":
        segments[1].access_level = "unknown"
    else:
        segments[1].rule_id = "urban_path_v1"
    steps = build_maneuvers(world, nodes, segments)
    assert [s.action for s in steps] == ["depart", "continue", "arrive"]
    assert steps[1].point == [0, 0.001]
    assert steps[1].access_level == segments[1].access_level
    assert steps[1].rule_id == segments[1].rule_id


def test_crossing_entry_does_not_invent_crossing_control(world):
    nodes, segments = _path(
        world,
        [[[0, 0], [0, 0.001]], [[0, 0.001], [0, 0.002]], [[0, 0.002], [0, 0.003]]],
    )
    world.edges["edge-1"].type = world.edges["edge-2"].type = "crossing"
    steps = build_maneuvers(world, nodes, segments)
    assert [s.action for s in steps] == ["depart", "cross", "arrive"]
    assert steps[1].segment_ids == ["edge-1", "edge-2"]
    assert steps[1].street_name is None and steps[1].edge_type == "crossing"


def test_turning_into_crossing_keeps_turn_direction(world):
    nodes, segments = _path(world, [[[0, 0], [0, 0.001]], [[0, 0.001], [0.001, 0.001]]])
    world.edges["edge-1"].type = "crossing"
    assert build_maneuvers(world, nodes, segments)[1].action == "turn_right"


def test_backtrack_preserves_repeated_segments_and_u_turn(world):
    nodes, segments = _path(world, [[[0, 0], [0, 0.001]]])
    steps = build_maneuvers(world, [nodes[0], nodes[1], nodes[0]], segments * 2)
    assert [s.action for s in steps] == ["depart", "u_turn", "arrive"]
    assert [s.segment_ids for s in steps] == [["edge-0"], ["edge-0"], []]


def test_directionless_and_zero_edge_routes_do_not_invent_a_heading(world):
    nodes, segments = _path(world, [[[0, 0], [0, 0]]])
    steps = build_maneuvers(world, nodes, segments)
    assert all(s.bearing_deg is None for s in steps)
    empty = build_maneuvers(world, [nodes[0]], [])
    assert len(empty) == 1 and empty[0].action == "arrive"
    assert empty[0].bearing_deg is empty[0].street_name is empty[0].edge_type is None


def test_tiny_engine_and_tool_share_maneuvers(world, tmp_path):
    result = plan_route(world, "park-b", "playground", "stroller")
    ctx = Ctx(world, VerificationStore(str(tmp_path / "vrs.db")))
    tool = route_tool(ctx, "park-b", "playground", "stroller", file_vrs=False)
    route = result.routes[0]
    steps = route.maneuvers
    assert tool.data["routes"][0]["maneuvers"] == [s.model_dump() for s in steps]
    assert [s.index for s in steps] == list(range(1, len(steps) + 1))
    assert [eid for s in steps for eid in s.segment_ids] == [s.edge_id for s in route.segments]
    assert sum(s.distance_m for s in steps) == pytest.approx(route.distance_m, abs=0.2)
    assert steps[0].point == route.geometry["coordinates"][0]
    assert steps[-1].point == route.geometry["coordinates"][-1]


def test_no_data_and_flood_blocked_routes_cannot_emit_steps(world):
    assert plan_route(world, "park-b", "island-hut", "stroller").routes == []
    assert plan_route(world, "park-b", "playground", "stroller", "stage_p5m").routes == []


def test_same_node_route_only_arrives(world):
    route = plan_route(world, "park-b", "park-b", "stroller").routes[0]
    assert [s.action for s in route.maneuvers] == ["arrive"]
    assert route.maneuvers[0].point == world.places["park-b"].coord
