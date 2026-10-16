"""GET /verify-next and GET /belief (Cycle 2)."""

from fastapi.testclient import TestClient
from townshiplens_api.main import app

c = TestClient(app)


def test_verify_next_plan_is_engine_verified():
    r = c.get("/verify-next", params={"profile": "wheelchair", "scope": "suite", "budget": 1})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["facts"] and "seg-" not in d["facts"][0]["label"]
    assert d["summary"]["confirmed_after"] >= d["summary"]["confirmed_before"]
    assert d["evidence_id"].startswith("ev-plan-") and "if they pass" in d["disclaimer"]
    assert c.get("/verify-next", params={"profile": "nope"}).status_code == 422
    assert c.get("/verify-next", params={"budget": 99}).status_code == 422


def test_belief_is_public_and_planning_only():
    r = c.get("/belief")
    assert r.status_code == 200
    assert "Planning estimate only" in r.json()["note"]
    assert set(r.json()["sources"]) == {"osm_prior_obs", "staff_verified"}
