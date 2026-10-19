"""A seat cannot establish a rest interval while closed or unavailable in the scenario."""

from datetime import UTC, datetime, timedelta

import pytest
from rest_support import add_rest, rest_detour
from townshiplens_spatial.flood import centres_reachability
from townshiplens_spatial.models import Closure
from townshiplens_spatial.routing import evidence_for_route, plan_route


def _prepare(world):
    rest_detour(world)
    world.flood.edge_classes["stage_p1m"] = {}
    world.flood.place_classes["stage_p1m"] = {}


def _closure(world, window="active"):
    now = datetime.now(UTC)
    world.places["rest-r"].closures = [
        Closure(
            id="cl-rest",
            element_id="rest-r",
            reason="works",
            starts_at=now + timedelta(days=1) if window == "future" else now - timedelta(days=2),
            ends_at=now - timedelta(days=1) if window == "expired" else None,
        )
    ]


@pytest.mark.parametrize("cause", ["likely_flooded", "active_closure"])
def test_unavailable_stop_cannot_make_a_rest_constrained_route_confirmed(world, cause):
    _prepare(world)
    if cause == "active_closure":
        _closure(world)
    else:
        world.flood.place_classes["stage_p1m"]["rest-r"] = cause
    result = plan_route(world, "park-b", "playground", "older_adult_rest", "stage_p1m")
    route = result.routes[0]
    assert result.status == route.status == "partly_unverified"
    assert not route.rest_limit_met and route.max_gap_between_rest_m == 111.2
    assert route.distance_m == 222.4  # no pointless detour to an unavailable bench
    assert "rest-r" not in {p["place_id"] for p in route.rest_points}
    assert any("longest stretch without a rest point" in w for w in result.warnings)


@pytest.mark.parametrize("cause", ["possible", "partial", "uncovered"])
def test_uncertain_stop_can_support_only_a_disclosed_lenient_rest_route(world, cause):
    _prepare(world)
    if cause == "possible":
        world.flood.place_classes["stage_p1m"]["rest-r"] = cause
    else:
        world.flood.coverage["rest-r"] = cause
    result = plan_route(world, "park-b", "playground", "older_adult_rest", "stage_p1m")
    route = result.routes[0]
    assert result.status == route.status == "partly_unverified"
    assert route.rest_limit_met and route.distance_m == 226.2
    assert route.rest_points_unverified == ["rest-r"]
    assert next(p for p in route.rest_points if p["place_id"] == "rest-r")["status"] == "unverified"
    assert any("Rest rest-r" in w and "not checked yet" in w for w in result.warnings)
    assert any("Rest rest-r" in w and ("flood" in w or "coverage" in w) for w in result.warnings)
    assert any(
        ev.element_id == "rest-r" and ev.attribute in {"flood", "flood_coverage"}
        for ev in evidence_for_route(world, route)
    )


@pytest.mark.parametrize("window", ["expired", "future"])
def test_inactive_closure_does_not_remove_a_usable_rest_stop(world, window):
    _prepare(world)
    _closure(world, window)
    result = plan_route(world, "park-b", "playground", "older_adult_rest")
    assert result.status == "confirmed" and result.routes[0].rest_limit_met
    assert result.routes[0].distance_m == 226.2


@pytest.mark.parametrize("scenario", [None, "baseline"])
def test_inactive_scenario_does_not_apply_nonbaseline_rest_coverage(world, scenario):
    _prepare(world)
    world.flood.place_classes["stage_p1m"]["rest-r"] = "likely_flooded"
    world.flood.coverage["rest-r"] = "uncovered"
    result = plan_route(world, "park-b", "playground", "older_adult_rest", scenario)
    assert result.status == "confirmed" and result.routes[0].rest_limit_met
    assert result.routes[0].rest_points_unverified == []


def test_unavailable_rest_does_not_hide_an_available_alternative_at_the_same_node(world):
    _prepare(world)
    _closure(world)
    add_rest(world, "backup-rest", "n-r")
    result = plan_route(world, "park-b", "playground", "older_adult_rest", "stage_p1m")
    assert result.status == "confirmed" and result.routes[0].rest_limit_met
    assert "backup-rest" in {p["place_id"] for p in result.routes[0].rest_points}
    assert "rest-r" not in {p["place_id"] for p in result.routes[0].rest_points}


@pytest.mark.parametrize("top_routes", [0, 1])
@pytest.mark.parametrize("cause", [None, "likely_flooded", "possible", "active_closure", "partial"])
def test_centre_status_uses_available_rests_even_without_a_route_preview(world, cause, top_routes):
    _prepare(world)
    world.graph.remove_edge("n-c", "n-d", key="seg-cd")
    del world.edges["seg-cd"]  # only the rest detour remains
    if cause == "active_closure":
        _closure(world)
    elif cause == "partial":
        world.flood.coverage["rest-r"] = cause
    elif cause:
        world.flood.place_classes["stage_p1m"]["rest-r"] = cause
    world.centres = {
        "evc-hall": world.centres["evc-hall"].model_copy(
            update={"node_id": "n-d", "place_id": "playground", "coord": world.node_coords["n-d"]}
        )
    }
    row = centres_reachability(
        world, "stage_p1m", "older_adult_rest", "park-b", top_routes=top_routes
    )[0]
    assert row.reachable
    assert row.route_status == ("confirmed" if cause is None else "partly_unverified")
    assert bool(row.route_id) == bool(top_routes)


@pytest.mark.parametrize("profile", ["default", "stroller", "wheelchair"])
def test_optional_rest_lists_do_not_include_closed_seats(world, profile):
    _prepare(world)
    before = plan_route(world, "park-b", "playground", profile)
    assert "bench-1" in {p["place_id"] for p in before.routes[0].rest_points}
    _closure(world)
    world.places["bench-1"].closures = [
        c.model_copy(update={"element_id": "bench-1"}) for c in world.places["rest-r"].closures
    ]
    # Non-rest profiles retain route passability; their optional rest lists obey availability.
    after = plan_route(world, "park-b", "playground", profile)
    assert after.status == before.status and after.routes[0].segments == before.routes[0].segments
    assert "bench-1" not in {p["place_id"] for p in after.routes[0].rest_points}
