from fastapi.testclient import TestClient
from townshiplens_api.main import app

c = TestClient(app)


def test_health_and_site():
    assert c.get("/healthz").json() == {"status": "ok"}
    assert c.get("/site").json()["id"] == "tiny"


def test_routes_confirmed():
    r = c.post("/routes", json={"from": "park-b", "to": "playground", "profile": "stroller"}).json()
    assert r["status"] == "confirmed"


def test_layers_access_has_status():
    fc = c.get("/layers/access", params={"profile": "stroller"}).json()
    st = {f["properties"]["id"]: f["properties"].get("status_for_profile") for f in fc["features"]}
    assert st["seg-cf"] == "unknown" and st["seg-be"] == "blocked" and st["seg-ab"] == "ok"
    assert all(
        f["properties"]["status_for_profile"] in {"ok", "unknown", "blocked"}
        for f in fc["features"]
        if f["geometry"]["type"] == "LineString"
    )


def test_unknown_lens_and_graph_alias():
    assert c.get("/layers/nope").status_code == 404
    assert c.get("/graph").json() == c.get("/layers/access").json()


def test_waste_layer():
    fc = c.get("/layers/waste").json()
    assert fc["features"] and all(f["properties"]["kind"] == "waste_point" for f in fc["features"])


def test_places_search_and_detail():
    assert c.get("/places", params={"q": "playground"}).json()["data"][0]["id"] == "playground"
    assert c.get("/places", params={"q": ""}).json()["ok"] is True
    assert c.get("/places/playground").json()["data"]["id"] == "playground"
    assert c.get("/places/nowhere").status_code == 404


def test_waste_points_endpoint():
    assert isinstance(c.get("/waste-points").json(), list)


def test_chat_agent_unavailable_emits_error_and_done():
    import importlib.util

    if importlib.util.find_spec("townshiplens_agent.run"):
        return  # Task 9 landed; covered by its own tests
    body = c.post("/chat", json={"message": "hi"}).text
    assert "event: error" in body and "event: done" in body


def test_db_path_is_per_world_without_database_url(monkeypatch):
    from townshiplens_api.settings import ROOT, ApiSettings

    monkeypatch.delenv("DATABASE_URL", raising=False)
    s = ApiSettings(_env_file=None)
    assert s.db_path("elmina") == str(ROOT / ".data/elmina.db")
    assert s.db_path("tiny") != s.db_path("elmina")


def test_explicit_database_url_is_honoured(tmp_path):
    from townshiplens_api.settings import ApiSettings

    s = ApiSettings(database_url=f"sqlite:///{tmp_path}/x.db")
    assert s.db_path("elmina") == f"{tmp_path}/x.db"


def test_all_three_stores_share_one_path_per_world(monkeypatch, tmp_path):
    from townshiplens_api import state
    from townshiplens_api.routes import manage, sim

    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr("townshiplens_api.settings.ROOT", tmp_path)
    state.reset()
    path = state.db_path()
    assert path.endswith(f"/{state.get_ctx().world.site.id}.db")
    manage._audit()
    sim._store()
    assert path in manage._audits and path in sim._stores


def test_layer_etag_304_and_changes_after_resolve():
    from townshiplens_api.routes.manage import commit_claim
    from townshiplens_spatial.models import Claim

    url, p = "/layers/access", {"profile": "stroller"}
    r1 = c.get(url, params=p)
    etag = r1.headers["etag"]
    assert r1.headers["cache-control"] == "private, max-age=0, must-revalidate"
    r2 = c.get(url, params=p, headers={"If-None-Match": etag})
    assert r2.status_code == 304 and r2.headers["etag"] == etag and not r2.content
    assert c.get(url, params={"profile": "default"}).headers["etag"] != etag
    assert c.get("/layers/flood", params=p).headers["etag"] != etag
    commit_claim(
        "seg-cf",
        "incline_pct",
        Claim(value=4.0, status="verified", verified_at="2026-10-15"),
        "edit",
        None,
    )
    r3 = c.get(url, params=p, headers={"If-None-Match": etag})
    assert r3.status_code == 200 and r3.headers["etag"] != etag
