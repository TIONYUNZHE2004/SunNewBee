# Key Numbers (single source for the proposal and deck)

> **Only use numbers from this page** in the proposal, deck and Q&A. Each has a source and a date. Add new numbers here first, with the source. Our own measured results go in [evaluation-plan § 5](../03-product/evaluation-plan.md) and are copied here when final.
> Checked 14 Oct 2026 by the research tracks. Items marked ⚠️ have caveats; read them before quoting.

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

## Technology and cost

| Number | Source |
|---|---|
| LLM cost about **USD 0.0006 per turn** on Claude Haiku 5.5 (≈ USD 0.60 per 1,000 questions); about USD 0.012 per turn on Sonnet 5.5 | Anthropic pricing page, 14 Oct 2026 ([ai-assistant-research § 1.4](../02-research/ai-assistant-research.md)) |
| Google Photorealistic 3D Tiles: 1,000 free billable events/month, then USD 6 per 1,000; one root-tile request ≈ a 3-hour session | Google Maps Platform pricing/usage pages ([3d-data-and-rendering](../02-research/3d-data-and-rendering.md)) |
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
| Unsupported claims on golden set | _ | |
| Correct route-status decisions | _ | |
| Journeys confirmed before → after one verification round | _ → _ | |
| Seeded faults detected | _ / _ | |
| Staff minutes per gap fixed | _ | |
| User study: correct entrance (TL vs baseline) | _ vs _ | |
