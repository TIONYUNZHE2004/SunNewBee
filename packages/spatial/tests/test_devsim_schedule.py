"""Development Simulation schedule and cost ESTIMATE (demo polish spec §6.1.3; AC-C3, AC-C4)."""

import re
from datetime import date
from pathlib import Path

import pytest
from townshiplens_spatial import devsim_schedule as ds

ROOT = Path(__file__).resolve().parents[3]
DOC = ROOT / "docs" / "04-architecture" / "devsim-estimates-sources.md"
KINDS = {"gazetted", "benchmark", "climatology", "assumption"}


def _table(header_start: str) -> list[dict[str, str]]:
    lines = DOC.read_text(encoding="utf-8").splitlines()
    i = next(k for k, ln in enumerate(lines) if ln.startswith(header_start))
    rows = []
    for ln in lines[i:]:
        if not ln.startswith("|"):
            break
        rows.append([c.strip() for c in ln.strip().strip("|").split("|")])
    head, body = rows[0], rows[2:]
    return [dict(zip(head, r, strict=True)) for r in body]


def test_sources_equal_the_doc_figures_table():  # AC-C3
    doc = _table("| id | figure | value |")
    assert [r["id"] for r in doc] == [s.id for s in ds.SOURCES]
    for row, src in zip(doc, ds.SOURCES, strict=True):
        assert float(row["value"]) == src.value, row["id"]
        assert row["kind"] == src.kind, row["id"]
        assert row["unit"] == src.unit, row["id"]
        assert row["kind"] in KINDS
        assert row["accessed"] == "2026-10-21"
        assert row["source title"] and row["edition/year"] and row["URL"]


def test_forum_figures_stay_assumptions():  # ruling R11
    by_id = {s.id: s for s in ds.SOURCES}
    for sid in ("floor_cycle_days", "fitout_months", "working_days_per_week"):
        assert by_id[sid].kind == "assumption"
    assert by_id["working_days_per_week"].value == 6  # ruling R10: Monday to Saturday


def test_holidays_equal_the_doc_holiday_table():  # AC-C3
    doc = _table("| date | name | status | source |")
    want = [
        (r["date"], re.sub(r" \((Mon|Tue|Wed|Thu|Fri|Sat|Sun)\)$", "", r["name"]), r["status"])
        for r in doc
    ]
    assert want == list(ds.HOLIDAYS)
    for d, _, status in ds.HOLIDAYS:
        # Only 2027 is gazetted; later years are expected dates.
        assert status == ("gazetted" if d.startswith("2027") else "expected") or (
            d == "2027-08-16" and status == "expected"
        )


def test_weekday_in_the_doc_matches_the_date():
    days = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
    for r in _table("| date | name | status | source |"):
        wd = re.search(r"\((\w{3})\)$", r["name"]).group(1)
        assert days[date.fromisoformat(r["date"]).weekday()] == wd, r["date"]


def test_every_used_figure_has_a_row():  # AC-C3: no figure in code without a row
    ids = {s.id for s in ds.SOURCES}
    s = ds.schedule()
    assert set(s.source_ids) <= ids
    assert set(ds.USED) == set(s.source_ids)


def test_schedule_outputs():  # AC-C4
    s = ds.schedule(storeys=30, homes=500)
    assert s.months_total == len(s.months) == len(s.floors_by_month) == len(s.cost_by_month)
    assert s.months[0] == "2027-01"
    assert s.floors_by_month[0] == 0 and s.floors_by_month[-1] == 30
    assert s.floors_by_month == sorted(s.floors_by_month)
    assert [p.name for p in s.phases] == ["foundation", "structure", "fit-out"]
    assert s.phases[0].end == "2027-10-04"  # 9 months of foundation
    assert s.phases[2].end == s.handover
    assert s.raya_shutdown_days == 10
    assert all(h.status in ("gazetted", "expected") for h in s.holidays)
    assert s.holidays and all(s.start <= h.date <= s.handover for h in s.holidays)
    assert s.label == "ESTIMATE" and "Not an SDP figure" in s.source_line


def test_sourced_inputs_reproduce_exactly():  # AC-C4
    s = ds.schedule(storeys=30, homes=500)
    assert s.gfa_m2 == round(500 * 93 * 1.3) == 60450
    assert s.rate_rm_per_m2 == 2206
    assert s.cost_total_rm == round(2206 * 60450) == 133_352_700
    # The structure needs 7 working days a floor; holidays, the Raya shutdown and rain extend it.
    assert ds.value("floor_cycle_days") * 30 == 210
    assert ds.schedule(storeys=30, homes=500) == s  # deterministic


