import json
from pathlib import Path

import numpy as np
import pytest
from rasterio.transform import from_origin
from townshiplens_spatial.models import EvacCentre, FloodBundle
from townshiplens_spatial.world import load_world

from data.scripts.build_flood import (
    MARGIN,
    STAGES,
    classify,
    connected_mask,
    drainage_mask,
    effective_hand,
    osm_drainage_geoms,
    relative_elevation,
    scenario_ids,
    stage_classes,
    vector_stage,
    water_features,
    write_outputs,
)
from data.scripts.build_waste import build_waste

# --- Step 1 (brief) -------------------------------------------------------------------------------


def test_classify_margin():
    assert classify(hand_min=0.2, stage=1.0, margin=0.5) == "likely_flooded"
    assert classify(hand_min=1.3, stage=1.0, margin=0.5) == "possible"
    assert classify(hand_min=2.0, stage=1.0, margin=0.5) == "unlikely"


def test_connected_mask_drops_isolated_hollows():
    hand = np.array([[0.0, 0.5, 9.0, 0.4], [0.2, 9.0, 9.0, 9.0]])
    m = connected_mask(hand, stage=1.0)
    assert m[0, 0] and m[0, 1] and m[1, 0] and not m[0, 3]  # (0,3): hollow, not on drainage


# --- connectivity / monotonicity ----------------------------------------------------------------


def test_effective_hand_equals_connected_mask_at_every_stage():
    rng = np.random.default_rng(7)
    for _ in range(20):
        hand = rng.choice([0.0, 0.3, 0.8, 1.6, 2.4, 3.5, 4.2, 6.0, 9.0], size=(12, 15))
        hand[rng.random(hand.shape) < 0.05] = np.nan
        eff = effective_hand(hand)
        for stage in (0.0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5):
            assert np.array_equal(connected_mask(hand, stage), eff < stage), stage


def test_water_masks_are_nested_across_stages():
    rng = np.random.default_rng(3)
    hand = rng.gamma(1.5, 2.0, size=(30, 30))
    hand[0, :] = 0.0  # a drainage line
    prev = np.zeros_like(hand, dtype=bool)
    for s in STAGES:
        m = connected_mask(hand, s)
        assert not (prev & ~m).any()
        assert m.sum() >= prev.sum()
        prev = m


def test_stage_classes_are_monotonic_and_omit_unlikely():
    values = {"a": 0.0, "b": 1.2, "c": 2.9, "d": 4.6, "e": 50.0, "f": float("nan")}
    out = stage_classes(values, STAGES, MARGIN)
    assert set(out) == {f"stage_p{s}m" for s in STAGES}
    rank = {"possible": 1, "likely_flooded": 2}
    for lo, hi in zip(STAGES, STAGES[1:], strict=False):
        a, b = out[f"stage_p{lo}m"], out[f"stage_p{hi}m"]
        assert set(a) <= set(b)
        assert all(rank[b[k]] >= rank[v] for k, v in a.items())
    assert out["stage_p1m"] == {"a": "likely_flooded", "b": "possible"}
    assert "e" not in out["stage_p3m"] and "f" not in out["stage_p3m"]
    assert "unlikely" not in {c for d in out.values() for c in d.values()}


def test_stage_classes_enforce_monotonicity_explicitly():
    # A per-stage classifier can never un-flood, but the cumulative max is enforced regardless.
    out = stage_classes(
        {"x": 1.1}, [1, 2], 0.5, classify_fn=lambda h, s, m: {1: "likely_flooded", 2: "possible"}[s]
    )
    assert out["stage_p2m"]["x"] == "likely_flooded"


# --- water polygons -------------------------------------------------------------------------------

T = from_origin(101.50, 3.20, 0.001, 0.001)  # 0.001 deg cells (~110 m): a small synthetic grid


def _synthetic():
    hand = np.full((20, 20), 9.0)
    hand[:, 10] = 0.0  # river column
    hand[:, 9] = 0.8
    hand[:, 11] = 1.6
    hand[:, 8] = 2.7
    hand[:, 12] = 4.4
    hand[2, 2] = 0.2  # isolated hollow far from the river
    dem = 20.0 + hand
    return hand, dem


