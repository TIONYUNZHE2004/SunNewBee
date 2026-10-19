import pytest
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore


@pytest.fixture
def ctx(world, tmp_path):
    return tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))


def test_find_place_alias(ctx):
    r = tools.find_place(ctx, "taman permainan")
    assert r.ok and r.data[0]["id"] == "playground"


def test_find_place_unknown(ctx):
    r = tools.find_place(ctx, "take me to the moon")
    assert r.ok and r.data == []
    r2 = tools.find_place(ctx, "")
    assert r2.ok and r2.data == []


def test_plan_route_creates_vr_for_unknown(ctx):
    r = tools.plan_route(ctx, "park-b", "kiosk", "stroller", question_summary="stroller to kiosk")
    assert r.data["status"] == "partly_unverified"
    vrs = r.data["verification_requests"]
    assert vrs and vrs[0]["element_id"] == "seg-cf" and vrs[0]["created"] is True
    r2 = tools.plan_route(ctx, "park-b", "kiosk", "stroller")
    assert r2.data["verification_requests"][0]["created"] is False
    assert r2.data["verification_requests"][0]["demand"] == 2


def test_plan_route_evidence_ids_match(ctx):
    r = tools.plan_route(ctx, "park-b", "playground", "stroller")
    ids = {e.id for e in r.evidence}
    assert set(r.data["routes"][0]["evidence_ids"]) <= ids


def test_place_details_and_nearby(ctx):
    d = tools.get_place_details(ctx, "toilet-1")
    assert d.ok and d.data["claims"]["wheelchair"]["status"] == "unknown"
    n = tools.nearby_amenities(ctx, "park-b", "seating", max_walk_m=200)
    assert n.ok and n.data[0]["id"] == "bench-1"


def test_missing_place_vr(ctx):
    r = tools.create_verification_request(
        ctx, "moon", "existence", "missing_place", "asked for moon"
    )
    assert r.ok and r.data["created"] is True


def test_find_place_prefers_playground_over_substring_alias(ctx):
    r = tools.find_place(ctx, "small playground")
    assert r.data[0]["id"] == "playground"
    assert "lakeside-mall" not in [d["id"] for d in r.data]


def test_find_place_short_query_matches_nothing(ctx):
    assert tools.find_place(ctx, "a").data == []
    assert tools.find_place(ctx, "mall").data[0]["id"] == "lakeside-mall"


def test_find_place_exact_name_beats_alias(ctx):
    assert tools.find_place(ctx, "Park toilet").data[0]["id"] == "toilet-1"


def test_nearby_wheelchair_avoids_steps(ctx):
    n = tools.nearby_amenities(ctx, "park-b", "toilet", max_walk_m=300, profile="wheelchair")
    assert n.ok and n.data[0]["id"] == "toilet-1"
    assert n.data[0]["walk_m"] == 222.4  # a-b-c-f-e, not a-b-e (steps)
    assert n.data[0]["via_unverified"] is True


def test_nearby_default_warns_and_uses_steps(ctx):
    n = tools.nearby_amenities(ctx, "park-b", "toilet", max_walk_m=300)
    assert n.data[0]["walk_m"] == 111.2 and n.data[0]["via_unverified"] is False
    assert n.warnings


def test_nearby_wheelchair_respects_cutoff_when_only_detour(ctx):
    assert tools.nearby_amenities(ctx, "park-b", "toilet", 150, "wheelchair").data == []


def test_nearby_excludes_flooded_destination_even_with_unflooded_connected_path(ctx):
    assert tools.nearby_amenities(ctx, "park-b", "playground", 1000).data
    result = tools.nearby_amenities(ctx, "park-b", "playground", 1000, scenario_id="stage_p3m")
    assert result.ok and result.data == []
    assert any("not a forecast" in warning for warning in result.warnings)


