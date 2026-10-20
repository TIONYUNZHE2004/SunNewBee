from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app
from townshiplens_spatial.models import Claim


@pytest.mark.parametrize(
    "when,expected,route_status",
    [
        (None, "unknown", "partly_unverified"),
        (date.today().isoformat(), "verified", "confirmed"),
        ((date.today() - timedelta(days=31)).isoformat(), "stale", "partly_unverified"),
    ],
)
def test_layer_and_route_report_the_same_usable_sidewalk_status(when, expected, route_status):
    world = state.get_ctx().world
    edge = world.edges["seg-ab"]
    edge.type = "major_road"
    edge.claims["sidewalk"] = Claim(value="both", status="verified", verified_at=when, ttl_days=30)
    client = TestClient(app)
    route = client.post(
        "/routes", json={"from": "park-b", "to": "lakeside-mall", "profile": "stroller"}
    ).json()
    assert route["status"] == route_status
    assert route["routes"][0]["road_sections"][0]["sidewalk_status"] == expected
    features = client.get("/layers/access", params={"profile": "stroller"}).json()["features"]
    properties = next(f["properties"] for f in features if f["properties"]["id"] == edge.id)
    assert properties["sidewalk_status"] == expected
    if expected != "verified":
        assert properties["access_level"] != "verified"
    assert edge.claims["sidewalk"].status == "verified"
