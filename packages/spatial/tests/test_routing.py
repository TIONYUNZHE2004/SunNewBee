from townshiplens_spatial.routing import plan_route


def test_confirmed(world):
    rr = plan_route(world, "park-b", "playground", "stroller")
    assert rr.status == "confirmed"
    assert [s.edge_id for s in rr.routes[0].segments] == ["seg-ab", "seg-bc", "seg-cd"]


def test_partly_unverified(world):
    rr = plan_route(world, "park-b", "kiosk", "stroller")
    assert rr.status == "partly_unverified"
    assert rr.routes[0].unknowns[0]["element_id"] == "seg-cf"


def test_no_data_unknown_place(world):
    assert plan_route(world, "park-b", "moon-base", "stroller").status == "no_data"
    assert plan_route(world, "park-b", "does-not-exist", "stroller").status == "no_data"


def test_blocked_island(world):
    assert plan_route(world, "park-b", "island-hut", "stroller").status == "blocked"


def test_default_profile_uses_steps(world):
    rr = plan_route(world, "park-b", "toilet-1", "default")
    assert rr.status == "confirmed"


def test_scenario_reroutes(world):
    rr = plan_route(world, "park-b", "playground", "stroller", "stage_p3m")
    assert all(s.edge_id != "seg-cd" for r in rr.routes for s in r.segments)


def test_drive_is_stubbed(world):
    rr = plan_route(world, "park-b", "playground", "drive")
    assert rr.status == "no_data" and "drive" in rr.warnings[0]


def test_route_geometry_is_linestring(world):
    g = plan_route(world, "park-b", "playground", "stroller").routes[0].geometry
    assert g["type"] == "LineString" and len(g["coordinates"]) >= 4


# --- regression: parallel edges (review fix) -------------------------------
from townshiplens_spatial.models import Claim  # noqa: E402


def _add_parallel(world, base_id, new_id, length, unknown_incline=True):
    e = world.edges[base_id].model_copy(deep=True, update={"id": new_id, "length_m": length})
    if unknown_incline:
        e.claims["incline_pct"] = Claim()
    world.edges[new_id] = e
    world.graph.add_edge(e.from_node, e.to_node, key=new_id, edge_id=new_id)


def test_strict_route_never_uses_unknown_parallel_edge(world):
    _add_parallel(world, "seg-bc", "seg-bc-par", 40.0)
    rr = plan_route(world, "park-b", "playground", "stroller")
    assert rr.status == "confirmed"
    r0 = rr.routes[0]
    assert r0.status == "confirmed" and r0.unknowns == []
    assert all(s.eval == "PASS" for s in r0.segments)
    assert [s.edge_id for s in r0.segments] == ["seg-ab", "seg-bc", "seg-cd"]


def test_parallel_failed_edge_not_used_for_distance_or_rest_gap(world):
    _add_parallel(world, "seg-bc", "seg-bc-steps", 5.0, unknown_incline=False)
    world.edges["seg-bc-steps"].claims["step_count"] = Claim(value=4, status="reported")
    r0 = plan_route(world, "park-b", "playground", "stroller").routes[0]
    assert r0.distance_m == 222.4
    assert r0.max_gap_between_rest_m == 111.2  # bench at n-c: a->c 111.2, then c->d 111.2


def test_lenient_alternative_is_offered_when_much_shorter(world):
    _add_parallel(world, "seg-cd", "seg-cd-short", 20.0)
    rr = plan_route(world, "park-b", "playground", "stroller")
    assert rr.status == "confirmed" and len(rr.routes) == 2
    assert rr.routes[0].status == "confirmed"
    alt = rr.routes[1]
    assert alt.status == "partly_unverified"
    assert alt.distance_m < 0.8 * rr.routes[0].distance_m
    assert [s.edge_id for s in alt.segments][-1] == "seg-cd-short"


def test_status_derived_from_first_route(world):
    rr = plan_route(world, "park-b", "kiosk", "stroller")
    assert rr.status == rr.routes[0].status


def test_unknown_id_vs_unmapped_place_warning(world):
    assert "no such place" in plan_route(world, "park-b", "nope", "stroller").warnings[0]
    assert "place not mapped" in plan_route(world, "park-b", "moon-base", "stroller").warnings[0]
