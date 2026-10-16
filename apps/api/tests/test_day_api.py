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
    assert h["on_time"] + h["late"] + h["cancelled"] + h["stranded"] + h["data_gap"] == h["trips"]
    assert "not a forecast" in d["disclaimer"] and d["population"]["sources"]
    assert d["timeline"] and d["tracks"]["nodes"]
    assert c.get("/day/nope").status_code == 404
