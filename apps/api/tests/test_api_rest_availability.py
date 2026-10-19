"""HTTP route responses must not promise a rest interval using an unavailable seat."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app
from townshiplens_spatial.models import Claim


def _rest_world():
    world = state.get_ctx().world
    # The fixture's two 111.2 m stretches meet a 120 m limit only with bench-1 at n-c.
    world.profiles["older_adult_rest"].max_rest_free_run_m = 120
    world.places["bench-1"].claims = {
        "seating": Claim(value=True, status="verified", verified_at=date.today().isoformat())
    }
    world.flood.edge_classes["stage_p1m"] = {}
    world.flood.place_classes["stage_p1m"] = {}
    return world


def _route(client):
    response = client.post(
        "/routes",
        json={
            "from": "park-b",
            "to": "playground",
            "profile": "older_adult_rest",
            "scenario_id": "stage_p1m",
        },
    )
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize("cause", ["likely_flooded", "active_closure", "possible", "partial"])
def test_rest_scenario_and_closure_availability_survive_http_transport(cause):
    world = _rest_world()
    client = TestClient(app)
    assert _route(client)["status"] == "confirmed"
    if cause == "active_closure":
        response = client.post(
            "/closures",
            json={"element_id": "bench-1", "reason": "works"},
            headers={"X-Staff-Token": "test-token"},
        )
        assert response.status_code == 201
    elif cause == "partial":
        world.flood.coverage["bench-1"] = cause
    else:
        world.flood.place_classes["stage_p1m"]["bench-1"] = cause
    result = _route(client)
    route = result["routes"][0]
    assert result["status"] == route["status"] == "partly_unverified"
    if cause in {"likely_flooded", "active_closure"}:
        assert route["rest_limit_met"] is False
        assert route["max_gap_between_rest_m"] == 222.4
        assert not route["rest_points"]
    else:
        assert route["rest_limit_met"] is True
        assert route["rest_points_unverified"] == ["bench-1"]
        assert route["rest_points"][0]["status"] == "unverified"
        assert any("Bench by the path" in w for w in result["warnings"])
        suffix = ".coverage" if cause == "partial" else ""
        assert f"ev-scn-stage_p1m.bench-1{suffix}" in route["evidence_ids"]


def test_ending_a_staff_closure_restores_the_usable_rest_interval():
    _rest_world()
    client = TestClient(app)
    closed = client.post(
        "/closures",
        json={"element_id": "bench-1", "reason": "works"},
        headers={"X-Staff-Token": "test-token"},
    )
    assert closed.status_code == 201
    assert not _route(client)["routes"][0]["rest_limit_met"]
    ended = client.post(
        f"/closures/{closed.json()['id']}/end", headers={"X-Staff-Token": "test-token"}
    )
    assert ended.status_code == 200
    result = _route(client)
    assert result["status"] == "confirmed" and result["routes"][0]["rest_limit_met"]