def test_nearby_route_distance_changes_when_flood_cuts_shortcut(ctx):
    ctx.world.flood.edge_classes["stage_p3m"]["seg-be"] = "likely_flooded"
    assert tools.nearby_amenities(ctx, "park-b", "toilet", 150).data
    assert not tools.nearby_amenities(ctx, "park-b", "toilet", 150, scenario_id="stage_p3m").data


def test_missing_place_vr_only_for_mapped_place_without_node(ctx):
    r = tools.plan_route(ctx, "park-b", "moon-base", "stroller")
    assert [v["element_id"] for v in r.data["verification_requests"]] == ["moon-base"]
    r2 = tools.plan_route(ctx, "park-b", "no-such-id", "stroller")
    assert r2.data["verification_requests"] == []
    assert any("no such place" in w for w in r2.warnings)


def test_stale_unknown_files_stale_vr(ctx):
    from townshiplens_spatial.models import Claim

    ctx.world.edges["seg-cf"].claims["incline_pct"] = Claim(
        value=2, status="verified", verified_at="2020-01-01"
    )
    r = tools.plan_route(ctx, "park-b", "kiosk", "stroller")
    vr = r.data["verification_requests"][0]
    assert vr["element_id"] == "seg-cf" and vr["reason"] == "stale"


def test_find_place_cjk_substring(ctx):
    assert tools.find_place(ctx, "附近的厕所在哪里").data[0]["id"] == "toilet-1"
    assert tools.find_place(ctx, "带我去游乐场").data[0]["id"] == "playground"
    assert tools.find_place(ctx, "厕所").data[0]["id"] == "toilet-1"


def test_find_place_phrase_beats_token_and_order_is_deterministic(ctx):
    assert tools.find_place(ctx, "park b").data[0]["id"] == "park-b"
    assert tools.find_place(ctx, "car park b").data[0]["id"] == "park-b"
    assert tools.find_place(ctx, "wc").data == []
    assert tools.find_place(ctx, "a").data == []
    assert tools.find_place(ctx, "take me to the moon").data == []
    assert tools.find_place(ctx, "small playground").data[0]["id"] == "playground"


def test_find_place_the_park_ranks_literal_park_first(ctx):
    from townshiplens_spatial.models import Place

    ctx.world.places["park"] = Place(
        id="park", type="park", name="Park", coord=[101.51, 3.18], node_id="n-a"
    )
    ids = [d["id"] for d in tools.find_place(ctx, "the park").data]
    assert ids[0] == "park"
    assert ids == [d["id"] for d in tools.find_place(ctx, "the park").data]
    assert ids[1:] == sorted(ids[1:], key=lambda i: (len(ctx.world.places[i].name), i))


def test_stale_status_claim_files_stale_vr(ctx):
    from townshiplens_spatial.models import Claim

    ctx.world.edges["seg-cf"].claims["incline_pct"] = Claim(value=2, status="stale")
    vr = tools.plan_route(ctx, "park-b", "kiosk", "stroller").data["verification_requests"][0]
    assert vr["reason"] == "stale"


def test_plan_route_caps_auto_filed_vrs(ctx, monkeypatch):
    real = tools.routing.plan_route(ctx.world, "park-b", "playground", "stroller")
    real.routes[0].unknowns = [
        {"element_id": f"seg-{i}", "attribute": "width" if i % 2 else "step_count"}
        for i in range(20)
    ]
    monkeypatch.setattr(tools.routing, "plan_route", lambda *a, **k: real)
    r = tools.plan_route(ctx, "park-b", "playground", "stroller")
    assert len(r.data["verification_requests"]) == tools.MAX_ROUTE_VRS == 10
    assert r.data["verification_requests_truncated"] == 10
    assert len(r.data["routes"][0]["unknowns"]) == 20  # uncertainty items still all reported
    assert [v["element_id"] for v in r.data["verification_requests"]] == [
        f"seg-{i}" for i in range(10)
    ]