def test_water_features_nested_with_surface_heights():
    hand, dem = _synthetic()
    feats = water_features(hand, dem, T, STAGES, simplify_deg=0.0, tile_deg=1.0)
    prev = None
    for s in STAGES:
        sid = f"stage_p{s}m"
        fs = feats[sid]
        assert fs, sid
        assert all(f["properties"]["scenario_id"] == sid for f in fs)
        # water surface = 5th-percentile ground inside the polygon + stage (river bed at 20 m here)
        assert all(
            f["properties"]["surface_height_m"] == pytest.approx(20.0 + s, abs=0.5) for f in fs
        )
        from shapely.geometry import shape
        from shapely.ops import unary_union

        geom = unary_union([shape(f["geometry"]) for f in fs])
        assert not geom.contains(shape({"type": "Point", "coordinates": [101.5025, 3.1975]}))
        if prev is not None:
            assert prev.difference(geom).area < 1e-12  # lower stage nested in higher stage
            assert geom.area >= prev.area
        prev = geom
    assert feats["baseline"] == []


# --- vector stage ---------------------------------------------------------------------------------


def _fc(features):
    return {"type": "FeatureCollection", "features": features}


def _line(eid, a, b, coords):
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": {
            "id": eid,
            "kind": "segment",
            "type": "footway",
            "from": a,
            "to": b,
            "length_m": 100.0,
            "claims": {},
        },
    }


def _place(pid, typ, name, coord, node=None):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": coord},
        "properties": {
            "id": pid,
            "kind": "place",
            "type": typ,
            "name": name,
            "aliases": [],
            "node_id": node,
            "entrance_ids": [],
            "claims": {},
        },
    }


def _write_base(d: Path, hall_name="Dewan Bunga Matahari"):
    (d / "base").mkdir(parents=True)
    x = lambda col: 101.50 + (col + 0.5) * 0.001  # noqa: E731
    y = lambda row: 3.20 - (row + 0.5) * 0.001  # noqa: E731
    walk = [
        _line("seg-river", "n-a", "n-b", [[x(10), y(5)], [x(10), y(6)]]),  # on the river column
        # These raster samples are independent lines, not junctions at different positions.
        _line("seg-bank", "n-bank-start", "n-c", [[x(11), y(6)], [x(11), y(7)]]),  # HAND 1.6
        _line("seg-high", "n-high-start", "n-d", [[x(3), y(10)], [x(4), y(10)]]),  # HAND 9
        _line("seg-out", "n-out-start", "n-e", [[102.9, 4.9], [102.91, 4.9]]),  # outside the raster
    ]
    places = [
        _place("osm-node-1", "community_centre", hall_name, [x(4), y(10)], "n-d"),
        _place("osm-node-2", "school", "SK Test", [x(11), y(7)], "n-c"),
        _place("osm-node-3", "playground", "Riverside playground", [x(10), y(6)], "n-b"),
        _place("osm-node-4", "recycling", "Recycling bins", [x(3), y(10)], "n-high-start"),
        _place("osm-node-5", "waste_basket", "Waste Basket", [x(4), y(11)], None),
        _place("osm-node-6", "park", "Elmina Central Park", [x(5), y(12)], None),
        _place("osm-node-7", "school", "Far school", [110.0, 1.0], None),
    ]
    (d / "base/walk.geojson").write_text(json.dumps(_fc(walk)), encoding="utf-8")
    (d / "base/places.geojson").write_text(json.dumps(_fc(places)), encoding="utf-8")
    (d / "site.json").write_text(
        json.dumps(
            {
                "id": "t",
                "name": "T",
                "township": "T",
                "center": [101.51, 3.19],
                "bbox": [101.5, 3.18, 101.52, 3.2],
                "attribution": ["© OpenStreetMap contributors (ODbL)"],
            }
        ),
        encoding="utf-8",
    )


