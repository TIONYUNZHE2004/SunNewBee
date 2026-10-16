from pathlib import Path

import pytest

TINY = Path(__file__).resolve().parents[3] / "packages/spatial/tests/fixtures/tiny"


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setenv("TL_DATA_DIR", str(TINY))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/t.db")
    monkeypatch.setenv("STAFF_TOKEN", "test-token")
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    monkeypatch.setenv("WARM_WORLD_MODEL", "false")  # no background solver work in tests
    from townshiplens_api import state

    state.reset()
    yield
    _stop_sim_threads()


def _stop_sim_threads() -> None:
    """Test hygiene (Task 55): a test that starts a run and never waits must not leak its worker
    into the next test. Cancel every run, then join the `sim-*` threads."""
    import threading

    from townshiplens_api.routes import sim as sim_routes

    for flag in list(sim_routes._cancel_flags.values()):
        flag.set()
    for t in threading.enumerate():
        if t.name.startswith("sim-") and t is not threading.current_thread():
            t.join(timeout=30)


@pytest.fixture
def run_sim():
    """POST /simulations, expect 202, poll until the run is done, return its report."""
    import time

    from fastapi.testclient import TestClient
    from townshiplens_api.main import app

    c = TestClient(app)

    def run(body: dict | None = None, timeout: float = 120.0) -> dict:
        r = c.post("/simulations", json=body or {}, headers={"X-Staff-Token": "test-token"})
        assert r.status_code == 202, r.text
        rid = r.json()["run_id"]
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            got = c.get(f"/simulations/{rid}").json()
            if got["status"] == "done":
                return got["report"]
            assert got["status"] in ("queued", "running"), got
            time.sleep(0.02)
        raise AssertionError("simulation did not finish")

    return run
