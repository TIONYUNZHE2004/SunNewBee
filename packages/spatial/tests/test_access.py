from datetime import UTC, date, datetime

import pytest
from townshiplens_spatial.access import assess_access, urban_context
from townshiplens_spatial.evaluate import evaluate_edge
from townshiplens_spatial.flood import centres_reachability
from townshiplens_spatial.models import Claim, Closure
from townshiplens_spatial.routing import plan_route


@pytest.mark.parametrize("mode", ["default", "stroller", "wheelchair", "older_adult_rest"])
def test_sidewalk_is_estimate_not_verified(world, mode):
    edge = world.edges["seg-ab"].model_copy(deep=True)
    edge.type = "sidewalk"
    edge.claims = {}
    edge.osm_tags = {"highway": "footway", "footway": "sidewalk"}
    result = assess_access(edge, world.profiles[mode])
    assert result.level == "likely_ok"
    assert result.rule_id == "pedestrian_infrastructure_v1"
    assert result.tags_used == edge.osm_tags
    if mode != "default":
        assert evaluate_edge(edge, world.profiles[mode])[0] == "UNKNOWN"


@pytest.mark.parametrize("mode", ["stroller", "wheelchair", "older_adult_rest"])
@pytest.mark.parametrize(
    "tags",
    [
        {"highway": "path"},
        {"highway": "track"},
        {"highway": "footway", "surface": "gravel"},
        {"highway": "residential"},
        {"highway": "primary"},
    ],
)
def test_insufficient_or_poor_map_basis_stays_unknown(world, mode, tags):
    edge = world.edges["seg-ab"].model_copy(deep=True)
    edge.claims = {}
    edge.osm_tags = tags
    edge.type = {"residential": "street", "primary": "major_road"}.get(
        tags["highway"], tags["highway"]
    )
    assert assess_access(edge, world.profiles[mode]).level == "unknown"


@pytest.mark.parametrize("mode", ["stroller", "wheelchair", "older_adult_rest"])
def test_map_estimate_cannot_override_reported_barrier_or_scenario(world, mode):
    edge = world.edges["seg-ab"].model_copy(deep=True)
    edge.type = "sidewalk"
    edge.osm_tags = {"highway": "footway", "footway": "sidewalk"}
    profile = world.profiles[mode]
    edge.claims = {"step_count": Claim(value=2, status="reported")}
    assert assess_access(edge, profile).level == "barrier"
    edge.claims = {}
    assert assess_access(edge, profile, "likely_flooded").level == "barrier"
    assert assess_access(edge, profile, "possible").level == "unknown"
    assert assess_access(edge, profile, flood_coverage="partial").level == "unknown"
    edge.closures = [
        Closure(
            id="closed",
            element_id=edge.id,
            reason="works",
            starts_at=datetime(2020, 1, 1, tzinfo=UTC),
        )
    ]
    assert assess_access(edge, profile).level == "barrier"


@pytest.mark.parametrize(
    "mode,tags",
    [
        ("default", {"highway": "residential", "foot": "no"}),
        ("stroller", {"highway": "footway", "access": "no"}),
        ("wheelchair", {"highway": "footway", "wheelchair": "no"}),
        ("drive", {"highway": "residential", "motor_vehicle": "no"}),
        ("drive", {"highway": "track", "motorcar": "no"}),
    ],
)
def test_explicit_mode_denial_survives_estimation(world, mode, tags):
    edge = world.edges["seg-ab"].model_copy(deep=True)
    edge.type = (
        "track" if tags["highway"] == "track" else "street" if mode == "drive" else "footway"
    )
    edge.osm_tags = tags
    assert evaluate_edge(edge, world.profiles[mode])[0] == "FAIL"
    assert assess_access(edge, world.profiles[mode]).level == "barrier"


def test_specific_permission_and_restricted_access(world):
    edge = world.edges["seg-ab"].model_copy(deep=True)
    edge.osm_tags = {"highway": "footway", "access": "no", "foot": "yes"}
    assert assess_access(edge, world.profiles["default"]).level == "likely_ok"
    edge.osm_tags = {"highway": "footway", "access": "private"}
    assert assess_access(edge, world.profiles["default"]).level == "unknown"


def test_drive_distinguishes_nonroads_from_road_barriers(world):
    edge = world.edges["seg-ab"].model_copy(deep=True)
    edge.osm_tags = {"highway": "footway"}
    assert assess_access(edge, world.profiles["drive"], "likely_flooded").level == "not_a_road"
    edge.type = "street"
    edge.osm_tags = {"highway": "residential"}
    assert assess_access(edge, world.profiles["drive"]).level == "likely_ok"
    assert assess_access(edge, world.profiles["drive"], "possible").level == "barrier"


def test_only_current_staff_facts_get_verified(world):
    edge = world.edges["seg-ab"].model_copy(deep=True)
    assert assess_access(edge, world.profiles["wheelchair"]).level != "verified"
    for claim in edge.claims.values():
        claim.evidence_type = "field_survey"
        claim.verified_by = "staff-1"
        claim.verified_at = date.today().isoformat()
    assert assess_access(edge, world.profiles["wheelchair"]).level == "verified"
    edge.claims["width_m"].status = "stale"
    edge.osm_tags = {"highway": "footway", "footway": "sidewalk"}
    edge.type = "sidewalk"
    assert assess_access(edge, world.profiles["wheelchair"]).level == "unknown"


