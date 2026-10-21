from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app


def test_affected_and_route_use_the_same_mapped_centre_entrance():
    world = state.get_ctx().world
    world.flood.edge_classes["stage_p3m"]["seg-bc"] = "likely_flooded"
    world.centres = {"evc-hall": world.centres["evc-hall"].model_copy(update={"place_id": "kiosk"})}
    world.places["kiosk"].entrance_ids = ["lakeside-mall"]
    client = TestClient(app)
    route = client.post(
        "/routes",
        json={
            "from": "park-b",
            "to": "__centre__evc-hall",
            "profile": "stroller",
            "scenario_id": "stage_p3m",
        },
    ).json()
    assert route["routes"][0]["target_node"] == "n-b"
    result = client.get("/scenarios/stage_p3m/affected", params={"profile": "stroller"}).json()
    samples = {
        pid for component in result["isolated_components"] for pid in component["sample_place_ids"]
    }
    assert not {"park-b", "lakeside-mall", "kiosk"} & samples
    assert "bench-1" in samples
