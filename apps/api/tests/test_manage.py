from fastapi.testclient import TestClient
from townshiplens_api.main import app
from vr_support import file_kiosk_vr

c = TestClient(app)
OK = {"X-Staff-Token": "test-token"}


def _file_vr():
    return file_kiosk_vr()


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


def test_vr_filters_reason_element_status():
    from townshiplens_api import state

    ctx = state.get_ctx()
    ctx.vrs.request("seg-cf", "incline_pct", "unknown")
    b, _ = ctx.vrs.request("seg-cf", "width_m", "stale")
    ctx.vrs.request("seg-x", "incline_pct", "user_report")
    ctx.vrs.resolve(b.id, "reject")

    def ids(**p):
        return {
            (v["element_id"], v["attribute"])
            for v in c.get("/verification-requests", params=p).json()
        }

    assert len(c.get("/verification-requests", params={"status": "all"}).json()) == 3
    assert len(c.get("/verification-requests").json()) == 2
    assert ids(reason="user_report") == {("seg-x", "incline_pct")}
    assert ids(status="all", element_id="seg-cf") == {
        ("seg-cf", "incline_pct"),
        ("seg-cf", "width_m"),
    }
    assert ids(attribute="incline_pct") == {("seg-cf", "incline_pct"), ("seg-x", "incline_pct")}
    assert ids(status="rejected", element_id="seg-cf") == {("seg-cf", "width_m")}


def test_staff_create_vr_dedupes_and_sanitises():
    body = {"target_id": "seg-cf", "attribute": "incline_pct", "reason": "stale"}
    assert c.post("/verification-requests", json=body).status_code == 401
    assert (
        c.post("/verification-requests", json=body, headers={"X-Staff-Token": "x"}).status_code
        == 401
    )
    a = c.post("/verification-requests", json=body, headers=OK)
    assert a.status_code == 200 and a.json()["demand"] == 1
    b = c.post("/verification-requests", json=body, headers=OK)
    assert b.json()["id"] == a.json()["id"] and b.json()["demand"] == 2
    # PDPA: unknown element / bad attribute / bad reason are normalised, no free text stored
    evil = {"target_id": "Ah Meng 0123456789", "attribute": "Call me!", "reason": "lol"}
    r = c.post("/verification-requests", json=evil, headers=OK).json()
    assert r["element_id"] == "unknown_place" and r["attribute"] == "unknown"
    assert r["reason"] == "unknown" and "Meng" not in str(r)


def test_verify_without_value_keeps_current_value():
    from townshiplens_api import state
    from townshiplens_spatial.models import Claim

    vid = _file_vr()
    world = state.get_ctx().world
    world.refresh_claim("seg-cf", "incline_pct", Claim(value=3.0, status="stale"))
    r = c.post(
        f"/verification-requests/{vid}/resolve",
        json={"action": "verify", "note": "looks right"},
        headers=OK,
    )
    assert r.status_code == 200 and r.json()["status"] == "resolved"
    claim = world.edges["seg-cf"].claims["incline_pct"]
    assert claim.value == 3.0 and claim.status == "verified"


def test_correct_number_attribute_needs_a_number():
    vid = _file_vr()
    url = f"/verification-requests/{vid}/resolve"
    assert c.post(url, json={"action": "correct", "value": "4"}, headers=OK).status_code == 422
    assert c.post(url, json={"action": "correct", "value": 4}, headers=OK).status_code == 200


def test_concurrent_resolves_loser_changes_nothing(monkeypatch):
    import threading
    import time
    from concurrent.futures import ThreadPoolExecutor

    from townshiplens_api import state
    from townshiplens_api.routes import manage

    vid = _file_vr()
    store = manage._audit()
    real = store.append
    rows = []

    def slow(**kw):
        time.sleep(0.3)
        rows.append(kw)
        return real(**kw)

    monkeypatch.setattr(store, "append", slow)
    url = f"/verification-requests/{vid}/resolve"
    barrier = threading.Barrier(2)

    def go(v):
        barrier.wait()
        return v, c.post(url, json={"action": "correct", "value": v}, headers=OK).status_code

    with ThreadPoolExecutor(2) as ex:
        results = dict(ex.map(go, [4.0, 6.0]))
    assert sorted(results.values()) == [200, 409]
    winner = next(v for v, s in results.items() if s == 200)
    assert len(rows) == 1
    assert state.get_ctx().world.edges["seg-cf"].claims["incline_pct"].value == winner
    done = c.get("/verification-requests", params={"status": "all"}).json()
    assert [x["resolution"]["value"] for x in done if x["id"] == vid] == [winner]


def test_vr_list_carries_current_value():
    from townshiplens_api import state
    from townshiplens_spatial.models import Claim

    vid = _file_vr()
    row = next(v for v in c.get("/verification-requests").json() if v["id"] == vid)
    assert row["current_value"] is None
    state.get_ctx().world.refresh_claim("seg-cf", "incline_pct", Claim(value=3.0, status="stale"))
    row = next(v for v in c.get("/verification-requests").json() if v["id"] == vid)
    assert row["current_value"] == 3.0


def test_staff_note_is_not_public():  # final review Minor 1
    vid = _file_vr()
    note = "call Mr Tan on 0123456789"
    r = c.post(
        f"/verification-requests/{vid}/resolve",
        json={"action": "verify", "value": 3.0, "note": note},
        headers=OK,
    )
    assert r.status_code == 200 and r.json()["resolution"]["note"] == note  # staff see it
    public = c.get("/verification-requests", params={"status": "resolved"}).json()
    assert public and all("note" not in (v["resolution"] or {}) for v in public)
    assert note not in str(public)
    assert any(x["note"] == note for x in c.get("/audit", headers=OK).json())  # kept for staff


def test_unauthenticated_invalid_body_is_401_not_422():  # task 29 Minor 7
    assert c.post("/verification-requests", json={"target_id": 5}).status_code == 401
    assert c.post("/verification-requests", json={}).status_code == 401
    url = "/verification-requests/vr-0001/resolve"
    assert c.post(url, json={"action": "bogus"}).status_code == 401
    assert c.post("/closures", json={"reason": "x"}).status_code == 401
    assert c.post("/verification-requests", json={}, headers=OK).status_code == 422
