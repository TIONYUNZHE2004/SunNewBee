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
    from townshiplens_spatial.models import Place

    ctx.world.places["__centre__evc-school"] = Place(
        id="__centre__evc-school",
        type="evacuation_centre",
        name="School (official PPS)",
        coord=[101.512, 3.182],
        node_id="n-h",
    )
    for q in ("School (official PPS)", "Community hall", "centre", "evc-school"):
        assert not any(d["id"].startswith("__") for d in tools.find_place(ctx, q).data)
    assert tools.find_place(ctx, "School (official PPS)").data == []


def test_evacuation_tool_repeat_idempotent(ctx):
    a = tools.list_evacuation_centres(ctx, "stage_p3m", "stroller", "park-b")
    b = tools.list_evacuation_centres(ctx, "stage_p3m", "stroller", "park-b")
    assert a.data == b.data


def test_evacuation_does_not_leak_transient_places(ctx):
    before = set(ctx.world.places)
    tools.list_evacuation_centres(ctx, "stage_p3m", "stroller", "park-b")
    assert set(ctx.world.places) == before
    r = tools.nearby_amenities(ctx, "park-b", "evacuation_centre", 2000)
    assert r.data == []
    assert not tools.get_place_details(ctx, "__centre__evc-school").ok


def test_affected_places_validation(ctx):
    assert not tools.affected_places(ctx, "stage_p3m", kind="bogus").ok
    assert not tools.affected_places(ctx, "stage_p3m", profile="drive").ok


def test_evac_evidence_status_and_disclaimer(ctx):
    r = tools.list_evacuation_centres(ctx, "stage_p3m", "stroller", "park-b")
    st = {e.element_id: e.status for e in r.evidence if e.id.startswith("ev-centre-")}
    assert st == {"evc-school": "reported", "evc-hall": "unknown"}
    assert all("not a forecast" in c["disclaimer"] for c in r.data)


def test_evac_stub_profile_warns(ctx):
    r = tools.list_evacuation_centres(ctx, None, "drive", "park-b")
    assert r.warnings and not any(c["reachable"] for c in r.data)


def test_waste_unknown_near_place_warns(ctx):
    r = tools.find_waste_points(ctx, near_place="nowhere")
    assert any("nowhere" in w for w in r.warnings)
