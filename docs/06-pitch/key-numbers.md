# Key Numbers (single source for the proposal and deck)

> **Only use numbers from this page** in the proposal, deck and Q&A. Each has a source and a date. Add new numbers here first, with the source. Our own measured results go in [evaluation-plan § 5](../03-product/evaluation-plan.md) and are copied here when final.
> Checked 14 Oct 2026 by the research tracks; flood, whole-Elmina and waste sections added 15 Oct 2026 from [flood-disaster-lens](../02-research/flood-disaster-lens.md) and [township-3d-engine-and-data](../02-research/township-3d-engine-and-data.md). Every number below appears in those docs with its source; do not add numbers that don't. Items marked ⚠️ have caveats; read them before quoting.
> The section "Measured on the committed Elmina seed" holds our own measured product numbers (15 Oct 2026, from [data/README](../../data/README.md), [overnight-log](../superpowers/overnight-log.md) and the [screenshots](screenshots/README.md)); it is separate from the research and open-data counts, which come from different queries and are not interchangeable with it.

## Who needs this (Malaysia)

| Number | Say it as | Source |
|---|---|---|
| **805,509** registered persons with disabilities in 2024 (2.4% of population) | "Over 800,000 Malaysians are registered OKU" | DOSM, *Persons with Disability Statistics Malaysia 2024* (released 11 Dec 2025): <https://v2.dosm.gov.my/portal-main/release-content/person-with-disability-statistics-malaysia-2024> |
| ⚠️ 756,681 OKU registered with JKM at 31 Jan 2024 (Selangor highest: 128,401) | Use only for the Selangor figure | Dewan Negara reply via Galen Centre: <https://ova.galencentre.org/756681-persons-with-disabilities-oku-registered-with-jkm-as-of-january-31-2024/>. *Different date and register from the DOSM figure, so don't mix the two in one sentence.* |
| ~**4.1 million** people aged 60+ (≈12%) in 2025; 13.3% by 2030; 15.1% by 2036 | "About one in eight Malaysians is 60+, rising to ~15% by the mid-2030s" | Ministerial figures via Malay Mail (26 Aug 2025): <https://www.malaymail.com/news/malaysia/2025/08/26/second-finance-minister-says-malaysia-to-be-aged-nation-by-2048-govt-planning-blueprint-as-births-fall-lifespans-rise/188944> |
| 65+ share **8.4%** in 2026; population 34.4 m | Use if a 65+ cut is needed | DOSM Current Population Estimates 2026: `reference/papers/context/DOSM_Current-Population-Estimates-2026.pdf` |
| ⚠️ "Aged nation" (65+ ≥ 14%) projected around **2048** | **Do not say "aged nation by 2030"** | Same Malay Mail source; see [accessibility-and-routing § 2](../02-research/accessibility-and-routing.md) |
| **2.31 million** children under five (2025) | "2.3 million under-fives, so a lot of strollers" | DOSM Children Statistics 2025 via Galen Centre: <https://ova.galencentre.org/dosm-live-births-under-5-deaths-vaccination-coverage-for-infants-decreased-in-2024/> |
| ⚠️ No measured Malaysian stroller-barrier statistic exists | Use on-site photos instead | [accessibility-and-routing § 2](../02-research/accessibility-and-routing.md) |

## SDP

| Number | Source |
|---|---|
| FY2025: sales RM4.2 bn, PBT RM803.4 m; ~12,950 acres of landbank; **27** active townships and developments | SDP IAR 2025 + FY2025 results release (see [sdp-context](../01-hackathon/sdp-context.md) [S1][S2]) |
| 1H2026 PBT +59.5% to RM635.6 m | EdgeProp (26 Aug 2026), [sdp-context](../01-hackathon/sdp-context.md) [S4] |
| SSR2030 *Community Experience* pillar: "Inclusivity & Social Equity: ensuring our developments are accessible and welcoming to all segments of society" | SDP sustainability page / SR2025 ([S7]) |
| Malaysia's first inclusive playground (with UNICEF), City of Elmina, March 2022, Universal Design + MS 1184 | Business Today ([S8]); toolkit in `reference/papers/context/` |
| Elmina Lakeside Mall opened Aug 2024; 180,000+ visitors in opening week | EdgeProp, via [site-selection](../02-research/site-selection.md) [L2] |

