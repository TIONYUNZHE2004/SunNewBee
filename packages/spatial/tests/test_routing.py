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


def _retype_major(world, edge_id, sidewalk=None, status="reported"):
    from datetime import date

    from townshiplens_spatial.models import Claim

    e = world.edges[edge_id].model_copy(deep=True, update={"type": "major_road"})
    if sidewalk:
        e.claims["sidewalk"] = Claim(
            value=sidewalk,
            status=status,
            evidence_type="osm_import",
            verified_at=date.today().isoformat() if status == "verified" else None,
        )
    world.edges[edge_id] = e


def test_route_over_major_road_without_sidewalk_data_is_never_confirmed(world):
    _retype_major(world, "seg-ab")  # the only way out of park-b
    for pid in ("default", "stroller", "wheelchair", "older_adult_rest"):
        rr = plan_route(world, "park-b", "lakeside-mall", pid)
        assert rr.status == "partly_unverified", pid
        assert {"element_id": "seg-ab", "attribute": "sidewalk"}.items() <= rr.routes[0].unknowns[
            0
        ].items()


def test_route_over_major_road_with_reported_sidewalk_is_confirmed_only_for_default(world):
    _retype_major(world, "seg-ab", "both")  # reported (OSM)
    assert plan_route(world, "park-b", "lakeside-mall", "default").status == "confirmed"
    for pid in ("stroller", "wheelchair", "older_adult_rest"):
        rr = plan_route(world, "park-b", "lakeside-mall", pid)
        assert rr.status == "partly_unverified", pid
        assert rr.routes[0].unknowns[0]["attribute"] == "sidewalk"


def test_route_over_major_road_with_verified_sidewalk_can_be_confirmed(world):
    _retype_major(world, "seg-ab", "both", status="verified")
    assert plan_route(world, "park-b", "lakeside-mall", "default").status == "confirmed"
    assert plan_route(world, "park-b", "lakeside-mall", "stroller").status == "confirmed"


def test_major_road_without_sidewalk_blocks_stroller_not_default(world):
    _retype_major(world, "seg-ab", "none")
    assert plan_route(world, "park-b", "lakeside-mall", "stroller").status == "blocked"
    assert plan_route(world, "park-b", "lakeside-mall", "default").status == "partly_unverified"


# --- Task 41: rest-point-aware routing (older_adult_rest, max_rest_free_run_m) ----------------
import time  # noqa: E402
from pathlib import Path  # noqa: E402

from townshiplens_spatial import routing  # noqa: E402


def _add_edge(world, eid, a, b, length, like="seg-cd"):
    """A verified, step-free footway like `like`, between a and b (b may be a new node)."""
    world.node_coords.setdefault(b, list(world.node_coords[a]))
    e = world.edges[like].model_copy(
        deep=True,
        update={
            "id": eid,
            "from_node": a,
            "to_node": b,
            "length_m": length,
            "coords": [world.node_coords[a], world.node_coords[b]],
        },
    )
    world.edges[eid] = e
    world.graph.add_edge(a, b, key=eid, edge_id=eid)
    return e


def _add_rest(world, pid, node, typ="seating"):
    from townshiplens_spatial.models import Place

    world.places[pid] = Place(
        id=pid, kind="amenity", type=typ, name=pid, coord=world.node_coords[node], node_id=node
    )
    world._place_by_node.setdefault(node, []).append(pid)


def _rest_detour(world, typ="seating"):
    """Tiny + a bench at n-b and a detour n-c -> n-r -> n-d (55 + 60 m) with a rest point at n-r.

    Shortest park-b -> playground is a-b-c-d (222.4 m); its last stretch c->d is 111.2 m without
    a rest point. The detour a-b-c-r-d is 226.2 m and never runs more than 60 m between rests.
    """
    _add_rest(world, "bench-b", "n-b")
    _add_edge(world, "seg-cr", "n-c", "n-r", 55.0)
    _add_edge(world, "seg-rd", "n-r", "n-d", 60.0)
    _add_rest(world, "rest-r", "n-r", typ)


def _ids(route):
    return [s.edge_id for s in route.segments]


def test_rest_profile_takes_slightly_longer_route_within_rest_limit(world):
    _rest_detour(world)
    rr = plan_route(world, "park-b", "playground", "older_adult_rest")
    assert rr.status == "confirmed", rr
    r0 = rr.routes[0]
    assert _ids(r0) == ["seg-ab", "seg-bc", "seg-cr", "seg-rd"]
    assert r0.distance_m == 226.2
    assert r0.max_gap_between_rest_m == 60.0
    assert r0.rest_limit_m == 100 and r0.rest_limit_met is True
    assert rr.max_rest_gap_m == 60.0 and rr.rest_limit_m == 100
    assert not any("rest point" in w for w in rr.warnings)
    assert all(len(_ids(r)) and r.max_gap_between_rest_m <= 100 for r in rr.routes)


