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
