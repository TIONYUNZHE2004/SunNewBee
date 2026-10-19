from datetime import date

import pytest
from tests_support import add_roads
from townshiplens_spatial.access import assess_access
from townshiplens_spatial.direction import allows_direction
from townshiplens_spatial.flood import centres_reachability
from townshiplens_spatial.models import Claim
from townshiplens_spatial.routing import plan_route
from townshiplens_spatial.tools import Ctx
from townshiplens_spatial.tools import plan_route as route_tool
from townshiplens_spatial.vr_store import VerificationStore


@pytest.mark.parametrize(
    "tags,forward,reverse",
    [
        ({"oneway": "yes"}, True, False),
        ({"oneway": "1"}, True, False),
        ({"oneway": "true"}, True, False),
        ({"oneway": "-1"}, False, True),
        ({"oneway": "no"}, True, True),
        ({"junction": "roundabout"}, True, False),
        ({"junction": "roundabout", "oneway": "no"}, True, True),
        ({"oneway": "yes", "oneway:motorcar": "no"}, True, True),
        ({"oneway": "no", "oneway:motor_vehicle": "-1"}, False, True),
        ({"oneway": "yes", "oneway:vehicle": "no", "oneway:motorcar": "-1"}, False, True),
    ],
)
def test_vehicle_direction_respects_orientation_and_specific_overrides(
    world, tags, forward, reverse
):
    edge = world.edges["seg-ab"]
    edge.osm_tags = tags
    assert allows_direction(edge, "drive", edge.from_node) == forward
    assert allows_direction(edge, "drive", edge.to_node) == reverse
    for profile in ("default", "wheelchair", "stroller", "older_adult_rest"):
        assert allows_direction(edge, profile, edge.from_node)
        assert allows_direction(edge, profile, edge.to_node)


def test_drive_cannot_reverse_a_one_way_but_walking_is_unchanged(world):
    add_roads(world)
    world.edges["rd-1"].osm_tags = {"highway": "residential", "oneway": "yes"}
    allowed = plan_route(world, "park-b", "park-c", "drive")
    forbidden = plan_route(world, "park-c", "park-b", "drive")
    assert allowed.routes and allowed.status != "confirmed"
    assert forbidden.status == "blocked" and not forbidden.routes
    assert any(r["attribute"] == "oneway" for r in forbidden.blocked_reasons)
    assert plan_route(world, "park-c", "park-b", "default").routes == []  # isolated road spur


def test_opposing_parallel_oneways_keep_the_edge_for_the_travel_direction(world):
    add_roads(world)
    edge = world.edges["rd-1"]
    edge.osm_tags = {"highway": "residential", "oneway": "yes"}
    other = edge.model_copy(deep=True, update={"id": "rd-reverse", "length_m": 90})
    other.osm_tags["oneway"] = "-1"
    world.edges[other.id] = other
    world.graph.add_edge(other.from_node, other.to_node, key=other.id, edge_id=other.id)
    forward = plan_route(world, "park-b", "park-c", "drive").routes[0]
    reverse = plan_route(world, "park-c", "park-b", "drive").routes[0]
    assert [s.edge_id for s in forward.segments] == ["rd-1", "rd-2"]
    assert [s.edge_id for s in reverse.segments] == ["rd-2", "rd-reverse"]
    assert forward.distance_m == 165 and reverse.distance_m == 145
    assert [eid for m in reverse.maneuvers for eid in m.segment_ids] == ["rd-2", "rd-reverse"]


def test_flood_centre_reachability_obeys_the_same_drive_direction(world):
    add_roads(world)
    world.edges["rd-1"].osm_tags = {"highway": "residential", "oneway": "-1"}
    result = centres_reachability(world, "baseline", "drive", "park-b")
    hall = next(row for row in result if row.centre.id == "evc-hall")
    assert not hall.reachable and hall.route_status == "blocked"
    assert plan_route(world, "park-b", "__centre__evc-hall", "drive").status == "blocked"


def test_blocked_direction_returns_reported_source_evidence(world):
    add_roads(world)
    world.edges["rd-1"].osm_tags = {"highway": "residential", "oneway": "yes"}
    result = route_tool(Ctx(world, VerificationStore(":memory:")), "park-c", "park-b", "drive")
    assert result.data["status"] == "blocked"
    evidence = next(ev for ev in result.evidence if ev.attribute == "oneway")
    assert evidence.element_id == "rd-1"
    assert evidence.status == "reported" and evidence.source_type == "osm_import"
    assert evidence.value == {"tag": "oneway", "value": "yes"}


@pytest.mark.parametrize(
    "tags",
    [
        {"oneway": "reversible"},
        {"oneway": "alternating"},
        {"oneway:conditional": "yes @ (Mo-Fr 08:00-09:00)"},
        {"oneway": "yes", "oneway:conditional": "no @ (Mo-Fr 08:00-09:00)"},
    ],
)
def test_uninterpreted_direction_cannot_establish_a_positive_driving_estimate(world, tags):
    add_roads(world)
    edge = world.edges["rd-1"]
    edge.osm_tags = {"highway": "residential", **tags}
    access = assess_access(edge, world.profiles["drive"])
    assert access.level == "unknown" and access.rule_id == "driving_direction_unknown_v1"
    result = plan_route(world, "park-b", "park-c", "drive")
    assert result.status == "partly_unverified"
    assert any("not interpreted" in warning for warning in result.warnings)
    assert allows_direction(edge, "drive", edge.to_node)


def test_checked_width_and_slope_cannot_verify_an_uninterpreted_direction(world):
    add_roads(world)
    edge = world.edges["rd-1"]
    edge.osm_tags = {"highway": "residential", "oneway": "reversible"}
    edge.claims = {
        key: Claim(
            value=value,
            status="verified",
            evidence_type="staff",
            verified_by="staff-a",
            verified_at=date.today().isoformat(),
        )
        for key, value in (("step_count", 0), ("incline_pct", 0), ("width_m", 3))
    }
    assert assess_access(edge, world.profiles["drive"]).level == "unknown"
