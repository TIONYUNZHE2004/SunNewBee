"""POST /routes/compare (demo polish B3, AC-B11): the compare_routes tool's data, no tickets."""

from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app
from townshiplens_spatial import tools

c = TestClient(app)
BODY = {"from": "park-b", "to": "toilet-1", "profile": "wheelchair"}


def test_compare_returns_the_tool_data_and_files_no_vr():
    r = c.post("/routes/compare", json=BODY)
    assert r.status_code == 200
    body = r.json()
    ctx = state.get_ctx()
    expected = tools.compare_routes(ctx, "park-b", "toilet-1", "wheelchair", file_vrs=False).data
    assert body == expected
    assert set(body) == {
        "status",
        "profile",
        "same_path",
        "fastest",
        "recommended",
        "stop",
        "reasons",
        "extra_minutes",
        "unchecked",
        "pois",
        "vr",
        "confirm_n",
    }
    assert body["unchecked"] and body["vr"] is None
    assert isinstance(body["confirm_n"], int)
    assert ctx.vrs.list("all") == []  # AC-B9: the anonymous endpoint never files tickets


def test_compare_same_path_and_scenario():
    r = c.post(
        "/routes/compare",
        json={"from": "park-b", "to": "playground", "profile": "wheelchair", "scenario_id": None},
    ).json()
    assert r["same_path"] is True and r["stop"] is None and r["extra_minutes"] == 0.0


def test_compare_rejects_unknown_profile_and_scenario():
    assert c.post("/routes/compare", json=BODY | {"profile": "hovercraft"}).status_code == 422
    assert c.post("/routes/compare", json=BODY | {"scenario_id": "nope"}).status_code in (404, 422)


def test_compare_unknown_place_is_a_data_gap():
    r = c.post("/routes/compare", json=BODY | {"to": "nowhere"}).json()
    assert r["status"] == "no_data" and r["recommended"] is None and r["vr"] is None
