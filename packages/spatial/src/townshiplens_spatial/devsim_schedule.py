"""Development Simulation schedule and cost ESTIMATE (demo polish spec 2026-10-21 §6.1.3, AC-C3/C4).

Every constant comes from a row of docs/04-architecture/devsim-estimates-sources.md (a test parses
the doc's tables and compares them with `SOURCES` and `HOLIDAYS`). The model:

- foundation: `foundation_months` calendar months from the start;
- structure: `floor_cycle_days` working days per storey, worked Monday to Saturday
  (`working_days_per_week`), extended by public holidays that fall on a working day, by one Hari
  Raya Aidilfitri site shutdown (`raya_shutdown_working_days`, the first Raya during structure
  work) and by rain: in a northeast-monsoon month each working day loses
  wet days x `rain_lost_fraction` / that month's working days;
- fit-out: `fitout_months` calendar months after topping out. The foundation and fit-out figures
  are calendar durations, so only the structure (counted in working days) is extended.

Cost is `rate x GFA` (GFA = homes x net area x common factor), spread over the months as a
cumulative Beta(a, a) S-curve (`scurve_shape`, an assumption). Indicative only: not an SDP figure,
a quotation or a forecast. No price escalation is applied.
"""

from __future__ import annotations

import calendar
import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from scipy.special import betainc

from .devsim_models import (
    MonsoonBand,
    MonsoonMonth,
    MonsoonSetPiece,
    RayaSetPiece,
    Schedule,
    ScheduleHoliday,
    SchedulePhase,
)

SourceKind = Literal["gazetted", "benchmark", "climatology", "assumption"]


@dataclass(frozen=True)
class Source:
    id: str
    value: float
    unit: str
    kind: SourceKind
    label: str


# The figures table (§1) of docs/04-architecture/devsim-estimates-sources.md, row for row.
SOURCES: tuple[Source, ...] = (
    Source(
        "cost_usd_per_m2_highrise_condo_kl_low",
        330,
        "USD per m2 CFA",
        "benchmark",
        "Kuala Lumpur high-rise apartments, average standard, cost per m2, low (Arcadis 2025)",
    ),
    Source(
        "cost_usd_per_m2_highrise_condo_kl_high",
        655,
        "USD per m2 CFA",
        "benchmark",
        "Same, high (Arcadis 2025)",
    ),
    Source(
        "fx_myr_per_usd_arcadis_q4_2024",
        4.48,
        "RM per USD",
        "benchmark",
        "Exchange rate Arcadis used",
    ),
    Source(
        "cost_rm_per_m2_highrise_condo_kv_low",
        1478,
        "RM per m2 CFA",
        "benchmark",
        "High-rise condominium cost per m2, low (converted)",
    ),
    Source(
        "cost_rm_per_m2_highrise_condo_kv_mid",
        2206,
        "RM per m2 CFA",
        "benchmark",
        "High-rise condominium cost per m2, mid-point (converted)",
    ),
    Source(
        "cost_rm_per_m2_highrise_condo_kv_high",
        2934,
        "RM per m2 CFA",
        "benchmark",
        "High-rise condominium cost per m2, high (converted)",
    ),
    Source(
        "cost_rm_per_m2_highrise_condo_kl_2022_low",
        1335,
        "RM per m2 CFA",
        "benchmark",
        "Cross-check: Kuala Lumpur high-rise apartments, low (Arcadis Malaysia 2022)",
    ),
    Source(
        "cost_rm_per_m2_highrise_condo_kl_2022_high",
        2670,
        "RM per m2 CFA",
        "benchmark",
        "Cross-check: same, high (Arcadis Malaysia 2022)",
    ),
    Source("gfa_net_per_home_m2", 93, "m2 per home", "assumption", "Net floor area per home"),
    Source("gfa_common_factor", 1.3, "ratio", "assumption", "Gross to net floor area"),
    Source("foundation_months", 9, "months", "assumption", "Foundation and piling"),
    Source("floor_cycle_days", 7, "days per storey", "assumption", "Structural floor cycle"),
    Source("fitout_months", 8, "months", "assumption", "Fit-out after topping out"),
    Source("working_days_per_week", 6, "days", "assumption", "Site working week, Mon to Sat"),
    Source(
        "raya_shutdown_working_days",
        10,
        "working days",
        "assumption",
        "Hari Raya site shutdown beyond the gazetted holidays",
    ),
    Source("monsoon_start_month", 11, "month", "climatology", "Northeast monsoon starts"),
    Source("monsoon_end_month", 3, "month", "climatology", "Northeast monsoon ends"),
    Source("monsoon_wet_days_nov", 18, "days per month", "climatology", "Wet days, November"),
    Source("monsoon_wet_days_dec", 15, "days per month", "climatology", "Wet days, December"),
    Source("monsoon_wet_days_jan", 11, "days per month", "climatology", "Wet days, January"),
    Source("monsoon_wet_days_feb", 12, "days per month", "climatology", "Wet days, February"),
    Source("monsoon_wet_days_mar", 14, "days per month", "climatology", "Wet days, March"),
    Source("rain_lost_fraction", 0.25, "fraction", "assumption", "Share of a wet day lost"),
    Source("scurve_shape", 2, "Beta parameter a = b", "assumption", "Spend curve shape"),
)
_BY_ID = {s.id: s for s in SOURCES}

