import threading
import time

from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app
from townshiplens_api.routes import sim as sim_route
from townshiplens_spatial import sim as sim_core

c = TestClient(app)
OK = {"X-Staff-Token": "test-token"}


def test_post_requires_token(monkeypatch):
    assert c.post("/simulations", json={}).status_code == 401
    assert c.post("/simulations", json={}, headers={"X-Staff-Token": "bad"}).status_code == 401
    monkeypatch.setenv("STAFF_TOKEN", "change-me")
    assert (
        c.post("/simulations", json={}, headers={"X-Staff-Token": "change-me"}).status_code == 503
    )


def _wait(rid: str) -> dict:
    end = time.monotonic() + 60
    while time.monotonic() < end:
        got = c.get(f"/simulations/{rid}").json()
        if got["status"] in ("done", "failed"):
            return got
        time.sleep(0.02)
    raise AssertionError("did not finish")


def test_post_returns_202_with_run_id_then_polling_reaches_done():
    r = c.post(
        "/simulations", json={"scenario_id": "stage_p3m", "profiles": ["stroller"]}, headers=OK
    )
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "queued" and body["run_id"].startswith("sim-")
    assert r.headers["location"] == f"/simulations/{body['run_id']}"
    first = c.get(f"/simulations/{body['run_id']}").json()  # known at once, whatever its state
    assert first["status"] in ("queued", "running", "done") and first["run_id"] == body["run_id"]
    done = _wait(body["run_id"])
    assert done["status"] == "done" and done["error"] is None
    rep = done["report"]
    assert rep["run_id"] == body["run_id"] and rep["scenario_id"] == "stage_p3m"
    assert set(rep["counts"]) <= {"stroller"}
    lst = c.get("/simulations", params={"limit": 5}).json()
    assert lst[0]["run_id"] == rep["run_id"] and "results" not in lst[0]
    assert lst[0]["task_count"] == len(rep["results"])


def test_status_progress_while_running_and_report_absent(monkeypatch):
    release, started = threading.Event(), threading.Event()
    real = sim_core.run_suite

    def slow(world, tasks, scenario_id=None, progress=None, run_id=None):
        if progress:
            progress(1, 4)
        started.set()
        assert release.wait(30)
        return real(world, tasks, scenario_id, progress, run_id)

    monkeypatch.setattr(sim_core, "run_suite", slow)
    rid = c.post("/simulations", json={"profiles": ["stroller"]}, headers=OK).json()["run_id"]
    assert started.wait(30)
    got = c.get(f"/simulations/{rid}").json()
    assert got["status"] == "running" and got["report"] is None and got["progress"]
    release.set()
    assert _wait(rid)["status"] == "done"


def test_second_post_while_running_is_409_with_the_running_id(monkeypatch):
    release, started = threading.Event(), threading.Event()
    real = sim_core.run_suite

    def slow(world, tasks, scenario_id=None, progress=None, run_id=None):
        started.set()
        assert release.wait(30)
        return real(world, tasks, scenario_id, progress, run_id)

    monkeypatch.setattr(sim_core, "run_suite", slow)
    first = c.post("/simulations", json={"profiles": ["stroller"]}, headers=OK).json()["run_id"]
    assert started.wait(30)
    r = c.post("/simulations", json={"profiles": ["wheelchair"]}, headers=OK)
    assert r.status_code == 409
    assert r.json()["run_id"] == first and "already running" in r.json()["detail"]
    release.set()
    assert _wait(first)["status"] == "done"
    assert c.post("/simulations", json={}, headers=OK).status_code == 202  # free again


