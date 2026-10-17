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
    assert stats["duplicates"] == 1


def test_main_dry_run_makes_no_request_and_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(bb, "OUT", tmp_path)
    (tmp_path / "site.json").write_text(
        json.dumps({"scene": {"home": {"lon": 101.5099, "lat": 3.1813}}})
    )

    def boom(*a, **k):
        raise AssertionError("dry run must not fetch")

    monkeypatch.setattr(bb, "fetch_all", boom)
    with pytest.raises(SystemExit) as e:
        bb.main(["--dry-run"])
    assert e.value.code == 0
    assert not (tmp_path / "base" / "buildings.geojson").exists()


def test_size_guard(tmp_path, monkeypatch):
    monkeypatch.setattr(bb, "OUT", tmp_path)
    monkeypatch.setattr(bb, "MAX_BYTES", 10)
    monkeypatch.setattr(
        bb, "fetch_all", lambda *a, **k: ([way(1, SQ, building="yes")], "2026-10-01")
    )
    (tmp_path / "site.json").write_text(
        json.dumps({"scene": {"home": {"lon": 101.5099, "lat": 3.1813}}})
    )
    with pytest.raises(SystemExit) as e:
        bb.main([])
    assert e.value.code == 3


def test_main_writes_files_and_site_key(tmp_path, monkeypatch):
    monkeypatch.setattr(bb, "OUT", tmp_path)
    monkeypatch.setattr(
        bb, "fetch_all", lambda *a, **k: ([way(1, SQ, building="yes")], "2026-10-01")
    )
    (tmp_path / "site.json").write_text(
        json.dumps({"scene": {"home": {"lon": 101.5099, "lat": 3.1813}}})
    )
    bb.main([])
    site = json.loads((tmp_path / "site.json").read_text())
    assert site["buildings"]["count"] == 1 and site["buildings"]["file"] == "base/buildings.geojson"
    assert site["buildings"]["as_of"] == "2026-10-01"  # the OSM data date, not today
    assert (tmp_path / "base" / "trees.geojson").exists()


@pytest.mark.parametrize(
    "exc", [bb.overpass.OverpassFailed("down"), bb.overpass.BudgetExceeded("cap")]
)
def test_blocked_exit_code_2_when_fetch_fails(tmp_path, monkeypatch, exc):
    monkeypatch.setattr(bb, "OUT", tmp_path)
    (tmp_path / "site.json").write_text(
        json.dumps({"scene": {"home": {"lon": 101.5099, "lat": 3.1813}}})
    )

    def fail(*a, **k):
        raise exc

    monkeypatch.setattr(bb, "fetch_all", fail)
    with pytest.raises(SystemExit) as e:
        bb.main([])
    assert e.value.code == 2
    assert not (tmp_path / "base" / "buildings.geojson").exists()


def test_height_rejects_absurd_values_and_non_metre_units():
    assert bb.infer_height({"height": "500"}, "w1")[1] == "default"
    assert bb.infer_height({"height": "500", "building:levels": "3"}, "w1")[:2] == (
        9.6,
        "osm_levels",
    )
    assert bb.infer_height({"building:levels": "200"}, "w1")[1] == "default"
    assert bb.infer_height({"height": "300"}, "w1")[:2] == (300.0, "osm_height")
    assert bb.infer_height({"height": "40 ft"}, "w1")[1] == "default"
    assert bb.infer_height({"height": "10'"}, "w1")[1] == "default"
    assert bb.infer_height({"height": "12,5 m"}, "w1")[:2] == (12.5, "osm_height")


def test_size_guard_applies_to_trees_too(tmp_path, monkeypatch):
    monkeypatch.setattr(bb, "OUT", tmp_path)
    monkeypatch.setattr(bb, "MAX_BYTES", 400)
    trees = [
        {"type": "node", "id": i, "lat": 3.181, "lon": 101.501, "tags": {"natural": "tree"}}
        for i in range(30)
    ]
    monkeypatch.setattr(
        bb, "fetch_all", lambda *a, **k: ([way(1, SQ, building="yes"), *trees], "2026-10-01")
    )
    (tmp_path / "site.json").write_text(
        json.dumps({"scene": {"home": {"lon": 101.5099, "lat": 3.1813}}})
    )
    with pytest.raises(SystemExit) as e:
        bb.main([])
    assert e.value.code == 3
    assert not (tmp_path / "base" / "trees.geojson").exists()


def test_parks_query_asks_for_park_like_ways_only():
    q = bb.parks_query_for((3.15, 101.46, 3.17, 101.48))
    assert 'way["leisure"~"^(park|garden|playground)$"]' in q
    assert 'way["landuse"~"^(grass|recreation_ground)$"]' in q
    assert "building" not in q


def test_build_parks_keeps_closed_rings_and_labels_kind():
    ring = [(101.5, 3.18), (101.501, 3.18), (101.501, 3.181), (101.5, 3.18)]
    els = [
        way(1, ring, leisure="park"),
        way(2, ring, landuse="grass"),
        way(3, ring[:2], leisure="park"),  # open: dropped
    ]
    feats = bb.build_parks(els)
    assert [f["properties"]["kind"] for f in feats] == ["park", "grass"]
    assert feats[0]["geometry"]["type"] == "Polygon"
    assert feats[0]["properties"]["id"] == "way/1"


def test_build_parks_dedupes_ways_repeated_across_tiles():
    ring = [(101.5, 3.18), (101.501, 3.18), (101.501, 3.181), (101.5, 3.18)]
    els = [
        way(1, ring, leisure="park"),
        way(2, ring, leisure="garden"),
        way(1, ring, leisure="park"),
    ]
    feats = bb.build_parks(els)
    assert [f["properties"]["id"] for f in feats] == ["way/1", "way/2"]


def test_build_features_keeps_the_osm_tag_subset_only():
    els = [
        way(
            1,
            SQ,
            building="yes",
            amenity="place_of_worship",
            religion="muslim",
            shop="",
            **{"building:levels": "2", "addr:street": "Jalan X", "height": "9"},
            name="Masjid",
        ),
        way(2, SQ, building="house"),
    ]
    b, _, _ = bb.build_features(els)
    assert b[0]["properties"]["osm"] == {
        "building": "yes",
        "amenity": "place_of_worship",
        "religion": "muslim",
        "building:levels": "2",
    }
    assert b[1]["properties"]["osm"] == {"building": "house"}


def test_building_ids_are_stable_across_reruns_and_tile_order():
    sq2 = [(x + 0.001, y) for x, y in SQ]
    els = [way(11, SQ, building="yes"), way(12, sq2, building="house"), way(11, SQ, building="yes")]
    first, _, _ = bb.build_features(els)
    again, _, _ = bb.build_features(list(reversed(els)))
    ids = {f["properties"]["id"] for f in first}
    assert ids == {"w11", "w12"}  # derived from the OSM way id only
    assert ids == {f["properties"]["id"] for f in again}
    assert first == bb.build_features(els)[0]


def test_main_without_an_osm_data_date_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(bb, "OUT", tmp_path)
    monkeypatch.setattr(bb, "fetch_all", lambda *a, **k: ([way(1, SQ, building="yes")], None))
    (tmp_path / "site.json").write_text(
        json.dumps({"scene": {"home": {"lon": 101.5099, "lat": 3.1813}}})
    )
    with pytest.raises(SystemExit) as e:
        bb.main([])
    assert e.value.code == 3
    assert not (tmp_path / "base" / "buildings.geojson").exists()
