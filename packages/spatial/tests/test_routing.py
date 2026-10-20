import pytest
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
    # Never confirmed: legal turn restrictions remain unmodelled.
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

from rest_support import add_rest as _add_rest  # noqa: E402
from rest_support import rest_detour as _rest_detour  # noqa: E402
from townshiplens_spatial import routing  # noqa: E402


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


def test_rest_fallback_minimises_longest_gap_before_route_weight(world):
    from rest_support import add_edge

    add_edge(world, "shortcut", "n-a", "n-d", 180.0)
    rr = plan_route(world, "park-b", "playground", "older_adult_rest")
    route = rr.routes[0]
    assert _ids(route) == ["seg-ab", "seg-bc", "seg-cd"]
    assert route.distance_m == 222.4
    assert route.max_gap_between_rest_m == 111.2
    assert route.rest_limit_met is False
    assert rr.status == "partly_unverified"
    # Profiles without a rest limit still prefer the shorter route.
    assert _ids(plan_route(world, "park-b", "playground", "default").routes[0]) == ["shortcut"]


def test_rest_fallback_can_use_unverified_edges_for_a_smaller_gap(world):
    from rest_support import add_edge
    from townshiplens_spatial.models import Claim

    add_edge(world, "shortcut", "n-a", "n-d", 180.0)
    world.edges["seg-cd"].claims["incline_pct"] = Claim()
    rr = plan_route(world, "park-b", "playground", "older_adult_rest")
    assert _ids(rr.routes[0]) == ["seg-ab", "seg-bc", "seg-cd"]
    assert rr.max_rest_gap_m == 111.2
    assert rr.status == "partly_unverified"
    assert any(u["element_id"] == "seg-cd" for u in rr.routes[0].unknowns)


def test_rest_fallback_remembers_earlier_gaps_after_reaching_a_bench(world):
    from rest_support import add_edge

    world.graph.clear()
    add_edge(world, "direct-bench", "n-a", "n-c", 180)
    add_edge(world, "first-rest", "n-a", "n-b", 110)
    add_edge(world, "second-rest", "n-b", "n-c", 110)
    add_edge(world, "finish", "n-c", "n-d", 110)
    _add_rest(world, "bench-b", "n-b")
    rr = plan_route(world, "park-b", "playground", "older_adult_rest")
    assert _ids(rr.routes[0]) == ["first-rest", "second-rest", "finish"]
    assert rr.max_rest_gap_m == 110


def test_rest_fallback_breaks_equal_gap_ties_by_route_weight(world):
    from rest_support import add_edge

    add_edge(world, "detour-start", "n-a", "n-r", 111.2)
    add_edge(world, "detour-middle", "n-r", "n-s", 10)
    add_edge(world, "detour-end", "n-s", "n-d", 111.2)
    _add_rest(world, "bench-r", "n-r")
    _add_rest(world, "bench-s", "n-s")
    rr = plan_route(world, "park-b", "playground", "older_adult_rest")
    assert _ids(rr.routes[0]) == ["seg-ab", "seg-bc", "seg-cd"]
    assert rr.max_rest_gap_m == 111.2


def test_rest_fallback_restores_harmoni_bench_route():
    import pytest
    from townshiplens_spatial.world import load_world

    if not (SEED / "site.json").exists():
        pytest.skip("Elmina seed not built")
    rr = plan_route(load_world(SEED), "osm-way-909868201", "park-b", "older_adult_rest")
    route = rr.routes[0]
    assert route.distance_m == pytest.approx(966, abs=1)
    assert route.max_gap_between_rest_m == pytest.approx(640, abs=1)
    assert [r["place_id"] for r in route.rest_points if r["place_id"].startswith("bench-")] == [
        "bench-urban-3",
        "bench-urban-2",
        "bench-urban-1",
    ]
    assert route.rest_limit_met is False
    assert rr.status == "partly_unverified"


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
        # Best of 3 per route: ignores scheduler noise (e.g. parallel test runs), still
        # catches a real algorithmic slowdown.
        best = float("inf")
        for _ in range(3):
            t0 = time.perf_counter()
            rr = plan_route(w, t["from_id"], t["to_id"], "older_adult_rest")
            best = min(best, time.perf_counter() - t0)
        worst = max(worst, best)
        for r in rr.routes:
            assert r.status != "confirmed" or r.rest_limit_met, t["id"]
    assert worst < 2.0, f"slowest older-adult route took {worst:.2f}s"


