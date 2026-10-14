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


def test_profiles_endpoint_lists_thresholds():
    r = c.get("/profiles")
    assert r.status_code == 200
    by_id = {p["id"]: p for p in r.json()}
    w = by_id["wheelchair"]
    assert w["hard"]["max_incline_pct"] == 8.3
    assert w["hard"]["min_width_m"] == 0.9
    assert w["hard"]["max_step_count"] == 0
    assert "no published source" in w["threshold_basis"]
