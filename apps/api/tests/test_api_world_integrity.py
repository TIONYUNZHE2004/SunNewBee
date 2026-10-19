import json
import shutil
from pathlib import Path

from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app


def test_malformed_world_never_falls_back_to_tiny_or_returns_a_route(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[3]
    data = tmp_path / "broken"
    shutil.copytree(root / "packages/spatial/tests/fixtures/tiny", data)
    walk = data / "base/walk.geojson"
    fc = json.loads(walk.read_text())
    edge = next(f for f in fc["features"] if f["properties"]["id"] == "seg-bc")
    edge["geometry"]["coordinates"][0] = [101.52, 3.19]
    walk.write_text(json.dumps(fc))
    monkeypatch.setenv("TL_DATA_DIR", str(data))
    state.reset()
    client = TestClient(app, raise_server_exceptions=False)
    assert client.get("/site").status_code == 500
    response = client.post(
        "/routes", json={"from": "park-b", "to": "playground", "profile": "stroller"}
    )
    assert response.status_code == 500
    assert "routes" not in response.text
