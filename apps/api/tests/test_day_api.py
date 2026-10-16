"""Elmina Day API (Cycle 10)."""

from fastapi.testclient import TestClient
from townshiplens_api.main import app

c = TestClient(app)


def test_day_scenarios_and_a_report_on_the_tiny_world():
    ids = {s["id"] for s in c.get("/day/scenarios").json()}
    assert {"weekday", "friday"} <= ids
    d = c.get("/day/weekday").json()
    h = d["headline"]
    assert h["residents"] == 5000 and h["trips"] > 0
    keys = ("on_time", "late", "cancelled", "turned_back", "stranded", "data_gap")
    assert sum(h[k] for k in keys) == h["trips"]
    sp = d["spotlight"]
    assert sp["residents"] and sp["voice"]["note"]
    assert all(p["voice"] in ("ai", "template", "engine") for p in sp["feed"])
    assert "not a forecast" in d["disclaimer"] and d["population"]["sources"]
    assert d["timeline"] and d["tracks"]["nodes"]
    assert c.get("/day/nope").status_code == 404