# The Selangor public holidays table (§2) of the sources doc: (date, name, status).
HOLIDAYS: tuple[tuple[str, str, str], ...] = (
    ("2027-01-01", "Tahun Baharu", "gazetted"),
    ("2027-01-22", "Thaipusam", "gazetted"),
    ("2027-02-06", "Tahun Baharu Cina", "gazetted"),
    ("2027-02-07", "Tahun Baharu Cina, day 2", "gazetted"),
    ("2027-02-24", "Nuzul Al-Quran", "gazetted"),
    ("2027-03-10", "Hari Raya Aidilfitri", "gazetted"),
    ("2027-03-11", "Hari Raya Aidilfitri, day 2", "gazetted"),
    ("2027-05-01", "Hari Pekerja", "gazetted"),
    ("2027-05-17", "Hari Raya Haji", "gazetted"),
    ("2027-05-20", "Hari Wesak", "gazetted"),
    ("2027-06-06", "Awal Muharam", "gazetted"),
    ("2027-06-07", "Hari Keputeraan Yang di-Pertuan Agong", "gazetted"),
    ("2027-08-15", "Maulidur Rasul", "gazetted"),
    ("2027-08-16", "Maulidur Rasul, replacement", "expected"),
    ("2027-08-31", "Hari Kebangsaan", "gazetted"),
    ("2027-09-16", "Hari Malaysia", "gazetted"),
    ("2027-10-28", "Deepavali", "gazetted"),
    ("2027-12-11", "Hari Keputeraan Sultan Selangor", "gazetted"),
    ("2027-12-25", "Hari Krismas", "gazetted"),
    ("2028-01-01", "Tahun Baharu", "expected"),
    ("2028-01-26", "Tahun Baharu Cina", "expected"),
    ("2028-01-27", "Tahun Baharu Cina, day 2", "expected"),
    ("2028-02-09", "Thaipusam", "expected"),
    ("2028-02-13", "Nuzul Al-Quran", "expected"),
    ("2028-02-27", "Hari Raya Aidilfitri", "expected"),
    ("2028-02-28", "Hari Raya Aidilfitri, day 2", "expected"),
    ("2028-05-01", "Hari Pekerja", "expected"),
    ("2028-05-05", "Hari Raya Haji", "expected"),
    ("2028-05-09", "Hari Wesak", "expected"),
    ("2028-05-26", "Awal Muharam", "expected"),
    ("2028-06-05", "Hari Keputeraan Yang di-Pertuan Agong", "expected"),
    ("2028-08-04", "Maulidur Rasul", "expected"),
    ("2028-08-31", "Hari Kebangsaan", "expected"),
    ("2028-09-16", "Hari Malaysia", "expected"),
    ("2028-10-17", "Deepavali", "expected"),
    ("2028-12-11", "Hari Keputeraan Sultan Selangor", "expected"),
    ("2028-12-25", "Hari Krismas", "expected"),
    ("2029-01-01", "Tahun Baharu", "expected"),
    ("2029-01-30", "Thaipusam", "expected"),
    ("2029-02-01", "Nuzul Al-Quran", "expected"),
    ("2029-02-13", "Tahun Baharu Cina", "expected"),
    ("2029-02-14", "Tahun Baharu Cina, day 2", "expected"),
    ("2029-02-15", "Hari Raya Aidilfitri", "expected"),
    ("2029-02-16", "Hari Raya Aidilfitri, day 2", "expected"),
    ("2029-04-24", "Hari Raya Haji", "expected"),
    ("2029-05-01", "Hari Pekerja", "expected"),
    ("2029-05-15", "Awal Muharam", "expected"),
    ("2029-05-28", "Hari Wesak", "expected"),
    ("2029-06-04", "Hari Keputeraan Yang di-Pertuan Agong", "expected"),
    ("2029-07-24", "Maulidur Rasul", "expected"),
    ("2029-08-31", "Hari Kebangsaan", "expected"),
    ("2029-09-16", "Hari Malaysia", "expected"),
    ("2029-11-05", "Deepavali", "expected"),
    ("2029-12-11", "Hari Keputeraan Sultan Selangor", "expected"),
    ("2029-12-25", "Hari Krismas", "expected"),
    ("2030-01-01", "Tahun Baharu", "expected"),
    ("2030-01-20", "Thaipusam", "expected"),
    ("2030-01-22", "Nuzul Al-Quran", "expected"),
    ("2030-02-03", "Tahun Baharu Cina", "expected"),
    ("2030-02-04", "Tahun Baharu Cina, day 2", "expected"),
    ("2030-02-05", "Hari Raya Aidilfitri", "expected"),
    ("2030-02-06", "Hari Raya Aidilfitri, day 2", "expected"),
    ("2030-04-14", "Hari Raya Haji", "expected"),
    ("2030-05-01", "Hari Pekerja", "expected"),
    ("2030-05-02", "Hari Wesak", "expected"),
    ("2030-05-04", "Awal Muharam", "expected"),
    ("2030-06-03", "Hari Keputeraan Yang di-Pertuan Agong", "expected"),
    ("2030-07-13", "Maulidur Rasul", "expected"),
    ("2030-08-31", "Hari Kebangsaan", "expected"),
    ("2030-09-16", "Hari Malaysia", "expected"),
    ("2030-10-26", "Deepavali", "expected"),
    ("2030-12-11", "Hari Keputeraan Sultan Selangor", "expected"),
    ("2030-12-25", "Hari Krismas", "expected"),
)
RAYA = "Hari Raya Aidilfitri"
START = date(2027, 1, 4)  # a Monday
COST_RATE = "cost_rm_per_m2_highrise_condo_kv_mid"
WET_DAYS = {
    11: "monsoon_wet_days_nov",
    12: "monsoon_wet_days_dec",
    1: "monsoon_wet_days_jan",
    2: "monsoon_wet_days_feb",
    3: "monsoon_wet_days_mar",
}
USED = (
    COST_RATE,
    "gfa_net_per_home_m2",
    "gfa_common_factor",
    "foundation_months",
    "floor_cycle_days",
    "fitout_months",
    "working_days_per_week",
    "raya_shutdown_working_days",
    "monsoon_start_month",
    "monsoon_end_month",
    *WET_DAYS.values(),
    "rain_lost_fraction",
    "scurve_shape",
)
SOURCE_LINE = (
    "ESTIMATE from published benchmarks: Arcadis Construction Cost Handbook (Kuala Lumpur, JUBM "
    "data); MetMalaysia Subang rain normals; JPM public holiday list. Durations, floor area and "
    "losses are assumptions. Not an SDP figure."
)


