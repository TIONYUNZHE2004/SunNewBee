from datetime import UTC, datetime, timedelta

import pytest
from conftest import TINY
from hypothesis import given, settings
from hypothesis import strategies as st
from townshiplens_spatial import events, marathon, tools
from townshiplens_spatial.world import load_world


def assert_continuous(world, course):
    node = course.start_node
    for eid in course.segment_ids:
        edge = world.edges[eid]
        assert node in (edge.from_node, edge.to_node)
        node = edge.to_node if node == edge.from_node else edge.from_node
    assert node == course.finish_node
    assert len(course.segment_ids) <= 400
    assert course.length_m == round(sum(world.edges[e].length_m for e in course.segment_ids), 1)


@given(st.floats(min_value=0.05, max_value=2, allow_nan=False, allow_infinity=False))
@settings(max_examples=12, deadline=None)
def test_course_is_continuous_deterministic_and_honest_about_distance(distance):
    world = load_world(TINY)
    course = marathon.plan_course(world, "park-b", distance)
    assert_continuous(world, course)
    assert course.start_node == course.finish_node
    assert course == marathon.plan_course(world, "park-b", distance)
    assert abs(course.length_m - distance * 1000) <= distance * 100 or any(
        "±10%" in w for w in course.warnings
    )


def test_point_to_point_and_road_exclusions(world):
    world.edges["seg-cd"].name = "Avoid Me"
    course = marathon.plan_course(
        world, "Car Park B", 0.3, "point_to_point", "playground", avoid_roads=["Avoid Me"]
    )
    assert_continuous(world, course)
    assert course.start == "park-b" and course.finish == "playground"
    assert "seg-cd" not in course.segment_ids


def test_major_roads_need_an_explicit_request(world):
    world.edges["seg-ab"].type = "major_road"
    world.edges["seg-ab"].name = "Main Road"
    with pytest.raises(ValueError, match="No mapped course connection"):
        marathon.plan_course(world, "park-b", 0.3)
    course = marathon.plan_course(world, "park-b", 0.3, prefer_roads=["Main Road"])
    assert "seg-ab" in course.segment_ids
    assert any("major road" in warning for warning in course.warnings)


def test_course_limit_does_not_raise_ad_hoc_limit():
    start = datetime(2030, 1, 1, tzinfo=UTC)
    args = dict(
        segment_ids=[f"segment-{i}" for i in range(70)],
        starts_at=start,
        ends_at=start + timedelta(hours=2),
    )
    assert len(events.CourseWindow(**args).segment_ids) == 70
    with pytest.raises(ValueError):
        events.ClosureWindow(**args)
    with pytest.raises(ValueError):
        events.CourseWindow(**{**args, "segment_ids": [str(i) for i in range(401)]})


def test_simulation_is_read_only_and_has_evidence(world):
    before = {eid: e.model_dump() for eid, e in world.edges.items()}
    request = marathon.MarathonRequest(
        start="park-b",
        distance_km=0.3,
        starts_at="2030-01-01T06:00:00+08:00",
        ends_at="2030-01-01T10:00:00+08:00",
        profiles=["default"],
    )
    result = marathon.simulate_marathon(world, request)
    assert_continuous(world, result.course)
    assert result.impact.event.reason == "event"
    assert result.impact.evidence_id.startswith("ev-closure-")
    assert before == {eid: e.model_dump() for eid, e in world.edges.items()}
    assert world.version == 0
    assert "simulate_marathon" in tools.TOOLS


@pytest.mark.parametrize(
    "kwargs",
    [
        dict(distance_km=0),
        dict(distance_km=float("nan")),
        dict(shape="bad"),
        dict(shape="point_to_point"),
        dict(finish="playground"),
        dict(avoid_roads=["Not A Road"]),
    ],
)
def test_invalid_or_ambiguous_course_requests_fail(world, kwargs):
    with pytest.raises(ValueError):
        marathon.plan_course(world, "park-b", **{**dict(distance_km=0.3), **kwargs})
