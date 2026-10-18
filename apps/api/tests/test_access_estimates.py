from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app
from townshiplens_spatial.models import Claim

client = TestClient(app)


def test_layer_and_route_share_estimate_contract():
    world = state.get_ctx().world
    for edge in world.edges.values():
        if edge.type != "steps":
            edge.type = "sidewalk"
            edge.claims = {}
            edge.osm_tags = {"highway": "footway", "footway": "sidewalk"}
    layer = client.get("/layers/access?profile=wheelchair").json()
    segments = {
        f["properties"]["id"]: f["properties"]
        for f in layer["features"]
        if f["geometry"]["type"] == "LineString"
    }
    response = client.post(
        "/routes", json={"from": "park-b", "to": "playground", "profile": "wheelchair"}
    )
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "likely_ok"
    route = result["routes"][0]
    assert route["access_metres"]["likely_ok"] == route["distance_m"]
    for segment in route["segments"]:
        props = segments[segment["edge_id"]]
        for key in ("access_level", "rule_id", "tags_used"):
            assert segment[key] == props[key]
        assert props["status_for_profile"] == "likely_ok"
    assert any(e.endswith(".access_estimate") for e in route["evidence_ids"])


def test_driving_layer_never_marks_footways_as_red_mode_barriers():
    layer = client.get("/layers/access?profile=drive&scenario_id=stage_p3m").json()
    nonroads = [f["properties"] for f in layer["features"] if f["geometry"]["type"] == "LineString"]
    assert nonroads
    assert all(p["status_for_profile"] == p["access_level"] == "not_a_road" for p in nonroads)
    assert all(p["rule_id"] == "driving_nonroad_v1" for p in nonroads)


def test_staff_verified_and_osm_restriction_have_traceable_rules():
    world = state.get_ctx().world
    edge = world.edges["seg-ab"]
    for c in edge.claims.values():
        c.evidence_type = "field_survey"
        c.verified_by = "staff-1"
    edge.osm_tags = {"highway": "footway"}

    def props():
        return next(
            f["properties"]
            for f in client.get("/layers/access?profile=wheelchair").json()["features"]
            if f["properties"]["id"] == edge.id
        )

    assert props()["access_level"] == "verified"
    edge.claims["width_m"] = Claim(value=0.5, status="reported")
    world.version += 1
    assert props()["access_level"] == "barrier"
