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
