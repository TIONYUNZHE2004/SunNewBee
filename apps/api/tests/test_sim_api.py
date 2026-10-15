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


def test_keeps_last_20_runs():
    for _ in range(22):
        assert (
            c.post("/simulations", json={"profiles": ["stroller"]}, headers=OK).status_code == 200
        )
    lst = c.get("/simulations", params={"limit": 50}).json()
    assert len(lst) == 20 and "world_version" in lst[0]


def test_report_fields():
    rep = c.post("/simulations", json={"profiles": ["wheelchair"]}, headers=OK).json()
    assert rep["gaps_truncated"] is False and len(rep["run_id"]) == 36
    assert all(set(u) == {"element_id", "attribute"} for x in rep["results"] for u in x["unknowns"])


def test_rest_advisories_are_reported_apart_from_invariant_violations():
    rep = c.post("/simulations", json={"profiles": ["older_adult_rest"]}, headers=OK).json()
    assert not [v for v in rep["invariant_violations"] if v["invariant"] == "I7"]
    assert rep["rest_advisories"], rep  # tiny: no route keeps rest points within 100 m
    a = rep["rest_advisories"][0]
    assert set(a) == {"kind", "task_id", "detail"} and a["kind"] == "rest_limit_no_alternative"
    got = c.get(f"/simulations/{rep['run_id']}").json()
    assert got["rest_advisories"] == rep["rest_advisories"]
