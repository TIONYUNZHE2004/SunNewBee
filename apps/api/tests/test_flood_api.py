from fastapi.testclient import TestClient
from townshiplens_api.main import app

c = TestClient(app)


def test_scenarios_and_water():
    ids = [s["id"] for s in c.get("/scenarios").json()]
    assert "stage_p3m" in ids
    water = c.get("/scenarios/stage_p3m").json()
    assert water["features"][0]["properties"]["surface_height_m"] > 0
    assert c.get("/scenarios/nope").status_code == 404


def test_water_applies_datum_offset():
    from townshiplens_api import state

    raw = state.get_ctx().world.water["stage_p3m"]["features"][0]["properties"]["surface_height_m"]
    state.get_ctx().world.site.scene.datum_offset_m = 2.5
    got = c.get("/scenarios/stage_p3m").json()["features"][0]["properties"]["surface_height_m"]
    assert got == raw + 2.5


def test_layers_flood_marks_likely():
    fc = c.get("/layers/flood", params={"scenario_id": "stage_p3m"}).json()
    lines = [f for f in fc["features"] if f["geometry"]["type"] == "LineString"]
    st = {f["properties"]["id"]: f["properties"]["status_for_profile"] for f in lines}
    assert st["seg-cd"] == "flooded_likely"
    assert set(st.values()) <= {"flooded_likely", "flooded_possible"}
    assert any(f["properties"].get("kind") == "evac_centre" for f in fc["features"])


def test_affected_and_centres():
    a = c.get("/scenarios/stage_p3m/affected").json()
    assert a["scenario_id"] == "stage_p3m" and "disclaimer" in a
    assert c.get("/scenarios/nope/affected").status_code == 404
    assert isinstance(
        c.get("/evacuation-centres", params={"scenario_id": "stage_p3m"}).json(), list
    )


def test_briefing():
    b = c.get(
        "/briefings/flood", params={"scenario_id": "stage_p3m", "profile": "wheelchair"}
    ).json()
    assert "affected" in b and "centres" in b and "not a forecast" in b["disclaimer"]
    assert b["scenario"]["id"] == "stage_p3m"
    assert c.get("/briefings/flood", params={"scenario_id": "nope"}).status_code == 404


def test_place_endpoint_resolves_centre_and_waste_ids():
    r = c.get("/places/evc-hall", params={"scenario_id": "stage_p3m", "near": "park-b"})
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["source_label"] == "Candidate (OSM), not an official relief centre"
    assert "route_status" in d["reachability"]
    w = c.get("/places/wp-park-recycle")
    assert w.status_code == 200 and w.json()["data"]["source_label"].startswith("Waste point")


def test_flood_layer_edges_carry_class_and_scenario():
    fc = c.get("/layers/flood", params={"scenario_id": "stage_p3m"}).json()
    lines = [f for f in fc["features"] if f["geometry"]["type"] == "LineString"]
    assert lines
    for f in lines:
        p = f["properties"]
        assert p["scenario_id"] == "stage_p3m"
        assert p["flood_class"] in {"likely_flooded", "possible"}
        assert not any("depth" in k for k in p)
    seg = next(f for f in lines if f["properties"]["id"] == "seg-cd")
    assert seg["properties"]["flood_class"] == "likely_flooded"


def test_access_layer_flags_flooded_edges_only():
    fc = c.get("/layers/access", params={"scenario_id": "stage_p3m"}).json()
    lines = [f["properties"] for f in fc["features"] if f["geometry"]["type"] == "LineString"]
    assert any(p.get("flood_class") for p in lines)
    assert all("flood_class" not in p for p in lines if p["status_for_profile"] == "ok")


def test_briefing_baseline_has_edge_ids():
    b = c.get("/briefings/flood", params={"scenario_id": "baseline"}).json()
    assert b["affected"]["likely_edge_ids"] == []


def test_scenario_margin_is_optional_and_not_defaulted():
    from townshiplens_spatial.models import Scenario

    s = Scenario(id="x", label="x", stage_m=1, disclaimer="d")
    assert s.margin_m is None
    assert Scenario(id="x", label="x", stage_m=1, disclaimer="d", margin_m=0.5).margin_m == 0.5
    # The test fixture world does not state a margin: the API reports none, not a default.
    fx = [s for s in c.get("/scenarios").json() if s["id"] == "stage_p3m"][0]
    assert fx["margin_m"] is None


def test_seed_scenarios_state_their_margin():
    import json
    from pathlib import Path

    from townshiplens_spatial.models import Scenario

    raw = json.loads(Path("data/seed/elmina/flood/scenarios.json").read_text(encoding="utf-8"))
    items = raw if isinstance(raw, list) else raw["scenarios"]
    assert items and all(Scenario.model_validate(i).margin_m is not None for i in items)


def test_briefing_names_the_origin():
    b = c.get("/briefings/flood", params={"scenario_id": "stage_p3m"}).json()
    assert b["near_place"] and b["near_place_name"]


def test_profiles_endpoint_lists_thresholds():
    r = c.get("/profiles")
    assert r.status_code == 200
    by_id = {p["id"]: p for p in r.json()}
    w = by_id["wheelchair"]
    assert w["hard"]["max_incline_pct"] == 8.3
    assert w["hard"]["min_width_m"] == 0.9
    assert w["hard"]["max_step_count"] == 0
    assert "no published source" in w["threshold_basis"]


def test_briefing_scenario_has_edge_ids():  # task 36 M-5
    b = c.get("/briefings/flood", params={"scenario_id": "stage_p3m"}).json()
    ids = b["affected"]["likely_edge_ids"] + b["affected"]["possible_edge_ids"]
    assert ids and all(i.startswith("seg-") for i in ids)
    assert "seg-cd" in b["affected"]["likely_edge_ids"]


def test_place_endpoint_rejects_bad_scenario_and_profile():  # task 32 Minor 3
    assert c.get("/places/evc-hall", params={"scenario_id": "nope"}).status_code == 404
    assert c.get("/places/evc-hall", params={"profile": "nope"}).status_code == 422
    assert c.get("/places/evc-hall", params={"near": "x" * 500}).status_code == 422
    ok = c.get("/places/evc-hall", params={"scenario_id": "baseline", "profile": "stroller"})
    assert ok.status_code == 200
    assert c.get("/places/evc-hall", params={"near": "no-such-place"}).status_code == 200  # a gap
