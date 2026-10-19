"""B-T7: GET /layers/street_furniture serves the display-only street furniture seed (or 404)."""

import json
import shutil
from pathlib import Path

from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app

TINY = Path(__file__).resolve().parents[3] / "packages/spatial/tests/fixtures/tiny"
SEED = Path(__file__).resolve().parents[3] / "data/seed/elmina"


def _pt(pid, kind, lon=101.51, lat=3.181, **extra):
    return {
        "type": "Feature",
        "properties": {"id": pid, "kind": kind, **extra},
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
    }


def _world(tmp_path, monkeypatch, features=None, *, text=None):
    d = tmp_path / "world"
    shutil.copytree(TINY, d)
    if features is not None or text is not None:
        body = (
            text
            if text is not None
            else json.dumps({"type": "FeatureCollection", "features": features})
        )
        (d / "base" / "street_furniture.geojson").write_text(body, encoding="utf-8")
        site = json.loads((d / "site.json").read_text(encoding="utf-8"))
        site["street_furniture"] = {"as_of": "2026-10-19"}
        (d / "site.json").write_text(json.dumps(site), encoding="utf-8")
    monkeypatch.setenv("TL_DATA_DIR", str(d))
    state.reset()
    return d


def test_serves_points_with_etag_and_as_of(tmp_path, monkeypatch):
    _world(
        tmp_path,
        monkeypatch,
        [
            _pt("osm-node-1", "bench", name="Bench 1"),
            _pt("osm-node-2", "bus_stop"),
            _pt("p-3", "shelter", source="seed_place"),
            _pt("osm-node-4", "traffic_signals"),
        ],
    )
    c = TestClient(app)
    r = c.get("/layers/street_furniture")
    assert r.status_code == 200, r.text
    body = r.json()
    ids = [f["properties"]["id"] for f in body["furniture"]["features"]]
    assert ids == ["osm-node-1", "osm-node-2", "p-3", "osm-node-4"]
    assert body["furniture"]["features"][2]["properties"]["source"] == "seed_place"
    assert body["as_of"] == "2026-10-19"
    assert body["attribution"] == ["Test fixture"]
    etag = r.headers["etag"]
    assert c.get("/layers/street_furniture", headers={"If-None-Match": etag}).status_code == 304


def test_drops_features_without_id_kind_or_point(tmp_path, monkeypatch):
    bad_geom = _pt("osm-way-9", "bench")
    bad_geom["geometry"] = {"type": "LineString", "coordinates": [[101.5, 3.18], [101.6, 3.19]]}
    nan = _pt("osm-node-8", "bench")
    nan["geometry"]["coordinates"] = ["x", 3.18]
    _world(
        tmp_path,
        monkeypatch,
        [
            _pt("osm-node-1", "bench"),
            _pt("", "bench"),
            _pt("osm-node-5", "kiosk"),
            {"type": "Feature", "properties": {"kind": "bench"}, "geometry": None},
            bad_geom,
            nan,
        ],
    )
    body = TestClient(app).get("/layers/street_furniture").json()
    assert [f["properties"]["id"] for f in body["furniture"]["features"]] == ["osm-node-1"]


def test_404_when_absent_and_502_when_unreadable(tmp_path, monkeypatch):
    _world(tmp_path, monkeypatch)
    c = TestClient(app)
    assert c.get("/layers/street_furniture").status_code == 404
    # the lens route still works (declared after this one)
    assert c.get("/layers/access").status_code == 200
    _world(tmp_path / "b", monkeypatch, text="{not json")
    r = TestClient(app).get("/layers/street_furniture")
    assert r.status_code == 502 and "detail" in r.json()


def test_seed_serves_every_feature(monkeypatch):
    path = SEED / "base" / "street_furniture.geojson"
    if not path.exists():
        return
    monkeypatch.setenv("TL_DATA_DIR", str(SEED))
    state.reset()
    body = TestClient(app).get("/layers/street_furniture").json()
    want = json.loads(path.read_text(encoding="utf-8"))["features"]
    assert len(body["furniture"]["features"]) == len(want) > 0
