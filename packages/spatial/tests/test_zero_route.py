"""A zero-edge graph match must not verify an explicitly inferred entrance connection."""

from datetime import date, timedelta

import pytest
from townshiplens_spatial.flood import centres_reachability
from townshiplens_spatial.models import Claim
from townshiplens_spatial.routing import plan_route
from townshiplens_spatial.tools import Ctx
from townshiplens_spatial.tools import plan_route as route_tool
from townshiplens_spatial.vr_store import VerificationStore


def _infer_at_shared_node(world):
    place = world.places["kiosk"]
    place.node_id = world.places["park-b"].node_id
    place.node_inferred = True
    place.claims["access_point"] = Claim(
        value=place.node_id, status="reported", evidence_type="osm_area_boundary_snap"
    )
    return place


@pytest.mark.parametrize("profile", ["default", "stroller", "wheelchair", "older_adult_rest"])
@pytest.mark.parametrize("reverse", [False, True])
def test_shared_graph_point_is_not_a_checked_inferred_connection(world, profile, reverse):
    _infer_at_shared_node(world)
    source, destination = ("kiosk", "park-b") if reverse else ("park-b", "kiosk")
    result = plan_route(world, source, destination, profile)
    route = result.routes[0]
    assert result.status == route.status == "partly_unverified"
    assert route.distance_m == 0 and route.segments == []
    assert [(u["element_id"], u["attribute"]) for u in route.unknowns] == [
        ("kiosk", "access_point")
    ]
    assert any("Zero mapped metres" in warning for warning in result.warnings)
    point = world.node_coords[world.places["park-b"].node_id]
    assert route.geometry["coordinates"] == [point, point]
    assert len(route.maneuvers) == 1 and route.maneuvers[0].bearing_deg is None


def test_same_place_does_not_require_a_connection_to_itself(world):
    _infer_at_shared_node(world)
    result = plan_route(world, "kiosk", "kiosk", "default")
    assert result.status == "confirmed"
    assert result.routes[0].unknowns == []


def test_explicit_mapped_entrance_takes_precedence_over_inferred_area_node(world):
    place = _infer_at_shared_node(world)
    place.entrance_ids = ["park-b"]
    result = plan_route(world, "park-b", "kiosk", "default")
    assert result.status == "confirmed"
    assert result.routes[0].unknowns == []


def test_fresh_staff_connection_is_honoured(world):
    place = _infer_at_shared_node(world)
    place.claims["access_point"] = Claim(
        value=place.node_id,
        status="verified",
        verified_at=date.today().isoformat(),
        verified_by="staff-a",
        evidence_type="field_survey",
    )
    assert plan_route(world, "park-b", "kiosk", "default").status == "confirmed"


@pytest.mark.parametrize(
    "updates",
    [
        {"verified_at": None},
        {"verified_at": (date.today() - timedelta(days=366)).isoformat()},
        {"evidence_type": "team_survey_placeholder"},
        {"verified_by": None},
        {"value": "a-different-node"},
    ],
)
def test_unusable_staff_connection_cannot_confirm_the_journey(world, updates):
    place = _infer_at_shared_node(world)
    values = {
        "value": place.node_id,
        "status": "verified",
        "verified_at": date.today().isoformat(),
        "verified_by": "staff-a",
        "evidence_type": "field_survey",
        **updates,
    }
    place.claims["access_point"] = Claim(**values)
    assert plan_route(world, "park-b", "kiosk", "default").status == "partly_unverified"


def test_tool_cites_the_inferred_connection_and_records_its_gap(world):
    _infer_at_shared_node(world)
    ctx = Ctx(world, VerificationStore(":memory:"))
    result = route_tool(ctx, "park-b", "kiosk", "default")
    assert result.data["status"] == "partly_unverified"
    assert any(e.attribute == "access_point" and e.element_id == "kiosk" for e in result.evidence)
    tickets = result.data["verification_requests"]
    assert len(tickets) == 1
    assert tickets[0]["element_id"] == "kiosk" and tickets[0]["attribute"] == "access_point"


def test_flooded_destination_still_blocks_the_shared_node_journey(world):
    _infer_at_shared_node(world)
    world.flood.place_classes["stage_p3m"]["kiosk"] = "likely_flooded"
    result = plan_route(world, "park-b", "kiosk", "default", "stage_p3m")
    assert result.status == "blocked" and result.routes == []


def test_centre_alias_of_the_same_place_does_not_invent_a_journey(world):
    place = _infer_at_shared_node(world)
    world.centres["evc-hall"] = world.centres["evc-hall"].model_copy(
        update={"place_id": place.id, "node_id": place.node_id, "coord": place.coord}
    )
    result = plan_route(world, place.id, "__centre__evc-hall", "default")
    assert result.status == "confirmed" and result.routes[0].unknowns == []


def test_unpreviewed_centre_row_agrees_on_zero_edge_inferred_origin(world):
    place = _infer_at_shared_node(world)
    world.centres["evc-hall"] = world.centres["evc-hall"].model_copy(
        update={"node_id": place.node_id}
    )
    route = plan_route(world, place.id, "__centre__evc-hall", "default")
    row = next(
        r
        for r in centres_reachability(world, None, "default", place.id)
        if r.centre.id == "evc-hall"
    )
    assert row.reachable
    assert row.route_status == route.status == "partly_unverified"
