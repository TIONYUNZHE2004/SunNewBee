# Business Case: TownshipLens

> Researched 14 Oct 2026. Figures labelled "estimate" are team assumptions for discussion, not quotes. Sources numbered [B1]... at the bottom.

## TL;DR

- **Who pays:** primarily **SDP as developer and township operator**, funded from placemaking/community-experience and sales-and-marketing budgets, with the **mall owner** (SDP-owned Elmina Lakeside Mall) as the first paying "site" and later **JMBs/MCs and residents' associations** as per-site subscribers. Residents use it free.
- **Why SDP would pay:** it makes SDP's accessibility and placemaking investment visible and verifiable, supports the SSR2030 Community Experience pillar ("accessible and welcoming to all segments of society") and the 2025 annual report's own call for age-inclusive design [B1][B2]; and it gives ops teams a prioritised list of data gaps.
- **Cost to pilot is small** (estimate: under RM15,000 cash for 4 to 8 weeks, mostly LLM/API and a few hundred ringgit of 3D/tiles; student labour is free). Scaling cost is dominated by *field verification time per site*, not software.
- **Scale path:** one facility (Elmina Urban Park) then Elmina's other public nodes, then Bandar Bukit Raja and Serenia City, then SDP's ~27 townships and developments [B2]. A **site template** (spatial graph + verification checklist + ops dashboard) is the reusable unit.
- **Value multiplication:** sales-gallery visitor wayfinding, event and facility booking handoff, emergency/closure information, ops dashboards, and a defensible data asset (verified accessibility graph) that competitors' apps do not have.
- **KPIs for the pilot:** answer correctness, unsupported-claim rate, time-to-find entrance, share of answers with an explicit uncertainty label, gaps found and closed, staff minutes per verification.

---

## 1. The problem in business terms

- SDP is investing in inclusive design (UNICEF inclusive playground, wheelchair-friendly ground-floor suites, age-inclusive guidance) [B2][B3], but residents cannot easily discover what exists, and public accessibility data in Malaysia is sparse (our OSM check at Elmina found 0 mapped entrances and 0 toilets in the pilot bbox).
- Malaysia is ageing (65+ share 8.4% in 2026; 12 states already "ageing") and 756,681 people were registered as OKU with JKM at Jan 2024 (Selangor highest at 128,401) [B4][B5]. Families with strollers and older residents face the same barriers.
- Budget 2027 earmarks at least RM3.24bn for seniors, OKU and Orang Asli support and prioritises AI adoption, so inclusion and AI are policy-aligned [B6][B7].
- SDP's resident-facing digital product is the SDP App for buyers and owners (construction, payments, defects, handover), which is not about the physical place [B2][B8].

## 2. Customers and payers

| Payer | Motivation | Willingness-to-pay logic | Evidence/risk |
|---|---|---|---|
| **SDP (township/placemaking and marketing teams)** | Differentiate townships, support SSR2030 Community Experience, reduce repeated enquiries | Pilot funded as an innovation or placemaking line; SDP already runs an Innovation Hub piloting solutions [B3] | SHIFT32 focuses on recurring income and industrial assets, so frame as sales differentiation and asset value protection, not a new product line [B9][B10] |
| **Mall owner (Elmina Lakeside Mall is wholly SDP-owned)** | Footfall, tenant experience, ESG signalling; the mall is in SDP's recurring-income segment [B10][B11] | Internal transfer or modest annual fee per mall | Mall opened Aug 2024 with 180,000 visitors in week one [B11] |
| **JMBs / MCs / residents' associations** | Reduce management complaints, show inclusivity | Per-site subscription competing with i-Neighbour-type tools | Fee collection is weak in many schemes (310 Selangor schemes had no JMB/MC in Aug 2026) [B12]; sell as low-cost add-on, not stand-alone |
| **Local councils (MBSA, MBDK)** | Compliance narrative, public-space accessibility | Possible grant or co-pilot | SDP-led inclusive playground was approved by Shah Alam City Council under Universal Design [B13]; enforcement of access audits is weak, so a council-friendly "audit support" angle exists (unverified demand) |
| **Residents and visitors** | Free | Free at point of use | Keeps adoption high |

