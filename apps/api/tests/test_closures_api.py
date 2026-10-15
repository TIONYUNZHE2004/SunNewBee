from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from townshiplens_api.main import app

c = TestClient(app)
OK = {"X-Staff-Token": "test-token"}


def _iso(delta: timedelta) -> str:
    return (datetime.now(UTC) + delta).isoformat()


def _create(**over):
    body = {"element_id": "seg-ab", "reason": "works", "ends_at": _iso(timedelta(days=2))}
    return c.post("/closures", json=body | over, headers=OK)


def test_create_and_end_require_staff_token():
    body = {"element_id": "seg-ab", "reason": "works"}
    assert c.post("/closures", json=body).status_code == 401
    assert c.post("/closures", json=body, headers={"X-Staff-Token": "nope"}).status_code == 401
    cid = _create().json()["id"]
    assert c.post(f"/closures/{cid}/end").status_code == 401
    assert c.post(f"/closures/{cid}/end", headers={"X-Staff-Token": "x"}).status_code == 401


def test_default_staff_token_refused(monkeypatch):
    monkeypatch.setenv("STAFF_TOKEN", "change-me")
    r = c.post(
        "/closures",
        json={"element_id": "seg-ab", "reason": "works"},
        headers={"X-Staff-Token": "change-me"},
    )
    assert r.status_code == 503


def test_end_before_start_is_422():
    r = _create(starts_at=_iso(timedelta(days=3)), ends_at=_iso(timedelta(days=1)))
    assert r.status_code == 422
    assert _create(ends_at=_iso(timedelta(days=-1))).status_code == 422  # ends before now(start)
    assert c.get("/closures", params={"active": False}).json() == []


def test_unknown_element_404_and_bad_reason_422():
    assert _create(element_id="nope").status_code == 404
    assert _create(reason="vibes").status_code == 422


def test_public_list_and_labels():
    r = _create(note="Resurfacing")
    assert r.status_code == 201
    row = r.json()
    assert row["source_label"] == "Reported closure (staff)"
    assert row["label"].startswith("Closed: works until ")
    assert row["active"] is True and row["element_kind"] == "edge"
    assert [x["id"] for x in c.get("/closures").json()] == [row["id"]]  # no token needed
    assert [x["id"] for x in c.get("/closures", params={"active": True}).json()] == [row["id"]]
    assert c.get("/closures", params={"active": False}).json() == []


def test_scheduled_closure_is_not_active_yet():
    r = _create(starts_at=_iso(timedelta(days=1)), ends_at=_iso(timedelta(days=2)))
    assert r.json()["active"] is False
    assert c.get("/closures").json() == []
    assert [x["id"] for x in c.get("/closures", params={"active": False}).json()] == [
        r.json()["id"]
    ]


def test_closure_blocks_route_and_end_restores():
    route = {"from": "park-b", "to": "playground", "profile": "default"}
    assert c.post("/routes", json=route).json()["status"] != "blocked"
    ids = [_create(element_id=e).json()["id"] for e in ("seg-ab", "seg-be")]
    blocked = c.post("/routes", json=route).json()
    assert blocked["status"] == "blocked"
    assert any("Reported closure (staff)" in w for w in blocked["warnings"])
    for i in ids:
        ended = c.post(f"/closures/{i}/end", headers=OK)
        assert ended.status_code == 200 and ended.json()["active"] is False
    assert c.post("/routes", json=route).json()["status"] != "blocked"
    assert c.get("/closures").json() == []
    assert len(c.get("/closures", params={"active": False}).json()) == 2


def test_end_twice_409_and_unknown_404():
    cid = _create().json()["id"]
    assert c.post(f"/closures/{cid}/end", headers=OK).status_code == 200
    assert c.post(f"/closures/{cid}/end", headers=OK).status_code == 409
    assert c.post("/closures/cl-9999/end", headers=OK).status_code == 404


def test_audit_rows_on_create_and_end():
    cid = _create(note="x").json()["id"]
    c.post(f"/closures/{cid}/end", headers=OK)
    rows = c.get("/audit", params={"element_id": "seg-ab"}, headers=OK).json()
    got = [r for r in rows if r["attribute"] == "closure"]
    assert sorted(r["reason"] for r in got) == ["closure:create", "closure:end"]
    assert all(r["actor"] == "staff" for r in got)


def test_layer_marks_closed_and_etag_changes():
    url = "/layers/access"
    r1 = c.get(url)
    etag = r1.headers["etag"]
    assert c.get(url, headers={"If-None-Match": etag}).status_code == 304
    cid = _create().json()["id"]
    r2 = c.get(url, headers={"If-None-Match": etag})
    assert r2.status_code == 200 and r2.headers["etag"] != etag
    props = {
        f["properties"]["id"]: f["properties"]
        for f in r2.json()["features"]
        if f["geometry"]["type"] == "LineString"
    }
    assert props["seg-ab"]["closed"] is True
    assert props["seg-ab"]["status_for_profile"] == "blocked"
    assert props["seg-ab"]["closure_label"].startswith("Closed: works")
    assert "closed" not in props["seg-bc"]
    etag2 = r2.headers["etag"]
    c.post(f"/closures/{cid}/end", headers=OK)
    assert c.get(url).headers["etag"] not in (etag, etag2)


def test_place_closure_in_layer_and_details():
    _create(element_id="toilet-1", reason="other")
    feats = c.get("/layers/access").json()["features"]
    toilet = next(f for f in feats if f["properties"]["id"] == "toilet-1")["properties"]
    assert toilet["closed"] is True
    d = c.get("/places/toilet-1").json()["data"]
    assert d["closures"][0]["source_label"] == "Reported closure (staff)"


def test_closures_survive_restart():
    from townshiplens_api import state

    cid = _create().json()["id"]
    state.reset()
    assert [x["id"] for x in c.get("/closures").json()] == [cid]
    feats = c.get("/layers/access").json()["features"]
    seg = next(f for f in feats if f["properties"]["id"] == "seg-ab")["properties"]
    assert seg["closed"] is True
