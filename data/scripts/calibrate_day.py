"""Calibrate Elmina Day's synthetic town against official open data (Cycle 21).

Compares the 5,000 synthetic residents with Petaling district (Selangor), where City of Elmina
is, using DOSM / MOE open data (CC BY 4.0):

- population by district, sex and 5-year age group (DOSM, population_district)
- enrolment in government schools by district (MOE EMIS via data.gov.my, enrolment_school_district)
- number of government schools by district (data.gov.my, schools_district)

The official files are fetched once into data/cache/opendata/ (gitignored); every comparison is
written to data/sim/<site>/calibration.json with its source, date and the gap, and nothing is
tuned here: this measures how far the synthetic town is from the district, it does not fit it.

    uv run python data/scripts/calibrate_day.py            # uses the cache, fetches if missing
"""

from __future__ import annotations

import json
import sys
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "cache" / "opendata"
SOURCES = {
    "population": {
        "file": "population_district.parquet",
        "url": "https://storage.dosm.gov.my/population/population_district.parquet",
        "title": "DOSM, Population by district, sex, age group and ethnicity (population_district)",
        "licence": "CC BY 4.0",
    },
    "enrolment": {
        "file": "enrol_selangor.json",
        "url": "https://api.data.gov.my/data-catalogue?id=enrolment_school_district"
        "&ifilter=selangor@state&limit=5000",
        "title": "MOE (EMIS) via data.gov.my, Enrolment in government schools by district",
        "licence": "CC BY 4.0",
    },
    "schools": {
        "file": "schools_selangor.json",
        "url": "https://api.data.gov.my/data-catalogue?id=schools_district"
        "&ifilter=selangor@state&limit=5000",
        "title": "data.gov.my, Number of government schools by district",
        "licence": "CC BY 4.0",
    },
}
BANDS = ["0-4", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49",
         "50-54", "55-59", "60-64", "65-69", "70-74", "75-79", "80-84", "85+"]  # fmt: skip


def fetch(key: str) -> Path:
    src = SOURCES[key]
    p = CACHE / src["file"]
    if not p.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(src["url"], timeout=60) as r:  # noqa: S310 - fixed official URLs
            p.write_bytes(r.read())
        print(f"fetched {src['file']} ({p.stat().st_size:,} B) from {src['url']}")
    return p


def band(age: int) -> str:
    return "85+" if age >= 85 else f"{age // 5 * 5}-{age // 5 * 5 + 4}"


def petaling_population(year: int) -> tuple[float, dict[str, float]]:
    import pyarrow.parquet as pq

    rows = pq.read_table(fetch("population")).to_pylist()
    sel = [
        r
        for r in rows
        if r["district"] == "Petaling"
        and r["sex"] == "both"
        and r["ethnicity"] == "overall"
        and r["date"].year == year
    ]
    total = next(r["population"] for r in sel if r["age"] == "overall") * 1000
    bands = {r["age"]: r["population"] * 1000 for r in sel if r["age"] in BANDS}
    return total, bands


def petaling_school_stats(year: int) -> dict:
    enrol = json.loads(fetch("enrolment").read_text())
    schools = json.loads(fetch("schools").read_text())
    rows = [
        r
        for r in enrol
        if r["district"] in ("Petaling Perdana", "Petaling Utama")  # the two MOE district offices
        and r["sex"] == "both"
        and r["date"].startswith(str(year))
    ]
    pupils = Counter()
    for r in rows:
        pupils[r["stage"]] += r["students"]
    sch = Counter()
    for r in schools:
        if r["district"] == "Petaling" and r["date"].startswith(str(year)):
            sch[r["stage"]] += r["schools"]
    return {"pupils": dict(pupils), "schools": dict(sch), "date": f"{year}-06-30"}


def synthetic(site: Path) -> dict:
    from townshiplens_spatial.day import schedule
    from townshiplens_spatial.day.population import synthesize
    from townshiplens_spatial.world import load_world

    w = load_world(site)
    pop = synthesize(w, 5000, 11)
    rs = pop.residents
    ages = [r.age for r in rs]
    houses = Counter(r.household for r in rs)
    places = schedule._places_by_purpose(w, None)
    return {
        "residents": len(rs),
        "bands": dict(Counter(band(a) for a in ages)),
        "primary_age": sum(
            1 for a in ages if schedule.PRIMARY_AGE[0] <= a <= schedule.PRIMARY_AGE[1]
        ),
        "secondary_age": sum(
            1 for a in ages if schedule.SECONDARY_AGE[0] <= a <= schedule.SECONDARY_AGE[1]
        ),
        "household_size": round(len(rs) / len(houses), 2),
        "car_share": round(
            sum(1 for h in {r.household: r.car for r in rs}.values() if h) / len(houses), 3
        ),
        "mapped_primary_schools": len(places.get("school_primary", [])),
        "mapped_secondary_schools": len(places.get("school_secondary", [])),
    }