## Our site (Elmina Urban Park + Lakeside Mall frontage)

| Number | Source |
|---|---|
| OSM in bbox: **54 footways, 58 buildings; 28 footways tagged `wheelchair=yes` with no width/incline/source; 0 entrances, 0 kerbs, 0 toilets, 1 bench** | Live Overpass query, 14 Oct 2026 ([site-selection § 4](../02-research/site-selection.md)). Re-run before the final pitch. |

## Measured on the committed Elmina seed (15 Oct 2026)

> Measured by us on `data/seed/elmina` as committed on 15 Oct 2026; re-measure after any seed rebuild (the area-places snap, Task 43, is done: 7 places have no walk node; re-measured 15 Oct 2026 after the rebuild). Sources: [data/README](../../data/README.md) (Task 31 and flood sections), [overnight-log](../superpowers/overnight-log.md), and the screenshots. Say "indicative, not a forecast" with every flood number. Never quote a flood number as a depth.

| Number | Say it as | Source (measured 15 Oct 2026) |
|---|---|---|
| **16,148** walk segments (909 are `major_road`, 86.7 km); **231** places (72 evacuation candidates) | "A mapped network of 16,000+ paths" | data/README import and Task 31 |
| **74** walk-network components; the largest holds **95.2%** of nodes (11,188 of 11,752). Before major roads: 199 components, 32% | "Most of Elmina is one connected walking network" | data/README Task 31 |
| **16,148 of 16,148** paths not yet checked for wheelchair travel; **18** of them rest on demo values, not yet surveyed | "Nothing is fully checked yet, and we show it" | Screenshot 04 (wheelchair profile). The count is per profile and moves with the data: earlier builds read 16,137 and 16,131 |
| **0** major-road segments with a `sidewalk` claim | "We don't know if the main roads have pavements, and we say so" | data/README Task 31 |
| Stroller, from Lakeside Mall to the 72 centres, baseline: **68** partly unverified, **4** no data (was 23 / 49 before major roads). Wheelchair reachable: **68** at baseline, **47** at +3 m (+3 m: 21 blocked, 4 no data) | "Reachable, but never 'confirmed' without sidewalk data" | Measured 15 Oct 2026 with `flood.centres_reachability` on the seed; data/README Task 31 and Task 43 |
| **From the management briefing** (default profile, from Lakeside Mall, demo start point): centres reachable (confirmed) **25** at normal river level, **3** at +3 m | Quote only with the profile and the start point | Screenshot 03. Differs from the stroller/wheelchair line above because the profile differs |
| Journey tests (100 tasks per profile; stroller, wheelchair and older-adult results identical): **40** no data, **60** success with unknowns, none confirmed; **60** older-adult rest-gap advisories | "Every journey that finds a route is 'partly unverified' at best, so far" | `sim.run_suite` on the seed, re-run 15 Oct 2026 (about 33 s); same counts as the Task 31 table |
| **Evacuation journeys** (50 sampled origins per profile, seed 47, of 116 eligible origins; `sim.run_evacuation`, measured 15 Oct 2026, about 58 s). Default profile, baseline / +1 m / +3 m / +5 m: **confirmed** 41 / 39 / 38 / 33, **partly unverified** 6 / 7 / 7 / 12, **blocked by flood** 0 / 1 / 2 / 2, **no mapped connection (data gap)** 3 in every stage. Stroller, wheelchair and older-adult (identical): partly unverified 47 / 46 / 45 / 45, blocked by flood 0 / 1 / 2 / 2, no mapped connection 3; none confirmed. No invariant violations | "Most sampled starting points can still reach a candidate centre, but only the default profile ever gets a fully checked path, and 3 of 50 starts have no mapped connection at all" | Indicative scenarios, not forecasts. Re-measure after any seed or code change |
| Hero route `park-b → playground`: **confirmed, 440.6 m** (placeholder facts); at +1 m and +3 m **partly unverified, 485.7 m** | "A confirmed route until the water reaches the lake path" | data/README (facts are `team_survey_placeholder`, not surveyed) |
| Stroller route Car Park B → Elmina Lakeside Mall: **partly unverified, 445.9 m**, 7 unchecked items | The demo answer (screenshot 01) | `data/demo` replay entry (the answer shown in screenshot 01) |

