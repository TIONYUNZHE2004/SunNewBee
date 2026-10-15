import json
import shutil
from pathlib import Path

from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app

TINY = Path(__file__).resolve().parents[3] / "packages/spatial/tests/fixtures/tiny"


def _fc(features):
    return {"type": "FeatureCollection", "features": features}


def _poly(i):
    x = 101.51 + i * 0.0002
    ring = [[x, 3.181], [x + 0.0001, 3.181], [x + 0.0001, 3.1811], [x, 3.181]]
    return {
        "type": "Feature",
        "properties": {"id": f"b{i}", "height_m": 6.0},
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


def _tree(i):
    return {
        "type": "Feature",
        "properties": {"id": f"t{i}"},
        "geometry": {"type": "Point", "coordinates": [101.51 + i * 0.0001, 3.181]},
    }


def _world(tmp_path, monkeypatch, *, buildings=True, corrupt=False):
    d = tmp_path / "world"
    shutil.copytree(TINY, d)
    if buildings:
        base = d / "base"
        text = "{not json" if corrupt else json.dumps(_fc([_poly(0), _poly(1)]))
        (base / "buildings.geojson").write_text(text, encoding="utf-8")
        (base / "trees.geojson").write_text(json.dumps(_fc([_tree(0), _tree(1)])), encoding="utf-8")
        site = json.loads((d / "site.json").read_text(encoding="utf-8"))
        site["buildings"] = {"as_of": "2026-10-16"}
        (d / "site.json").write_text(json.dumps(site), encoding="utf-8")
    monkeypatch.setenv("TL_DATA_DIR", str(d))
    state.reset()
    return d


def test_serves_buildings_and_trees_with_etag(tmp_path, monkeypatch):
    _world(tmp_path, monkeypatch)
    c = TestClient(app)
    r = c.get("/layers/buildings")
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["buildings"]["features"]) == 2
    assert len(body["trees"]["features"]) == 2
    assert body["as_of"] == "2026-10-16"
    assert body["attribution"] == ["Test fixture"]
    etag = r.headers["etag"]
    assert "cache-control" in r.headers
    r2 = c.get("/layers/buildings", headers={"If-None-Match": etag})
    assert r2.status_code == 304


def test_404_when_no_buildings_seed(tmp_path, monkeypatch):
    _world(tmp_path, monkeypatch, buildings=False)
    c = TestClient(app)
    assert c.get("/layers/buildings").status_code == 404
    assert c.get("/layers/access").status_code == 200


def test_corrupt_file_is_not_a_500(tmp_path, monkeypatch):
    _world(tmp_path, monkeypatch, corrupt=True)
    c = TestClient(app)
    r = c.get("/layers/buildings")
    assert r.status_code in (404, 502)
    assert "detail" in r.json()


def test_missing_site_json_falls_back_to_tiny(monkeypatch, tmp_path):
    monkeypatch.setenv("TL_DATA_DIR", str(tmp_path / "nope"))
    state.reset()
    assert state.data_dir() == TINY