def main(site: Path, year: int = 2025, dest: Path | None = None) -> dict:
    total, bands = petaling_population(year)
    st = petaling_school_stats(year)
    syn = synthetic(site)
    n = syn["residents"]

    def pct(x: float, of: float) -> float:
        return round(100 * x / of, 1)

    age_rows = [
        {
            "band": b,
            "petaling_pct": pct(bands.get(b, 0), sum(bands.values())),
            "synthetic_pct": pct(syn["bands"].get(b, 0), n),
        }
        for b in BANDS
    ]
    for r in age_rows:
        r["gap_points"] = round(r["synthetic_pct"] - r["petaling_pct"], 1)
    broad = {}
    for name, lo, hi in (("0-14", 0, 2), ("15-64", 3, 12), ("65+", 13, 17)):
        broad[name] = {
            "petaling_pct": round(sum(r["petaling_pct"] for r in age_rows[lo : hi + 1]), 1),
            "synthetic_pct": round(sum(r["synthetic_pct"] for r in age_rows[lo : hi + 1]), 1),
        }
    per_k = {
        "primary": {
            "petaling_government_school_pupils_per_1000": round(
                1000 * st["pupils"].get("primary", 0) / total, 1
            ),
            "synthetic_primary_age_per_1000": round(1000 * syn["primary_age"] / n, 1),
        },
        "secondary": {
            "petaling_government_school_pupils_per_1000": round(
                1000 * st["pupils"].get("secondary", 0) / total, 1
            ),
            "synthetic_secondary_age_per_1000": round(1000 * syn["secondary_age"] / n, 1),
        },
    }
    # the district's own school-age children, estimated from its 5-year bands (even spread
    # within a band), so demography and government-school share can be told apart
    pb = {r["band"]: r["petaling_pct"] * 10 for r in age_rows}
    est_7_12 = round(pb["5-9"] * 3 / 5 + pb["10-14"] * 3 / 5, 1)
    est_13_17 = round(pb["10-14"] * 2 / 5 + pb["15-19"] * 3 / 5, 1)
    per_k["primary"]["petaling_age_7_12_per_1000_estimated"] = est_7_12
    per_k["secondary"]["petaling_age_13_17_per_1000_estimated"] = est_13_17
    src_pop = f"DOSM population_district, Petaling {year}"
    src_moe = f"MOE EMIS enrolment, Petaling Perdana + Petaling Utama, 30 Jun {year}"
    rows = [
        {"what": f"Ages {k}", "synthetic": f"{v['synthetic_pct']}%",
         "official": f"{v['petaling_pct']}%", "source": src_pop}
        for k, v in broad.items()
    ] + [
        {"what": "Children aged 7-12 per 1,000 residents",
         "synthetic": str(per_k["primary"]["synthetic_primary_age_per_1000"]),
         "official": f"about {est_7_12} (from 5-year age bands)", "source": src_pop},
        {"what": "Teenagers aged 13-17 per 1,000 residents",
         "synthetic": str(per_k["secondary"]["synthetic_secondary_age_per_1000"]),
         "official": f"about {est_13_17} (from 5-year age bands)", "source": src_pop},
        {"what": "Pupils per 1,000 residents (primary / secondary)",
         "synthetic": f"{per_k['primary']['synthetic_primary_age_per_1000']} / "
         f"{per_k['secondary']['synthetic_secondary_age_per_1000']} (every school-age resident "
         "goes to a mapped school, government or private)",
         "official": f"{per_k['primary']['petaling_government_school_pupils_per_1000']} / "
         f"{per_k['secondary']['petaling_government_school_pupils_per_1000']} in government "
         "schools only",
         "source": src_moe},
    ]  # fmt: skip
    gap = {r["band"]: r["gap_points"] for r in age_rows}
    gap_50_64 = round(gap["50-54"] + gap["55-59"] + gap["60-64"], 1)
    gap_80 = round(gap["80-84"] + gap["85+"], 1)
    out = {
        "generated": date.today().isoformat(),
        "summary_rows": rows,
        "area": "Petaling district, Selangor (City of Elmina lies in it)",
        "year": year,
        "sources": [
            {k: v for k, v in src.items() if k != "file"}
            | {"bytes": (CACHE / src["file"]).stat().st_size}
            for src in SOURCES.values()
        ],
        "petaling": {
            "population": round(total),
            "government_school_pupils": st["pupils"],
            "government_schools": st["schools"],
            "pupils_per_school": {
                k: round(st["pupils"][k] / st["schools"][k])
                for k in ("primary", "secondary")
                if st["schools"].get(k)
            },
        },
        "synthetic": syn,
        "age_bands": age_rows,
        "age_broad": broad,
        "max_band_gap_points": max(abs(r["gap_points"]) for r in age_rows),
        "school_age_per_1000": per_k,
        "band_gaps": {"ages_50_64_points": gap_50_64, "ages_80_plus_points": gap_80},
        "notes": [
            f"The synthetic town has fewer people aged 50-64 ({gap_50_64:+} points) and more aged "
            f"80+ ({gap_80:+} points) than Petaling: its household generator makes parents 26-50 "
            "and adds older grandparents, so there are few older commuters.",
            "Enrolment counts government schools only (MOE EMIS). Dividing it by the age-band "
            "estimate gives roughly 75% (7-12) and 65% (13-17) in government schools; the rest "
            "may be in private, international or religious schools, schooled in another district, "
            "or non-citizens. These are rough ratios, not facts about children.",
            "Petaling is a proxy: it is the wider urban district (Petaling Jaya, Subang Jaya, Shah "
            "Alam), and Elmina is one new township in it, which may be younger.",
            "The generator's inputs (Malaysia-wide age shares, household size, car ownership) are "
            "DOSM figures, so they are not checks; only the Petaling comparison is.",
            f"Years: the district comparison uses {year}, the latest year with enrolment data.",
            "Nothing is fitted to these figures: they measure the gap, and the gap is reported.",
        ],
    }
    dest = dest or ROOT / "data" / "sim" / site.name / "calibration.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {dest}")
    return out


