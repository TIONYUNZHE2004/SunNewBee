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