def test_vector_stage_on_synthetic_data(tmp_path):
    _write_base(tmp_path)
    hand, _ = _synthetic()
    out = vector_stage(tmp_path, effective_hand(hand), T, STAGES, MARGIN)
    ec, pc = out["edge_classes"], out["place_classes"]
    assert ec["stage_p1m"] == {"seg-river": "likely_flooded"}
    assert ec["stage_p2m"] == {"seg-river": "likely_flooded", "seg-bank": "possible"}
    assert ec["stage_p3m"]["seg-bank"] == "likely_flooded"
    assert all("seg-high" not in d and "seg-out" not in d for d in ec.values())
    assert pc["stage_p1m"] == {"osm-node-3": "likely_flooded"}
    assert out["stats"]["edges_no_coverage"] == 1
    centres = [
        EvacCentre(coord=f["geometry"]["coordinates"], **f["properties"]) for f in out["centres"]
    ]
    assert {c.id for c in centres} == {"evc-osm-node-1", "evc-osm-node-2"}  # far school excluded
    assert all(c.source == "osm_candidate" for c in centres)
    hall = next(c for c in centres if c.place_id == "osm-node-1")
    assert hall.node_id == "n-d" and "Dewan MBSA Matahari" in (hall.notes or "")
    assert "unverified" in hall.notes
    # an unverified (fuzzy) match never carries evidence_url; the article URL stays in the note
    assert hall.evidence_url is None and "https://berita.rtm.gov.my/" in hall.notes
    assert out["uncovered_edges"] == ["seg-out"] and out["uncovered_places"] == ["osm-node-7"]
    assert next(c for c in centres if c.place_id == "osm-node-2").notes is None


def test_exact_name_match_becomes_official_pps(tmp_path):
    _write_base(tmp_path, hall_name="Dewan MBSA Matahari")
    hand, _ = _synthetic()
    out = vector_stage(tmp_path, effective_hand(hand), T, STAGES, MARGIN)
    pps = [f["properties"] for f in out["centres"] if f["properties"]["source"] == "official_pps"]
    assert len(pps) == 1 and pps[0]["id"] == "pps-osm-node-1"
    assert pps[0]["evidence_url"].startswith("https://berita.rtm.gov.my/")
    assert not any(f["properties"]["id"] == "evc-osm-node-1" for f in out["centres"])


def test_vector_stage_skips_without_base_layers(tmp_path, capsys):
    hand, _ = _synthetic()
    assert vector_stage(tmp_path, effective_hand(hand), T, STAGES, MARGIN) is None
    assert "base layers missing; run import_osm.py first" in capsys.readouterr().out


def test_outputs_load_with_load_world(tmp_path):
    _write_base(tmp_path)
    hand, dem = _synthetic()
    water = water_features(hand, dem, T, STAGES, simplify_deg=0.0, tile_deg=1.0)
    vec = vector_stage(tmp_path, effective_hand(hand), T, STAGES, MARGIN)
    write_outputs(tmp_path, water, vec, created="2026-10-15")
    build_waste(tmp_path)
    w = load_world(tmp_path)
    assert [s.id for s in w.flood.scenarios] == scenario_ids(STAGES)
    assert set(w.water) == set(scenario_ids(STAGES))
    assert all(s.disclaimer.startswith("Indicative scenario") for s in w.flood.scenarios)
    assert w.flood.edge_classes["stage_p1m"] == {"seg-river": "likely_flooded"}
    assert w.flood.edge_classes["baseline"] == {}
    assert len(w.centres) == 2
    site = json.loads((tmp_path / "site.json").read_text(encoding="utf-8"))
    assert any("Copernicus DEM GLO-30" in a for a in site["attribution"])
    assert site["attribution"].count("© OpenStreetMap contributors (ODbL)") == 1  # REM uses OSM
    assert "HAND: ASF (CC0)" not in site["attribution"]  # HAND is only the comparison method
    assert {s.method for s in w.flood.scenarios} == {"REM"}
    FloodBundle.model_validate_json((tmp_path / "flood/scenarios.json").read_text(encoding="utf-8"))
    # waste: recycling + bin from OSM, plus the programme site only because the OSM name exists
    types = sorted(p.type for p in w.waste.values())
    assert types == ["bin", "programme_site", "recycling_drop_off"]
    assert all(p.status == "unknown" for p in w.waste.values())
    assert w.site.scene.datum_offset_m == 0.0  # untouched without a computed geoid height
    # idempotent attribution append; the datum offset is written only when computed
    write_outputs(tmp_path, water, vec, created="2026-10-15", datum_offset_m=-3.74)
    site2 = json.loads((tmp_path / "site.json").read_text(encoding="utf-8"))
    assert site2["attribution"] == site["attribution"]
    assert load_world(tmp_path).site.scene.datum_offset_m == -3.74