def test_plan_route_not_truncated_reports_zero(ctx):
    r = tools.plan_route(ctx, "park-b", "kiosk", "stroller")
    assert r.data["verification_requests_truncated"] == 0


def test_plan_route_reports_rest_gap_and_limit_for_older_adult(ctx):
    r = tools.plan_route(ctx, "park-b", "playground", "older_adult_rest")
    assert r.data["max_rest_gap_m"] == 111.2 and r.data["rest_limit_m"] == 100
    assert r.data["status"] == "partly_unverified"
    assert "longest stretch without a rest point is about 110 m (limit 100 m)" in r.warnings
    s = tools.plan_route(ctx, "park-b", "playground", "stroller")
    assert s.data["max_rest_gap_m"] is None and s.data["rest_limit_m"] is None


# --- Task 43: area places snapped to an inferred access point ---------------------------------


def _infer(ctx, place_id):
    from townshiplens_spatial.models import Claim

    p = ctx.world.places[place_id]
    p.node_inferred = True
    p.claims["access_point"] = Claim(
        value=p.node_id, status="reported", evidence_type="osm_area_boundary_snap"
    )
    return p


def test_route_to_inferred_place_warns_entrance_not_mapped(ctx):
    _infer(ctx, "kiosk")
    r = tools.plan_route(ctx, "park-b", "kiosk", "default")
    assert r.data["routes"]
    assert (
        "Route ends at the nearest mapped path to Park kiosk; its entrance is not mapped."
        in r.warnings
    )
    ev = next(e for e in r.evidence if e.id == "ev-kiosk.access_point")
    assert ev.source_type == "osm_area_boundary_snap" and ev.status == "reported"


def test_route_from_inferred_place_warns_too(ctx):
    _infer(ctx, "kiosk")
    r = tools.plan_route(ctx, "kiosk", "park-b", "default")
    assert (
        "Route starts at the nearest mapped path to Park kiosk; its entrance is not mapped."
        in r.warnings
    )


def test_no_entrance_warning_for_mapped_places_or_no_route(ctx):
    r = tools.plan_route(ctx, "park-b", "kiosk", "default")
    assert not [w for w in r.warnings if "entrance is not mapped" in w]
    _infer(ctx, "island-hut")
    r = tools.plan_route(ctx, "park-b", "island-hut", "default")
    assert r.data["status"] == "no_data"
    assert not [w for w in r.warnings if "entrance is not mapped" in w]


def test_place_details_expose_node_inferred(ctx):
    assert tools.get_place_details(ctx, "kiosk").data["node_inferred"] is False
    _infer(ctx, "kiosk")
    assert tools.get_place_details(ctx, "kiosk").data["node_inferred"] is True


def test_no_entrance_warning_when_the_place_has_a_mapped_entrance(ctx):
    """Review I2 (R28): routing ends at the mapped entrance, so the caveat would be false."""
    from townshiplens_spatial.models import Place

    p = _infer(ctx, "kiosk")
    ent = Place(id="kiosk-gate", kind="entrance", type="entrance", name="Kiosk gate",
                coord=[101.51, 3.181], node_id="n-c")  # fmt: skip
    ctx.world.places[ent.id] = ent
    p.entrance_ids = ["kiosk-gate"]
    r = tools.plan_route(ctx, "park-b", "kiosk", "default")
    assert r.data["routes"]
    assert not [w for w in r.warnings if "entrance is not mapped" in w]
    assert not [e for e in r.evidence if e.id == "ev-kiosk.access_point"]
    # An entrance id that resolves to nothing mapped does not count.
    p.entrance_ids = ["no-such-entrance"]
    r = tools.plan_route(ctx, "park-b", "kiosk", "default")
    assert [w for w in r.warnings if "entrance is not mapped" in w]


def test_plan_route_tool_data_carries_demo_evidence(ctx):
    res = tools.plan_route(ctx, "park-b", "playground", "stroller")
    assert res.data["status"] == "confirmed" and res.data["demo_evidence"] is True
    assert res.data["routes"][0]["demo_evidence"] is True


