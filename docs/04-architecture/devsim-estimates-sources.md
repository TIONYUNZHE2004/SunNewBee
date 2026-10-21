# Development Simulation: estimate sources

Every number that the Development Simulation (`devsim_schedule.py`) uses for cost, schedule, holidays and rain comes from a row in this file. A test (AC-C3) reads the first table and compares it with `devsim_schedule.SOURCES`; a figure that is in code but not here fails the build.

**Honesty rules**

- Everything the simulation outputs from these figures is labelled **ESTIMATE**. It is an indicative order of magnitude for a Hypothetical Development, **not an SDP figure, not a quotation, and not a forecast** (ADR 0014).
- `kind` says how far to trust a row:
  - `gazetted`: published by the government for that exact year (public holidays).
  - `benchmark`: a published industry or statistical figure, used as published or with arithmetic shown in the notes.
  - `climatology`: a published long-term weather average.
  - `assumption`: no published source found, or the figure is a labelled modelling choice. The UI must show these as assumptions.
- No figure here was invented to fill a gap. Where nothing was found, the row says so and the value is a conservative, round modelling choice.
- All rows were accessed on 2026-10-21.

## 1. Figures (machine-readable)

`value` is a plain number. Months are 1-12. Days are working days unless the row says otherwise.

| id | figure | value | unit | source title | edition/year | URL | accessed | kind |
|---|---|---|---|---|---|---|---|---|
| cost_usd_per_m2_highrise_condo_kl_low | Kuala Lumpur apartments, high-rise, average standard: construction cost, low end | 330 | USD per m2 CFA | Arcadis Construction Cost Handbook Asia 2025, "Construction costs for selected Asian cities", Kuala Lumpur row (KL data: JUBM Group) | 2025 edition, costs at Q4 2024 | https://media.arcadis.com/-/media/project/arcadiscom/com/perspectives/asia/publications/cch/2025/arcadis-ph-cchb-2025.pdf?rev=14d66007630a4ed4ae27ab7084fd85ca | 2026-10-21 | benchmark |
| cost_usd_per_m2_highrise_condo_kl_high | Same, high end | 655 | USD per m2 CFA | same as above | 2025 edition, costs at Q4 2024 | same as above | 2026-10-21 | benchmark |
| fx_myr_per_usd_arcadis_q4_2024 | Exchange rate Arcadis used (USD1 = RM) | 4.48 | RM per USD | same as above | 2025 edition | same as above | 2026-10-21 | benchmark |
| cost_rm_per_m2_highrise_condo_kv_low | High-rise condominium, Klang Valley, cost per m2 CFA, low (330 x 4.48, rounded) | 1478 | RM per m2 CFA | derived from the two rows above | 2025 edition, Q4 2024 | same as above | 2026-10-21 | benchmark |
| cost_rm_per_m2_highrise_condo_kv_mid | Mid-point of low and high (rounded) | 2206 | RM per m2 CFA | derived from the rows above | 2025 edition, Q4 2024 | same as above | 2026-10-21 | benchmark |
| cost_rm_per_m2_highrise_condo_kv_high | High-rise condominium, cost per m2 CFA, high (655 x 4.48, rounded) | 2934 | RM per m2 CFA | derived from the rows above | 2025 edition, Q4 2024 | same as above | 2026-10-21 | benchmark |
| cost_rm_per_m2_highrise_condo_kl_2022_low | Cross-check: KL apartments high-rise, average standard, total, low | 1335 | RM per m2 CFA | Arcadis Construction Cost Handbook Malaysia 2022, "Construction costs for Kuala Lumpur" | 2022 edition, Q4 2021 | https://media.arcadis.com/-/media/project/arcadiscom/com/perspectives/asia/publications/cch/2022/construction-cost-handbook-my-2022.pdf | 2026-10-21 | benchmark |
| cost_rm_per_m2_highrise_condo_kl_2022_high | Cross-check: same, high | 2670 | RM per m2 CFA | same as above | 2022 edition, Q4 2021 | same as above | 2026-10-21 | benchmark |
| gfa_net_per_home_m2 | Net (sellable) floor area per home. 1,000 sq ft = 92.9 m2; round to 93 | 93 | m2 per home | No published source for this project: modelling input, labelled in the UI as an editable assumption. Context: Arcadis spec for KL average-standard high-rise apartments is 46-83 m2 per unit (2025 edition footnote), so 93 m2 is above that range, i.e. a larger family unit | n/a | https://media.arcadis.com/-/media/project/arcadiscom/com/perspectives/asia/publications/cch/2025/arcadis-ph-cchb-2025.pdf?rev=14d66007630a4ed4ae27ab7084fd85ca | 2026-10-21 | assumption |
| gfa_common_factor | Gross floor area / net area (lobbies, corridors, lifts, stairs, services, balconies). Cost basis is CFA including balconies and lift shafts, so gross is used | 1.3 | ratio | No published source found; industry practice (typical net-to-gross efficiency about 75-80 percent) | n/a | n/a | 2026-10-21 | assumption |
| foundation_months | Site works, piling and pile caps / raft, before the first structural floor | 9 | months | No published Malaysian source found (searched for CIDB and journal case studies; only a low-rise 54-day foundation figure turned up, which does not apply to a tower); industry practice | n/a | n/a | 2026-10-21 | assumption |
| floor_cycle_days | Typical structural floor cycle (working days per storey) | 7 | days per storey | No published Malaysian source found; modelling choice. Practitioner forum posts agree with it (see note "Durations"); a forum thread is not a benchmark | n/a | n/a | 2026-10-21 | assumption |
| fitout_months | Architectural works, finishes and M&E commissioning after topping out | 8 | months | No published Malaysian source found; modelling choice. Practitioner forum posts agree with it (see note "Durations"); a forum thread is not a benchmark | n/a | n/a | 2026-10-21 | assumption |
| working_days_per_week | Site working days per week (Monday to Saturday; Sundays off) | 6 | days | No published source; modelling choice. Malaysian building sites commonly work Saturdays, so a six-day week is used (a five-day week would make the schedule about 15 percent longer) | n/a | n/a | 2026-10-21 | assumption |
| raya_shutdown_working_days | Hari Raya site shutdown beyond the gazetted holidays, applied once (the first Hari Raya during structure work) | 10 | working days | No published source found; industry practice (the spec's example value) | n/a | n/a | 2026-10-21 | assumption |
| monsoon_start_month | Northeast monsoon start (November) | 11 | month | MKN "Fenomena Monsun Timur Laut" (NE monsoon, November to March); MetMalaysia seasonal outlook for 2026/27 expects it from late October to mid-March | 2024 (MKN), 2026 outlook | https://www.mkn.gov.my/web/ms/2024/10/17/fenomena-monsun-timur-laut/ | 2026-10-21 | climatology |
| monsoon_end_month | Northeast monsoon end (March) | 3 | month | same as above | 2024 | https://www.mkn.gov.my/web/ms/2024/10/17/fenomena-monsun-timur-laut/ | 2026-10-21 | climatology |
| monsoon_wet_days_nov | Days with rain of 1.0 mm or more, November, Subang | 18 | days per month | Wikipedia "Seri Kembangan", climate table (Subang Jaya), citing Jabatan Meteorologi Malaysia, Subang station | 1961-2010 normals | https://en.wikipedia.org/wiki/Seri_Kembangan | 2026-10-21 | climatology |
| monsoon_wet_days_dec | December, same definition | 15 | days per month | same as above | 1961-2010 | https://en.wikipedia.org/wiki/Seri_Kembangan | 2026-10-21 | climatology |
| monsoon_wet_days_jan | January, same definition | 11 | days per month | same as above | 1961-2010 | https://en.wikipedia.org/wiki/Seri_Kembangan | 2026-10-21 | climatology |
| monsoon_wet_days_feb | February, same definition | 12 | days per month | same as above | 1961-2010 | https://en.wikipedia.org/wiki/Seri_Kembangan | 2026-10-21 | climatology |
| monsoon_wet_days_mar | March, same definition | 14 | days per month | same as above | 1961-2010 | https://en.wikipedia.org/wiki/Seri_Kembangan | 2026-10-21 | climatology |
| rain_lost_fraction | Fraction of a wet day (1.0 mm or more) that is lost to work | 0.25 | fraction | No published source found; modelling choice. A wet day does not stop all trades (interior works continue), so well under 1 | n/a | n/a | 2026-10-21 | assumption |
| scurve_shape | Cumulative spend curve: symmetric S (3t^2 - 2t^3, a Beta(2,2) CDF). The value is the Beta parameter | 2 | Beta parameter a = b | No published source found; common modelling practice for construction cash flow | n/a | n/a | 2026-10-21 | assumption |

## 2. Selangor public holidays, 2027 to 2030

Status:

- `gazetted`: in the official federal and state schedule from the Cabinet Division, Prime Minister's Department (JPM), "Jadual Hari Kelepasan Am Persekutuan dan Negeri 2027", published 20 Aug 2026: <https://www.kabinet.gov.my/storage/2026/08/HKA_2027.pdf> (page <https://www.kabinet.gov.my/hari-kelepasan-am/>). Islamic dates and Deepavali in that PDF are marked "Tertakluk kepada perubahan" (subject to change); they stay `gazetted` here, with that caveat.
- `expected`: not yet gazetted. 2028 and later come from published calendars. Islamic holidays depend on moon sighting; Thaipusam, Wesak and Deepavali depend on the lunar or Hindu calendar.
- The official PDF's state columns could not be read as text. Which holidays Selangor observes is taken from the federal list, plus the Selangor entries in the calendar sites (Thaipusam, Nuzul Al-Quran, New Year's Day, Sultan of Selangor's birthday). The PDF itself lists "Hari Keputeraan Sultan Selangor, 11 Disember" as a state holiday and Thaipusam and Nuzul Al-Quran as state holidays.
- Federal rule (kabinet.gov.my): a holiday that falls on a state's weekly rest day moves to the next day. Rows marked "replacement" are that rule, taken from the calendar sites, so they are `expected` even in 2027.

Source keys: **JPM27** = the official PDF above. **PH** = <https://publicholidays.com.my/ms/selangor/> (2027 and 2028 only; states its dates are estimates). **KC27** = <https://kalendarcuti.my/kalendar-cuti-umum-selangor-2027/>. **CM28** = <https://calendarmalaysia.com/public-holidays-2028/>, **CM29** = <https://calendarmalaysia.com/public-holidays-2029/>, **CM30** = <https://calendarmalaysia.com/public-holidays-2030/> (all accessed 2026-10-21; they say Islamic dates are tentative until JAKIM announces them).

| date | name | status | source |
|---|---|---|---|
| 2027-01-01 | Tahun Baharu (Fri) | gazetted | JPM27 |
| 2027-01-22 | Thaipusam (Fri) | gazetted | JPM27 |
| 2027-02-06 | Tahun Baharu Cina (Sat) | gazetted | JPM27 |
| 2027-02-07 | Tahun Baharu Cina, day 2 (Sun) | gazetted | JPM27 |
| 2027-02-24 | Nuzul Al-Quran (Wed) | gazetted | JPM27 |
| 2027-03-10 | Hari Raya Aidilfitri (Wed) | gazetted | JPM27 |
| 2027-03-11 | Hari Raya Aidilfitri, day 2 (Thu) | gazetted | JPM27 |
| 2027-05-01 | Hari Pekerja (Sat) | gazetted | JPM27 |
| 2027-05-17 | Hari Raya Haji (Mon) | gazetted | JPM27 |
| 2027-05-20 | Hari Wesak (Thu) | gazetted | JPM27 |
| 2027-06-06 | Awal Muharam (Sun) | gazetted | JPM27 |
| 2027-06-07 | Hari Keputeraan Yang di-Pertuan Agong (Mon) | gazetted | JPM27 |
| 2027-08-15 | Maulidur Rasul (Sun) | gazetted | JPM27 |
| 2027-08-16 | Maulidur Rasul, replacement (Mon) | expected | KC27, PH |
| 2027-08-31 | Hari Kebangsaan (Tue) | gazetted | JPM27 |
| 2027-09-16 | Hari Malaysia (Thu) | gazetted | JPM27 |
| 2027-10-28 | Deepavali (Thu) | gazetted | JPM27 |
| 2027-12-11 | Hari Keputeraan Sultan Selangor (Sat) | gazetted | JPM27 |
| 2027-12-25 | Hari Krismas (Sat) | gazetted | JPM27 |
| 2028-01-01 | Tahun Baharu (Sat) | expected | CM28, PH |
| 2028-01-26 | Tahun Baharu Cina (Wed) | expected | CM28, PH |
| 2028-01-27 | Tahun Baharu Cina, day 2 (Thu) | expected | CM28, PH |
| 2028-02-09 | Thaipusam (Wed) | expected | CM28 (PH and another site give 13 Feb; sources disagree) |
| 2028-02-13 | Nuzul Al-Quran (Sun) | expected | CM28, PH |
| 2028-02-27 | Hari Raya Aidilfitri (Sun) | expected | CM28, PH |
| 2028-02-28 | Hari Raya Aidilfitri, day 2 (Mon) | expected | CM28, PH |
| 2028-05-01 | Hari Pekerja (Mon) | expected | CM28, PH |
| 2028-05-05 | Hari Raya Haji (Fri) | expected | CM28, PH |
| 2028-05-09 | Hari Wesak (Tue) | expected | CM28, PH |
| 2028-05-26 | Awal Muharam (Fri) | expected | CM28 (PH gives 25 May; plus or minus 1 day) |
| 2028-06-05 | Hari Keputeraan Yang di-Pertuan Agong (Mon) | expected | CM28, PH |
| 2028-08-04 | Maulidur Rasul (Fri) | expected | CM28 (PH gives 3 Aug; plus or minus 1 day) |
| 2028-08-31 | Hari Kebangsaan (Thu) | expected | CM28, PH |
| 2028-09-16 | Hari Malaysia (Sat) | expected | CM28, PH |
| 2028-10-17 | Deepavali (Tue) | expected | CM28, PH |
| 2028-12-11 | Hari Keputeraan Sultan Selangor (Mon) | expected | CM28, PH (date fixed each year in the schedule) |
| 2028-12-25 | Hari Krismas (Mon) | expected | CM28, PH |
| 2029-01-01 | Tahun Baharu (Mon) | expected | CM29 |
| 2029-01-30 | Thaipusam (Tue) | expected | CM29 (marked tentative) |
| 2029-02-01 | Nuzul Al-Quran (Thu) | expected | CM29 |
| 2029-02-13 | Tahun Baharu Cina (Tue) | expected | CM29 |
| 2029-02-14 | Tahun Baharu Cina, day 2 (Wed) | expected | CM29 |
| 2029-02-15 | Hari Raya Aidilfitri (Thu) | expected | CM29 |
| 2029-02-16 | Hari Raya Aidilfitri, day 2 (Fri) | expected | CM29 |
| 2029-04-24 | Hari Raya Haji (Tue) | expected | CM29 |
| 2029-05-01 | Hari Pekerja (Tue) | expected | CM29 |
| 2029-05-15 | Awal Muharam (Tue) | expected | CM29 |
| 2029-05-28 | Hari Wesak (Mon) | expected | CM29 (marked tentative; another site gives 27 May) |
| 2029-06-04 | Hari Keputeraan Yang di-Pertuan Agong (Mon) | expected | CM29 |
| 2029-07-24 | Maulidur Rasul (Tue) | expected | CM29 |
| 2029-08-31 | Hari Kebangsaan (Fri) | expected | CM29 |
| 2029-09-16 | Hari Malaysia (Sun) | expected | CM29 |
| 2029-11-05 | Deepavali (Mon) | expected | CM29 (marked tentative; another site gives 4 Nov) |
| 2029-12-11 | Hari Keputeraan Sultan Selangor (Tue) | expected | CM29 |
| 2029-12-25 | Hari Krismas (Tue) | expected | CM29 |
| 2030-01-01 | Tahun Baharu (Tue) | expected | CM30 |
| 2030-01-20 | Thaipusam (Sun) | expected | CM30 (marked tentative) |
| 2030-01-22 | Nuzul Al-Quran (Tue) | expected | CM30 |
| 2030-02-03 | Tahun Baharu Cina (Sun) | expected | CM30 |
| 2030-02-04 | Tahun Baharu Cina, day 2 (Mon) | expected | CM30 |
| 2030-02-05 | Hari Raya Aidilfitri (Tue) | expected | CM30 |
| 2030-02-06 | Hari Raya Aidilfitri, day 2 (Wed) | expected | CM30 |
| 2030-04-14 | Hari Raya Haji (Sun) | expected | CM30 |
| 2030-05-01 | Hari Pekerja (Wed) | expected | CM30 |
| 2030-05-02 | Hari Wesak (Thu) | expected | CM30 (marked tentative) |
| 2030-05-04 | Awal Muharam (Sat) | expected | CM30 |
| 2030-06-03 | Hari Keputeraan Yang di-Pertuan Agong (Mon) | expected | CM30 |
| 2030-07-13 | Maulidur Rasul (Sat) | expected | CM30 |
| 2030-08-31 | Hari Kebangsaan (Sat) | expected | CM30 |
| 2030-09-16 | Hari Malaysia (Mon) | expected | CM30 |
| 2030-10-26 | Deepavali (Sat) | expected | CM30 (marked tentative) |
| 2030-12-11 | Hari Keputeraan Sultan Selangor (Wed) | expected | CM30 |
| 2030-12-25 | Hari Krismas (Wed) | expected | CM30 |

## 3. Notes, ranges and caveats

- **Cost.**
  - Basis: Arcadis 2025 edition, costs at Q4 2024, KL data from JUBM Group. Rate is per m2 of Construction Floor Area (to the outside face of external walls, including lift shafts, stairwells, balconies, plant rooms and water tanks).
  - Spec: 6 to 12 units per floor, 46 to 83 m2 per unit. It excludes air-conditioning, kitchen cabinets and home appliances.
  - The cost includes preliminaries but excludes contingencies, site formation, external works, land, professional fees, finance and legal costs. Basements are not included.
  - The published range is USD 330 to 655 per m2 (the Arcadis 2025 PDF is labelled for the Philippines but carries the full Asia table). The RM figures are our arithmetic at Arcadis's own rate of RM 4.48 per USD: RM 1,478 to RM 2,934, mid-point RM 2,206.
  - The older Malaysia-specific 2022 edition (Q4 2021) gave RM 1,335 to RM 2,670 directly in RM, for the same row. The 2025 RM range is about 11 percent higher at both ends, which is a sensible check.
  - Arcadis did not publish a Malaysia-only 2023 to 2025 edition on its handbook page (the latest listed Malaysia edition was 2022). The 2025 numbers come only from the Asia edition.
  - The simulation should say "excludes land, fees, external works, contingencies" next to the total.
  - No price escalation to 2027 or later is applied. This makes the total conservative-low for a build that starts after 2026.
- **Not found.** JUBM, Rider Levett Bucknall and Langdon & Seah Malaysia cost-handbook tables were not found online. The KL figures are the one published benchmark in this file.
- **Net to gross.** 93 m2 net and a 1.30 gross factor give 120.9 m2 of CFA per home. At the mid rate that is about RM 267,000 per home. It excludes land, fees and contingencies.
- **Durations.**
  - No CIDB or journal case study with Malaysian tower durations was found. Only anecdotal forum posts exist for floor cycle and fit-out. Cycle claims range from 4 days (rare) to 7 days (typical aluminium formwork).
  - Forum note (context only, not a benchmark source): Lowyat.net thread "Construction Progress for High Rise Property", <https://forum.lowyat.net/topic/3998021>, accessed 2026-10-21. Practitioner posts (Jul 2016) say aluminium formwork runs "around 7 days cycle per floor for typical floor" (fastest heard: 6 days on average), and "for architectural works, it normally take around 7 to 8 months from concrete topping up works". `floor_cycle_days` and `fitout_months` therefore stay `assumption`.
  - International studies give 5 to 11 days per floor, with high-rise flat-slab projects around 6. For a 7-day cycle at 6 working days per week, one storey takes about 1.2 calendar weeks.
  - Working week: Monday to Saturday (6 days, `working_days_per_week`), an assumption. Sundays and public holidays that fall on a working day are not worked.
  - Foundation of 9 months is a modelling choice. Treat the schedule as plus or minus 25 percent.
  - Because durations are assumptions, the UI must show the schedule as an ESTIMATE with its assumptions visible.
- **Rain.**
  - The wet-day counts are days with 1.0 mm or more, 1961-2010 normals for Subang Airport, transcribed in Wikipedia from MetMalaysia. The MetMalaysia climate-normals table itself was not reachable online. Other sites give larger counts (for example 25 days in November at a 0.2 mm threshold), so the definition matters.
  - Subang is the nearest long-record station to Elmina (Shah Alam / Petaling district, west coast). The NE monsoon matters less on the west coast than on the east coast, where it dominates.
  - MetMalaysia's seasonal outlook expects the 2026/27 NE monsoon from late October to mid-March, with a strong El Nino through Oct to Dec 2026. That may change one season, but the model uses the long-term normals.
- **Holidays.**
  - 2027 is gazetted (JPM, published 20 Aug 2026). Islamic holidays and Deepavali in that PDF are marked subject to change.
  - 2028 to 2030 are expected dates from calendar sites. These sites disagree by a day or more on some lunar dates (Thaipusam 2028, Wesak 2029, Deepavali 2029). The table records the most-cited date and notes the disagreement.
  - Weekend holidays (Saturday or Sunday) are listed with their weekday. The simulation counts holiday days lost only on working days (Monday to Saturday); a holiday on a Sunday costs nothing. The Aug 2027 replacement row is the only replacement listed.
  - Not Selangor holidays (not listed): Federal Territory Day, Israk and Mikraj, Awal Ramadan, Hari Raya day 3, second day of Hari Raya Haji, other states' rulers' birthdays.
  - 2029 and 2030 lists do not use an official Selangor schedule, so the Selangor Sultan's birthday (11 Dec) is carried from the pattern in 2027 and 2028.
- **S-curve.** The shape is a modelling choice. Spend per month is the difference of the cumulative curve, so it is monotonic by construction.
