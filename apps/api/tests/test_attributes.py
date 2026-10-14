from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app
from townshiplens_spatial.models import Claim

c = TestClient(app)
OK = {"X-Staff-Token": "test-token"}
URL = "/elements/seg-cf/attributes/incline_pct"


def _body(**kw):
    return {"value": 4.0, "status": "verified", "source_type": "site_visit", **kw}


def _seed():
    state.get_ctx().world.refresh_claim("seg-cf", "incline_pct", Claim(value=3.0, status="stale"))


def test_token_behaviour(monkeypatch):
    assert c.patch(URL, json=_body()).status_code == 401
    assert c.patch(URL, json=_body(), headers={"X-Staff-Token": "bad"}).status_code == 401
    monkeypatch.setenv("STAFF_TOKEN", "change-me")
    r = c.patch(URL, json=_body(), headers={"X-Staff-Token": "change-me"})
    assert r.status_code == 503


def test_validation():
    _seed()
    assert (
        c.patch("/elements/nope/attributes/incline_pct", json=_body(), headers=OK).status_code
        == 404
    )
    assert (
        c.patch("/elements/seg-cf/attributes/Bad-Key", json=_body(), headers=OK).status_code == 422
    )
    assert c.patch(URL, json=_body(value="steep"), headers=OK).status_code == 422
    assert c.patch(URL, json=_body(status="stale"), headers=OK).status_code == 422
    assert c.patch(URL, json=_body(value=4), headers=OK).status_code == 200  # int ok


def test_edit_changes_world_and_audits():
    _seed()
    r = c.patch(URL, json=_body(note="measured"), headers=OK)
    assert r.status_code == 200
    claim = state.get_ctx().world.edges["seg-cf"].claims["incline_pct"]
    assert claim.value == 4.0 and claim.status == "verified"
    rows = c.get("/audit", params={"element_id": "seg-cf"}).json()
    assert len(rows) == 1
    a = rows[0]
    assert a["reason"] == "edit" and a["actor"] == "staff" and a["attribute"] == "incline_pct"
    assert a["old"]["value"] == 3.0 and a["new"]["value"] == 4.0 and a["note"] == "measured"
    assert a["new"]["evidence_type"] == "site_visit"


def test_unknown_nulls_value():
    _seed()
    r = c.patch(URL, json=_body(value=9.0, status="unknown"), headers=OK)
    assert r.status_code == 200
    claim = state.get_ctx().world.edges["seg-cf"].claims["incline_pct"]
    assert claim.value is None and claim.status == "unknown"
    assert c.get("/audit", params={"element_id": "seg-cf"}).json()[0]["new"]["value"] is None


def test_first_claim_old_null_and_order():
    c.patch(URL, json=_body(), headers=OK)
    c.patch(URL, json=_body(value=5.0), headers=OK)
    rows = c.get("/audit", params={"element_id": "seg-cf"}).json()
    assert [r["new"]["value"] for r in rows] == [5.0, 4.0]
    assert rows[1]["old"]["value"] is None  # pre-existing unknown claim
    c.patch("/elements/seg-cf/attributes/brand_new", json=_body(), headers=OK)
    assert c.get("/audit", params={"element_id": "seg-cf"}).json()[0]["old"] is None


def test_resolve_writes_audit():
    c.post("/routes", json={"from": "park-b", "to": "kiosk", "profile": "stroller"})
    vid = c.get("/verification-requests").json()[0]["id"]
    r = c.post(
        f"/verification-requests/{vid}/resolve",
        json={"action": "verify", "value": 4.0},
        headers=OK,
    )
    assert r.status_code == 200
    rows = c.get("/audit", params={"element_id": "seg-cf"}).json()
    assert len(rows) == 1 and rows[0]["reason"] == f"resolve:{vid}"
    assert rows[0]["new"]["value"] == 4.0
