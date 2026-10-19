"""Positive sidewalk/rest facts obey the same verification gate as edge hard limits."""

from datetime import date, timedelta

import pytest
from rest_support import rest_detour
from townshiplens_spatial.evaluate import (
    edge_gaps,
    effective_claim_status,
    evaluate_edge,
    rest_point_state,
)
from townshiplens_spatial.flood import centres_reachability
from townshiplens_spatial.models import Claim
from townshiplens_spatial.routing import plan_route


@pytest.mark.parametrize(
    "typ,attr,value", [("seating", "seating", True), ("shelter", "shelter", "covered")]
)
def test_undated_rest_point_can_only_support_a_lenient_journey(world, typ, attr, value):
    rest_detour(world, typ, {attr: Claim(value=value, status="verified")})
    assert rest_point_state(world.places["rest-r"]) == "UNKNOWN"
    result = plan_route(world, "park-b", "playground", "older_adult_rest")
    route = result.routes[0]
    assert result.status == route.status == "partly_unverified"
    assert route.rest_limit_met and route.rest_points_unverified == ["rest-r"]
    assert any("Rest rest-r" in w and "not checked yet" in w for w in result.warnings)


def test_unpreviewed_centre_row_cannot_trust_an_undated_rest_stop(world):
    rest_detour(world, claims={"seating": Claim(value=True, status="verified")})
    world.centres["evc-hall"] = world.centres["evc-hall"].model_copy(
        update={"node_id": "n-d", "place_id": "playground", "coord": world.node_coords["n-d"]}
    )
    row = next(
        r
        for r in centres_reachability(world, None, "older_adult_rest", "park-b")
        if r.centre.id == "evc-hall"
    )
    assert row.reachable and row.route_status == "partly_unverified"


@pytest.mark.parametrize("profile", ["default", "stroller", "wheelchair", "older_adult_rest"])
def test_undated_positive_sidewalk_never_supports_a_pass(world, profile):
    edge = world.edges["seg-ab"]
    edge.type = "major_road"
    edge.claims["sidewalk"] = Claim(value="both", status="verified")
    state, reasons = evaluate_edge(edge, world.profiles[profile])
    assert state == "UNKNOWN" and reasons[0]["attribute"] == "sidewalk"
    assert any(gap["attribute"] == "sidewalk" for gap in edge_gaps(edge, world.profiles[profile]))
    result = plan_route(world, "park-b", "lakeside-mall", profile)
    assert result.status == "partly_unverified"
    assert result.routes[0].road_sections[0].sidewalk_status == "unknown"
    assert edge.claims["sidewalk"].status == "verified"  # raw audit record is retained


@pytest.mark.parametrize("profile", ["stroller", "wheelchair", "older_adult_rest"])
def test_undated_negative_sidewalk_keeps_its_known_barrier(world, profile):
    edge = world.edges["seg-ab"]
    edge.type = "major_road"
    edge.claims["sidewalk"] = Claim(value="none", status="verified")
    assert evaluate_edge(edge, world.profiles[profile])[0] == "FAIL"
    assert plan_route(world, "park-b", "lakeside-mall", profile).status == "blocked"


@pytest.mark.parametrize(
    "typ,attr,value", [("seating", "seating", False), ("shelter", "shelter", "none")]
)
def test_undated_negative_rest_point_stays_absent(world, typ, attr, value):
    place = world.places["bench-1"]
    place.type = typ
    place.claims = {attr: Claim(value=value, status="verified")}
    assert rest_point_state(place) == "FAIL"


@pytest.mark.parametrize(
    "claim,expected",
    [
        (None, "unknown"),
        (Claim(value="both", status="verified"), "unknown"),
        (Claim(value=None, status="verified", verified_at=date.today().isoformat()), "unknown"),
        (Claim(value="both", status="reported"), "reported"),
        (Claim(value="both", status="contested"), "contested"),
        (Claim(value="both", status="verified", verified_at=date.today().isoformat()), "verified"),
        (
            Claim(
                value="both",
                status="verified",
                verified_at=(date.today() - timedelta(days=31)).isoformat(),
                ttl_days=30,
            ),
            "stale",
        ),
    ],
)
def test_derived_status_requires_a_usable_verification(claim, expected):
    assert effective_claim_status(claim, "sidewalk") == expected