def test_scurve_is_monotonic_and_ends_at_the_total():  # AC-C4
    for storeys, homes in ((30, 500), (12, 120), (45, 800)):
        s = ds.schedule(storeys=storeys, homes=homes)
        c = s.cost_by_month
        assert all(b > a for a, b in zip(c, c[1:], strict=False))
        assert c[-1] == s.cost_total_rm
        assert c[0] > 0
        # Symmetric S: half the money is spent by the middle month (within one month's spend).
        mid = s.months_total // 2
        assert abs(c[mid - 1] - s.cost_total_rm / 2) <= max(
            b - a for a, b in zip(c, c[1:], strict=False)
        )


def test_sunday_holidays_are_not_counted():  # AC-C4
    s = ds.schedule()
    struct = next(p for p in s.phases if p.name == "structure")
    in_structure = [h for h in s.holidays if struct.start <= h.date < struct.end]
    sundays = [h.date for h in in_structure if date.fromisoformat(h.date).weekday() == 6]
    assert sundays, "the structure phase has Sunday holidays (e.g. Hari Raya 2028-02-27)"
    assert not set(sundays) & set(s.holidays_lost)
    assert s.holidays_lost == [h.date for h in in_structure if h.working_day]
    assert s.holiday_days_lost == len(s.holidays_lost)
    assert ds.working_day(date(2027, 1, 9))  # a Saturday is worked
    assert not ds.working_day(date(2027, 1, 10))  # a Sunday is not


def test_raya_and_monsoon_set_pieces():  # AC-C4
    s = ds.schedule()
    struct = next(p for p in s.phases if p.name == "structure")
    raya = s.raya_set_piece
    assert raya is not None and raya.days == 10
    first_raya = min(d for d, n, _ in ds.HOLIDAYS if n == ds.RAYA and d >= struct.start)
    assert raya.date == first_raya and raya.date < struct.end
    assert s.months[raya.month_index] == raya.date[:7]
    # Ruling R25: the staged monsoon is the first band starting after the Raya month and before
    # the handover month (Nov 2028 - Mar 2029 here, during fit-out: no structure days lost).
    mp = s.monsoon_set_piece
    assert mp is not None and mp.months
    band = next(b for b in s.monsoon_bands if b.start_month == mp.start_month)
    assert raya.month_index < band.start_index < s.months_total - 1
    assert not [b for b in s.monsoon_bands if raya.month_index < b.start_index < band.start_index]
    assert (mp.start_month, mp.end_month) == ("2028-11", "2029-03")
    assert [m.month_index for m in mp.months] == list(range(band.start_index, band.end_index + 1))
    for m in mp.months:
        assert int(m.month[5:]) in (11, 12, 1, 2, 3)
        assert m.wet_days == ds.value(ds.WET_DAYS[int(m.month[5:])])
        assert m.month >= struct.end[:7] and m.days_lost == 0  # fit-out: rain is not counted
    for b in s.monsoon_bands:
        assert 0 <= b.start_index <= b.end_index < s.months_total
        assert s.months[b.start_index] == b.start_month and s.months[b.end_index] == b.end_month


def test_full_monsoon_month_loses_wet_days_times_fraction():
    """A monsoon month wholly inside structure work loses exactly wet days x the fraction."""
    s = ds.schedule()
    struct = next(p for p in s.phases if p.name == "structure")
    i = s.months.index("2027-11")
    assert struct.start < "2027-11-01" and struct.end > "2027-12-01"
    assert not [h for h in s.holidays_lost if h.startswith("2027-11")]
    nov = s.days_lost_by_month[i] - s.days_lost_by_month[i - 1]
    assert nov == pytest.approx(18 * 0.25, abs=0.15)


def test_days_lost_by_month_adds_holidays_shutdown_and_rain():  # ruling R25
    s = ds.schedule()
    lost = s.days_lost_by_month
    assert len(lost) == s.months_total
    assert all(b >= a for a, b in zip(lost, lost[1:], strict=False))
    total = s.holiday_days_lost + s.raya_shutdown_days + s.rain_days_lost
    assert abs(lost[-1] - total) <= 0.5
    # nothing is lost before structure work starts, nothing after it ends
    struct = next(p for p in s.phases if p.name == "structure")
    before = [x for m, x in zip(s.months, lost, strict=True) if m < struct.start[:7]]
    after = [x for m, x in zip(s.months, lost, strict=True) if m > struct.end[:7]]
    assert set(before) == {0} and set(after) == {lost[-1]}
    # the Raya month carries the holiday plus the shutdown days started in it
    r = s.raya_set_piece.month_index
    assert lost[r + 1] - lost[r - 1] >= s.raya_shutdown_days


def test_more_storeys_take_longer():
    assert ds.schedule(storeys=40).months_total > ds.schedule(storeys=20).months_total


def test_start_date_comes_from_its_row():  # review M8
    assert ds.value("schedule_start_date") == 20270104
    assert ds.START.isoformat() == "2027-01-04" and ds.START.weekday() == 0
    assert ds.schedule().start == "2027-01-04"
    assert "schedule_start_date" in ds.schedule().source_ids