def test_write_outputs_without_vector_stage_keeps_scenarios(tmp_path):
    hand, dem = _synthetic()
    water = water_features(hand, dem, T, STAGES, simplify_deg=0.0, tile_deg=1.0)
    write_outputs(tmp_path, water, None, created="2026-10-15")
    b = FloodBundle.model_validate_json(
        (tmp_path / "flood/scenarios.json").read_text(encoding="utf-8")
    )
    assert [s.id for s in b.scenarios] == scenario_ids(STAGES)
    assert b.scenarios[3].label == "River +3 m (indicative)" and b.scenarios[3].margin_m == 0.5
    assert not (tmp_path / "site.json").exists()  # never created by this script
    assert not (tmp_path / "flood/evac_centres.geojson").exists()


def test_sanity_report_lists_nearest_edges(tmp_path, monkeypatch):
    import data.scripts.build_flood as bf

    _write_base(tmp_path)
    hand, _ = _synthetic()
    eff = effective_hand(hand)
    vec = vector_stage(tmp_path, eff, T, STAGES, MARGIN)
    monkeypatch.setattr(bf, "SANITY_POINTS", {"river": (101.5105, 3.1945)})
    rep = bf.sanity_report(tmp_path, eff, T, vec)
    assert (
        "connected relative height at point = 0.00 m "
        "(stage_p1m=likely_flooded, stage_p3m=likely_flooded)" in rep
    )
    assert "seg-river" in rep.splitlines()[1] and "stage_p3m=likely_flooded" in rep


# --- REM (relative elevation above OSM drainage) ----------------------------------------------


def _valley():
    """A channel down column 5 (sloping 0.05 m per row) between two hills rising 2 m per cell."""
    rows, cols = np.mgrid[0:12, 0:11]
    dem = 10.0 + 0.05 * rows + 2.0 * np.abs(cols - 5)
    drain = np.zeros(dem.shape, dtype=bool)
    drain[:, 5] = True
    return dem, drain


def test_rem_is_height_above_nearest_channel():
    dem, drain = _valley()
    rem = relative_elevation(dem, drain)
    assert np.all(rem[drain] == 0.0)
    expected = 2.0 * np.abs(np.arange(11) - 5)
    # valley floor = min DEM within 1 cell (3x3) along the 0.05 m/row slope -> REM + 0.05 m
    assert np.allclose(rem[2:-2], expected + 0.05 * (expected > 0), atol=1e-9)
    assert np.allclose(rem, expected, atol=0.11)  # end rows: windows are truncated


def test_rem_hill_cells_stay_dry_at_small_stage():
    dem, drain = _valley()
    rem = relative_elevation(dem, drain)
    m1, m3 = connected_mask(rem, 1, drain), connected_mask(rem, 3, drain)
    assert m1[:, 5].all() and not m1[:, [4, 6]].any()  # only the channel at +1 m
    assert m3[:, 4:7].all() and not m3[:, :4].any() and not m3[:, 7:].any()  # REM 2 m wet at +3
    assert not connected_mask(rem, 5, drain)[:, [0, 10]].any()  # hill tops (REM 10 m) dry


def test_rem_hollow_not_connected_to_drainage_stays_dry():
    dem, drain = _valley()
    dem[5, 9] = 5.0  # a hollow below the channel, behind the hill (REM about -5 m)
    rem = relative_elevation(dem, drain)
    assert rem[5, 9] < 0
    for s in STAGES:
        assert not connected_mask(rem, s, drain)[5, 9]
    eff = effective_hand(rem, drain)
    assert eff[5, 9] == pytest.approx(6.05)  # joins only once the ~6 m barrier (col 8) is topped
    for s in (0.5, 1, 2.5, 4, 6.5, 9):
        assert np.array_equal(connected_mask(rem, s, drain), eff < s)