### Flood scenarios on the seed (REM, indicative, not a forecast)

| Scenario | Water km² | `likely_flooded` paths | `possible` paths | `likely_flooded` places |
|---|---|---|---|---|
| River +1 m | 3.24 | 445 | 345 | 15 |
| River +2 m | 6.15 | 790 | 563 | 18 |
| River +3 m | 10.25 | 1,353 | 396 | 23 |
| River +4 m | 14.95 | 1,749 | 719 | 29 |
| River +5 m | 19.06 | 2,468 | 567 | 35 |

Share of the 16,148 paths `likely_flooded`: +1 m 2.8%, +3 m 8.4%, +5 m 15.3%. At +3 m the briefing lists **29** places affected (screenshot 03). Coverage limits: 61 paths and 3 places lie outside the elevation window and read "unlikely", and 209 paths are only partly covered ([data/README](../../data/README.md)). Method: REM over mapped OSM drainage (ADR 0010 amendment); HAND, which flagged 39% of segments at +1 m, was dropped.

### Test suite state (15 Oct 2026, checklist on `e9657c5`)
pytest 641 (+1 expected failure), golden 13/13 on the mock, vitest 317, e2e 13/13, lint, gen, typecheck and build passing. These are test results, not user or model-quality measurements.

## Whole of City of Elmina: what open data gives us

Envelope bbox (S, W, N, E) `3.150, 101.460, 3.240, 101.530`, about 10.0 km x 7.8 km (about 78 km2). ⚠️ It is roughly 3–4x the township's land area and includes parts of neighbouring estates, so **counts are upper bounds until we clip to a polygon**. OSM counts from Overpass, 14 Oct 2026 ([township-3d-engine-and-data § 2.2](../02-research/township-3d-engine-and-data.md)); Overpass was overloaded, so re-run before the final pitch.

| Number | Say it as | Source |
|---|---|---|
| **6,901** OSM buildings in the envelope (3,085 in the Elmina East core) | "Thousands of buildings already mapped" | [township-3d-engine-and-data § 2.2](../02-research/township-3d-engine-and-data.md) |
| **22,369** Overture buildings (3.2x OSM), **0** with a height, 670 (3.0%) with floors | "Footprints are plentiful; heights are not, so 3D buildings come from the photoreal mesh" | Overture release 2026-09-23.1, queried 14 Oct 2026 ([§ 2.3](../02-research/township-3d-engine-and-data.md)) |
| **1,161** footways, **249** paths, **20** pedestrian ways, **3** steps | "The walking network exists" | § 2.2 |
| **684** primary/secondary/tertiary/trunk/motorway ways, **2,406** residential, **1,806** service | "A full township road graph for the `drive` profile" | § 2.2 |
| **214** ways/nodes with any `wheelchair=*` tag (almost all footways; none checked for incline or width) | "Wheelchair labels exist but nobody checked them" | § 2.2 |
| **0** `entrance=*`, **1** `barrier=kerb`, **4** `amenity=toilets`, **6** benches | "Zero mapped entrances: this is the gap we close" | § 2.2 |
| **0** `amenity=recycling`, **5** `waste_basket` | "No recycling points mapped in Elmina" | § 2.2 |
| **26** river, **43** drain, **41** ditch, **13** stream ways; **83** `natural=water` | "Rich hydrology, under-mapped drains (our judgement)" | § 2.2 |
| **7** `community_centre` elements (4 distinct names); **27** schools, **43** places of worship, **98** bus stops | "Candidate evacuation centres exist in the data; official status is set per event" | § 2.2 |
| 8,871 Overture road/path segments in the envelope | Use only if a transport count is needed | § 2.3 |

