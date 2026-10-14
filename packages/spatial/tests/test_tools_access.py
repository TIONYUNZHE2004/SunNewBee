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
