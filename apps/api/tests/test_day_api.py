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


def test_day_changes_and_compare_on_the_tiny_world():
    ch = c.get("/day/weekday/changes").json()
    assert ch["scenario"] == "weekday" and isinstance(ch["candidates"], list)
    if ch["candidates"]:
        body = {"actions": [ch["candidates"][0]["action"]]}
        r = c.post("/day/weekday/compare", json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["trips_better"] + d["trips_worse"] <= d["trips_changed"]
        assert "residents_better" in d and "residents_worse" in d and d["baseline"]
        assert "not a plan" in d["disclaimer"] and d["changed_geojson"]["features"]
        assert all(f["properties"]["whatif"] for f in d["changed_geojson"]["features"])
    bad = c.post(
        "/day/weekday/compare",
        json={"actions": [{"kind": "set_river_stage", "scenario_id": "stage_p3m"}]},
    )
    assert bad.status_code == 422
    assert c.post("/day/weekday/compare", json={"actions": []}).status_code == 422


def test_rehearse_my_trip_is_a_post_with_ends_in_the_body():
    body = {"from_id": "park-b", "to_id": "playground", "profile": "stroller", "leave_at": "07:30"}
    r = c.post("/day/weekday/trip", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "rehearsed" and d["from"]["name"] == "Car Park B"
    assert d["asked"]["outcome"] == "clear" and d["sweep"] and d["track"]
    assert "not a forecast" in d["disclaimer"]
    # a home point never travels in the URL: there is no GET form
    assert c.get("/day/weekday/trip", params={"from_id": "park-b"}).status_code == 405
    assert c.post("/day/weekday/trip", json={**body, "leave_at": "25:00"}).status_code == 422
    assert c.post("/day/nope/trip", json=body).status_code == 404
