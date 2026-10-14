from fastapi.testclient import TestClient
from townshiplens_api.main import app

c = TestClient(app)
OK = {"X-Staff-Token": "test-token"}


def test_post_requires_token(monkeypatch):
    assert c.post("/simulations", json={}).status_code == 401
    assert c.post("/simulations", json={}, headers={"X-Staff-Token": "bad"}).status_code == 401
    monkeypatch.setenv("STAFF_TOKEN", "change-me")
    assert (
        c.post("/simulations", json={}, headers={"X-Staff-Token": "change-me"}).status_code == 503
    )


def test_run_get_list():
    r = c.post(
        "/simulations", json={"scenario_id": "stage_p3m", "profiles": ["stroller"]}, headers=OK
    )
    assert r.status_code == 200
    rep = r.json()
    assert rep["run_id"] and rep["scenario_id"] == "stage_p3m"
    assert set(rep["counts"]) <= {"stroller"}
    got = c.get(f"/simulations/{rep['run_id']}")
    assert got.status_code == 200 and got.json()["run_id"] == rep["run_id"]
    lst = c.get("/simulations", params={"limit": 5}).json()
    assert lst[0]["run_id"] == rep["run_id"] and "results" not in lst[0]
    assert lst[0]["task_count"] == len(rep["results"])


def test_unknown_run_404():
    assert c.get("/simulations/sim-nope").status_code == 404


def test_unknown_scenario_422():
    r = c.post("/simulations", json={"scenario_id": "nope"}, headers=OK)
    assert r.status_code == 422