def test_rest_gap_warning_rounds_to_10_m_but_never_down_to_the_limit():
    assert routing._about_m(111.2, 100) == 110
    assert routing._about_m(146.0, 100) == 150
    assert routing._about_m(103.0, 100) == 110  # "about 100 m (limit 100 m)" would read as OK
    assert routing._about_m(100.4, 100) == 110


# --- Task 41 fix round 1: tri-state rest points (review I-1, ruling R30) ----------------------
from rest_support import detour_spur, rest_claim  # noqa: E402


@pytest.mark.parametrize("status", ["verified", "reported"])
def test_rest_point_recorded_absent_never_counts(world, status):
    _rest_detour(world, claims=rest_claim(present=False, status=status))
    rr = plan_route(world, "park-b", "playground", "older_adult_rest")
    r0 = rr.routes[0]
    assert r0.rest_limit_met is False and rr.status == "partly_unverified"
    assert "rest-r" not in {p["place_id"] for p in r0.rest_points}
    assert any("longest stretch without a rest point" in w for w in rr.warnings)


@pytest.mark.parametrize(
    "claims",
    [
        None,  # OSM-only: no claim at all
        rest_claim(status="unknown"),
        rest_claim(status="reported"),  # reported present is not enough to promise a seat
        rest_claim(verified_at="2020-01-01"),  # verified long ago: stale
        rest_claim(typ="shelter", status="contested"),
    ],
    ids=["osm_only", "unknown", "reported_present", "stale", "contested_shelter"],
)
def test_unverified_rest_point_counts_only_leniently(world, claims):
    typ = "shelter" if claims and "shelter" in claims else "seating"
    _rest_detour(world, typ=typ, claims=claims)
    rr = plan_route(world, "park-b", "playground", "older_adult_rest")
    r0 = rr.routes[0]
    assert _ids(r0) == ["seg-ab", "seg-bc", "seg-cr", "seg-rd"]
    assert rr.status == "partly_unverified" and r0.status == "partly_unverified"
    assert r0.rest_limit_met is True and r0.unknowns == []  # every segment is PASS
    assert r0.rest_points_unverified == ["rest-r"]
    assert {"place_id": "rest-r", "status": "unverified"}.items() <= next(
        p for p in r0.rest_points if p["place_id"] == "rest-r"
    ).items()
    assert any("Rest rest-r" in w and "not checked yet" in w for w in rr.warnings), rr.warnings
    assert not any("longest stretch" in w for w in rr.warnings)


def test_verified_rest_point_confirms_and_lists_as_verified(world):
    _rest_detour(world)  # rest-r verified present today
    rr = plan_route(world, "park-b", "playground", "older_adult_rest")
    r0 = rr.routes[0]
    assert rr.status == "confirmed" and r0.rest_points_unverified == []
    assert {p["status"] for p in r0.rest_points} == {"verified"}


def test_unverified_rest_points_file_no_verification_requests(world, tmp_path):
    from townshiplens_spatial import tools
    from townshiplens_spatial.vr_store import VerificationStore

    _rest_detour(world, claims=None)
    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    r = tools.plan_route(ctx, "park-b", "playground", "older_adult_rest")
    assert r.data["status"] == "partly_unverified"
    assert r.data["verification_requests"] == []


