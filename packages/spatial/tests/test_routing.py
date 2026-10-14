from tests_support import add_roads
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


def test_island_in_other_component_is_no_data(world):
    # island-hut is not joined to the rest of the mapped graph: a data gap, not a barrier
    assert plan_route(world, "park-b", "island-hut", "stroller").status == "no_data"


def test_default_profile_uses_steps(world):
    rr = plan_route(world, "park-b", "toilet-1", "default")
    assert rr.status == "confirmed"


def test_scenario_reroutes(world):
    rr = plan_route(world, "park-b", "playground", "stroller", "stage_p3m")
    assert all(s.edge_id != "seg-cd" for r in rr.routes for s in r.segments)


def test_drive_routes_on_roads_only(world):
    add_roads(world)
    rr = plan_route(world, "park-b", "park-c", "drive")
    assert rr.routes, rr
    r = rr.routes[0]
    ids = [s.edge_id for s in r.segments]
    assert ids == ["rd-1", "rd-2"]
    assert not {world.edges[i].type for i in ids} & {"footway", "steps", "path", "ramp"}
    # never confirmed: one-way and turn restrictions are not modelled
    assert r.status == "partly_unverified" and rr.status == "partly_unverified"
    assert any("one-way" in w for w in rr.warnings)
    # 165 m at the drive speed, not at walking speed
    assert r.est_minutes == round(165 / (world.profiles["drive"].speed_kmh * 1000 / 60), 1)
    assert r.est_minutes < 165 / 70


def test_drive_snaps_footway_only_place_to_road_within_cap(world):
    add_roads(world)
    # the playground's node is footway-only, ~78 m from the road node n-z
    assert all(world.edges[k].type != "street" for _, _, k in world.graph.edges("n-d", keys=True))
    rr = plan_route(world, "park-b", "playground", "drive")
    assert rr.routes and rr.status == "partly_unverified"
    assert [s.edge_id for s in rr.routes[0].segments] == ["rd-1", "rd-2"]


def test_drive_place_beyond_snap_cap_is_no_data_not_blocked(world):
    add_roads(world)
    rr = plan_route(world, "park-b", "island-hut", "drive")
    assert rr.status == "no_data" and not rr.routes
    assert any("no mapped road within 150 m of island-hut" in w for w in rr.warnings)


def test_drive_disconnected_road_components_is_no_data_not_blocked(world):
    add_roads(world)
    from townshiplens_spatial.models import Edge

    # a second, separate road piece at the island hut (its own node, beside n-h)
    world.node_coords.update({"n-r1": [101.512, 3.182], "n-r2": [101.5125, 3.182]})
    e = Edge(
        id="rd-far",
        type="street",
        from_node="n-r1",
        to_node="n-r2",
        coords=[[101.512, 3.182], [101.5125, 3.182]],
        length_m=55.0,
    )
    world.edges[e.id] = e
    world.graph.add_edge("n-r1", "n-r2", key=e.id, edge_id=e.id)
    rr = plan_route(world, "park-b", "island-hut", "drive")
    assert rr.status == "no_data" and not rr.routes
    assert any("mapped roads do not connect" in w for w in rr.warnings)


def test_drive_flood_cut_road_is_blocked(world):
    add_roads(world)
    world.flood.edge_classes["stage_p3m"]["rd-1"] = "likely_flooded"
    rr = plan_route(world, "park-b", "park-c", "drive", "stage_p3m")
    assert rr.status == "blocked"


def test_drive_without_any_roads_is_no_data(world):
    rr = plan_route(world, "park-b", "playground", "drive")
    assert rr.status == "no_data" and not rr.routes


def test_walking_unaffected_by_drive_roads_and_warning(world):
    before = plan_route(world, "park-b", "playground", "stroller")
    add_roads(world)
    after = plan_route(world, "park-b", "playground", "stroller")
    assert after.status == "confirmed" and not after.warnings
    assert [s.edge_id for s in after.routes[0].segments] == ["seg-ab", "seg-bc", "seg-cd"]
    assert after.routes[0].distance_m == before.routes[0].distance_m


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


# --- C3: no_data (data gap) vs blocked (known FAIL) ---------------------------
def _add_walk_node(world, nid, place_id, etype, near="n-a", lonlat=(101.5085, 3.181)):
    from townshiplens_spatial.models import Edge, Place

    world.node_coords[nid] = list(lonlat)
    if etype is not None:
        e = Edge(
            id=f"e-{nid}",
            type=etype,
            from_node=near,
            to_node=nid,
            coords=[world.node_coords[near], list(lonlat)],
            length_m=40.0,
        )
        world.edges[e.id] = e
        world.graph.add_edge(near, nid, key=e.id, edge_id=e.id)
    else:
        world.graph.add_node(nid)
    world.places[place_id] = Place(
        id=place_id, type="facility", name=place_id, coord=list(lonlat), node_id=nid
    )


def test_walk_two_components_no_fail_edges_is_no_data(world):
    _add_walk_node(world, "n-q", "lone", None)  # no edge touches it: separate component
    for prof in ("default", "stroller", "wheelchair"):
        rr = plan_route(world, "park-b", "lone", prof)
        assert rr.status == "no_data" and not rr.routes and not rr.blocked_reasons
        assert any("mapped paths do not connect park-b and lone" in w for w in rr.warnings)


def test_walk_connected_but_only_path_has_fail_edge_is_blocked(world):
    _add_walk_node(world, "n-q", "up-steps", "steps")  # reachable only over steps
    assert plan_route(world, "park-b", "up-steps", "default").status == "confirmed"
    rr = plan_route(world, "park-b", "up-steps", "stroller")
    assert rr.status == "blocked" and rr.blocked_reasons