def test_shelter_counts_as_a_rest_point(world):
    _rest_detour(world, typ="shelter")
    rr = plan_route(world, "park-b", "playground", "older_adult_rest")
    assert rr.status == "confirmed" and _ids(rr.routes[0])[-2:] == ["seg-cr", "seg-rd"]
    assert {p["place_id"] for p in rr.routes[0].rest_points} >= {"bench-b", "rest-r"}


def test_other_profiles_keep_the_shortest_route(world):
    _rest_detour(world)
    for pid in ("stroller", "wheelchair", "default"):
        rr = plan_route(world, "park-b", "playground", pid)
        assert rr.status == "confirmed", pid
        r0 = rr.routes[0]
        assert _ids(r0) == ["seg-ab", "seg-bc", "seg-cd"], pid
        assert r0.rest_limit_m is None and r0.rest_limit_met is None
        assert rr.rest_limit_m is None and rr.max_rest_gap_m is None
        assert not any("rest point" in w for w in rr.warnings)


def test_no_route_within_rest_limit_is_never_confirmed(world):
    # Tiny as shipped: a->c is 111.2 m before the only bench, and c->d is 111.2 m again.
    rr = plan_route(world, "park-b", "playground", "older_adult_rest")
    assert rr.status == "partly_unverified"
    r0 = rr.routes[0]
    assert _ids(r0) == ["seg-ab", "seg-bc", "seg-cd"]  # best route by the existing order
    assert r0.status == "partly_unverified" and r0.unknowns == []
    assert r0.rest_limit_m == 100 and r0.rest_limit_met is False
    assert rr.max_rest_gap_m == 111.2 and rr.rest_limit_m == 100
    assert "longest stretch without a rest point is about 110 m (limit 100 m)" in rr.warnings
    assert all(r.status != "confirmed" for r in rr.routes)


def test_rest_limit_prefers_unverified_route_within_limit_over_verified_one_over_it(world):
    _rest_detour(world)
    from townshiplens_spatial.models import Claim

    world.edges["seg-cr"].claims["incline_pct"] = Claim()  # unknown
    rr = plan_route(world, "park-b", "playground", "older_adult_rest")
    assert rr.status == "partly_unverified"
    r0 = rr.routes[0]
    assert _ids(r0) == ["seg-ab", "seg-bc", "seg-cr", "seg-rd"]
    assert r0.rest_limit_met is True and r0.max_gap_between_rest_m <= 100
    assert [u["element_id"] for u in r0.unknowns] == ["seg-cr"]
    assert not any("rest point" in w for w in rr.warnings)


def test_rest_search_is_deterministic(world):
    _rest_detour(world)
    a = plan_route(world, "park-b", "playground", "older_adult_rest")
    b = plan_route(world, "park-b", "playground", "older_adult_rest")
    assert a.model_dump() == b.model_dump()


def test_rest_search_label_cap_falls_back_honestly(world, monkeypatch):
    _rest_detour(world)
    monkeypatch.setattr(routing, "MAX_REST_LABELS", 1)
    rr = plan_route(world, "park-b", "playground", "older_adult_rest")
    assert rr.status == "partly_unverified" and rr.routes[0].rest_limit_met is False
    assert any("rest-point search stopped early" in w for w in rr.warnings)


def test_rest_limit_with_flood_scenario_still_avoids_flooded_edges(world):
    _rest_detour(world)
    rr = plan_route(world, "park-b", "playground", "older_adult_rest", "stage_p3m")
    assert all(s.eval != "FAIL" for r in rr.routes for s in r.segments)
    assert all(r.status != "confirmed" or r.rest_limit_met for r in rr.routes)


SEED = Path(__file__).resolve().parents[3] / "data" / "seed" / "elmina"


def test_rest_route_on_elmina_seed_is_fast():
    import pytest
    from townshiplens_spatial.sim import default_tasks
    from townshiplens_spatial.world import load_world

    if not (SEED / "site.json").exists():
        pytest.skip("Elmina seed not built")
    w = load_world(SEED)
    tasks = default_tasks(w, ["older_adult_rest"])
    assert tasks
    worst = 0.0
    for t in tasks[:: max(1, len(tasks) // 10)]:
        t0 = time.perf_counter()
        rr = plan_route(w, t["from_id"], t["to_id"], "older_adult_rest")
        worst = max(worst, time.perf_counter() - t0)
        for r in rr.routes:
            assert r.status != "confirmed" or r.rest_limit_met, t["id"]
    assert worst < 2.0, f"slowest older-adult route took {worst:.2f}s"


def test_rest_gap_warning_rounds_to_10_m_but_never_down_to_the_limit():
    assert routing._about_m(111.2, 100) == 110
    assert routing._about_m(146.0, 100) == 150
    assert routing._about_m(103.0, 100) == 110  # "about 100 m (limit 100 m)" would read as OK
    assert routing._about_m(100.4, 100) == 110