def test_review_i1_reproduction_is_never_confirmed(world):
    from townshiplens_spatial.models import Claim

    _rest_detour(world, claims=rest_claim(status="unknown"))
    world.places["bench-b"].claims = rest_claim(present=False)  # staff: gone
    world.places["bench-1"].claims = {
        "seating": Claim(value=None, status="unknown", notes="bench removed")
    }
    rr = plan_route(world, "park-b", "playground", "older_adult_rest")
    assert rr.status != "confirmed" and all(r.status != "confirmed" for r in rr.routes)
    assert "bench-b" not in {p["place_id"] for r in rr.routes for p in r.rest_points}


# --- fix round 1 Minors ---------------------------------------------------------------------
def test_detour_route_lists_each_unknown_and_evidence_once(world):
    detour_spur(world)
    rr = plan_route(world, "park-b", "playground", "older_adult_rest")
    r0 = rr.routes[0]
    assert _ids(r0) == ["seg-ab", "seg-bc", "seg-cm", "seg-mr", "seg-mr", "seg-md"]
    assert r0.distance_m == 232.4 and r0.rest_limit_met is True
    assert [u["element_id"] for u in r0.unknowns] == ["seg-mr"]
    assert len(r0.evidence_ids) == len(set(r0.evidence_ids))
    assert [p["place_id"] for p in r0.rest_points] == ["bench-b", "bench-1", "rest-r"]


def test_other_profiles_count_shelters_as_rest_points_review_m2(world):
    # Disclosed change (review M-2): rest_points / max_gap now count shelters for every profile.
    _add_rest(world, "shelter-b", "n-b", "shelter")
    r0 = plan_route(world, "park-b", "playground", "stroller").routes[0]
    assert [p["place_id"] for p in r0.rest_points] == ["shelter-b", "bench-1"]
    assert r0.max_gap_between_rest_m == 111.2 and r0.rest_limit_met is None


def test_strict_rest_search_stopped_early_is_still_warned(world, monkeypatch):
    from townshiplens_spatial.models import Claim

    _rest_detour(world)
    world.edges["seg-cr"].claims["incline_pct"] = Claim()
    real = routing._rest_search

    def strict_truncates(world, sources, targets, profile, scenario_id, allow_unknown, limit):
        if not allow_unknown:
            return None, [], {}, True
        return real(world, sources, targets, profile, scenario_id, allow_unknown, limit)

    monkeypatch.setattr(routing, "_rest_search", strict_truncates)
    rr = plan_route(world, "park-b", "playground", "older_adult_rest")
    assert rr.routes[0].rest_limit_met is True and rr.rest_search_truncated is True
    assert any("rest-point search stopped early" in w for w in rr.warnings)


def test_rest_search_cap_is_bounded_on_a_dense_grid(world, monkeypatch):
    """Review M-5: the seed never exercises the label cap; a dense synthetic grid does."""
    from townshiplens_spatial.models import Edge

    n, step = 120, 12.0
    world.edges.clear()
    world.graph.clear()
    world._place_by_node.clear()
    for i in range(n):
        for j in range(n):
            world.node_coords[f"g{i}.{j}"] = [101.5 + i * 1e-4, 3.18 + j * 1e-4]
    like = world_edge_template()
    for i in range(n):
        for j in range(n):
            for di, dj in ((1, 0), (0, 1)):
                if i + di < n and j + dj < n:
                    a, b = f"g{i}.{j}", f"g{i + di}.{j + dj}"
                    e = Edge(**{**like, "id": f"e{a}-{b}", "from_node": a, "to_node": b,
                                "coords": [world.node_coords[a], world.node_coords[b]],
                                "length_m": step})  # fmt: skip
                    world.edges[e.id] = e
                    world.graph.add_edge(a, b, key=e.id, edge_id=e.id)
            if (i * 7 + j * 3) % 50 == 0:
                _add_rest(world, f"r{i}.{j}", f"g{i}.{j}")
    world.graph.add_node("island")  # unreachable target: the search runs until the cap or done
    prof = world.profiles["older_adult_rest"].model_copy(update={"max_rest_free_run_m": 300})
    t0 = time.perf_counter()
    nodes, _, _, truncated = routing._rest_search(
        world, ["g0.0"], ["island"], prof, None, True, 300
    )
    took = time.perf_counter() - t0
    assert nodes is None
    assert took < 5.0, f"rest search took {took:.2f}s"
    assert truncated or took < 5.0


