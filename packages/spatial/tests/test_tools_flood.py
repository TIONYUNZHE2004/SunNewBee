import pytest
from tests_support import add_roads
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore


@pytest.fixture
def ctx(world, tmp_path):
    return tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))


def test_registry_has_the_ten_lookups_and_three_world_model_tools(ctx):
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
        "suggest_interventions",
        "simulate_what_if",
        "plan_verifications",
        "river_tipping_point",
        "rising_river_rollout",
        "find_fixes",
        "day_rehearsal",
        "day_test_change",
        "rehearse_my_trip",
        "simulate_event",
        "simulate_closure",
        "simulate_marathon",
        "simulate_development",
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
    assert not tools.affected_places(ctx, "stage_p3m", profile="bogus").ok
    assert tools.affected_places(ctx, "stage_p3m", profile="drive").ok


def test_evac_evidence_status_and_disclaimer(ctx):
    r = tools.list_evacuation_centres(ctx, "stage_p3m", "stroller", "park-b")
    st = {e.element_id: e.status for e in r.evidence if e.id.startswith("ev-centre-")}
    assert st == {"evc-school": "reported", "evc-hall": "unknown"}
    assert all("not a forecast" in c["disclaimer"] for c in r.data)


def test_evac_drive_without_roads_is_no_data_not_blocked(ctx):
    r = tools.list_evacuation_centres(ctx, None, "drive", "park-b")
    assert not any("stub" in w or "not built" in w for w in r.warnings)
    assert any("no mapped road within 150 m of park-b" in w for w in r.warnings)
    assert r.data and all(c["reachable"] is False for c in r.data)
    assert {c["route_status"] for c in r.data} == {"no_data"}


def test_evac_drive_reachable_is_never_confirmed(ctx):
    add_roads(ctx.world)
    r = tools.list_evacuation_centres(ctx, None, "drive", "park-b")
    by = {c["centre"]["id"]: c for c in r.data}
    # hall (n-c) is footway-only but ~55 m from the road; the island school is > 150 m away
    assert by["evc-hall"]["reachable"] is True
    assert by["evc-hall"]["route_status"] == "partly_unverified"
    assert by["evc-school"]["reachable"] is False
    assert by["evc-school"]["route_status"] == "no_data"
    assert any("one-way" in x for x in r.warnings)


def test_nearby_amenities_drive_carries_standing_warning(ctx):
    add_roads(ctx.world)
    r = tools.nearby_amenities(ctx, "park-b", "parking", 1000, profile="drive")
    assert any("one-way" in w for w in r.warnings)
    assert [h["id"] for h in r.data] == ["park-b", "park-c"]


def test_centre_in_other_component_is_no_data_not_unreachable(ctx):
    r = tools.list_evacuation_centres(ctx, None, "stroller", "park-b")
    by = {c["centre"]["id"]: c for c in r.data}
    # island school (n-h) is in another mapped component: a data gap, not "not reachable"
    assert by["evc-school"]["route_status"] == "no_data"
    assert by["evc-school"]["reachable"] is False
    assert by["evc-hall"]["reachable"] is True
    assert any("no mapped connection" in w for w in r.warnings)


def test_waste_unknown_near_place_warns(ctx):
    r = tools.find_waste_points(ctx, near_place="nowhere")
    assert any("nowhere" in w for w in r.warnings)


def test_place_details_resolves_centres_with_source_label(ctx):
    pps = tools.get_place_details(ctx, "evc-school")
    assert pps.ok and pps.data["kind"] == "evac_centre"
    assert pps.data["source"] == "official_pps" and pps.data["source_label"] == "Official PPS"
    cand = tools.get_place_details(ctx, "evc-hall")
    assert cand.data["source_label"] == "Candidate (OSM), not an official relief centre"
    assert cand.data["claims"]["source"]["status"] == "unknown"
    assert any(e.element_id == "evc-hall" for e in cand.evidence)
    assert "reachability" not in cand.data  # only when a query supplies the origin


def test_place_details_centre_reachability_when_origin_given(ctx):
    r = tools.get_place_details(
        ctx, "evc-school", scenario_id="stage_p3m", profile="stroller", near="park-b"
    )
    reach = r.data["reachability"]
    assert reach["route_status"] in {"confirmed", "partly_unverified", "blocked", "no_data"}
    assert reach["scenario_id"] == "stage_p3m" and reach["profile"] == "stroller"
    assert "not a forecast" in reach["disclaimer"]


def test_place_details_resolves_waste_without_inventing_a_schedule(ctx):
    r = tools.get_place_details(ctx, "wp-park-recycle")
    assert r.ok and r.data["kind"] == "waste_point"
    assert r.data["source_label"] == "Waste point: verified"
    assert r.data["collection_day"] is None
    assert r.data["claims"]["status"]["status"] == "verified"
    e = tools.get_place_details(ctx, "wp-ewaste")
    assert e.ok and e.data["source_label"].startswith("Waste point:")


# --- Task 43 (R26): centres whose walk node is an inferred area snap ------------------------

ENTRANCE_NOTE = (
    "Reachability ends at the nearest mapped path to Community hall (candidate); "
    "its entrance is not mapped."
)


def _inferred_hall(ctx):
    ctx.world.centres["evc-hall"] = ctx.world.centres["evc-hall"].model_copy(
        update={"place_id": "bench-1"}
    )
    ctx.world.places["bench-1"].node_inferred = True


def test_evacuation_list_caveats_centres_with_inferred_node(ctx):
    _inferred_hall(ctx)
    r = tools.list_evacuation_centres(ctx, None, "default", "park-b")
    rows = {d["centre"]["id"]: d for d in r.data}
    assert rows["evc-hall"]["reachable"] and rows["evc-hall"]["entrance_note"] == ENTRANCE_NOTE
    assert "entrance_note" not in rows["evc-school"]  # not reachable / not inferred
    assert any("entrances are not mapped" in w and w.startswith("1 reachable") for w in r.warnings)


def test_evacuation_list_no_caveat_without_inferred_nodes(ctx):
    r = tools.list_evacuation_centres(ctx, None, "default", "park-b")
    assert all("entrance_note" not in d for d in r.data)
    assert not any("entrance" in w for w in r.warnings)


def test_centre_details_caveat_inferred_node(ctx):
    _inferred_hall(ctx)
    r = tools.get_place_details(ctx, "evc-hall", None, "default", "park-b")
    assert r.data["reachability"]["entrance_note"] == ENTRANCE_NOTE
    assert ENTRANCE_NOTE in r.warnings


def test_centre_flagged_node_inferred_gets_the_caveat_without_a_place(ctx):
    ctx.world.centres["evc-hall"] = ctx.world.centres["evc-hall"].model_copy(
        update={"node_inferred": True}
    )
    r = tools.list_evacuation_centres(ctx, None, "default", "park-b")
    rows = {d["centre"]["id"]: d for d in r.data}
    assert rows["evc-hall"]["entrance_note"] == ENTRANCE_NOTE
    assert rows["evc-hall"]["centre"]["node_inferred"] is True