def test_rem_channel_spike_is_smoothed():
    dem, drain = _valley()
    dem[6, 5] += 8.0  # a bridge deck in the surface model
    rem = relative_elevation(dem, drain)
    assert rem[6, 5] == 0.0
    assert rem[6, 3] == pytest.approx(4.05, abs=0.06)  # neighbours unaffected by the spike


def test_rem_without_drainage_is_nan():
    dem, _ = _valley()
    assert np.isnan(relative_elevation(dem, np.zeros(dem.shape, dtype=bool))).all()


def _way(tags, pts):
    return {"type": "way", "tags": tags, "geometry": [{"lon": x, "lat": y} for x, y in pts]}


def test_osm_drainage_geoms_and_mask():
    x = lambda col: 101.50 + (col + 0.5) * 0.001  # noqa: E731
    y = lambda row: 3.20 - (row + 0.5) * 0.001  # noqa: E731
    pond = [(x(12), y(12)), (x(16), y(12)), (x(16), y(16)), (x(12), y(16)), (x(12), y(12))]
    # the stream (col 2, rows 0-14) runs into the lake; the pond is off-line
    lake_outer = [(x(1), y(14)), (x(5), y(14)), (x(5), y(18)), (x(1), y(18)), (x(1), y(14))]
    els = [
        _way({"waterway": "stream"}, [(x(2), y(0)), (x(2), y(14))]),
        _way({"waterway": "stream", "tunnel": "culvert"}, [(x(8), y(0)), (x(8), y(10))]),
        _way({"waterway": "drain"}, [(x(18), y(0)), (x(18), y(10))]),
        _way({"natural": "water", "water": "pond"}, pond),
        {
            "type": "relation",
            "tags": {"type": "multipolygon", "natural": "water"},
            "members": [
                {"type": "way", "role": "outer", "geometry": _way({}, lake_outer)["geometry"]}
            ],
        },
    ]
    lines, polys = osm_drainage_geoms(els)
    assert len(lines) == 1 and len(polys) == 2
    m = drainage_mask(lines, polys, (20, 20), T)
    assert m[0:14, 2].all() and not m[:, 8].any() and not m[:, 18].any()
    assert m[16, 3] and not m[14, 14] and not m[10, 10]  # on-line lake in, off-line pond out
    assert drainage_mask(lines, polys, (20, 20), T, connected_only=False)[14, 14]


def test_load_osm_water_reads_overpass_and_geojson(tmp_path):
    from data.scripts.build_flood import load_osm_water

    a = tmp_path / "a.json"
    a.write_text(
        json.dumps({"elements": [{"id": 1, **_way({"waterway": "river"}, [(0, 0), (1, 1)])}]}),
        encoding="utf-8",
    )
    b = tmp_path / "b.geojson"
    sq = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
    b.write_text(
        json.dumps(
            _fc(
                [
                    {
                        "type": "Feature",
                        "geometry": {"type": "Polygon", "coordinates": [sq]},
                        "properties": {"tags": {"natural": "water"}},
                    },
                    {
                        "type": "Feature",
                        "geometry": {"type": "LineString", "coordinates": [[0, 0], [2, 2]]},
                        "properties": {"waterway": "stream", "tunnel": "culvert"},
                    },
                ]
            )
        ),
        encoding="utf-8",
    )
    lines, polys = osm_drainage_geoms(load_osm_water([a, a, b]))
    assert len(lines) == 1 and len(polys) == 1


def test_duplicate_halls_are_deduped_within_100_m(tmp_path):
    from data.scripts.build_flood import evac_centres

    a = _place("osm-way-2", "community_centre", "Dewan Refelsia", [101.5100, 3.1800], None)
    b = _place("osm-node-9", "community_centre", "Dewan  refelsia", [101.5105, 3.1803], "n-x")
    far = _place("osm-node-3", "community_centre", "Dewan Refelsia", [101.5200, 3.1800], None)
    other = _place("osm-node-4", "school", "SK Elmina", [101.5101, 3.1801], None)
    dropped: list = []
    ids = {f["properties"]["id"] for f in evac_centres([a, b, far, other], dropped=dropped)}
    # the copy snapped to a walk node wins; the one 1.1 km away is a different hall
    assert ids == {"evc-osm-node-9", "evc-osm-node-3", "evc-osm-node-4"}
    assert dropped == [("osm-way-2", "osm-node-9")]


