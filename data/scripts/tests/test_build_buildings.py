import json

import pytest

from data.scripts import build_buildings as bb


def way(i, pts, **tags):
    return {
        "type": "way",
        "id": i,
        "tags": tags,
        "geometry": [{"lon": x, "lat": y} for x, y in pts],
    }


SQ = [(101.5, 3.18), (101.5003, 3.18), (101.5003, 3.1803), (101.5, 3.1803), (101.5, 3.18)]


def test_bbox_and_tiles_cover_the_area():
    s, w, n, e = bb.bbox_around(101.5099, 3.1813, 3500)
    assert s < 3.1813 < n and w < 101.5099 < e
    ts = bb.tiles((s, w, n, e), 0.02)
    assert 9 <= len(ts) <= 25
    assert min(t[0] for t in ts) <= s and max(t[2] for t in ts) >= n


def test_height_rules_and_determinism():
    assert bb.infer_height({"height": "12.5 m"}, "w1")[:2] == (12.5, "osm_height")
    assert bb.infer_height({"building:levels": "4"}, "w1")[:2] == (12.8, "osm_levels")
    h, src, mn = bb.infer_height({"building": "retail"}, "w1")
    assert src == "default" and 6 <= h <= 30 and mn == 0
    assert bb.infer_height({"building": "retail"}, "w1") == bb.infer_height(
        {"building": "retail"}, "w1"
    )
    assert (
        bb.infer_height({"height": "-3", "min_height": "99"}, "w2")[2]
        < bb.infer_height({"height": "-3"}, "w2")[0]
    )


def test_kind_of():
    assert bb.kind_of({"building": "apartments"}) == "residential"
    assert bb.kind_of({"building": "yes", "shop": "mall"}) == "commercial"
    assert bb.kind_of({"building": "warehouse"}) == "industrial"
    assert bb.kind_of({"building": "school"}) == "civic"
    assert bb.kind_of({"building": "yes"}) == "other"


def test_simplify_ring_drops_degenerate_and_collinear():
    ring = [
        [101.5, 3.18],
        [101.5001, 3.18],
        [101.5003, 3.18],
        [101.5003, 3.1803],
        [101.5, 3.1803],
        [101.5, 3.18],
    ]
    out = bb.simplify_ring(ring)
    assert out is not None and len(out) == 5 and out[0] == out[-1]  # collinear vertex removed
    assert bb.simplify_ring([[101.5, 3.18], [101.5, 3.18], [101.5, 3.18]]) is None
    tiny = [
        [101.5, 3.18],
        [101.50001, 3.18],
        [101.50001, 3.180001],
        [101.5, 3.180001],
        [101.5, 3.18],
    ]
    assert bb.simplify_ring(tiny) is None  # < 4 m2


def test_build_features_dedupes_skips_and_counts():
    els = [
        way(1, SQ, building="yes", name="Block C"),
        way(1, SQ, building="yes"),  # duplicate id
        way(2, SQ[:2], building="yes"),  # not a polygon
        {"type": "relation", "id": 9, "tags": {"building": "yes"}},
        {"type": "node", "id": 5, "lat": 3.181, "lon": 101.501, "tags": {"natural": "tree"}},
    ]
    b, t, stats = bb.build_features(els)
    assert [x["properties"]["id"] for x in b] == ["w1"]
    assert b[0]["properties"]["name"] == "Block C" and b[0]["geometry"]["type"] == "Polygon"
    assert len(t) == 1 and t[0]["geometry"]["coordinates"] == [101.501, 3.181]
    assert stats["skipped_relations"] == 1 and stats["skipped_invalid"] == 1


def test_main_dry_run_makes_no_request_and_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(bb, "OUT", tmp_path)
    (tmp_path / "site.json").write_text(
        json.dumps({"scene": {"home": {"lon": 101.5099, "lat": 3.1813}}})
    )
    with pytest.raises(SystemExit) as e:
        bb.main(["--dry-run"])
    assert e.value.code == 0
    assert not (tmp_path / "base" / "buildings.geojson").exists()


def test_size_guard(tmp_path, monkeypatch):
    monkeypatch.setattr(bb, "OUT", tmp_path)
    monkeypatch.setattr(bb, "MAX_BYTES", 10)
    monkeypatch.setattr(bb, "fetch_all", lambda *a, **k: [way(1, SQ, building="yes")])
    (tmp_path / "site.json").write_text(
        json.dumps({"scene": {"home": {"lon": 101.5099, "lat": 3.1813}}})
    )
    with pytest.raises(SystemExit) as e:
        bb.main([])
    assert e.value.code == 3


def test_main_writes_files_and_site_key(tmp_path, monkeypatch):
    monkeypatch.setattr(bb, "OUT", tmp_path)
    monkeypatch.setattr(bb, "fetch_all", lambda *a, **k: [way(1, SQ, building="yes")])
    (tmp_path / "site.json").write_text(
        json.dumps({"scene": {"home": {"lon": 101.5099, "lat": 3.1813}}})
    )
    bb.main([])
    site = json.loads((tmp_path / "site.json").read_text())
    assert site["buildings"]["count"] == 1 and site["buildings"]["file"] == "base/buildings.geojson"
    assert (tmp_path / "base" / "trees.geojson").exists()
