from datetime import date

from fastapi.testclient import TestClient
from townshiplens_api import geojson, state
from townshiplens_api.main import app
from townshiplens_api.routes import core
from townshiplens_spatial import access, evaluate


def test_verification_expiry_invalidates_layer_and_http_etag(monkeypatch):
    world = state.get_ctx().world
    for c in world.edges["seg-ab"].claims.values():
        c.status = "verified"
        c.verified_by = "staff"
        c.evidence_type = "field_survey"
        c.verified_at = "2026-10-18"
        c.ttl_days = 0

    class Today(date):
        day = 18

        @classmethod
        def today(cls):
            return cls(2026, 10, cls.day)

    for module in (access, evaluate, geojson, core):
        monkeypatch.setattr(module, "date", Today)
    client = TestClient(app)
    first = client.get("/layers/access?profile=wheelchair")

    def status(response):
        return next(
            f["properties"]["status_for_profile"]
            for f in response.json()["features"]
            if f["properties"]["id"] == "seg-ab"
        )

    assert status(first) == "verified"
    Today.day = 19
    second = client.get(
        "/layers/access?profile=wheelchair", headers={"If-None-Match": first.headers["etag"]}
    )
    assert second.status_code == 200
    assert second.headers["etag"] != first.headers["etag"]
    assert status(second) == "unknown"