## Flood and local facts (Lens 2)

> **Use the framing in [ADR 0010](../00-overview/decisions/0010-flood-lens-hand-scenarios.md):** Elmina's core is not low-lying; documented floods are in the downstream neighbours. Never say "Elmina floods".

| Number / fact | Say it as | Source |
|---|---|---|
| Elmina elevation sample (SRTM, 10 x 10 grid): min **19 m**, median **38 m**, max **107 m**; Lakeside Mall about **45 m**; Sungai Subang about **20–34 m** | "The built-up core sits well above the river" | [flood-disaster-lens § 2.1](../02-research/flood-disaster-lens.md) (OpenTopoData SRTM30, ran 14–15 Oct 2026) |
| **4 Oct 2024** flash flood at Paya Jaras (Kampung Kubu Gajah): relief centres Dewan MBSA Seri Pagi (**101** people), Dewan Kenanga Petaling land office (**265**), Dewan MBSA Matahari (**48**) | "Relief centres opened next door in October 2024" | RTM, via [flood-disaster-lens § 1.3 [F8]](../02-research/flood-disaster-lens.md) |
| 16 Apr 2024: water **0.3–0.6 m** at Subang / Sungai Buloh incl. Kampung Kubu Gajah | ⚠️ secondary summary (Malay Mail returned 403 to us); say "reported" | § 1.3 [F7] |
| Apr 2025: about **100 families** affected at Kampung Kubu Gajah | ⚠️ secondary summary; say "reported" | § 1.3 [F7] |
| Dec 2021 Klang Valley floods: **321** personnel deployed to evacuate Taman Sri Muda (about **4,400** houses) | Context only: Taman Sri Muda is roughly 20 km away (our estimate, unverified) and is not an analogue of Elmina's terrain. **No report found naming Elmina as flooded in Dec 2021** (unverified absence) | § 1.2 [F1] |
| SDP says Central Park was designed as a temporary flood basin (Q1000) | ⚠️ developer-sourced and uncorroborated; say "SDP says" | The Edge Malaysia Weekly, 25 Nov–1 Dec 2024, § 1.5 [F4] |
| OSM: **3** features named "flood retention pond", **1** pumping station, **48** embankments (local flood-relevant bbox) | ⚠️ crowd-mapped; capacities unknown | § 1.5 / § 2.3 (ran 14–15 Oct 2026) |
| Copernicus GLO-30: **30 m** surface model, free with attribution; vertical error of order **1–4 m** vs flood depths of 0.15–0.5 m | "Too coarse for per-path depths, so we use three classes and a margin" | § TL;DR and § 2.1 [F18][F19] |
| ASF global HAND raster: **CC0**, built from GLO-30 | ⚠️ Tried first and **dropped** (too dense a channel network: flagged 39% of segments at +1 m); kept only as a comparison. Our scenarios use REM over OSM drainage | [F20]; data/README |
| Our scenarios: `stage_p1m` … `stage_p5m` (river stage +1 to +5 m, indicative); margin **0.5 m** in the built seed (planning default was 0.5–1.0 m) | "Engineering defaults, versioned and shown to users" | [ADR 0010](../00-overview/decisions/0010-flood-lens-hand-scenarios.md) |
| Depth thresholds: wheelchair/stroller FAIL above about **0.05–0.10 m**; pedestrian FAIL above **0.30 m**; car about **0.30 m** | ⚠️ wheelchair/stroller values are **our engineering default with no published source**; pedestrian bands follow UK FD2320-style danger bands | § 5.1 [F37][F38][F40] |
| MET Malaysia warnings are available via `api.data.gov.my` | Optional live banner | § 2.4 [F16] |
| JPS InfoBanjir: **no documented public API** found (~1,500 stations) | "We don't scrape it; permission needed" | § 2.4 [F15] |
| Google tiles: heights/elevations may not be recorded from them | "All heights come from the DEM" | § 2.2 [F12][F13] |

