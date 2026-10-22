import shutil
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient
from rasterio.transform import from_origin
from townshiplens_api import state
from townshiplens_api.main import app

TINY = Path(__file__).resolve().parents[3] / "packages/spatial/tests/fixtures/tiny"


def test_generated_terrain_and_combined_scenarios_are_listed_and_queryable(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[3]))
    from data.scripts.build_lowlying import Config, write_outputs

    dest = tmp_path / "world"
    shutil.copytree(TINY, dest)
    dem = np.full((8, 8), 10.0)
    dem[2:6, 2:6] = 0
    write_outputs(
        dest, dem, from_origin(101.5085, 3.182, 0.0005, 0.0005), Config(1, 4, 1, 8, False)
    )
    monkeypatch.setenv("TL_DATA_DIR", str(dest))
    state.reset()
    client = TestClient(app)
    scenarios = client.get("/scenarios").json()
    low = next(s for s in scenarios if s["id"] == "lowlying")
    assert low["kind"] == "lowlying" and low["stage_m"] == 0
    assert {s["id"] for s in scenarios} >= {
        "stage_p1m+lowlying",
        "stage_p2m+lowlying",
        "stage_p3m+lowlying",
    }
    for sid in ("lowlying", "stage_p3m+lowlying"):
        affected = client.get(f"/scenarios/{sid}/affected")
        assert affected.status_code == 200, affected.text
        assert "cut_off_places" in affected.json() and affected.json()["possible_total"] > 0
        water = client.get(f"/scenarios/{sid}")
        assert water.status_code == 200
        terrain = [
            f for f in water.json()["features"] if f["properties"].get("scenario_id") == "lowlying"
        ]
        assert terrain and all("surface_height_m" not in f["properties"] for f in terrain)
    assert client.get("/scenarios/lowlying/affected").json()["likely_total"] == 0


def test_unbuilt_seed_does_not_advertise_a_generated_terrain_layer():
    client = TestClient(app)
    assert "lowlying" not in {s["id"] for s in client.get("/scenarios").json()}
    assert client.get("/scenarios/lowlying").status_code == 404
    assert client.get("/scenarios/lowlying/affected").status_code == 404
