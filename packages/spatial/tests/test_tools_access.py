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
