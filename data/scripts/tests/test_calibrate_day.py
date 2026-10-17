"""Calibration of the synthetic town against official open data (Cycle 21)."""

import importlib.util
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("calibrate_day", HERE / "calibrate_day.py")
cal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cal)
CACHED = all((cal.CACHE / s["file"]).exists() for s in cal.SOURCES.values())
SEED = HERE.parents[1] / "data" / "seed" / "elmina"


def test_age_bands_follow_dosm():
    assert cal.band(0) == "0-4" and cal.band(14) == "10-14" and cal.band(85) == "85+"
    assert cal.band(99) == "85+" and len(cal.BANDS) == 18


@pytest.mark.skipif(not (CACHED and (SEED / "site.json").exists()), reason="open data not cached")
def test_calibration_reports_the_gap_without_fitting(tmp_path, monkeypatch):
    out = cal.main(SEED, dest=tmp_path / "calibration.json")  # never rewrites the tracked file
    assert out["petaling"]["population"] > 2_000_000
    assert abs(sum(r["petaling_pct"] for r in out["age_bands"]) - 100) < 1
    assert out["max_band_gap_points"] < 10  # the synthetic town is close, not identical
    assert all(s["licence"] == "CC BY 4.0" for s in out["sources"])
    assert any("government schools only" in n for n in out["notes"])
    assert out["band_gaps"]["ages_50_64_points"] < 0  # the shortfall is reported, not hidden
    assert "Nothing is fitted" in cal.report(out)
