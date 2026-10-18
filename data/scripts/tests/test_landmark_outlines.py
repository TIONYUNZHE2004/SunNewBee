"""Traced landmark outlines: every outline carries its source, is a sane polygon, and the
landmarks builder places it with match "traced_outline"."""

import json
import math
from pathlib import Path

from shapely.geometry import Polygon

from data.scripts import build_landmarks as bl

SEED = Path(__file__).resolve().parents[2] / "seed" / "elmina"
OUTLINES = SEED / "sources" / "landmark_outlines.geojson"
LANDMARKS = SEED / "base" / "landmarks.geojson"
REQUIRED = ("model", "name", "source_url", "source_label", "traced_by", "traced_on", "method")
MODELS = {spec["model"] for spec in bl.LANDMARKS}

LON, LAT = 101.5, 3.18
D = 1 / 111320.0


def _metres(ring):
    lat0 = sum(c[1] for c in ring) / len(ring)
    kx = 111320.0 * math.cos(math.radians(lat0))
    return Polygon([(c[0] * kx, c[1] * 110574.0) for c in ring])


def _outlines():
    return json.loads(OUTLINES.read_text(encoding="utf-8"))["features"]


def test_every_outline_records_its_source():
    feats = _outlines()
    assert feats, "no traced outline"
    for f in feats:
        p = f["properties"]
        for key in REQUIRED:
            assert isinstance(p.get(key), str) and p[key].strip(), (p.get("model"), key)
        assert p["model"] in MODELS
        assert p["source_url"].startswith("https://")
        assert p["traced_by"] == "coordinator"
        assert p["method"] == "traced from a georeferenced public site plan"
        assert len(p["traced_on"]) == 10 and p["traced_on"][4] == "-"
        cps = p["control_points"]
        assert len([c for c in cps if c["role"] == "fit"]) >= 3
        assert len(p["residuals_m"]) == len(cps)


def test_outlines_are_valid_polygons_within_the_area_band():
    for f in _outlines():
        assert f["geometry"]["type"] == "Polygon"
        ring = f["geometry"]["coordinates"][0]
        assert ring[0] == ring[-1]
        poly = _metres(ring)
        assert poly.is_valid
        assert 400 <= poly.area <= 6000, (f["properties"]["model"], poly.area)


def test_one_outline_per_model():
    models = [f["properties"]["model"] for f in _outlines()]
    assert len(models) == len(set(models))


def _square(lon, lat, side_m, bid):
    dl = side_m * D
    ring = [[lon, lat], [lon + dl, lat], [lon + dl, lat + dl], [lon, lat + dl], [lon, lat]]
    return {
        "type": "Feature",
        "properties": {"id": bid},
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


def _outline(model, lon, lat, side_m):
    f = _square(lon, lat, side_m, "x")
    f["properties"] = {
        "model": model,
        "name": "Kanopi Residences",
        "source_url": "https://example.test/plan.png",
        "source_label": "Example site plan",
        "traced_by": "coordinator",
        "traced_on": "2026-10-18",
        "method": "traced from a georeferenced public site plan",
    }
    return f


KANOPI = next(s for s in bl.LANDMARKS if s["model"] == "kanopi")


def test_traced_outline_is_placed_with_its_source_and_overlapping_building():
    near = _square(LON + 20 * D, LAT, 30, "w2")  # overlaps the 30 m outline by a third
    far = _square(LON + 500 * D, LAT, 30, "w3")
    small = _square(LON + 25 * D, LAT + 25 * D, 4, "w1")  # overlaps, but less
    feats, unplaced = bl.build_landmarks(
        [KANOPI], [far, small, near], [], "2026-10-17", [_outline("kanopi", LON, LAT, 30)]
    )
    assert unplaced == []
    p = feats[0]["properties"]
    assert p["match"] == "traced_outline"
    assert p["building_id"] == "w2"
    assert p["osm"] is None
    assert p["source_url"] == "https://example.test/plan.png"
    assert p["source_label"] == "Example site plan"
    assert (p["traced_by"], p["traced_on"]) == ("coordinator", "2026-10-18")
    assert p["as_of"] == "2026-10-18"
    assert (p["id"], p["model"]) == (KANOPI["id"], "kanopi")
    assert feats[0]["geometry"] == _outline("kanopi", LON, LAT, 30)["geometry"]


def test_traced_outline_without_overlap_has_null_building():
    far = _square(LON + 500 * D, LAT, 30, "w3")
    feats, _ = bl.build_landmarks(
        [KANOPI], [far], [], "2026-10-17", [_outline("kanopi", LON, LAT, 30)]
    )
    assert feats[0]["properties"]["building_id"] is None


def test_traced_outline_wins_over_an_osm_match():
    named = _square(LON + 500 * D, LAT, 30, "w9")
    named["properties"]["name"] = "Kanopi Residences"
    feats, _ = bl.build_landmarks(
        [KANOPI], [named], [], "2026-10-17", [_outline("kanopi", LON, LAT, 30)]
    )
    assert [f["properties"]["match"] for f in feats] == ["traced_outline"]


def test_built_landmarks_hold_every_traced_outline():
    placed = {
        f["properties"]["model"]: f["properties"]
        for f in json.loads(LANDMARKS.read_text(encoding="utf-8"))["features"]
    }
    for o in _outlines():
        p = placed[o["properties"]["model"]]
        assert p["match"] == "traced_outline"
        assert p["source_url"] == o["properties"]["source_url"]
