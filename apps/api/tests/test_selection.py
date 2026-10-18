"""T-016: malformed selections must never serve ordinary baseline/default results."""

import pytest
from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app

c = TestClient(app)


@pytest.mark.parametrize(
    "url",
    [
        "/layers/access",
        "/layers/flood",
        "/graph",
        "/evacuation-centres",
        "/briefings/flood",
        "/places/playground",
    ],
)
@pytest.mark.parametrize(
    "params,code",
    [
        ({"scenario_id": "not-a-scenario"}, 404),
        ({"profile": "bogus", "scenario_id": "baseline"}, 422),
        ({"scenario_id": ""}, 404),
    ],
)
def test_bad_selection_rejected(url, params, code):
    r = c.get(url, params=params)
    assert r.status_code == code
    assert r.json()["detail"].startswith("unknown ")


@pytest.mark.parametrize(
    "extra,code", [({"scenario_id": "not-a-scenario"}, 404), ({"profile": "bogus"}, 422)]
)
def test_routes_reject_bad_selection_without_vrs(extra, code):
    before = state.get_ctx().vrs.list("all")
    r = c.post("/routes", json={"from": "park-b", "to": "playground", **extra})
    assert r.status_code == code
    assert state.get_ctx().vrs.list("all") == before


def test_layer_coverage_is_a_gap_and_never_fabricates_a_flood_class():
    w = state.get_ctx().world
    w.flood.coverage["seg-ab"] = "partial"
    for lens in ("access", "flood"):
        fc = c.get(f"/layers/{lens}", params={"scenario_id": "stage_p1m"}).json()
        props = next(f["properties"] for f in fc["features"] if f["properties"]["id"] == "seg-ab")
        assert props["status_for_profile"] == "unknown"
        assert props["flood_coverage"] == "partial"
        assert "flood_class" not in props
    fc = c.get("/layers/access", params={"scenario_id": "baseline"}).json()
    props = next(f["properties"] for f in fc["features"] if f["properties"]["id"] == "seg-ab")
    assert props["status_for_profile"] == "ok" and "flood_coverage" not in props


def test_flooded_destination_route_is_blocked_with_reason():
    r = c.post("/routes", json={"from": "park-b", "to": "playground", "scenario_id": "stage_p3m"})
    assert r.status_code == 200
    assert r.json()["status"] == "blocked" and r.json()["routes"] == []
    assert r.json()["blocked_reasons"][0]["element_id"] == "playground"
