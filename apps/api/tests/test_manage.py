from fastapi.testclient import TestClient
from townshiplens_api.main import app

c = TestClient(app)
OK = {"X-Staff-Token": "test-token"}


def _file_vr():
    c.post("/routes", json={"from": "park-b", "to": "kiosk", "profile": "stroller"})
    vrs = c.get("/verification-requests").json()
    assert vrs and vrs[0]["element_id"] == "seg-cf"
    return vrs[0]["id"]


def test_vr_flow():
    vid = _file_vr()
    body = {"action": "verify", "value": 4.0, "note": "test"}
    assert (
        c.post(
            f"/verification-requests/{vid}/resolve", json=body, headers={"X-Staff-Token": "nope"}
        ).status_code
        == 401
    )
    assert c.post(f"/verification-requests/{vid}/resolve", json=body).status_code == 401
    r = c.post(f"/verification-requests/{vid}/resolve", json=body, headers=OK)
    assert r.status_code == 200 and r.json()["status"] == "resolved"
    again = c.post("/routes", json={"from": "park-b", "to": "kiosk", "profile": "stroller"}).json()
    assert again["status"] == "confirmed"  # the fix improved the answer


def test_resolve_unknown_404_and_twice_409():
    body = {"action": "reject", "note": "x"}
    assert (
        c.post("/verification-requests/vr-9999/resolve", json=body, headers=OK).status_code == 404
    )
    vid = _file_vr()
    assert c.post(f"/verification-requests/{vid}/resolve", json=body, headers=OK).status_code == 200
    assert c.post(f"/verification-requests/{vid}/resolve", json=body, headers=OK).status_code == 409
    assert c.get("/verification-requests", params={"status": "rejected"}).json()[0]["id"] == vid


def test_verify_requires_value():
    vid = _file_vr()
    r = c.post(f"/verification-requests/{vid}/resolve", json={"action": "verify"}, headers=OK)
    assert r.status_code == 422


def test_default_token_refused_503(monkeypatch):
    monkeypatch.setenv("STAFF_TOKEN", "change-me")
    vid = _file_vr()
    r = c.post(
        f"/verification-requests/{vid}/resolve",
        json={"action": "reject"},
        headers={"X-Staff-Token": "change-me"},
    )
    assert r.status_code == 503 and "change-me" not in r.text


def test_value_type_mismatch_422():
    from townshiplens_api import state
    from townshiplens_spatial.models import Claim

    vid = _file_vr()
    state.get_ctx().world.refresh_claim("seg-cf", "incline_pct", Claim(value=3.0, status="stale"))
    url = f"/verification-requests/{vid}/resolve"
    bad = c.post(url, json={"action": "verify", "value": "steep"}, headers=OK)
    assert bad.status_code == 422
    assert (
        c.post(url, json={"action": "verify", "value": 4}, headers=OK).status_code == 200
    )  # int ok


def test_layers_cache_invalidated_by_world_version():
    from townshiplens_api import state
    from townshiplens_spatial.models import Claim

    def st():
        fc = c.get("/layers/access", params={"profile": "stroller"}).json()
        return {
            f["properties"]["id"]: f["properties"]["status_for_profile"]
            for f in fc["features"]
            if f["geometry"]["type"] == "LineString"
        }["seg-cf"]

    assert st() == "unknown"
    state.get_ctx().world.refresh_claim(
        "seg-cf", "incline_pct", Claim(value=4.0, status="verified", verified_at="2026-10-15")
    )
    assert st() != "unknown"