def _sloping_river():
    """A river down column 30 dropping 0.2 m per row over 0.06 deg (several 0.01 deg tiles)."""
    rows, cols = np.mgrid[0:60, 0:40]
    dem = 20.0 + 0.2 * (59 - rows) + 0.8 * np.abs(cols - 30)
    drain = np.zeros(dem.shape, dtype=bool)
    drain[:, 30] = True
    return dem, drain


def test_surface_height_rises_with_stage_at_every_point():
    from shapely.geometry import Point, shape

    dem, drain = _sloping_river()
    rem = relative_elevation(dem, drain)
    water = water_features(rem, dem, T, STAGES, tile_deg=0.01, drain=drain)
    probes = [
        Point(101.50 + (c + 0.5) * 0.001, 3.20 - (r + 0.5) * 0.001)
        for r in range(2, 60, 7)
        for c in (28, 30, 31)
    ]
    for pt in probes:
        heights = []
        for s in STAGES:
            hs = [
                f["properties"]["surface_height_m"]
                for f in water[f"stage_p{s}m"]
                if shape(f["geometry"]).contains(pt)
            ]
            heights.append(max(hs) if hs else None)
        seen = [h for h in heights if h is not None]
        assert seen, pt
        assert all(b - a == pytest.approx(1.0) for a, b in zip(seen, seen[1:], strict=False))


def test_ground_above_drawn_surface_share_is_small():
    from data.scripts.build_flood import ground_above_surface_share

    dem, drain = _sloping_river()
    rem = relative_elevation(dem, drain)
    share = ground_above_surface_share(rem, dem, T, 1, drain, STAGES, tile_deg=0.01)
    # 0.01 deg tile = 10 rows = 2 m of river fall: the upstream half of a tile sits above +1 m
    assert 0.0 < share < 0.6
    assert ground_above_surface_share(rem, dem, T, 5, drain, STAGES, tile_deg=0.01) < share


def test_unnamed_halls_are_never_merged():
    from data.scripts.build_flood import dedupe_places

    a = _place(
        "osm-way-1", "community_centre", "Community hall (unnamed, OSM)", [101.5100, 3.1800], None
    )
    b = _place(
        "osm-node-2",
        "community_centre",
        "Community hall (unnamed, OSM)",
        [101.51045, 3.1800],
        "n-x",
    )
    kept, dropped = dedupe_places([a, b])
    assert len(kept) == 2 and dropped == []


def test_seed_scenario_disclaimers_match_build_constant():
    from data.scripts.build_flood import DISCLAIMERS

    p = Path(__file__).resolve().parents[2] / "seed/elmina/flood/scenarios.json"
    scenarios = json.loads(p.read_text(encoding="utf-8"))["scenarios"]
    river = [s for s in scenarios if s.get("kind", "river_stage") == "river_stage"]
    assert river and all(s["disclaimer"] == DISCLAIMERS["rem"] for s in river)
    # the T-029 terrain screen keeps its own disclaimer (limits stated, never a depth)
    from data.scripts.build_lowlying import DISCLAIMER as LOWLYING

    assert all(s["disclaimer"] == LOWLYING for s in scenarios if s.get("kind") == "lowlying")
    assert "101.46" in DISCLAIMERS["rem"] and "paths outside it are not" in DISCLAIMERS["rem"]


