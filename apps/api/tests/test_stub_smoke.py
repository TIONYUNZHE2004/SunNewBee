from fastapi.testclient import TestClient
from townshiplens_api.main import app


def test_health_and_site():
    c = TestClient(app)
    assert c.get("/healthz").json() == {"status": "ok"}
    assert c.get("/site").json()["id"] == "tiny"
