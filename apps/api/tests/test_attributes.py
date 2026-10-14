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
    rows = c.get("/audit", params={"element_id": "seg-cf"}, headers=OK).json()
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
    assert (
        c.get("/audit", params={"element_id": "seg-cf"}, headers=OK).json()[0]["new"]["value"]
        is None
    )


def test_first_claim_old_null_and_order():
    c.patch(URL, json=_body(), headers=OK)
    c.patch(URL, json=_body(value=5.0), headers=OK)
    rows = c.get("/audit", params={"element_id": "seg-cf"}, headers=OK).json()
    assert [r["new"]["value"] for r in rows] == [5.0, 4.0]
    assert rows[1]["old"]["value"] is None  # pre-existing unknown claim
    c.patch("/elements/seg-cf/attributes/brand_new", json=_body(), headers=OK)
    assert c.get("/audit", params={"element_id": "seg-cf"}, headers=OK).json()[0]["old"] is None


def test_resolve_writes_audit():
    c.post("/routes", json={"from": "park-b", "to": "kiosk", "profile": "stroller"})
    vid = c.get("/verification-requests").json()[0]["id"]
    r = c.post(
        f"/verification-requests/{vid}/resolve",
        json={"action": "verify", "value": 4.0},
        headers=OK,
    )
    assert r.status_code == 200
    rows = c.get("/audit", params={"element_id": "seg-cf"}, headers=OK).json()
    assert len(rows) == 1 and rows[0]["reason"] == f"resolve:{vid}"
    assert rows[0]["new"]["value"] == 4.0


def test_audit_requires_staff():
    assert c.get("/audit").status_code == 401
    assert c.get("/audit", headers={"X-Staff-Token": "bad"}).status_code == 401


def test_null_value_422_unless_unknown():
    assert c.patch(URL, json=_body(value=None), headers=OK).status_code == 422
    assert c.patch(URL, json=_body(value=None, status="unknown"), headers=OK).status_code == 200


def _vr():
    c.post("/routes", json={"from": "park-b", "to": "kiosk", "profile": "stroller"})
    return c.get("/verification-requests").json()[0]["id"]


def test_resolve_audit_failure_leaves_vr_open(monkeypatch):
    import sqlite3

    from townshiplens_api.store import AuditStore

    _seed()
    vid = _vr()

    def boom(self, **kw):
        raise sqlite3.OperationalError("locked")

    monkeypatch.setattr(AuditStore, "append", boom)
    r = c.post(
        f"/verification-requests/{vid}/resolve", json={"action": "verify", "value": 4.0}, headers=OK
    )
    assert r.status_code == 503
    assert c.get("/verification-requests").json()[0]["id"] == vid  # still open
    assert state.get_ctx().world.edges["seg-cf"].claims["incline_pct"].value == 3.0


def test_resolve_vr_failure_after_commit_keeps_claim_and_audit(monkeypatch):
    import sqlite3

    _seed()
    vid = _vr()

    def boom(*a, **kw):
        raise sqlite3.OperationalError("locked")

    monkeypatch.setattr(state.get_ctx().vrs, "resolve", boom)
    r = c.post(
        f"/verification-requests/{vid}/resolve", json={"action": "verify", "value": 4.0}, headers=OK
    )
    assert r.status_code == 503
    assert c.get("/verification-requests").json()[0]["id"] == vid
    assert state.get_ctx().world.edges["seg-cf"].claims["incline_pct"].value == 4.0
    assert len(c.get("/audit", params={"element_id": "seg-cf"}, headers=OK).json()) == 1


def _patch(key, value):
    return c.patch(f"/elements/seg-cf/attributes/{key}", json=_body(value=value), headers=OK)


def test_catalogue_types_enforced_with_null_existing():
    state.get_ctx().world.refresh_claim("seg-cf", "step_count", Claim(value=None, status="unknown"))
    r = _patch("step_count", "3")
    assert r.status_code == 422 and "step_count" in r.json()["detail"]
    assert _patch("step_count", 3).status_code == 200
    assert _patch("wheelchair", "maybe").status_code == 422
    assert _patch("wheelchair", "limited").status_code == 200
    assert _patch("lit", "yes").status_code == 422
    assert _patch("lit", True).status_code == 200


def test_unknown_key_keeps_existing_value_check():
    assert _patch("foo", "bar").status_code == 200  # no existing claim: anything goes
    assert _patch("foo", 5).status_code == 422  # existing str -> int mismatch
    assert _patch("foo", "baz").status_code == 200


def test_resolve_enforces_catalogue():
    null_claim = Claim(value=None, status="unknown")
    state.get_ctx().world.refresh_claim("seg-cf", "incline_pct", null_claim)
    c.post("/routes", json={"from": "park-b", "to": "kiosk", "profile": "stroller"})
    vid = c.get("/verification-requests").json()[0]["id"]
    for action in ("verify", "correct"):
        r = c.post(
            f"/verification-requests/{vid}/resolve",
            json={"action": action, "value": "4"},
            headers=OK,
        )
        assert r.status_code == 422
    assert c.get("/verification-requests").json()[0]["id"] == vid  # still open


def test_validate_value():
    from townshiplens_spatial.attributes import validate_value as v

    assert v("step_count", 3) is None and v("step_count", 2.5) is None
    assert v("step_count", "3") and v("step_count", True)
    assert v("ramp", False) is None and v("ramp", "true") and v("ramp", 1)
    assert v("surface", "wood") is None and v("surface", "lava")
    assert v("surface", 3)
    assert v("name", "Kiosk") is None and v("name", 3)
    assert v("foo", object()) is None
