from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app
from townshiplens_spatial.models import Claim


def test_access_layer_distinguishes_sidewalks_and_road_sidewalk_claims():
    world = state.get_ctx().world
    world.edges["seg-ab"].type = "sidewalk"
    world.edges["seg-bc"].type = "street"
    world.edges["seg-bc"].claims["sidewalk"] = Claim(
        value="one_side", status="reported", evidence_type="osm_import"
    )
    c = TestClient(app)
    features = c.get("/layers/access").json()["features"]
    props = {f["properties"]["id"]: f["properties"] for f in features}
    assert props["seg-ab"]["type"] == "sidewalk"
    assert props["seg-bc"]["sidewalk"] == "one_side"
    assert props["seg-bc"]["sidewalk_status"] == "reported"
    route = c.post("/routes", json={"from": "park-b", "to": "playground"}).json()["routes"][0]
    assert route["sidewalk_m"] == world.edges["seg-ab"].length_m
    assert route["road_m"] == world.edges["seg-bc"].length_m
    assert route["road_without_mapped_sidewalk_m"] == 0


def test_access_layer_carries_the_crossing_marking_claim():
    """B-T7 fix round 1: the stylised city draws zebra stripes only on a marked crossing, so the
    access layer carries the crossing claim (value and status) of each crossing edge."""
    world = state.get_ctx().world
    world.edges["seg-ab"].type = "crossing"
    world.edges["seg-ab"].claims["crossing"] = Claim(
        value="marked", status="reported", evidence_type="osm_import"
    )
    world.edges["seg-bc"].type = "crossing"
    world.edges["seg-bc"].claims.pop("crossing", None)
    features = TestClient(app).get("/layers/access").json()["features"]
    props = {f["properties"]["id"]: f["properties"] for f in features}
    assert props["seg-ab"]["crossing"] == "marked"
    assert props["seg-ab"]["crossing_status"] == "reported"
    assert props["seg-bc"]["crossing"] is None
    assert props["seg-bc"]["crossing_status"] == "unknown"