## SDP and the roadmap lens

| Number / fact | Source |
|---|---|
| DC1 hyperscale data centre at Elmina Business Park completed **March 2026**; RM**2.6 bn** sukuk programme for data centres and logistics set up **July 2026** (SHIFT32 context). Roadmap-lens motivation only: we have not built a siting tool | [sdp-context](../01-hackathon/sdp-context.md) [S4][S22] |

## Recycling / waste (Lens 3, thin)

| Number / fact | Source |
|---|---|
| Plan: **20–40** hand-curated waste points (5 OSM waste baskets + surveyed bins + 3–8 nearby recycling/e-waste points + SDP programme sites) | [township-3d-engine-and-data § 3](../02-research/township-3d-engine-and-data.md) |
| MBSA door-to-door recycling programme (from 22 May 2023) covers Seksyen 31, 32, 33 and Alam Budiman: **Elmina is not covered** | ibid. |
| Zero Waste Malaysia map lists 1,764 recycling places and 545 e-waste points nationally (613 in Selangor), updated 8 Oct 2026 | ⚠️ no licence or API stated: reference only, **do not scrape** or quote as our data |

## Technology and cost

| Number | Source |
|---|---|
| LLM cost about **USD 0.0006 per turn** on Claude Haiku 5.5 (≈ USD 0.60 per 1,000 questions); about USD 0.012 per turn on Sonnet 5.5 | Anthropic pricing page, 14 Oct 2026 ([ai-assistant-research § 1.4](../02-research/ai-assistant-research.md)) |
| Google Photorealistic 3D Tiles: 1,000 free billable events/month, then USD 6 per 1,000; one root-tile request ≈ a 3-hour session | Google Maps Platform pricing/usage pages ([3d-data-and-rendering](../02-research/3d-data-and-rendering.md); [ADR 0007](../00-overview/decisions/0007-3d-engine-cesium.md)) |
| Mapbox GL JS (lite view): 50,000 free loads per month | [ADR 0007](../00-overview/decisions/0007-3d-engine-cesium.md) consequences |
| ⚠️ Google tile quality over Elmina: **unverified** (no evidence found); a Day-1 spike decides | [township-3d-engine-and-data § 2.4](../02-research/township-3d-engine-and-data.md) |
| LLM spatial-reasoning failures: MapEval (2025), TurnBack (2025), GraphArena (2024/25), *Lost in Aggregation* (2026) | `reference/papers/ai/` |

## Policy

| Fact | Source |
|---|---|
| PDPA amendments in force: processor duties and cross-border changes from 1 Apr 2025; DPO, breach notification and portability from 1 Jun 2025 | Baker McKenzie ([sdp-context](../01-hackathon/sdp-context.md) [S18]) |
| ⚠️ Budget 2027 (tabled 9 Oct 2026): ≥ RM3.24 bn for seniors, OKU and Orang Asli | Single news source (theSun, [S15]). Verify against the official speech before quoting |
| MS 1184:2014 (Amd. 1:2017) is the universal-design code; the PwD Act 2008 has no penalty for non-compliance | [accessibility-and-routing § 2](../02-research/accessibility-and-routing.md) |

## Our measured results (fill in from evals; never estimate)

| Metric | Value | Run / session |
|---|---|---|
| Golden set (mock assistant): questions passing | 13 / 13 | 15 Oct 2026, `e9657c5`; mock only, so not a live-model unsupported-claim rate (that stays _) |
| Correct route-status decisions | _ | |
| Journeys confirmed before → after one verification round | _ → _ | not run (console shows "No run yet"). The Task 31 baseline has none confirmed: see the measured section |
| Flood answers with disclaimer present / with forbidden wording | _ / _ · _ / _ | |
| Residential clusters reaching a candidate centre at `stage_p3m` (by profile) | _ % | |
| Flood engine agreement (answers vs engine) | _ / _ | |
| Seeded faults detected | _ / _ | |
| Staff minutes per gap fixed | _ | |
| User study: correct entrance (TL vs baseline) | _ vs _ | |