def test_urban_proxy_reports_basis_and_checks_whole_edge(world):
    edge = world.edges["seg-ab"]
    road = world.edges["seg-bc"]
    edge.osm_tags = {"highway": "footway"}
    road.osm_tags = {"highway": "residential"}
    road.coords = [[x, y + 0.0001] for x, y in edge.coords]
    context = urban_context(world, edge)
    assert context["context:road_edge"] == road.id
    assert float(context["context:max_distance_m"]) < 60
    edge.claims = {}
    result = assess_access(edge, world.profiles["wheelchair"], urban=context)
    assert result.level == "likely_ok"
    assert result.rule_id == "urban_footway_v1"
    edge.coords = [edge.coords[0], [101.52, 3.19]]
    world.graph.graph.pop("_urban_access")
    assert urban_context(world, edge) == {}


def test_estimated_route_never_confirmed_and_counts_metres(world):
    for edge in world.edges.values():
        if edge.type != "steps":
            edge.type = "sidewalk"
            edge.claims = {}
            edge.osm_tags = {"highway": "footway", "footway": "sidewalk"}
    result = plan_route(world, "park-b", "playground", "wheelchair")
    route = result.routes[0]
    assert result.status == route.status == "likely_ok"
    assert route.access_metres["likely_ok"] == route.distance_m
    assert all(s.eval == "UNKNOWN" and s.access_level == "likely_ok" for s in route.segments)
    assert all(s.rule_id and s.tags_used for s in route.segments)
    assert any("not checked on site" in w for w in result.warnings)
    result = plan_route(world, "park-b", "playground", "wheelchair", "stage_p3m")
    assert result.status != "confirmed"


def test_estimate_cannot_hide_a_missing_sidewalk_or_endpoint_flood(world):
    for edge in world.edges.values():
        if edge.type != "steps":
            edge.type = "sidewalk"
            edge.claims = {}
            edge.osm_tags = {"highway": "footway", "footway": "sidewalk"}
    edge = world.edges["seg-ab"]
    edge.type = "street"
    edge.osm_tags = {"highway": "residential"}
    route = plan_route(world, "park-b", "playground", "wheelchair").routes[0]
    assert route.status == "partly_unverified"
    assert route.access_metres["unknown"] > 0
    assert route.access_metres["likely_ok"] > 0
    edge.type = "sidewalk"
    edge.osm_tags = {"highway": "footway", "footway": "sidewalk"}
    world.flood.place_classes["stage_p1m"]["playground"] = "likely_flooded"
    assert plan_route(world, "park-b", "playground", "wheelchair", "stage_p1m").status == "blocked"


def test_centre_rows_without_route_previews_keep_estimated_status(world):
    for edge in world.edges.values():
        if edge.type != "steps":
            edge.type = "sidewalk"
            edge.claims = {}
            edge.osm_tags = {"highway": "footway", "footway": "sidewalk"}
    rows = centres_reachability(world, None, "wheelchair", "park-b", top_routes=0)
    estimated = [
        r for r in rows if r.reachable and r.centre.node_id != world.places["park-b"].node_id
    ]
    assert estimated
    assert all(r.route_status == "likely_ok" for r in estimated)


@pytest.mark.parametrize("mode", ["wheelchair", "stroller", "drive"])
def test_impassable_tag_wins_over_estimate(world, mode):
    edge = world.edges["seg-ab"].model_copy(deep=True)
    edge.type = "street" if mode == "drive" else "sidewalk"
    edge.osm_tags = {
        "highway": "residential" if mode == "drive" else "footway",
        "surface": "concrete",
        "smoothness": "impassable",
    }
    assert assess_access(edge, world.profiles[mode]).level == "barrier"


def test_undated_staff_claims_cannot_establish_current_verification(world):
    edge = world.edges["seg-ab"].model_copy(deep=True)
    for c in edge.claims.values():
        c.evidence_type = "field_survey"
        c.verified_by = "staff"
        c.verified_at = None
    assert assess_access(edge, world.profiles["wheelchair"]).level == "unknown"


def test_unpreviewed_centres_still_respect_rest_limit(world):
    from townshiplens_spatial.models import EvacCentre

    for cid, node in [("origin", "n-a"), ("near", "n-b"), ("far", "n-d")]:
        world.centres[cid] = EvacCentre(
            id=cid, name=cid, coord=world.node_coords[node], node_id=node, source="osm_candidate"
        )
    rows = centres_reachability(world, None, "older_adult_rest", "park-b")
    far = next(r for r in rows if r.centre.id == "far")
    assert far.route_id is None
    assert far.route_status == "partly_unverified"


def test_impassable_smoothness_is_not_a_pedestrian_prohibition(world):
    edge = world.edges["seg-ab"].model_copy(deep=True)
    edge.osm_tags = {"highway": "footway", "smoothness": "impassable"}
    assert assess_access(edge, world.profiles["default"]).level != "barrier"
