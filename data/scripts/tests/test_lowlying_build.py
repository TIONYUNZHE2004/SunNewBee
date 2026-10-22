import json
import shutil
from pathlib import Path

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from rasterio.transform import from_origin
from townshiplens_spatial.world import load_world

from data.scripts.build_lowlying import (
    Config,
    features,
    load_config,
    lowlying_mask,
    priority_fill,
    write_outputs,
)

TINY = Path(__file__).resolve().parents[3] / "packages/spatial/tests/fixtures/tiny"
CFG = Config(
    min_fill_m=1, min_cells=4, boundary_cells=1, connectivity=8, exclude_mapped_water=False
)


def test_enclosed_basin_is_possible_but_open_diagonal_outlet_is_not():
    dem = np.full((9, 9), 10.0)
    dem[2:7, 2:7] = 2
    assert lowlying_mask(dem, CFG).sum() == 25
    # An 8-connected opening discharges the hollow in this terrain model.
    dem[0, 0] = dem[1, 1] = 2
    assert not lowlying_mask(dem, CFG).any()


def test_nodata_is_an_outlet_and_never_a_false_dam():
    dem = np.full((9, 9), 10.0)
    dem[2:7, 2:7] = 2
    dem[4, 4] = np.nan
    original = dem.copy()
    assert not lowlying_mask(dem, CFG).any()
    np.testing.assert_equal(dem, original)
    assert np.isnan(priority_fill(dem)[4, 4])


@given(st.lists(st.integers(-3, 20), min_size=49, max_size=49))
@settings(max_examples=20, deadline=None)
def test_priority_fill_never_lowers_dem_is_idempotent_and_thresholds_are_nested(values):
    dem = np.array(values).reshape(7, 7)
    filled = priority_fill(dem)
    assert np.all(filled >= dem)
    assert filled.max() <= dem.max()
    np.testing.assert_equal(priority_fill(filled), filled)
    low = lowlying_mask(dem, CFG)
    high = lowlying_mask(dem, Config(**{**CFG.__dict__, "min_fill_m": 2}))
    assert not (high & ~low).any()


def test_small_pits_and_known_water_are_filtered():
    dem = np.full((9, 9), 10.0)
    dem[3:5, 3:5] = 0
    assert lowlying_mask(dem, CFG).sum() == 4
    excluded = dem == 0
    assert not lowlying_mask(dem, CFG, excluded).any()
    dem[3, 3] = 10
    assert not lowlying_mask(dem, CFG).any()


def test_output_is_possible_only_has_area_and_never_publishes_fill_contrast(tmp_path):
    dest = tmp_path / "tiny"
    shutil.copytree(TINY, dest)
    dem = np.full((8, 8), 10.0)
    dem[2:6, 2:6] = 0
    transform = from_origin(101.5085, 3.182, 0.0005, 0.0005)
    report = write_outputs(dest, dem, transform, CFG)
    bundle = json.loads((dest / "flood/scenarios.json").read_text())
    assert report["lowlying_cells"] == 16 and report["possible_edges"] > 0
    assert set(bundle["edge_classes"]["lowlying"].values()) == {"possible"}
    assert set(bundle["place_classes"]["lowlying"].values()) == {"possible"}
    fc = json.loads((dest / "flood/lowlying.geojson").read_text())
    assert fc["features"] and all(f["properties"]["area_m2"] > 0 for f in fc["features"])
    assert "fill_depth" not in json.dumps(fc) and "surface_height_m" not in json.dumps(fc)
    assert any(s.id == "lowlying" for s in load_world(dest).flood.scenarios)
    # Rebuilding replaces this scenario, instead of creating duplicate IDs.
    write_outputs(dest, dem, transform, CFG)
    assert (
        sum(
            s["id"] == "lowlying"
            for s in json.loads((dest / "flood/scenarios.json").read_text())["scenarios"]
        )
        == 1
    )


def test_empty_coverage_fails_without_writing_a_misleading_empty_layer(tmp_path):
    dest = tmp_path / "tiny"
    shutil.copytree(TINY, dest)
    with pytest.raises(ValueError, match="no finite"):
        write_outputs(dest, np.full((5, 5), np.nan), from_origin(101.51, 3.18, 0.001, 0.001), CFG)
    assert not (dest / "flood/lowlying.geojson").exists()
    assert features(np.zeros((5, 5), dtype=bool), from_origin(101, 3, 0.001, 0.001)) == []
    assert load_config().min_fill_m == 2.0  # above GLO-30's 2 m relative accuracy (LE90)
    assert set(load_config().exclude_landcover) == {"water", "forest", "scrub"}


def test_a_basin_under_forest_canopy_is_not_screened(tmp_path):
    """GLO-30 is a canopy surface: gaps between trees read as pits, so forest is a gap."""
    dest = tmp_path / "tiny"
    shutil.copytree(TINY, dest)
    dem = np.full((8, 8), 10.0)
    dem[2:6, 2:6] = 0
    transform = from_origin(101.5085, 3.182, 0.0005, 0.0005)
    x0, y0 = 101.5085, 3.182
    forest = [[x0, y0], [x0 + 0.004, y0], [x0 + 0.004, y0 - 0.004], [x0, y0 - 0.004], [x0, y0]]
    (dest / "base").mkdir(exist_ok=True)
    (dest / "base/landcover.geojson").write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"class": "forest"},
                        "geometry": {"type": "Polygon", "coordinates": [forest]},
                    }
                ],
            }
        )
    )
    canopy = Config(**{**CFG.__dict__, "exclude_landcover": ("forest",)})
    report = write_outputs(dest, dem, transform, canopy)
    assert report["lowlying_cells"] == 0 and report["not_screened_cells"] == 64
    # not screened is a gap (UNKNOWN), never "checked and clear": every element over it
    bundle = json.loads((dest / "flood/scenarios.json").read_text())
    gaps = bundle["scenario_coverage"]["lowlying"]
    world = load_world(dest)
    inside = [
        e.id
        for e in world.edges.values()
        if all(x0 <= x <= x0 + 0.004 and y0 - 0.004 <= y <= y0 for x, y in e.coords)
    ]
    assert inside and all(gaps.get(eid) == "uncovered" for eid in inside)
    assert write_outputs(dest, dem, transform, CFG)["lowlying_cells"] == 16  # no exclusion


def test_the_ignored_border_is_a_coverage_gap_too(tmp_path):
    """Codex audit Q1 (#32): a place in an ignored border row was evaluated PASS."""
    from townshiplens_spatial.routing import endpoint_flood

    dest = tmp_path / "tiny"
    shutil.copytree(TINY, dest)
    dem = np.full((8, 8), 10.0)
    cfg = Config(
        min_fill_m=2, min_cells=4, boundary_cells=2, connectivity=8, exclude_mapped_water=False
    )
    write_outputs(dest, dem, from_origin(101.5085, 3.18125, 0.0005, 0.0005), cfg)
    gaps = json.loads((dest / "flood/scenarios.json").read_text())["scenario_coverage"]["lowlying"]
    assert gaps.get("park-b") in ("uncovered", "partial")
    world = load_world(dest)
    assert endpoint_flood(world, "park-b", "default", "lowlying") != "PASS"