def test_place_details_never_expose_claim_notes(ctx):
    from townshiplens_spatial.models import Claim

    ctx.world.refresh_claim(
        "playground", "wheelchair", Claim(value="yes", status="verified", notes="ring 0123456789")
    )
    r = tools.get_place_details(ctx, "playground")
    assert r.data["claims"]["wheelchair"]["value"] == "yes"
    assert all("notes" not in c for c in r.data["claims"].values())
    assert "0123456789" not in str(r.model_dump())


def _fake_unknowns(ctx, monkeypatch, per_route):
    """Plan park-b to playground, then replace each route's unknowns (a list per route)."""
    real = tools.routing.plan_route(ctx.world, "park-b", "playground", "stroller")
    alt = real.routes[0].model_copy(deep=True)
    real.routes = [real.routes[0], alt][: len(per_route)]
    for r, u in zip(real.routes, per_route, strict=True):
        r.unknowns = u
    monkeypatch.setattr(tools.routing, "plan_route", lambda *a, **k: real)


def _unk(n, start=0):
    return [{"element_id": f"seg-{i}", "attribute": "width"} for i in range(start, start + n)]


def test_vr_cap_boundary_exactly_ten_is_not_truncated(ctx, monkeypatch):  # task 24 Minor 4
    _fake_unknowns(ctx, monkeypatch, [_unk(10)])
    r = tools.plan_route(ctx, "park-b", "playground", "stroller")
    assert len(r.data["verification_requests"]) == 10
    assert r.data["verification_requests_truncated"] == 0


def test_vr_cap_counts_distinct_pairs_across_alternate_routes(ctx, monkeypatch):
    # the alternate repeats 6 of the first route's 8 pairs and adds 4 new: 12 distinct, cap 10
    _fake_unknowns(ctx, monkeypatch, [_unk(8), _unk(10, start=2)])
    r = tools.plan_route(ctx, "park-b", "playground", "stroller")
    assert len(r.data["verification_requests"]) == 10
    assert r.data["verification_requests_truncated"] == 2
    ids = [v["element_id"] for v in r.data["verification_requests"]]
    assert ids == [f"seg-{i}" for i in range(10)]  # route order, no repeats


def test_missing_place_vrs_do_not_count_against_the_route_cap(ctx):
    r = tools.plan_route(ctx, "moon-base", "playground", "stroller")  # moon-base has no node
    assert r.data["status"] == "no_data"
    assert [v["reason"] for v in r.data["verification_requests"]] == ["missing_place"]
    assert r.data["verification_requests_truncated"] == 0


def test_blocked_route_still_carries_the_inferred_entrance_caveat(ctx):
    """Task 55: a closure that blocks the route must not drop the "entrance not mapped" caveat."""
    from datetime import UTC, datetime, timedelta

    from townshiplens_spatial.models import Closure

    _infer(ctx, "kiosk")
    now = datetime.now(UTC)
    ctx.world.set_closures(
        [
            Closure(
                id=f"cl-{i}", element_id=eid, reason="works", starts_at=now - timedelta(hours=1)
            )
            for i, eid in enumerate(e.id for e in ctx.world.edges.values())
        ]
    )
    r = tools.plan_route(ctx, "park-b", "kiosk", "default")
    assert r.data["status"] == "blocked"
    assert (
        "Route ends at the nearest mapped path to Park kiosk; its entrance is not mapped."
        in r.warnings
    )


def test_generic_place_search_uses_named_origin_context(ctx):
    from townshiplens_spatial.models import Place

    ctx.world.places["far"] = Place(id="far", type="playground", name="Playground", coord=[102, 4])
    assert {
        p["id"]
        for p in tools.find_place(ctx, "playground", types=["playground"], near_place="park-b").data
    } == {"playground"}
    assert not tools.find_place(ctx, "playground", near_place="unknown").ok
