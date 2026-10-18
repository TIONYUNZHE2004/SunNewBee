"""Task 31 outcomes pinned on the committed Elmina seed (review M-6): a later re-import must not
silently break them. Skipped when the seed is absent."""

from pathlib import Path

import pytest
from townshiplens_spatial.routing import plan_route
from townshiplens_spatial.sim import default_tasks
from townshiplens_spatial.world import load_world

SEED = Path(__file__).resolve().parents[2] / "seed" / "elmina"

pytestmark = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")


@pytest.fixture(scope="module")
def world():
    return load_world(SEED)


def _major(world, route) -> list[str]:
    return [s.edge_id for s in route.segments if world.edges[s.edge_id].type == "major_road"]


def test_hero_route_is_confirmed_at_about_440_m_without_a_major_road(world):
    rr = plan_route(world, "park-b", "playground", "stroller")
    assert rr.status == "confirmed"
    assert rr.routes[0].distance_m == pytest.approx(440.6, abs=0.5)
    assert not _major(world, rr.routes[0])
    assert rr.routes[0].road_m == pytest.approx(151.8, abs=0.1)
    assert rr.routes[0].road_without_mapped_sidewalk_m == rr.routes[0].road_m
    # These footways have no sidewalk subtag; preserve that gap instead of relabelling them.
    assert rr.routes[0].sidewalk_m == 0


def test_surau_route_exposes_its_road_centre_line_distance(world):
    rr = plan_route(world, "osm-way-910405528", "osm-way-910378231", "default")
    assert rr.status == "confirmed"
    route = rr.routes[0]
    assert route.distance_m == pytest.approx(363.8, abs=0.5)
    assert route.road_without_mapped_sidewalk_m == pytest.approx(352.0, abs=0.1)
    assert route.sidewalk_m == 0
    assert any("sidewalk access is not verified" in warning for warning in rr.warnings)


def test_a_real_mapped_sidewalk_is_used_without_turning_osm_into_survey_data(world):
    rr = plan_route(world, "osm-node-10177746975", "osm-node-11361643136", "default")
    assert rr.routes
    route = rr.routes[0]
    assert route.distance_m == pytest.approx(76.8, abs=0.5)
    assert route.sidewalk_m == route.distance_m and route.road_m == 0
    assert {world.edges[s.edge_id].type for s in route.segments} == {"sidewalk"}


def test_seed_preserves_reported_sidewalk_and_crossing_tags(world):
    sidewalks = [e for e in world.edges.values() if e.type == "sidewalk"]
    crossings = [e.claims["crossing"] for e in world.edges.values() if "crossing" in e.claims]
    road_claims = [
        e.claims["sidewalk"]
        for e in world.edges.values()
        if e.type == "street" and "sidewalk" in e.claims
    ]
    assert sidewalks and crossings and road_claims
    assert all(
        c.status == "reported" and c.evidence_type == "osm_import" for c in crossings + road_claims
    )


def test_major_roads_carry_no_width_or_surface_claims(world):
    """OSM has neither for these ways here: a survey, not the import, has to provide them."""
    roads = [e for e in world.edges.values() if e.type == "major_road"]
    assert roads
    assert not [e.id for e in roads if {"width_m", "surface"} & set(e.claims)]


def test_no_confirmed_strict_profile_route_crosses_a_major_road(world):
    """Strict profiles need a verified sidewalk on a major road, and none is verified."""
    checked = 0
    for profile in ("stroller", "wheelchair"):
        tasks = default_tasks(world, [profile])
        for t in tasks[:: max(1, len(tasks) // 12)]:
            rr = plan_route(world, t["from_id"], t["to_id"], profile)
            for r in rr.routes:
                checked += 1
                assert r.status != "confirmed" or not _major(world, r), (profile, t["id"])
    assert checked
