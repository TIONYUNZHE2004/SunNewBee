"""Cycle 9: the API warms the world-model screens' default requests in the background."""

from fastapi.testclient import TestClient
from townshiplens_api import state, warm
from townshiplens_api.main import app
from townshiplens_spatial import tools


def test_warm_once_fills_the_same_cache_entries_the_endpoints_use():
    ctx = state.get_ctx()
    tools._WM_CACHE.clear()
    s = warm.warm_once(ctx)
    assert s["state"] == "warm" and set(s["done"]) == {n for n, _ in warm.JOBS}
    filled = len(tools._WM_CACHE)
    c = TestClient(app)
    assert c.get("/river-rollout").status_code == 200
    assert c.get("/what-if/suggestions").status_code == 200
    assert c.get("/verify-next").status_code == 200
    assert len(tools._WM_CACHE) == filled  # every default request was a cache hit


def test_health_reports_the_warm_state():
    warm.warm_once(state.get_ctx())
    d = TestClient(app).get("/healthz").json()
    assert d["status"] == "ok" and d["world_model"]["state"] == "warm"


def test_a_failing_job_never_breaks_the_warm_up(monkeypatch):
    def boom(ctx):
        raise RuntimeError("x")

    monkeypatch.setattr(warm, "JOBS", (("boom", boom), *warm.JOBS[1:]))
    s = warm.warm_once(state.get_ctx())
    assert "boom" not in s["done"] and s["state"] == "warm"


def test_verify_next_rejects_a_non_walking_profile():
    assert TestClient(app).get("/verify-next", params={"profile": "drive"}).status_code == 422


def test_the_loop_warms_again_when_the_world_changes(monkeypatch):
    import time

    monkeypatch.setattr(warm, "POLL_S", 0.05)
    ctx = state.get_ctx()
    warm.start()
    try:
        deadline = time.time() + 10
        while warm.status()["version"] != ctx.world.version or warm.status()["state"] != "warm":
            assert time.time() < deadline
            time.sleep(0.05)
        ctx.world.version += 1  # a resolved ticket or a closure bumps the version
        while warm.status()["version"] != ctx.world.version or warm.status()["state"] != "warm":
            assert time.time() < deadline
            time.sleep(0.05)
    finally:
        warm.stop()