def world_edge_template() -> dict:
    """A verified, step-free, flat footway's fields (claims dated today)."""
    from datetime import date

    from townshiplens_spatial.models import Claim

    today = date.today().isoformat()
    v = {"status": "verified", "verified_at": today}
    return {
        "type": "footway",
        "claims": {
            "step_count": Claim(value=0, **v),
            "incline_pct": Claim(value=1, **v),
            "width_m": Claim(value=1.5, **v),
        },
    }


def test_confirmed_route_over_placeholder_evidence_is_flagged_demo(world):
    # Status stays `confirmed` (the evaluation is correct); the flag lets the UI and agent say
    # "confirmed on demo values, not yet surveyed".
    rr = plan_route(world, "park-b", "playground", "stroller")
    assert rr.status == "confirmed" and rr.routes[0].status == "confirmed"
    assert rr.routes[0].demo_evidence is True and rr.demo_evidence is True


def test_route_without_placeholder_evidence_is_not_flagged(world):
    for eid in ("seg-ab", "seg-bc", "seg-cd"):
        for c in world.edges[eid].claims.values():
            c.evidence_type = "field_survey"
    rr = plan_route(world, "park-b", "playground", "stroller")
    assert rr.status == "confirmed"
    assert rr.routes[0].demo_evidence is False and rr.demo_evidence is False


def test_no_route_result_is_not_demo(world):
    rr = plan_route(world, "park-b", "moon-base", "stroller")
    assert rr.demo_evidence is False


def test_route_evidence_carries_photo_url_only_for_uploaded_hex_ids(world):  # task 34 M8
    from townshiplens_spatial.routing import evidence_for_route

    photo = "ab" * 16
    world.edges["seg-ab"].claims["step_count"].evidence_ids = ["note-7", photo]
    world.edges["seg-bc"].claims["step_count"].evidence_ids = ["note-7"]
    rr = plan_route(world, "park-b", "playground", "stroller")
    ev = {e.id: e for e in evidence_for_route(world, rr.routes[0])}
    assert ev["ev-seg-ab.step_count"].photo_url == f"/evidence/{photo}"
    assert ev["ev-seg-bc.step_count"].photo_url is None


def test_drive_route_says_when_a_place_is_snapped_to_a_road(world):  # task 26 Minor 1
    add_roads(world)
    rr = plan_route(world, "park-b", "playground", "drive")
    notes = [w for w in rr.warnings if "nearest mapped road" in w]
    # park-b is ~55 m and the playground ~78 m off the road spur: both are named, rounded to 10 m
    assert any(w.startswith("Car Park B is about 60 m") for w in notes), rr.warnings
    assert any("Playground is about 80 m" in w or "playground" in w.lower() for w in notes)
    on_road = plan_route(world, "park-b", "park-c", "drive")  # park-c sits on a road node
    assert not any(w.startswith("Car Park C") for w in on_road.warnings)
    assert not [
        w for w in plan_route(world, "park-b", "playground", "stroller").warnings if "road" in w
    ]


def test_snap_to_road_breaks_ties_by_node_id(world):  # task 26 Minor 5
    from townshiplens_spatial.routing import _snap_to_road

    world.node_coords.update({"n-t1": [101.5, 3.18], "n-t2": [101.5, 3.18]})
    for roads in ({"n-t1", "n-t2"}, {"n-t2", "n-t1"}):
        assert _snap_to_road(world, roads, "n-none", [101.5, 3.18]) == "n-t1"


