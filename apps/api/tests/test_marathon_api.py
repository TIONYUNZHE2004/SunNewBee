from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app
from townshiplens_spatial import tools

BODY = {
    "start": "park-b",
    "distance_km": 0.3,
    "starts_at": "2030-01-01T06:00:00+08:00",
    "ends_at": "2030-01-01T10:00:00+08:00",
    "profiles": ["default"],
}


def test_public_marathon_proposal_is_read_only():
    world = state.get_ctx().world
    before = {k: v.model_dump() for k, v in world.edges.items()}
    response = TestClient(app).post("/marathon/plan", json=BODY)
    assert response.status_code == 200, response.text
    assert (
        response.json()["course"]["disclaimer"]
        == "Proposed course on mapped roads, not an approved route."
    )
    assert before == {k: v.model_dump() for k, v in world.edges.items()}


def test_marathon_invalid_input_and_busy_solver():
    client = TestClient(app)
    for changes in (
        {"distance_km": -5},
        {"ends_at": BODY["starts_at"]},
        {"start": "missing"},
        {"profiles": ["missing"]},
    ):
        assert client.post("/marathon/plan", json={**BODY, **changes}).status_code == 422
    tools._WM_SLOTS.acquire()
    tools._WM_SLOTS.acquire()
    try:
        assert client.post("/marathon/plan", json=BODY).status_code == 503
    finally:
        tools._WM_SLOTS.release()
        tools._WM_SLOTS.release()


def test_road_labels_route_precedes_generic_lens_route():
    world = state.get_ctx().world
    world.edges["seg-ab"].name = "Main Road"
    response = TestClient(app).get("/layers/road-labels")
    assert response.status_code == 200
    row = response.json()[0]
    assert row["name"] == "Main Road"
    assert set(row) == {"name", "road_class", "length_m", "anchor", "bearing_deg"}
