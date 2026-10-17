# Calibration report: the synthetic town against official open data

*2026-10-17, branch `ai/world-model-2`. Built by `data/scripts/calibrate_day.py`; numbers from `data/sim/elmina/calibration.json`.*

## Why

Elmina Day rehearses a day of **5,000 synthetic residents**. The obvious question from a judge is:
"how do you know they behave like Elmina?" We cannot observe Elmina's residents (and would not
want their personal data), but City of Elmina lies in **Petaling district, Selangor**, and the
government publishes open data for it. This report measures how far the synthetic town is from
the district. **Nothing is fitted to these figures:** they measure the gap, and the gap is
reported, here and in the Day panel ("How it was made → Checked against Petaling district").

## Sources (all CC BY 4.0, fetched once into `data/cache/opendata/`)

| Dataset | Publisher | File | Size |
|---|---|---|---|
| Population by district, sex, age group and ethnicity | DOSM (`population_district`) | https://storage.dosm.gov.my/population/population_district.parquet | 264,746 B |
| Enrolment in government schools by district | MOE EMIS via data.gov.my (`enrolment_school_district`, Selangor only) | https://api.data.gov.my/data-catalogue?id=enrolment_school_district&ifilter=selangor@state&limit=5000 | 103,456 B |
| Number of government schools by district | data.gov.my (`schools_district`, Selangor only) | https://api.data.gov.my/data-catalogue?id=schools_district&ifilter=selangor@state&limit=5000 | 36,693 B |

Petaling, 2025: **2,370,700 people**; **147,974** primary and
**101,560** secondary pupils in **150** primary and
**77** secondary government schools (the two MOE district offices, Petaling Perdana and Petaling Utama).

## What calibration found, first: a bug

Before this cycle, **every child under 13, toddlers included, went on a primary-school run** and
was counted as a pupil: 293 of 674 households with children drove to a primary school although
no one in them was of primary-school age (7-12, Standard 1-6). The storm day reported
**1,373 pupils**, about 275 per 1,000 residents, against **105** government-school pupils per
1,000 in Petaling. Fixed: a school run happens only when a child aged 7-12 lives in the home
(younger siblings still ride along, and are not counted). The storm day now has **818 pupils**.
Every number in the demo script was re-measured after the fix.

## The synthetic town against Petaling (2025)

| What | Synthetic town | Petaling district |
|---|---|---|
| Ages 0-14 | 23.3% | 19.1% |
| Ages 15-64 | 67.4% | 71.8% |
| Ages 65+ | 9.2% | 9.0% |
| Children aged 7-12 per 1,000 residents | 92.0 | about 82.8 (from 5-year age bands) |
| Teenagers aged 13-17 per 1,000 residents | 72.4 | about 66.2 (from 5-year age bands) |
| Government-school pupils per 1,000 residents (primary / secondary) | every school-age resident goes to a mapped school | 62.4 / 42.8 |
| Household size | 3.77 people | 3.8 (DOSM Census 2020, Malaysia; no district figure used) |
| Households with a car | 91.5% | 92.3% (DOSM household survey 2024, Malaysia) |

### By 5-year age band

| Band | Petaling | Synthetic | Gap (points) |
|---|---|---|---|
| 0-4 | 5.3% | 7.9% | +2.6 |
| 5-9 | 7.0% | 7.6% | +0.6 |
| 10-14 | 6.8% | 7.8% | +1.0 |
| 15-19 | 6.5% | 6.6% | +0.1 |
| 20-24 | 8.3% | 7.8% | -0.5 |
| 25-29 | 8.2% | 13.0% | +4.8 |
| 30-34 | 8.2% | 8.4% | +0.2 |
| 35-39 | 9.7% | 8.5% | -1.2 |
| 40-44 | 9.1% | 8.8% | -0.3 |
| 45-49 | 6.9% | 9.1% | +2.2 |
| 50-54 | 5.9% | 3.5% | -2.4 |
| 55-59 | 4.9% | 0.9% | -4.0 |
| 60-64 | 4.1% | 0.8% | -3.3 |
| 65-69 | 3.3% | 2.2% | -1.1 |
| 70-74 | 2.6% | 1.9% | -0.7 |
| 75-79 | 1.8% | 1.8% | +0.0 |
| 80-84 | 0.8% | 2.0% | +1.2 |
| 85+ | 0.5% | 1.3% | +0.8 |

Largest gap: **4.8 points**.

## How to read it

- **Ages.** The synthetic town is younger than Petaling: more children (0-14: 23.3% vs 19.1%) and
  more adults aged 25-29, because the household generator makes every family with children have
  parents aged 26-50. That is plausible for a new township of young families, but it is an
  assumption, not data: Elmina's own age profile is not published.
- **School-age children.** About 10% more per 1,000 than the district (92 vs about 83 aged 7-12;
  72 vs about 66 aged 13-17). The district's government-school pupils are fewer again (62 and 43
  per 1,000) because private and international schools and non-citizens are outside MOE's
  government enrolment: about 75% of 7-12s and 65% of 13-17s in Petaling are in government
  schools. In the rehearsal every school-age resident goes to a mapped school nearby (government
  or private), so school-run counts are an upper bound for government schools.
- **What this does not show.** Trip timing, where people work, and how residents choose under a
  flood have no public figure for Elmina. They stay stated assumptions (listed in the Day panel),
  the knobs a pilot would replace with SDP's own resident data, with consent.

## Reproduce

```bash
uv sync --all-packages --all-groups   # pyarrow is in the data group
uv run python data/scripts/calibrate_day.py
uv run pytest data/scripts/tests/test_calibrate_day.py -q
```
