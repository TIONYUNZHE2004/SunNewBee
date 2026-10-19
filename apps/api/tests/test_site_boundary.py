"""GET /site exposes the display-only Elmina outline (spec 2026-10-19 resident journey A-T4)."""

import json
import shutil
from pathlib import Path

from fastapi.testclient import TestClient

SEED = Path(__file__).resolve().parents[3] / "data/seed/elmina"
TINY = Path(__file__).resolve().parents[3] / "packages/spatial/tests/fixtures/tiny"


def _client(monkeypatch, data: Path) -> TestClient:
    monkeypatch.setenv("TL_DATA_DIR", str(data))
    from townshiplens_api import state
    from townshiplens_api.main import app

    state.reset()
    return TestClient(app)


def test_site_has_the_boundary_geometry_on_the_seed(monkeypatch):
    b = _client(monkeypatch, SEED).get("/site").json()["boundary"]
    assert b["file"] == "base/boundary.geojson"
    assert b["source"] == "fallback_union"
    geom = b["geometry"]
    assert geom["type"] in ("Polygon", "MultiPolygon")
    raw = json.loads((SEED / "base/boundary.geojson").read_text(encoding="utf-8"))
    assert geom == raw["features"][0]["geometry"]


def test_site_without_a_boundary_has_none(monkeypatch):
    assert _client(monkeypatch, TINY).get("/site").json().get("boundary") is None


def _world_with_boundary(tmp_path: Path, file: str, body: str | None) -> Path:
    d = tmp_path / "w"
    shutil.copytree(TINY, d)
    site = json.loads((d / "site.json").read_text(encoding="utf-8"))
    site["boundary"] = {
        "file": file,
        "source": "fallback_union",
        "method": "test",
        "area_km2": 1.0,
        "as_of": "2026-10-19",
    }
    (d / "site.json").write_text(json.dumps(site), encoding="utf-8")
    if body is not None:
        (d / "base").mkdir(exist_ok=True)
        (d / "base" / "boundary.geojson").write_text(body, encoding="utf-8")
    return d


def test_unreadable_or_non_polygon_boundary_serves_no_geometry(monkeypatch, tmp_path):
    point = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}}],
        }
    )
    for i, body in enumerate(["not json", point, None]):
        d = _world_with_boundary(tmp_path / str(i), "base/boundary.geojson", body)
        b = _client(monkeypatch, d).get("/site").json()["boundary"]
        assert b["geometry"] is None
        assert b["source"] == "fallback_union"


def test_boundary_file_outside_the_world_is_never_read(monkeypatch, tmp_path):
    d = _world_with_boundary(tmp_path, "../../../etc/passwd", None)
    b = _client(monkeypatch, d).get("/site").json()["boundary"]
    assert b["geometry"] is None