def report(c: dict) -> str:
    """The comparison report (docs/03-product/calibration-report-2026-10.md), from the JSON."""
    rows = "\n".join(
        f"| {r['what']} | {r['synthetic']} | {r['official']} |" for r in c["summary_rows"]
    )
    bands = "\n".join(
        f"| {r['band']} | {r['petaling_pct']}% | {r['synthetic_pct']}% | {r['gap_points']:+} |"
        for r in c["age_bands"]
    )
    src = "\n".join(
        f"| {s['title']} | {s['url']} | {s['bytes']:,} B | {s['licence']} |" for s in c["sources"]
    )
    notes = "\n".join(f"- {n}" for n in c["notes"])
    p, syn = c["petaling"], c["synthetic"]
    pupils, schools = p["government_school_pupils"], p["government_schools"]
    script, data = "`data/scripts/calibrate_day.py`", "`data/sim/elmina/calibration.json`"
    offices = "MOE district offices Petaling Perdana and Petaling Utama"
    cars = round(100 * syn["car_share"], 1)
    return f"""# Comparison report: the synthetic town and Petaling district (official open data)

*{c["generated"]}. Generated by {script} from {data}.*

## Why

Elmina Day rehearses a day of **5,000 synthetic residents**. A judge will ask how we know they
look like Elmina. Elmina's residents are not observed (and their personal data is not wanted),
but City of Elmina lies in **Petaling district, Selangor**, and the government publishes open data
for it. This compares the synthetic town with the district. **Nothing is fitted:** the gap is
measured and reported, here and in the Day panel ("How it was made → Compared with Petaling").

## Sources (CC BY 4.0, cached in `data/cache/opendata/`)

| Dataset | URL | Size | Licence |
|---|---|---|---|
{src}

Petaling, {c["year"]}: **{p["population"]:,} people**; **{pupils["primary"]:,}** primary
and **{pupils["secondary"]:,}** secondary pupils in **{schools["primary"]}** primary and
**{schools["secondary"]}** secondary government schools ({offices}).

## What the comparison found first: a bug

Before Cycle 21, **every child under 13, toddlers included, went on a primary-school run** and was
counted as a pupil: 293 of 674 households with children drove to a primary school with no one
aged 7-12 (Standard 1-6). The storm day reported 1,373 pupils (about 275 per 1,000 residents).
Fixed: a school run only when a child aged 7-12 lives in the home; under-7s ride along only with
a parent who is home. The demo numbers were re-measured.

## The synthetic town and Petaling ({c["year"]})

| What | Synthetic town | Petaling district |
|---|---|---|
{rows}

Inputs, not checks: household size {syn["household_size"]} (input: DOSM Census 2020, 3.8,
Malaysia); households with a car {cars}% (input: DOSM household survey 2024, 92.3%, Malaysia).

### By 5-year age band

| Band | Petaling | Synthetic | Gap (points) |
|---|---|---|---|
{bands}

## How to read it

{notes}

What has no public figure for Elmina (trip timing, workplaces, how residents choose under a
flood) stays a stated assumption in the Day panel: the knobs a pilot would replace with SDP's own
resident data, with consent.

## Reproduce

```bash
uv sync --all-packages --all-groups   # pyarrow is in the data group
uv run python data/scripts/calibrate_day.py
uv run pytest data/scripts/tests/test_calibrate_day.py -q
```
"""


if __name__ == "__main__":
    site = ROOT / "data" / "seed" / (sys.argv[1] if len(sys.argv) > 1 else "elmina")
    res = main(site)
    (ROOT / "docs" / "03-product" / "calibration-report-2026-10.md").write_text(
        report(res), encoding="utf-8"
    )
    print(
        json.dumps(
            {k: res[k] for k in ("age_broad", "max_band_gap_points", "school_age_per_1000")},
            indent=1,
        )
    )