def test_elmina_seed_pins_the_task_31_major_road_outcomes():  # task 31 M-6
    import pytest
    from townshiplens_spatial.sim import default_tasks
    from townshiplens_spatial.world import load_world

    if not (SEED / "site.json").exists():
        pytest.skip("Elmina seed not built")
    w = load_world(SEED)
    roads = [e for e in w.edges.values() if e.type == "major_road"]
    assert roads
    # OSM gives no width or surface for major roads here, so none may carry such a claim
    assert not [e.id for e in roads if {"width_m", "surface"} & set(e.claims)]
    hero = plan_route(w, "park-b", "playground", "stroller")
    # T-020: the demo width/slope values do not establish a mapped sidewalk on roads.
    assert hero.status == "partly_unverified"
    assert hero.routes[0].distance_m == pytest.approx(416.4, abs=1)
    assert hero.routes[0].road_without_mapped_sidewalk_m > 0
    # a confirmed route never crosses a major road (no verified sidewalk anywhere on the seed)
    major = {e.id for e in roads}
    for prof in ("stroller", "wheelchair", "older_adult_rest"):
        tasks = default_tasks(w, [prof])
        for t in tasks[:: max(1, len(tasks) // 8)]:
            rr = plan_route(w, t["from_id"], t["to_id"], prof)
            for r in rr.routes:
                if r.status == "confirmed":
                    assert not major & {s.edge_id for s in r.segments}, t["id"]


def _nx_reference_search(world, sources, targets, profile, scenario_id, allow_unknown):
    """The pre-Task-53 `_search`: networkx on a copy with a super-source and super-target."""
    import networkx as nx
    from townshiplens_spatial.routing import make_weight

    evals, chosen = {}, {}
    weight = make_weight(world, profile, scenario_id, allow_unknown, evals, chosen)
    h = nx.MultiGraph(world.graph)
    for s in sources:
        h.add_edge("__S__", s, key="__s__" + s)
    for t in targets:
        h.add_edge(t, "__T__", key="__t__" + t)

    def w2(u, v, data):
        return 0.0 if any(str(k).startswith("__") for k in data) else weight(u, v, data)

    try:
        path = nx.dijkstra_path(h, "__S__", "__T__", weight=w2)
    except nx.NetworkXNoPath:
        return None, [], evals
    nodes = path[1:-1]
    return nodes, [chosen[(u, v)] for u, v in zip(nodes, nodes[1:], strict=False)], evals


def test_search_matches_the_networkx_reference_without_copying_the_graph(world):
    from townshiplens_spatial.routing import _search, _targets

    add_roads(world)
    places = sorted(p for p in world.places if not p.startswith("__"))
    checked = 0
    for prof in ("stroller", "default", "drive", "wheelchair"):
        profile = world.profiles[prof]
        for sc in (None, "stage_p3m"):
            for a in places:
                for b in places:
                    src, dst = _targets(world, a, profile), _targets(world, b, profile)
                    if not src or not dst:
                        continue
                    for lenient in (False, True):
                        want = _nx_reference_search(world, src, dst, profile, sc, lenient)
                        got = _search(world, src, dst, profile, sc, lenient)
                        assert got[:2] == want[:2], (prof, sc, a, b, lenient)
                        checked += 1
    assert checked > 200


def test_search_matches_the_reference_on_the_elmina_seed():
    import random

    import pytest
    from townshiplens_spatial.routing import _search, _targets
    from townshiplens_spatial.sim import default_tasks
    from townshiplens_spatial.world import load_world

    if not (SEED / "site.json").exists():
        pytest.skip("Elmina seed not built")
    w = load_world(SEED)
    tasks = default_tasks(w, ["stroller", "wheelchair"])
    for t in random.Random(53).sample(tasks, 12):
        profile = w.profiles[t["profile"]]
        src, dst = _targets(w, t["from_id"], profile), _targets(w, t["to_id"], profile)
        for lenient in (False, True):
            want = _nx_reference_search(w, src, dst, profile, None, lenient)
            assert _search(w, src, dst, profile, None, lenient)[:2] == want[:2], t["id"]
