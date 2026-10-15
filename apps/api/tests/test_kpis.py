from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app

c = TestClient(app)
OK = {"X-Staff-Token": "test-token"}


def test_kpis_empty():
    k = c.get("/kpis").json()
    assert k == {"open_vrs": 0, "median_hours_to_resolve": None, "journeys_confirmed_pct": None}


def test_median_and_open_count_after_resolves():
    vrs = state.get_ctx().vrs
    ids = [vrs.request("seg-cf", a, "unknown")[0].id for a in ("incline_pct", "width_m", "surface")]
    assert c.get("/kpis").json()["open_vrs"] == 3
    for vid, hrs in zip(ids[:2], (2, 6), strict=True):
        vrs.resolve(vid, "reject")
        vrs.db.execute(
            "UPDATE vr SET created_at=?, resolved_at=? WHERE id=?",
            ("2026-10-15T00:00:00+00:00", f"2026-10-15T{hrs:02d}:00:00+00:00", vid),
        )
        vrs.db.commit()
    k = c.get("/kpis").json()
    assert k["open_vrs"] == 1
    assert k["median_hours_to_resolve"] is None


def test_median_of_two_resolved():
    vrs = state.get_ctx().vrs
    for a, hrs in (("incline_pct", 2), ("width_m", 6)):
        vid = vrs.request("seg-cf", a, "unknown")[0].id
        vrs.resolve(vid, "verify", 1)
        vrs.db.execute(
            "UPDATE vr SET created_at=?, resolved_at=? WHERE id=?",
            ("2026-10-15T00:00:00+00:00", f"2026-10-15T{hrs:02d}:00:00+00:00", vid),
        )
        vrs.db.commit()
    assert c.get("/kpis").json()["median_hours_to_resolve"] == 4.0


def test_journeys_confirmed_from_latest_run(run_sim):
    run_sim({})
    run = c.get("/simulations").json()[0]
    total = sum(sum(v.values()) for v in run["counts"].values())
    ok = sum(v.get("success", 0) for v in run["counts"].values())
    assert total and c.get("/kpis").json()["journeys_confirmed_pct"] == round(100 * ok / total, 1)


def test_malformed_timestamp_skipped_and_odd_median():
    vrs = state.get_ctx().vrs
    for a, hrs in (("incline_pct", 1), ("width_m", 3), ("surface", 9)):
        vid = vrs.request("seg-cf", a, "unknown")[0].id
        vrs.resolve(vid, "verify", 1)
        vrs.db.execute(
            "UPDATE vr SET created_at=?, resolved_at=? WHERE id=?",
            ("2026-10-15T00:00:00+00:00", f"2026-10-15T{hrs:02d}:00:00+00:00", vid),
        )
    bad = vrs.request("seg-cf", "kerb", "unknown")[0].id
    vrs.resolve(bad, "verify", 1)
    vrs.db.execute("UPDATE vr SET created_at='garbage' WHERE id=?", (bad,))
    vrs.db.commit()
    assert c.get("/kpis").json()["median_hours_to_resolve"] == 3.0
