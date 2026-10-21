from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app
from townshiplens_spatial import models, tools

client = TestClient(app)
START = datetime(2030, 10, 28, 7, tzinfo=UTC)
STAFF = {"X-Staff-Token": "test-token"}


def body(**changes):
    return {
        "name": "Drain repairs",
        "reason": "works",
        "closures": [
            {
                "segment_ids": ["seg-bc"],
                "starts_at": START.isoformat(),
                "ends_at": (START + timedelta(hours=3)).isoformat(),
            }
        ],
        **changes,
    }


def test_public_simulation_contract_and_event_alias_are_read_only():
    ctx = state.get_ctx()
    version = ctx.world.version
    expected = client.post("/closures/simulate", json=body(profiles=["default"]))
    assert expected.status_code == 200, expected.text
    data = expected.json()
    assert data["event"]["reason"] == "works" and data["at"] == START.isoformat().replace(
        "+00:00", "Z"
    )
    assert data["trips_affected"] > 0 and data["timing_ms"] > 0
    assert "not traffic counts" in data["disclaimer"]
    assert "assumed travel pattern, not measured" in data["weights_note"]
    for road in data["detour_roads"]:
        assert {
            "name",
            "segment_ids",
            "trips",
            "weighted_trips",
            "road_class",
            "pressure",
        } <= road.keys()
    alias = client.post("/events/simulate", json=body(profiles=["default"]))
    assert alias.status_code == 200, alias.text
    assert alias.json() | {"timing_ms": 0} == data | {"timing_ms": 0}
    assert ctx.closures.list() == [] and ctx.vrs.list("all") == []
    assert ctx.world.version == version


@pytest.mark.parametrize("reason", ["event", "works", "accident", "flooding", "other"])
def test_named_staff_alias_preserves_real_reason_and_separate_windows(reason):
    request = body(reason=reason)
    request["closures"].append(
        {
            "segment_ids": ["seg-be"],
            "starts_at": (START + timedelta(hours=1)).isoformat(),
            "ends_at": (START + timedelta(hours=4)).isoformat(),
        }
    )
    assert client.post("/events", json=request).status_code == 401
    result = client.post("/events", json=request, headers=STAFF)
    assert result.status_code == 201, result.text
    rows = result.json()["closures"]
    assert len(rows) == 2 and all(row["reason"] == reason for row in rows)
    assert all(row["label"].startswith(f"Closed: {reason} (Drain repairs)") for row in rows)
    assert rows[0]["starts_at"] != rows[1]["starts_at"]
    state.reset()
    stored = state.get_ctx().closures.list()
    assert len(stored) == 2 and all(row.reason == reason for row in stored)


def test_residents_avoid_named_accident_only_within_its_window(monkeypatch):
    monkeypatch.setattr(models, "utcnow", lambda: START - timedelta(seconds=1))
    query = {"from": "park-b", "to": "kiosk", "profile": "default"}
    assert client.post("/events", json=body(reason="accident"), headers=STAFF).status_code == 201

    def route():
        return client.post("/routes", json=query).json()

    assert "seg-bc" in [s["edge_id"] for s in route()["routes"][0]["segments"]]
    monkeypatch.setattr(models, "utcnow", lambda: START)
    state.reset()
    result = route()
    assert "seg-bc" not in [s["edge_id"] for s in result["routes"][0]["segments"]]
    assert any("accident (Drain repairs)" in warning for warning in result["warnings"])
    monkeypatch.setattr(models, "utcnow", lambda: START + timedelta(hours=3))
    assert "seg-bc" in [s["edge_id"] for s in route()["routes"][0]["segments"]]


@pytest.mark.parametrize(
    "changes",
    [
        {"reason": "invented"},
        {"profiles": []},
        {"profiles": ["invented"]},
        {"closures": []},
        {"at": "not-a-date"},
        {"name": "   "},
        {
            "closures": [
                {
                    "segment_ids": ["invented"],
                    "starts_at": START.isoformat(),
                    "ends_at": (START + timedelta(hours=1)).isoformat(),
                }
            ]
        },
        {
            "closures": [
                {
                    "road_names": ["Invented Road"],
                    "starts_at": START.isoformat(),
                    "ends_at": (START + timedelta(hours=1)).isoformat(),
                }
            ]
        },
        {
            "closures": [
                {
                    "segment_ids": ["seg-bc"],
                    "starts_at": START.isoformat(),
                    "ends_at": START.isoformat(),
                }
            ]
        },
    ],
)
def test_invalid_closure_simulations_return_422_without_writes(changes):
    result = client.post("/closures/simulate", json=body(**changes))
    assert result.status_code == 422, result.text
    assert state.get_ctx().closures.list() == []


def test_later_invalid_window_does_not_partially_persist():
    request = body()
    request["closures"].append(
        {
            "segment_ids": ["invented"],
            "starts_at": START.isoformat(),
            "ends_at": (START + timedelta(hours=2)).isoformat(),
        }
    )
    assert client.post("/events", json=request, headers=STAFF).status_code == 422
    assert state.get_ctx().closures.list() == []
    assert client.get("/audit", headers=STAFF).json() == []


def test_storage_failure_rolls_back_all_windows():
    store = state.get_ctx().closures
    store.db.execute(
        "CREATE TRIGGER fail_second BEFORE INSERT ON closures "
        "WHEN NEW.element_id = 'seg-be' BEGIN SELECT RAISE(ABORT, 'test'); END"
    )
    request = body()
    request["closures"].append(
        {
            "segment_ids": ["seg-be"],
            "starts_at": START.isoformat(),
            "ends_at": (START + timedelta(hours=2)).isoformat(),
        }
    )
    assert client.post("/events", json=request, headers=STAFF).status_code == 503
    assert store.list() == []


def test_bounded_scenario_and_solver_busy():
    request = body()
    request["closures"] *= 41
    assert client.post("/closures/simulate", json=request).status_code == 422
    request["closures"] = request["closures"][:40]
    request["closures"][0]["segment_ids"] = ["seg-bc", "seg-be"]
    assert client.post("/closures/simulate", json=request).status_code == 422
    tools._WM_SLOTS.acquire()
    tools._WM_SLOTS.acquire()
    try:
        assert client.post("/closures/simulate", json=body()).status_code == 503
    finally:
        tools._WM_SLOTS.release()
        tools._WM_SLOTS.release()