## 3. Value proposition and "value multiplication"

1. **Resident utility:** answers "which entrance, which path, which toilet", with evidence and uncertainty.
2. **Ops utility:** a dashboard of unanswered questions, recurring queries, stale attributes and correction requests; maps to the original "knowledge-gap loop" differentiator.
3. **Sales utility:** buyers visiting the Elmina Sales Gallery (3.18032, 101.50823, OSM) can ask the assistant about accessibility and amenities around a unit; supports SDP's age-inclusive messaging.
4. **Events and facility booking:** extend the same graph to event routes and temporary closures (for example, festival at the park); hand off to booking platforms such as i-Neighbour for halls and courts [B14].
5. **Emergency and closure information:** published closures only; no live safety guarantees in MVP.
6. **Data asset:** a verified, dated accessibility graph per township, reusable for council reports, CSR/ESG disclosures and future digital-twin work. SDP's annual report already speaks of an "AI-ready enterprise data platform", so the graph can plug in [B2].
7. **ESG evidence:** contributes measurable social-impact metrics (inclusive access) for SDP's sustainability reporting under the Community Experience pillar [B1].

## 4. Cost model (estimates)

| Item | Pilot (4 to 8 weeks) | Per additional site (steady state) | Notes |
|---|---|---|---|
| LLM/API usage | RM200 to RM1,500 | RM100 to RM500/month | Depends on traffic; use small model for routing and larger for explanation |
| Hosting (web app, DB) | RM0 to RM300 | RM100 to RM300/month | Free tiers for pilot |
| 3D/tiles | RM0 to RM500 | RM0 to RM500/month | Google tiles reported at $6 per 1,000 root requests for first 100,000, with free tier of 1,000 (check current) [B15]; prefer OSM-extruded 3D to avoid fees; see policy limits [B16] |
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
| Business | Enquiries deflected, sales-gallery use, mall dwell time | Exploratory |

## 7. Pilot plan (4 to 8 weeks at Elmina Urban Park + Lakeside Mall frontage)

Site: bbox 3.1775, 101.5055, 3.1835, 101.5135 (see `docs/02-research/site-selection.md`).

| Week | Activities | Output |
|---|---|---|
| 0 | Agree scope, permission and contacts with SDP township office and mall management; privacy notice; consent forms | Signed-off scope |
| 1 | Reconnaissance visit; baseline map-and-FAQ test with 5 users; draft spatial graph from OSM | Graph v0, baseline results |
| 2 | Systematic survey (entrances, steps, kerbs, ramps, toilets, seating, shelter), photo evidence with dates | Verified graph v1, evidence store |
| 3 | Assistant + 3D/2D explorer + staff correction UI; resident-agent test cases | Internal alpha |
| 4 | Resident and staff testing (n about 10 to 15, including older adults, stroller users, a wheelchair user, OKU organisations); log gaps | Test report |
| 5 to 6 | Staff verify gaps; update graph; repeat tasks | Gap-closure metrics |
| 7 to 8 | Soft public link (QR at park signage), measure usage; handover pack for ops | Pilot report with KPIs; recommendation to expand |

**Go/no-go criteria:** correctness and unsupported-claim thresholds met; staff say the update workflow is sustainable; no privacy incidents.

## 8. Scale path across SDP

1. **Pilot site** (Elmina Urban Park + mall frontage).
2. **Elmina cluster:** Rainforest Knowledge Centre, Central Park precincts, Elmina Business Park amenities.
3. **Other signature townships:** Bandar Bukit Raja (Wetland Townpark, community hall), Serenia City, Nilai Impian lake park [B2].
4. **Mature townships:** Bukit Jelutong, Ara Damansara, Putra Heights/USJ (SDP's role there is lower; confirm; unverified).
5. **Productise:** reusable site template, survey app, ops dashboard, training; per-site onboarding in 2 to 3 weeks (estimate).
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
