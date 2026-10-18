"""T-014: prefer mapped walking paths, and expose road geometry without verifying it."""

import pytest
from townshiplens_spatial import tools
from townshiplens_spatial.models import Claim, Edge
from townshiplens_spatial.routing import plan_route
from townshiplens_spatial.vr_store import VerificationStore


def _alternative(world, kind="street", length=280):
    edge = Edge(
        id="alternative",
        type=kind,
        from_node="n-a",
        to_node="n-d",
        coords=[world.node_coords["n-a"], world.node_coords["n-d"]],
        length_m=length,
        name="Example Road",
    )
    world.edges[edge.id] = edge
    world.graph.add_edge(edge.from_node, edge.to_node, key=edge.id, edge_id=edge.id)
    return edge


def test_walkers_prefer_a_modestly_longer_mapped_walking_path(world):
    original = plan_route(world, "park-b", "playground", "default").routes[0]
    _alternative(world, length=original.distance_m / 1.1)
    rr = plan_route(world, "park-b", "playground", "default")
    assert rr.routes[0].distance_m == original.distance_m
    assert all(s.edge_id != "alternative" for s in rr.routes[0].segments)
    # Cost is only a preference. A much shorter road still wins and needs a caveat.
    world.edges["alternative"].length_m = original.distance_m / 2
    rr = plan_route(world, "park-b", "playground", "default")
    assert rr.routes[0].road_m == rr.routes[0].distance_m
    assert rr.routes[0].road_without_mapped_sidewalk_m == rr.routes[0].distance_m
    assert any("road centre lines" in w for w in rr.warnings)


def test_unverified_sidewalk_never_displaces_a_confirmed_route(world):
    _alternative(world, kind="sidewalk", length=1)
    rr = plan_route(world, "park-b", "playground", "stroller")
    assert rr.status == "confirmed"
    assert all(s.edge_id != "alternative" for s in rr.routes[0].segments)
    assert any(r.status == "partly_unverified" for r in rr.routes)


def test_sidewalk_composition_is_citable_and_creates_no_extra_ticket(world):
    edge = _alternative(world, kind="sidewalk", length=1)
    ctx = tools.Ctx(world, VerificationStore(":memory:"))
    result = tools.plan_route(ctx, "park-b", "playground", "default")
    route = result.data["routes"][0]
    assert route["sidewalk_m"] == 1 and route["road_m"] == 0
    evidence = next(e for e in result.evidence if e.attribute == "route_walkways")
    assert evidence.value["sidewalk_m"] == 1
    assert evidence.status == "reported" and evidence.id in route["evidence_ids"]
    assert edge.claims == {} and ctx.vrs.list("all") == []


@pytest.mark.parametrize(
    "value,status,missing",
    [
        (None, "unknown", True),
        ("none", "reported", True),
        ("both", "reported", False),
        ("one_side", "verified", False),
        ("separate", "reported", False),
        ("both", "contested", True),
        ("both", "stale", True),
    ],
)
def test_road_section_sidewalk_claims_keep_their_provenance(world, value, status, missing):
    edge = _alternative(world, length=1)
    if value is not None:
        edge.claims["sidewalk"] = Claim(value=value, status=status, evidence_type="osm_import")
    route = plan_route(world, "park-b", "playground", "default").routes[0]
    assert route.road_without_mapped_sidewalk_m == (1 if missing else 0)
    section = route.road_sections[0]
    assert section.element_id == edge.id and section.name == "Example Road"
    assert section.sidewalk == value and section.sidewalk_status == status


def test_drive_keeps_distance_costs_and_has_no_sidewalk_warning(world):
    _alternative(world, length=100)
    rr = plan_route(world, "park-b", "playground", "drive")
    assert rr.routes[0].distance_m == 100
    assert not any("sidewalk" in w for w in rr.warnings)


def test_zero_distance_route_has_zero_composition(world):
    route = plan_route(world, "park-b", "park-b", "default").routes[0]
    assert route.sidewalk_m == route.road_m == route.road_without_mapped_sidewalk_m == 0
    assert route.road_sections == []