def test_rewrite_disclaimers_edits_only_that_field(tmp_path):
    from data.scripts.build_flood import DISCLAIMERS, rewrite_disclaimers

    f = tmp_path / "flood"
    f.mkdir()
    raw = (
        '{\n "scenarios": [\n  {\n   "id": "a",\n   "method": "REM",\n'
        '   "disclaimer": "old"\n  },\n  {\n   "id": "b",\n   "method": "HAND",\n'
        '   "disclaimer": "keep"\n  }\n ]\n}\n'
    )
    (f / "scenarios.json").write_text(raw, encoding="utf-8")
    assert rewrite_disclaimers(tmp_path) == 1
    assert (f / "scenarios.json").read_text(encoding="utf-8") == raw.replace(
        '"old"', json.dumps(DISCLAIMERS["rem"], ensure_ascii=False)
    )


def test_rewrite_disclaimers_refuses_when_keys_and_scenarios_disagree(tmp_path):
    """Review (Task 22 M3): a second `disclaimer` key would shift the pairing."""
    from data.scripts.build_flood import rewrite_disclaimers

    f = tmp_path / "flood"
    f.mkdir()
    raw = (
        '{"scenarios": [{"id": "a", "method": "HAND", "disclaimer": "keep",'
        ' "extra": {"disclaimer": "nested"}}, {"id": "b", "method": "REM", "disclaimer": "old"}]}'
    )
    (f / "scenarios.json").write_text(raw, encoding="utf-8")
    with pytest.raises(ValueError, match="disclaimer keys"):
        rewrite_disclaimers(tmp_path)
    assert (f / "scenarios.json").read_text(encoding="utf-8") == raw


def test_update_site_writes_two_space_indent(tmp_path):
    from data.scripts.build_flood import update_site

    (tmp_path / "site.json").write_text('{"id": "x"}', encoding="utf-8")
    update_site(tmp_path, 1.5)
    assert '\n  "attribution"' in (tmp_path / "site.json").read_text(encoding="utf-8")


def test_coverage_lists_places_without_node(tmp_path):
    """Task 43: places nothing can route to are listed in coverage.json."""
    _write_base(tmp_path)
    hand, dem = _synthetic()
    vec = vector_stage(tmp_path, effective_hand(hand), T, STAGES, MARGIN)
    places = json.loads((tmp_path / "base/places.geojson").read_text(encoding="utf-8"))["features"]
    expected = sorted(f["properties"]["id"] for f in places if not f["properties"].get("node_id"))
    assert expected  # the synthetic base has unsnapped places
    assert vec["places_without_node"] == expected
    water = water_features(hand, dem, T, STAGES, simplify_deg=0.0, tile_deg=1.0)
    write_outputs(tmp_path, water, vec, created="2026-10-15")
    cov = json.loads((tmp_path / "flood/coverage.json").read_text(encoding="utf-8"))
    assert cov["places_without_node"] == expected


def test_coverage_lists_snap_warnings_and_centres_carry_node_inferred(tmp_path):
    """Review I1/I3 (R28): fallback snaps are listed in coverage; centres built from an
    inferred-node place say so (typed EvacCentre.node_inferred)."""
    _write_base(tmp_path)
    pp = tmp_path / "base/places.geojson"
    fc = json.loads(pp.read_text(encoding="utf-8"))
    hall = next(f for f in fc["features"] if f["properties"]["id"] == "osm-node-1")
    hall["properties"]["node_inferred"] = True
    hall["properties"]["snap_warning"] = "OSM outline not returned for this way; snapped ..."
    pp.write_text(json.dumps(fc), encoding="utf-8")
    hand, dem = _synthetic()
    vec = vector_stage(tmp_path, effective_hand(hand), T, STAGES, MARGIN)
    assert vec["places_snap_warnings"] == [
        {"id": "osm-node-1", "warning": "OSM outline not returned for this way; snapped ..."}
    ]
    centres = {f["properties"]["place_id"]: f["properties"] for f in vec["centres"]}
    assert centres["osm-node-1"]["node_inferred"] is True
    assert centres["osm-node-2"].get("node_inferred", False) is False
    water = water_features(hand, dem, T, STAGES, simplify_deg=0.0, tile_deg=1.0)
    write_outputs(tmp_path, water, vec, created="2026-10-15")
    cov = json.loads((tmp_path / "flood/coverage.json").read_text(encoding="utf-8"))
    assert cov["places_snap_warnings"] == vec["places_snap_warnings"]