def test_failed_run_is_reported_without_internals(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret internals /Users/x")

    real = sim_core.run_suite
    monkeypatch.setattr(sim_core, "run_suite", boom)
    rid = c.post("/simulations", json={}, headers=OK).json()["run_id"]
    got = _wait(rid)
    assert got["status"] == "failed" and got["report"] is None
    assert "secret" not in got["error"] and got["error"]
    assert c.get("/simulations").json() == []  # a failed run is not a recent report
    monkeypatch.setattr(sim_core, "run_suite", real)
    assert c.post("/simulations", json={}, headers=OK).status_code == 202  # not stuck


def test_runs_are_persisted_and_active_runs_do_not_survive_a_restart():
    rid = c.post("/simulations", json={"profiles": ["stroller"]}, headers=OK).json()["run_id"]
    assert _wait(rid)["status"] == "done"
    store = sim_route._store()
    store.create_job("sim-stuck", "2026-10-15T00:00:00+00:00", None)
    store.set_job("sim-stuck", "running", "Planning journeys")
    from townshiplens_api.store import SimStore

    fresh = SimStore(state.db_path())  # a new process opens the same file
    assert fresh.get(rid)["run_id"] == rid
    j = fresh.job("sim-stuck")
    assert j["status"] == "failed" and "restart" in j["error"] and fresh.active_job() is None


def test_unknown_run_404():
    assert c.get("/simulations/sim-nope").status_code == 404


def test_unknown_scenario_422():
    r = c.post("/simulations", json={"scenario_id": "nope"}, headers=OK)
    assert r.status_code == 422


def test_keeps_last_20_runs(run_sim):
    for _ in range(22):
        run_sim({"profiles": ["stroller"]})
    lst = c.get("/simulations", params={"limit": 50}).json()
    assert len(lst) == 20 and "world_version" in lst[0]


def test_report_fields(run_sim):
    rep = run_sim({"profiles": ["wheelchair"]})
    assert rep["gaps_truncated"] is False and len(rep["run_id"]) == 36
    assert all(set(u) == {"element_id", "attribute"} for x in rep["results"] for u in x["unknowns"])


def test_rest_advisories_are_reported_apart_from_invariant_violations(run_sim):
    rep = run_sim({"profiles": ["older_adult_rest"]})
    assert not [v for v in rep["invariant_violations"] if v["invariant"] == "I7"]
    assert rep["rest_advisories"], rep  # tiny: no route keeps rest points within 100 m
    a = rep["rest_advisories"][0]
    assert set(a) == {"kind", "task_id", "detail", "long_segments"}
    assert a["kind"] == "rest_limit_no_alternative" and a["long_segments"] >= 1
    assert rep["rest_limit_m"] == 100 and rep["rest_long_segments"] >= 1
    got = c.get(f"/simulations/{rep['run_id']}").json()["report"]
    assert got["rest_advisories"] == rep["rest_advisories"]


def test_report_carries_the_evacuation_table(run_sim):
    rep = run_sim({"profiles": ["stroller"]})
    ev = rep["evacuation"]
    assert ev["origins_sampled"] == 6 and ev["origins_available"] == 6
    assert {r["profile"] for r in ev["rows"]} == {"stroller"}
    assert [r["scenario_id"] for r in ev["rows"]] == list(sim_core.EVAC_SCENARIOS)
    p5 = next(r for r in ev["rows"] if r["scenario_id"] == "stage_p5m")
    assert p5["counts"]["blocked_by_flood"] == 2 and p5["total"] == 6
    assert ev["violations"] == [] and not [
        v for v in rep["invariant_violations"] if v["invariant"] in ("E1", "E2")
    ]
    # evacuation never leaks into the journey outcome counts the KPI tiles use
    assert set(rep["counts"]["stroller"]) <= {
        "success",
        "success_with_unknowns",
        "blocked",
        "no_data",
    }


def test_evacuation_violations_are_critical_invariant_violations(run_sim, monkeypatch):
    real = sim_core.run_evacuation

    def rigged(*a, **k):
        out = real(*a, **k)
        out["violations"] = [
            {
                "invariant": "E1",
                "task_id": "evac:stroller:park-b",
                "profile": "stroller",
                "origin_id": "park-b",
                "detail": "x",
            }
        ]
        return out

    monkeypatch.setattr(sim_core, "run_evacuation", rigged)
    rep = run_sim({"profiles": ["stroller"]})
    assert [v["invariant"] for v in rep["invariant_violations"]] == ["E1"]
    assert c.get("/simulations").json()[0]["violation_count"] == 1
