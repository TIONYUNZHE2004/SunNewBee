# Business Case: TownshipLens

> Researched 14 Oct 2026; updated 15 Oct 2026 for the Township World Model platform (lenses `access`, `flood`, `waste`; [ADR 0009](../00-overview/decisions/0009-township-world-model-platform.md)). Figures labelled "estimate" are team assumptions for discussion, not quotes. Items labelled "hypothesis" are value claims we still have to validate with SDP and ops people. Sources numbered [B1]... at the bottom; flood and 3D facts link to the research docs.

## TL;DR

- **Who pays:** primarily **SDP as developer and township operator**, funded from placemaking/community-experience and sales-and-marketing budgets, with the **mall owner** (SDP-owned Elmina Lakeside Mall) as the first paying "site" and later **JMBs/MCs and residents' associations** as per-site subscribers. Residents use it free.
- **Why SDP would pay:** it makes SDP's accessibility and placemaking investment visible and verifiable, supports the SSR2030 Community Experience pillar ("accessible and welcoming to all segments of society") and the 2025 annual report's own call for age-inclusive design [B1][B2]; and it gives ops teams a prioritised list of data gaps.
- **Cost to pilot is small** (estimate: under RM15,000 cash for 4 to 8 weeks, mostly LLM/API and a few hundred ringgit of 3D/tiles; student labour is free). Scaling cost is dominated by *field verification time per site*, not software.
- **Scale path:** one facility (Elmina Urban Park) then Elmina's other public nodes, then Bandar Bukit Raja and Serenia City, then SDP's ~27 townships and developments [B2]. A **site template** (spatial graph + verification checklist + ops dashboard) is the reusable unit.
- **Value multiplication:** one verified world model of the township serves **three lenses today** (accessibility, flood what-if, recycling) and more later, so each fix and each data-collection hour pays off several times. Also sales-gallery visitor wayfinding, event and facility booking handoff, emergency/closure information, ops dashboards, and a defensible data asset (a verified township model) that competitors' apps do not have.
- **Flood lens value (hypotheses):** township ops can rehearse "what if the river rises?" and pre-position; residents get a route-aware, honest answer; the scenario runs and resident-agent results are material for climate-resilience and ESG reporting and for conversations with insurers. See § 3a.
- **Roadmap lens:** site screening (e.g. for SDP's data-centre business under SHIFT32) on the same model. Not built; a commercial slide only.
- **KPIs for the pilot:** answer correctness, unsupported-claim rate, time-to-find entrance, share of answers with an explicit uncertainty label, gaps found and closed, staff minutes per verification.

---

## 1. The problem in business terms

- SDP is investing in inclusive design (UNICEF inclusive playground, wheelchair-friendly ground-floor suites, age-inclusive guidance) [B2][B3], but residents cannot easily discover what exists, and public accessibility data in Malaysia is sparse (our OSM check found 0 mapped entrances and 0 toilets in the Urban Park deep-spot bbox, and 0 entrances and only 4 toilets across the whole Elmina envelope).
- Malaysia is ageing (65+ share 8.4% in 2026; 12 states already "ageing") and 805,509 people were registered as persons with disabilities in 2024 (DOSM; see [key-numbers](key-numbers.md)). Selangor has the most JKM-registered OKU of any state (128,401 at Jan 2024) [B5]. Families with strollers and older residents face the same barriers.
- Budget 2027 earmarks at least RM3.24bn for seniors, OKU and Orang Asli support and prioritises AI adoption, so inclusion and AI are policy-aligned [B6][B7].
- SDP's resident-facing digital product is the SDP App for buyers and owners (construction, payments, defects, handover), which is not about the physical place [B2][B8].

## 2. Customers and payers

| Payer | Motivation | Willingness-to-pay logic | Evidence/risk |
|---|---|---|---|
| **SDP (township/placemaking and marketing teams)** | Differentiate townships, support SSR2030 Community Experience, reduce repeated enquiries | Pilot funded as an innovation or placemaking line; SDP already runs an Innovation Hub piloting solutions [B3] | SHIFT32 focuses on recurring income and industrial assets, so frame as sales differentiation and asset value protection, not a new product line [B9][B10] |
| **Mall owner (Elmina Lakeside Mall is wholly SDP-owned)** | Footfall, tenant experience, ESG signalling; the mall is in SDP's recurring-income segment [B10][B11] | Internal transfer or modest annual fee per mall | Mall opened Aug 2024 with 180,000 visitors in week one [B11] |
| **JMBs / MCs / residents' associations** | Reduce management complaints, show inclusivity | Per-site subscription competing with i-Neighbour-type tools | Fee collection is weak in many schemes (310 Selangor schemes had no JMB/MC in Aug 2026) [B12]; sell as low-cost add-on, not stand-alone |
| **Local councils (MBSA, MBDK)** | Compliance narrative, public-space accessibility | Possible grant or co-pilot | SDP-led inclusive playground was approved by Shah Alam City Council under Universal Design [B13]; enforcement of access audits is weak, so a council-friendly "audit support" angle exists (unverified demand) |
| **SDP township operations / safety lead (flood lens)** | Plan for heavy rain, brief the team, communicate with residents | Funded from township-operations or risk/resilience budgets (hypothesis; the real owner of flood response at SDP vs MBSA is **unverified**, see [flood-disaster-lens § 6](../02-research/flood-disaster-lens.md)) | Needs SDP comms approval for publishing scenarios; the persona is validated in the feedback session |
| **Insurers / lenders / ESG reporting teams** (indirect) | Evidence of climate-resilience planning for a township | Possible partner or data-sharing value (hypothesis, **no demand evidence yet**) | Our indicative HAND scenarios are not certified flood-risk maps; never position them as insurance-grade |
| **Residents and visitors** | Free | Free at point of use | Keeps adoption high |

## 3. Value proposition and "value multiplication"

1. **Resident utility:** answers "which entrance, which path, which toilet", with evidence and uncertainty.
2. **Ops utility:** a dashboard of unanswered questions, recurring queries, stale attributes and correction requests; maps to the original "knowledge-gap loop" differentiator.
3. **Sales utility:** buyers visiting the Elmina Sales Gallery (3.18032, 101.50823, OSM) can ask the assistant about accessibility and amenities around a unit; supports SDP's age-inclusive messaging.
4. **Events and facility booking:** extend the same graph to event routes and temporary closures (for example, festival at the park); hand off to booking platforms such as i-Neighbour for halls and courts [B14].
5. **Emergency and closure information:** published closures only; no live safety guarantees in MVP.
6. **Data asset:** a verified, dated accessibility graph per township, reusable for council reports, CSR/ESG disclosures and future digital-twin work. SDP's annual report already speaks of an "AI-ready enterprise data platform", so the graph can plug in [B2].
7. **ESG evidence:** contributes measurable social-impact metrics (inclusive access) for SDP's sustainability reporting under the Community Experience pillar [B1].

### 3a. Flood lens value in business terms (hypotheses to validate)

| Value | For whom | How we would show it | Caveat |
|---|---|---|---|
| **Pre-positioning and briefing:** which roads, gates and halls get cut at river +N m, which clusters become islands | Township ops / safety lead | Flood briefing for `stage_p1m` … `stage_p5m`; time to produce a briefing vs today (ask ops) | Indicative HAND scenarios on a 30 m model, not a forecast; sharpen with SDP LiDAR and drainage data ([ADR 0010](../00-overview/decisions/0010-flood-lens-hand-scenarios.md)) |
| **Resident communication:** a hedged, editable BM/EN/中文 draft notice | Ops, community team | Advisory draft (never auto-sent) | Official warnings stay with JPS, MET Malaysia, NADMA and MBSA |
| **Inclusive emergency planning:** can every profile (wheelchair, stroller, older adult, car) reach a centre? | Residents, ops, council | Resident-agent result per scenario `<X>%` (measured) | Centres are `osm_candidate` unless an official PPS list says otherwise |
| **ESG / climate-resilience reporting:** a documented, repeatable scenario process and the verification trail | SDP sustainability team | Scenario provenance (DEM, method, margin, version) stored per run | Supporting evidence only; not a compliance certificate |
| **Insurer and lender conversations** | SDP finance / risk | A neutral, transparent scenario method as a starting point | No claims about premiums or risk reduction; **no evidence of demand yet** |
| **Sales and community trust** | Sales/marketing | Honest, evidence-based flood information for buyers and residents | SDP may be sensitive about publishing flood extents for its own estate: comms review required ([flood-disaster-lens § 6, § 9](../02-research/flood-disaster-lens.md)) |

### 3b. Value multiplication across lenses

| Shared asset | Lens 1 `access` | Lens 2 `flood` | Lens 3 `waste` | Future lens |
|---|---|---|---|---|
| Base twin (buildings, terrain, roads and paths, waterways) | step-free routing | water and cut-off analysis | map layer | site screening (e.g. data centres) |
| Verified claims + verification-request loop | entrance and slope facts | unknown kerb ramps on evacuation routes | "collection day unknown, ask MBSA" | planning constraints |
| Routing engine | stroller / wheelchair / rest | same engine with `scenario_id` and `drive` | n/a | access and logistics checks |
| AI assistant + validator | grounded route answers | grounded scenario answers with disclaimer | grounded drop-off answers | grounded screening answers |
| Resident agents | journey tests | evacuation journey tests | n/a | n/a |
| Management console | VR queue, KPIs | flood briefing, advisory draft | point upkeep | screening reports |

The pitch point: the second lens cost weeks, not months, because the model, engine, assistant and loop already existed; the third (waste) cost days. A **data-centre / site-screening lens** is the natural next step for SDP's SHIFT32 strategy (DC1 at Elmina Business Park completed March 2026 per [sdp-context](../01-hackathon/sdp-context.md)); it needs its own data (power, fibre, planning rules), so it stays a roadmap item and needs an ADR before any work.

## 4. Cost model (estimates)

| Item | Pilot (4 to 8 weeks) | Per additional site (steady state) | Notes |
|---|---|---|---|
| LLM/API usage | RM200 to RM1,500 | RM100 to RM500/month | Depends on traffic; use small model for routing and larger for explanation |
| Hosting (web app, DB) | RM0 to RM300 | RM100 to RM300/month | Free tiers for pilot |
| 3D/tiles | RM0 to RM500 | RM0 to RM500/month | Google tiles reported at $6 per 1,000 root requests for first 100,000, with free tier of 1,000 (check current) [B15]; Cesium OSM Buildings is the fallback if fees or quality are a problem; see policy limits [B16]; Mapbox lite view has a free tier (see [ADR 0007](../00-overview/decisions/0007-3d-engine-cesium.md)) |
| Flood pipeline (DEM, HAND, scenarios) | RM0 (open Copernicus GLO-30, ASF HAND CC0; runs offline on a laptop) | RM0 to low hundreds per township (compute and storage) | Real costs are SDP data access and ops time; a hydraulic model (SFINCS) with LiDAR is a pilot-phase cost, not estimated here |
| Field verification labour | 3 visits x 3 students (unpaid) | 2 to 4 staff-days per site per quarter | Main recurring cost; use SDP township staff plus volunteers |
| Staff dashboard training and ops time | 2 hours onboarding | 1 to 2 hours/week | Each correction ideally under 10 minutes |
| Compliance (PDPA, privacy notice, DPO contact) | Minimal; no personal data by design | Light | PDPA amendments in force: DPO, breach notification, portability since 1 Jun 2025 [B17] |
| Photography/consent | Minimal | Low | Blur people; avoid sensitive data |
| **Indicative total** | **under RM15,000** (incl. buffer) | **RM500 to RM2,000/month per site plus verification time** (estimate) | Compare: Mappedin Pro quoted at $165 per map per month in one buyer's guide [B18] |

## 5. Revenue and funding options (post-hackathon)
- **Internal SDP budget** (pilot to rollout): placemaking/marketing/innovation.
- **Per-site licence** to SDP townships, malls and later third-party developers: tiered by number of mapped nodes.
- **Grants and CSR:** UNICEF-style partnerships, Yayasan/CSR, government digital or inclusion programmes (Budget 2027 digital and OKU allocations [B6][B7]; eligibility unverified).
- **Data partnerships:** contribute verified attributes to OSM/Wheelmap (open-data goodwill; check ODbL obligations).

## 6. KPIs

| Layer | KPI | Target for pilot (to be set with mentors) |
|---|---|---|
| Answer quality | Route and answer correctness vs field truth | At least 90% on test set (estimate) |
| Trust | Unsupported-claim rate | Under 2% of answers |
| Transparency | Share of answers with evidence + date or explicit "unknown" | 100% |
| Usability | Time to find correct entrance vs map+FAQ baseline | At least 30% faster (hypothesis) |
| Understanding | Users who correctly describe the uncertainty label | At least 80% |
| Ops loop | Gaps raised, gaps closed, median time to close | Close 70% of high-priority gaps within 7 days |
| Ops effort | Staff minutes per verification | Under 10 |
| Adoption | Unique users, repeat users, questions per session | Measure only; no personal data |
| Impact | Resident-reported confidence in visiting the site | Pre/post survey, consent-based |
| Flood: honesty | Scenario answers carrying the disclaimer; forbidden wording ("safe", forecast) | 100%; 0 |
| Flood: planning use | Ops people who say the briefing changes what they would pre-position; scenario fit against Oct 2024 / Apr 2025 evidence, if shared | Qualitative (feedback session, n = 1–2); report mismatches |
| Flood: inclusion | Share of residential clusters that can reach a candidate centre, per profile and scenario | Measured (`<X>%`), reported as-is |
| Business | Enquiries deflected, sales-gallery use, mall dwell time | Exploratory |

## 7. Pilot plan (4 to 8 weeks at Elmina Urban Park + Lakeside Mall frontage)

Site: bbox 3.1775, 101.5055, 3.1835, 101.5135 (see `docs/02-research/site-selection.md`).

| Week | Activities | Output |
|---|---|---|
| 0 | Agree scope, permission and contacts with SDP township office and mall management; privacy notice; consent forms | Signed-off scope |
| 1 | Reconnaissance visit; baseline map-and-FAQ test with 5 users; draft spatial graph from OSM | Graph v0, baseline results |
| 2 | Systematic survey (entrances, steps, kerbs, ramps, toilets, seating, shelter), photo evidence with dates | Verified graph v1, evidence store |
| 3 | Assistant + 3D/2D explorer + staff correction UI; resident-agent test cases; flood scenarios and management briefing | Internal alpha |
| 4 | Resident and staff testing (n about 10 to 15, including older adults, stroller users, a wheelchair user, OKU organisations); log gaps | Test report |
| 5 to 6 | Staff verify gaps; update graph; repeat tasks | Gap-closure metrics |
| 7 to 8 | Soft public link (QR at park signage), measure usage; handover pack for ops | Pilot report with KPIs; recommendation to expand |

**Lens 2 pilot add-on (4–8 weeks, with SDP/MBSA):** obtain LiDAR/survey and drainage GIS, the official PPS list and flood photos (Oct 2024, Apr 2025); recompute HAND at finer resolution; compare scenarios with real events; run the flood briefing with the ops team; decide whether a hydraulic model (SFINCS) is justified.

**Go/no-go criteria:** correctness and unsupported-claim thresholds met; disclaimer on 100% of scenario answers; staff say the update workflow is sustainable; SDP comms approves the flood wording; no privacy incidents.

## 8. Scale path across SDP

1. **Pilot site** (Elmina Urban Park + mall frontage).
2. **Elmina cluster:** the whole of City of Elmina is already modelled from open data; add deep verified spots (Rainforest Knowledge Centre, Central Park precincts, Elmina Business Park amenities).
3. **Other signature townships:** Bandar Bukit Raja (Wetland Townpark, community hall), Serenia City, Nilai Impian lake park [B2].
4. **Mature townships:** Bukit Jelutong, Ara Damansara, Putra Heights/USJ (SDP's role there is lower; confirm; unverified).
5. **Productise:** reusable township template (open-data base twin + lens overlays), survey app, ops dashboard, training; per-site onboarding in 2 to 3 weeks (estimate).
5b. **More lenses on the same model:** events, maintenance, and site screening (data centres, tied to SHIFT32). Each needs an ADR and must not delay the two deep lenses.
6. **Beyond SDP:** other developers, councils, hospitals, universities (the DCU and Ondokuz Mayis precedents show demand for campus-scale versions) [B19].

SDP's portfolio: 27 townships and integrated/signature developments, ~12,950 acres landbank, new launches of RM3.6bn GDV in 2025 [B2]. Each new launch can ship with a TownshipLens site template at handover.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Wrong answer causes a trip failure or injury | Never certify; show verified date; explicit unknowns; disclaimers; no safety guarantees; human override path |
| Data goes stale | Expiry per attribute; staleness flags to ops; resident "report a problem" button |
| Staff do not use the dashboard | Make corrections under 10 minutes; weekly digest; assign owner in township office |
| Policy change (AI Governance Bill tabling forecast Nov-Dec 2026) | Risk-based, low-risk information service; log decisions; transparent design aligned to AIGE principles [B20][B21] |
| Google 3D terms | Use tiles only as visual backdrop; own geometry from OSM and survey [B16] |
| Privacy | No personal data by default; anonymous logs; follow PDPA [B17] |
| Mismatch with SDP priorities (industrial, data centres) | Frame around placemaking, sales differentiation and ESG; low cost |
| Over-reliance on simulated agents | Present them as test tools; test with real residents |
| **Flood misinformation:** false reassurance ("not flooded" read as "safe") or panic | Always "indicative scenario, not a forecast"; never "safe"; official MBSA/JPS/NADMA links; disclaimer enforced by the validator; SDP comms review; advisory drafts never auto-sent |
| **30 m DEM and datum limits** | Three classes with a margin; no centimetre depths; datum offset calibrated; plan for LiDAR + SFINCS in the pilot |
| **Breadth:** too many lenses dilute quality | Two deep lenses + one thin; others roadmap behind an ADR |
| Flood framing hurts SDP's estate image | Frame as resident safety and neighbours; agree wording with SDP comms before publishing |

---

## Sources

- [B1] SDP Sustainability Report 2025: https://www.simedarbyproperty.com/sites/default/files/2026-04/SDP%20SR2025%20%28Website%29.pdf
- [B2] SDP Integrated Annual Report 2025: https://www.simedarbyproperty.com/sites/default/files/2026-04/SDP%20IAR2025%20%28Website%29.pdf
- [B3] Business Today, UNICEF inclusive playground: https://www.businesstoday.com.my/2022/03/02/sime-darby-property-launches-malaysias-first-inclusive-playground-in-partnership-with-unicef/
- [B4] DOSM population estimates 2026: https://www.dosm.gov.my/uploads/release-content/file_20260730111244.pdf
- [B5] OKU registered with JKM (31 Jan 2024): https://ova.galencentre.org/756681-persons-with-disabilities-oku-registered-with-jkm-as-of-january-31-2024/
- [B6] The Sun, Budget 2027 seniors/OKU: https://thesun.my/news/budget-2027-rm3-24b-seniors-oku-orang-asli-support/
- [B7] The Star, Digital Ministry Budget 2027: https://www.thestar.com.my/news/nation/2026/10/11/digital-ministry-pushes-ai-nation-goal-under-budget-2027
- [B8] App Store, SDP App: https://apps.apple.com/us/app/id6474657954
- [B9] EdgeProp, SHIFT32: https://api.edgeprop.my/content/1915464/sime-darby-property-hits-record-rm8034m-pbt-shift32-strategy-begins-kwap-raises-stake
- [B10] EdgeProp, recurring income push (Aug 2026): https://www.edgeprop.my/content/1917245/sime-darby-property%E2%80%99s-recurring-income-push-gains-traction
- [B11] EdgeProp, Lakeside Mall opening week: https://www.edgeprop.my/content/1910344/elmina-lakeside-mall-attracts-over-180000-during-opening-week
- [B12] The Star, 310 Selangor strata schemes without JMB/MC: https://www.thestar.com.my/metro/metro-news/2026/08/12/310-selangor-strata-schemes-still-without-jmb-or-mc
- [B13] Business Today (as B3) for council approval; UBBL/MS 1184 discussion: https://ejournal.um.edu.my/index.php/jdbe/article/download/10143/7189/20342
- [B14] TimeTec i-Neighbour: https://www.i-neighbour.com/feature/Oct2024/
- [B15] Google Map Tiles billing: https://developers.google.com/maps/documentation/tile/usage-and-billing
- [B16] Map Tiles API policies: https://developers.google.com/maps/documentation/tile/policies
- [B17] Baker McKenzie, PDPA 2024 amendments: https://insightplus.bakermckenzie.com/bm/data-technology/malaysia-personal-data-protection-amendment-act-2024-to-come-into-force
- [B18] Mappedin pricing mention in buyer's guide: https://www.guideflow.com/blog/indoor-mapping-software
- [B19] DCU: https://www.dcu.ie/dts/news/2025/oct/ai-powered-campus-way-finding ; Ondokuz Mayis: https://www.omu.edu.tr/en/node/20569
- [B20] Baker McKenzie, AI Governance Bill consultation: https://www.bakermckenzie.com/en/insight/publications/2026/07/malaysia-public-consultation-on-the-ai-governance-bill
- [B21] Malaysia.gov.my, AIGE: https://www.malaysia.gov.my/en/my-initiative/whole-government-digital-services/tadbir-urus/national-guidelines-on-artificial-intelligence-governance-and-ethics-aige
