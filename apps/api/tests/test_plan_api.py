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


def test_ticket_impact_endpoint():
    r = c.post("/routes", json={"from": "park-b", "to": "kiosk", "profile": "stroller"})
    assert r.status_code == 200
    vrs = c.get("/verification-requests").json()
    vr = next((v for v in vrs if v["element_id"] == "seg-cf"), None)
    if vr is None:  # /routes may not file tickets; file one through the chat tool path
        from townshiplens_api import state
        from townshiplens_spatial import tools as sp

        sp.plan_route(
            state.get_ctx(),
            from_id="park-b",
            to_id="kiosk",
            profile="stroller",
            question_summary="stroller route Car Park B -> Park kiosk",
        )
        vr = next(v for v in state.get_ctx().vrs.list() if v.element_id == "seg-cf").model_dump()
    d = c.get(f"/verification-requests/{vr['id']}/impact").json()
    assert d["mode"] in ("would", "did") and d["sampled"] >= 1 and "planning estimate" in d["note"]
    assert c.get("/verification-requests/vr-9999/impact").status_code == 404
