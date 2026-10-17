"""POST /what-if and GET /what-if/suggestions (Cycle 1, Township World Model)."""

import pytest
from fastapi.testclient import TestClient
from townshiplens_api.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_what_if_ramp_suite(client):
    r = client.post(
        "/what-if",
        json={
            "actions": [{"kind": "build_ramp", "element_id": "seg-be"}],
            "profile": "wheelchair",
            "scope": "suite",
        },
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["summary"]["confirmed_after"] > d["summary"]["confirmed_before"]
    assert d["evidence_id"].startswith("ev-whatif-")
    assert d["action_labels"] == ["Build a step-free ramp at a set of unnamed steps"]
    assert all(f["properties"]["whatif"] for f in d["diff_geojson"]["features"])
    assert "not a forecast" in d["disclaimer"]


def test_what_if_rejects_invented_ids_and_kinds(client):
    bad = client.post("/what-if", json={"actions": [{"kind": "build_ramp", "element_id": "x"}]})
    assert bad.status_code == 422 and "unknown path" in bad.text
    weird = client.post("/what-if", json={"actions": [{"kind": "teleport"}]})
    assert weird.status_code == 422


def test_what_if_never_changes_the_real_township(client):
    before = client.post(
        "/routes", json={"from": "park-b", "to": "toilet-1", "profile": "wheelchair"}
    )
    client.post(
        "/what-if",
        json={"actions": [{"kind": "close_path", "element_id": "seg-ab"}], "scope": "evacuation"},
    )
    after = client.post(
        "/routes", json={"from": "park-b", "to": "toilet-1", "profile": "wheelchair"}
    )
    assert before.json()["status"] == after.json()["status"]


def test_what_if_suggestions(client):
    r = client.get("/what-if/suggestions", params={"profile": "wheelchair"})
    assert r.status_code == 200
    kinds = {c["action"]["kind"] for c in r.json()["candidates"]}
    assert {"build_ramp", "close_path"} <= kinds and "stage_p3m" in r.json()["river_stages"]
    assert client.get("/what-if/suggestions", params={"profile": "nope"}).status_code == 422


def test_what_if_rejects_drive_and_bogus_stage(client):
    """Review C1/I8: drive what-ifs were slow (minutes on the seed) and off-topic."""
    r = client.post("/what-if", json={"actions": [], "profile": "drive", "scope": "evacuation"})
    assert r.status_code == 422 and "walking profiles" in r.text
    r = client.post("/what-if", json={"actions": [], "scope": "suite", "scenario_id": "stage_p9m"})
    assert r.status_code == 422


def test_river_rollout_endpoint(client):
    r = client.get("/river-rollout", params={"profiles": ["wheelchair"], "n": 5})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["stages"][0]["id"] == "baseline" and d["residents"] and d["routes"]
    assert "not a forecast" in d["disclaimer"]
    assert client.get("/river-rollout", params={"profiles": ["drive"]}).status_code == 422


def test_river_rollout_repeats_and_permutations_hit_one_cache_entry(client):
    """Review C4: repeated or reordered profiles never multiply the work."""
    from townshiplens_spatial import tools

    before = len(tools._WM_CACHE)
    a = client.get("/river-rollout", params={"profiles": ["stroller", "wheelchair"], "n": 5})
    b = client.get("/river-rollout", params={"profiles": ["wheelchair", "stroller"] * 10, "n": 5})
    assert a.status_code == b.status_code == 200 and a.json() == b.json()
    assert len(tools._WM_CACHE) - before <= 1
    assert len({r["id"] for r in b.json()["residents"]}) == len(b.json()["residents"])