def value(source_id: str) -> float:
    return _BY_ID[source_id].value


def _int(source_id: str) -> int:
    v = value(source_id)
    if v != int(v):
        raise ValueError(f"{source_id} must be a whole number, got {v}")
    return int(v)


def _add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def _month_index(start: date, d: date) -> int:
    return (d.year - start.year) * 12 + d.month - start.month


def _ym(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _monsoon_months() -> set[int]:
    a, b = _int("monsoon_start_month"), _int("monsoon_end_month")
    return {((a - 1 + i) % 12) + 1 for i in range((b - a) % 12 + 1)}


def holidays() -> dict[date, tuple[str, str]]:
    return {date.fromisoformat(d): (n, s) for d, n, s in HOLIDAYS}


def working_day(d: date) -> bool:
    """A site working day: Monday to Saturday (`working_days_per_week` = 6)."""
    return d.weekday() < _int("working_days_per_week")


def _workable_days(y: int, m: int, hols) -> int:
    n = calendar.monthrange(y, m)[1]
    return sum(1 for i in range(1, n + 1) if working_day(d := date(y, m, i)) and d not in hols)


def schedule(storeys: int = 30, homes: int = 500, start: date = START) -> Schedule:
    """AC-C4: the ESTIMATE schedule and cost for `storeys` and `homes` from `start`."""
    hols = holidays()
    last_listed = max(hols)
    monsoon = _monsoon_months()
    frac = value("rain_lost_fraction")
    cycle = _int("floor_cycle_days")
    shutdown_days = _int("raya_shutdown_working_days")
    need = cycle * storeys

    found_end = _add_months(start, _int("foundation_months"))
    d, done, rain = found_end, 0.0, 0.0
    lost: list[date] = []
    raya: date | None = None
    shutdown_left = 0
    floors_on: dict[date, int] = {}
    rain_by_month: dict[str, float] = {}
    workable: dict[tuple[int, int], int] = {}
    while done < need - 1e-9:
        if d > last_listed:
            raise ValueError("the structure runs past the last listed public holiday")
        if raya is None and hols.get(d, ("",))[0] == RAYA:
            raya, shutdown_left = d, shutdown_days
        if working_day(d):
            if d in hols:
                lost.append(d)
            elif shutdown_left > 0:
                shutdown_left -= 1
            else:
                loss = 0.0
                if d.month in monsoon:
                    key = (d.year, d.month)
                    if key not in workable:
                        workable[key] = _workable_days(d.year, d.month, hols)
                    loss = value(WET_DAYS[d.month]) * frac / workable[key]
                    rain_by_month[_ym(d)] = rain_by_month.get(_ym(d), 0.0) + loss
                done += 1.0 - loss
                rain += loss
        floors_on[d] = min(storeys, math.floor(done / cycle + 1e-9))
        d += timedelta(days=1)
    struct_end = d
    handover = _add_months(struct_end, _int("fitout_months"))

    n_months = _month_index(start, handover) + 1
    months = [_add_months(date(start.year, start.month, 1), i) for i in range(n_months)]
    floors_by_month = []
    for m in months:
        end = date(m.year, m.month, calendar.monthrange(m.year, m.month)[1])
        if end < found_end:
            floors_by_month.append(0)
        elif end >= struct_end:
            floors_by_month.append(storeys)
        else:
            floors_by_month.append(floors_on[end])

    gfa = homes * value("gfa_net_per_home_m2") * value("gfa_common_factor")
    rate = _int(COST_RATE)
    total = round(rate * gfa)
    a = value("scurve_shape")
    cost_by_month = [
        round(total * float(betainc(a, a, (i + 1) / n_months))) for i in range(n_months)
    ]
    cost_by_month[-1] = total

    bands = []
    for y in range(start.year - 1, handover.year + 1):
        b0 = date(y, _int("monsoon_start_month"), 1)
        b1 = _add_months(b0, len(monsoon) - 1)
        i0, i1 = _month_index(start, b0), _month_index(start, b1)
        if i1 < 0 or i0 > n_months - 1:
            continue
        lo, hi = max(i0, 0), min(i1, n_months - 1)  # clipped to the project's months
        bands.append(
            MonsoonBand(
                start_month=_ym(months[lo]),
                end_month=_ym(months[hi]),
                start_index=lo,
                end_index=hi,
            )
        )
    s0, s1 = _month_index(start, found_end), _month_index(start, struct_end - timedelta(days=1))
    monsoon_piece = None
    for b in bands:
        lo, hi = max(b.start_index, s0), min(b.end_index, s1)
        if lo > hi:
            continue
        rows = []
        for i in range(lo, hi + 1):
            m = months[i]
            rows.append(
                MonsoonMonth(
                    month=_ym(m),
                    month_index=i,
                    wet_days=_int(WET_DAYS[m.month]),
                    days_lost=round(rain_by_month.get(_ym(m), 0.0), 1),
                )
            )
        monsoon_piece = MonsoonSetPiece(
            start_month=rows[0].month, end_month=rows[-1].month, months=rows
        )
        break

    return Schedule(
        storeys=storeys,
        homes=homes,
        start=start.isoformat(),
        handover=handover.isoformat(),
        months_total=n_months,
        months=[_ym(m) for m in months],
        phases=[
            SchedulePhase(name="foundation", start=start.isoformat(), end=found_end.isoformat()),
            SchedulePhase(
                name="structure", start=found_end.isoformat(), end=struct_end.isoformat()
            ),
            SchedulePhase(name="fit-out", start=struct_end.isoformat(), end=handover.isoformat()),
        ],
        floors_by_month=floors_by_month,
        gfa_m2=round(gfa),
        rate_rm_per_m2=rate,
        cost_total_rm=total,
        cost_by_month=cost_by_month,
        holidays=[
            ScheduleHoliday(
                date=h.isoformat(),
                name=n,
                status=s,
                month_index=_month_index(start, h),
                working_day=working_day(h),
            )
            for h, (n, s) in sorted(hols.items())
            if start <= h <= handover
        ],
        holiday_days_lost=len(lost),
        holidays_lost=[h.isoformat() for h in lost],
        rain_days_lost=round(rain),
        raya_shutdown_days=shutdown_days,
        monsoon_bands=bands,
        raya_set_piece=RayaSetPiece(
            date=raya.isoformat(), month_index=_month_index(start, raya), days=shutdown_days
        )
        if raya
        else None,
        monsoon_set_piece=monsoon_piece,
        source_ids=list(USED),
        source_line=SOURCE_LINE,
    )
