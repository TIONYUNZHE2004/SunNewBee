import pytest
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore


@pytest.fixture
def ctx(world, tmp_path):
    return tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))


def test_registry_has_exactly_ten(ctx):
    assert set(tools.TOOLS) == {
        "find_place",
        "get_place_details",
        "plan_route",
        "nearby_amenities",
        "get_closures",
        "create_verification_request",
        "list_flood_scenarios",
        "affected_places",
        "list_evacuation_centres",
        "find_waste_points",
    }


def test_list_flood_scenarios(ctx):
    r = tools.list_flood_scenarios(ctx)
    assert any(s["id"] == "stage_p3m" for s in r.data)
    assert all(e.status == "indicative" for e in r.evidence)


def test_evacuation_tool_labels_source(ctx):
    r = tools.list_evacuation_centres(ctx, "stage_p3m", "wheelchair", "lakeside-mall")
    assert {c["centre"]["source"] for c in r.data} == {"official_pps", "osm_candidate"}


def test_waste_points(ctx):
    r = tools.find_waste_points(ctx, type="recycling_drop_off")
    assert [p["id"] for p in r.data] == ["wp-park-recycle"]
    assert r.evidence[0].id == "ev-wp-park-recycle.status"


def test_affected_places_filters_and_evidence(ctx):
    r = tools.affected_places(ctx, "stage_p3m", kind="facility")
    assert [x["id"] for x in r.data["likely"]] == ["playground"]
    assert all(x["kind"] == "place" for x in r.data["possible"])
    ids = {e.id for e in r.evidence}
    assert "ev-scn-stage_p3m" in ids and "ev-scn-stage_p3m.playground" in ids
    assert not tools.affected_places(ctx, "nope").ok


def test_affected_places_unknown_profile(ctx):
    r = tools.affected_places(ctx, "stage_p3m", profile="bogus")
    assert not r.ok


def test_transient_centre_places_never_surface_in_search(ctx):
    tools.list_evacuation_centres(ctx, "stage_p3m", "stroller", "park-b")
    assert any(pid.startswith("__centre__") for pid in ctx.world.places)
    for q in ("School (official PPS)", "Community hall", "centre", "evc-school"):
        assert not any(d["id"].startswith("__") for d in tools.find_place(ctx, q).data)
    assert tools.find_place(ctx, "School (official PPS)").data == []


def test_evacuation_tool_repeat_idempotent(ctx):
    a = tools.list_evacuation_centres(ctx, "stage_p3m", "stroller", "park-b")
    b = tools.list_evacuation_centres(ctx, "stage_p3m", "stroller", "park-b")
    assert a.data == b.data
