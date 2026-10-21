"""POST /developments/simulate (spec 2026-10-21 §5.1, AC-H6)."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app

SEED = Path(__file__).resolve().parents[3] / "data/seed/elmina"


def test_tiny_fixture_returns_404_with_the_spec_message():  # AC-H6
    r = TestClient(app).post("/developments/simulate", json={})
    assert r.status_code == 404
    assert r.json() == {"detail": "development simulation not available for this world"}
    assert TestClient(app).post("/developments/simulate").status_code == 404  # body optional


def test_a_plan_failing_its_check_is_unavailable_and_cached(monkeypatch):
    from townshiplens_api.routes import devsim as route
    from townshiplens_spatial import devsim

    calls = []

    def bad(world, brief):
        calls.append(1)
        raise devsim.DevsimCheckError("a number in the copy is not a fact")

    monkeypatch.setattr(devsim, "build_development_plan", bad)
    route.clear_cache()
    c = TestClient(app)
    try:
        assert c.post("/developments/simulate", json={}).status_code == 404
        assert c.post("/developments/simulate", json={}).status_code == 404
        assert calls == [1]  # deterministic: the failure is cached, not rebuilt per request
    finally:
        route.clear_cache()


def test_brief_text_is_bounded():
    r = TestClient(app).post("/developments/simulate", json={"brief_text": "x" * 2001})
    assert r.status_code == 422


@pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
def test_elmina_returns_the_plan(monkeypatch):
    monkeypatch.setenv("TL_DATA_DIR", str(SEED))
    state.reset()
    c = TestClient(app)
    r = c.post(
        "/developments/simulate",
        json={"brief_text": "Simulate a 30-storey, 500-home tower near Lakeside Mall"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["world"] == "elmina" and d["provisional"] is False and d["total_s"] == 45
    assert d["site"]["parcel_id"] == "way/1564861412"
    assert d["site"]["kanopi_clearance_m"] >= 200
    f = d["facts"]
    assert f["profile"] == "default" and f["provenance"] == "routing engine, default profile"
    assert f["detour"]["detour_min"] >= 2 and f["detour"]["after_m"] > f["detour"]["before_m"]
    assert f["park"]["min"] >= 1 and f["mall"]["min"] >= 1
    assert [c["name"] for c in d["cast"]] == [
        "Pak Cik Halim",
        "Farid",
        "Site worker",
        "Mei Ling",
        "Mak Cik Zainab",
        "Arjun",
    ]
    assert [b["n"] for b in d["bubbles"]] == list(range(1, 8))
    assert [a["name"] for a in d["acts"]] == [
        "Brief",
        "Construction",
        "Handover",
        "Daily Life",
    ]
    assert "end_card" not in d and d["brief"]["title"] == "Impact brief"
    # the 45 s plan carries the impact modules (demo polish C7)
    for k in ("impact", "lorry_route", "schedule", "flood", "access_matrix", "residents"):
        assert k in d, k
    assert len(d["residents"]["residents"]) == 40
    assert d["schedule"]["months_total"] == len(d["schedule"]["days_lost_by_month"])
    assert d["month_keys"][0] == [0.0, 0.0] and d["month_keys"][-1][0] == 45
    assert set(d["anchors"]) == {"halim_path", "farid", "worker", "junction", "park", "mall"}
    assert d["labels"]["simulation"] == "Simulation · illustrative"
    # deterministic and cached: the same plan again
    assert c.post("/developments/simulate", json={}).json() == d
