from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app
from townshiplens_spatial import models

c = TestClient(app)
STAFF = {"X-Staff-Token": "test-token"}
START = datetime(2030, 10, 27, 23, tzinfo=UTC)


def body(**kwargs):
    return {
        "name": "Elmina Marathon",
        "segment_ids": ["seg-bc"],
        "starts_at": START.isoformat(),
        "ends_at": (START + timedelta(hours=4)).isoformat(),
        **kwargs,
    }


def test_simulation_is_public_and_does_not_store_closures_or_tickets():
    ctx = state.get_ctx()
    version = ctx.world.version
    result = c.post("/events/simulate", json=body(profiles=["default"]))
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["trips_affected"] > 0 and data["detour_roads"]
    assert data["per_profile"]["default"]["trips_total"] == data["trips_total"]
    assert data["disclaimer"] == "Estimate from mapped roads and sample trips, not traffic counts."
    assert c.get("/closures", params={"active": "false"}).json() == []
    assert ctx.vrs.list("all") == [] and ctx.world.version == version


@pytest.mark.parametrize(
    "overrides",
    [
        {"segment_ids": ["unknown"]},
        {"profiles": ["unknown"]},
        {"profiles": []},
        {"ends_at": START.isoformat()},
        {"segment_ids": []},
        {"name": "   "},
        {"segment_ids": ["seg-bc"] * 41},
    ],
)
def test_simulation_rejects_bad_input(overrides):
    assert c.post("/events/simulate", json=body(**overrides)).status_code == 422
    assert state.get_ctx().closures.list() == []


def test_event_creation_requires_staff_and_validates_whole_course():
    assert c.post("/events", json=body()).status_code == 401
    assert (
        c.post("/events", json=body(segment_ids=["seg-ab", "unknown"]), headers=STAFF).status_code
        == 422
    )
    assert state.get_ctx().closures.list() == []


def test_named_event_persists_and_routes_avoid_it_only_during_window(monkeypatch):
    monkeypatch.setattr(models, "utcnow", lambda: START - timedelta(seconds=1))
    query = {"from": "park-b", "to": "kiosk", "profile": "default"}
    before = c.post("/routes", json=query).json()["routes"][0]
    assert "seg-bc" in [s["edge_id"] for s in before["segments"]]
    response = c.post("/events", json=body(segment_ids=["seg-bc", "seg-bc"]), headers=STAFF)
    assert response.status_code == 201, response.text
    rows = response.json()["closures"]
    assert len(rows) == 1 and rows[0]["event_name"] == "Elmina Marathon"
    assert rows[0]["source_label"] == "Reported closure (staff)" and not rows[0]["active"]
    assert "seg-bc" in [
        s["edge_id"] for s in c.post("/routes", json=query).json()["routes"][0]["segments"]
    ]
    state.reset()  # reload upcoming named closures from SQLite
    monkeypatch.setattr(models, "utcnow", lambda: START)
    active = c.post("/routes", json=query).json()
    assert "seg-bc" not in [s["edge_id"] for s in active["routes"][0]["segments"]]
    assert any("Elmina Marathon" in line for line in active["warnings"])
    assert c.get("/closures").json()[0]["event_name"] == "Elmina Marathon"
    audit = c.get("/audit", headers=STAFF).json()
    assert any(row["reason"] == "event:create" for row in audit)
    monkeypatch.setattr(models, "utcnow", lambda: START + timedelta(hours=4))
    assert "seg-bc" in [
        s["edge_id"] for s in c.post("/routes", json=query).json()["routes"][0]["segments"]
    ]


def test_solver_busy_is_503_without_writes():
    from townshiplens_spatial import tools

    tools._WM_SLOTS.acquire()
    tools._WM_SLOTS.acquire()
    try:
        assert c.post("/events/simulate", json=body()).status_code == 503
    finally:
        tools._WM_SLOTS.release()
        tools._WM_SLOTS.release()
    assert state.get_ctx().closures.list() == []
