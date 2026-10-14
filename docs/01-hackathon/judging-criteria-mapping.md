# Judging Criteria → Our Evidence

> For each official criterion: what judges want, what we claim, the **evidence** that backs it, and **where** it appears (proposal, demo, deck). Use this as the checklist for the proposal review on Thu 22 Oct and the final review on Sun 8 Nov.
> Weights are from the [hackathon brief](hackathon-brief.md).
> Updated 15 Oct 2026 for the Township World Model platform ([ADR 0009](../00-overview/decisions/0009-township-world-model-platform.md)): one 3D world model of City of Elmina, lenses `access` (deep), `flood` (deep), `waste` (thin). **Track: People** (flood is framed as resident safety and getting around in emergencies). The main new risk is looking too broad; our answer is "one model, two deep lenses, everything else labelled thin or roadmap".

## Summary scorecard (self-assessment; update after each milestone)

| Criterion | Weight | Our strongest card | Biggest gap today | Self-score (1–5) |
|---|---|---|---|---|
| Strategic Fit & Theme | 15% | Hits People sub-themes (accessibility, safety & security, getting around, community wellbeing); township is SDP's product | SDP-specific numbers; showing flood is People, not Planet | 4 |
| **Impact & Sustainability** | **25%** | Measurable before→after gap closure; inclusive by design; resident safety planning with management | No user data yet; no flood validation data | 2 → target 4 |
| Innovation & Differentiation | 20% | One verified world model, many lenses; tri-state facts; closed gap loop; honest flood scenarios; agents as testers | Need a crisp competitor matrix incl. Flood Hub | 4 |
| Feasibility & Deliverability | 20% | Open data for the whole of Elmina, deterministic engines, browser app, near-zero cost | **Breadth** (two deep lenses + 3D in 4 weeks), Cesium/Google tile quality over Elmina, 30 m DEM | 3 → target 4 |
| Commercial & Value Multiplication | 10% | Same model reused by 3 lenses (+ data-centre siting as a roadmap lens); ops, ESG and insurer value | Pricing and who pays | 3 → target 4 |
| Team, Evidence & Pitch | 10% | Research depth (this KB), live demo, eval numbers, management feedback | Rehearsal, user study | 3 → target 4 |

---

## 1. Strategic Fit & Theme Relevance (15%)

**Judges want:** clear alignment with People or Planet, and with SDP's township priorities.

| Claim | Evidence | Where shown |
|---|---|---|
| Directly answers the People question ("every resident … healthier, safer, more connected") | Explicit mapping to sub-themes 3 (accessibility & inclusion), 4 (getting around), 5 (digital living), 1 (community wellbeing) and the safety & security theme via the flood lens (resident safety: can everyone still get to a centre?) | Proposal §1, deck slide 2 |
| The flood lens is People (resident safety), not a climate-modelling project | Framed around residents' routes, neighbours and evacuation centres; we never forecast. Planet's climate resilience is a side benefit | Proposal §2, deck slide 6 |
| Fits SDP's business: facilities and community spaces are what SDP builds and manages | SDP township and facility context: [sdp-context.md](sdp-context.md) | Proposal §1 |
| Built for an actual SDP township, not a generic city | Whole City of Elmina in 3D; deep spots chosen in [site-selection](../02-research/site-selection.md); local flood story in [flood-disaster-lens § 1](../02-research/flood-disaster-lens.md) | Proposal §3, demo |
| Fits SDP's strategy beyond residential | Same model could later screen sites for the data-centre business (SHIFT32; DC1 at Elmina Business Park, per [sdp-context](sdp-context.md)): roadmap slide only | Deck slide 13 |
| Supports SDP's sustainability/ESG and inclusivity messaging | Quote SDP's own commitments (from sdp-context) | Deck "why SDP" slide |

**Tactics:** do not oversell flood as "Elmina is at risk"; say the recent floods were in the downstream neighbours and Elmina residents are affected via roads. Use SDP's own vocabulary (from their reports); name the real facility; open with a resident story set in that township.

## 2. Impact & Sustainability Value (25%), the biggest weight

**Judges want:** *measurable* benefits for residents, communities (and the environment).

| Claim | Evidence (measured) | Where |
|---|---|---|
| Residents find the right entrance faster and more reliably | User study: success rate + time, TL vs map+FAQ ([evaluation-plan § 4](../03-product/evaluation-plan.md)) | Deck "results" slide |
| Residents understand what's verified vs not | Uncertainty-comprehension score from the study | Deck "results" |
| The information base improves over time | Persona journeys confirmed **before → after** one verification round | Demo J5/J6 + deck |
| Staff effort is small | Minutes per gap fixed (timed on the field visit) | Deck |
| Reach | Malaysian OKU, 60+ and young-family statistics (cited, from [accessibility-and-routing § 2](../02-research/accessibility-and-routing.md)) | Proposal §2 |
| Residents and managers can plan for emergencies | Flood what-if: cut-off list, islands, reachable centres per profile; resident-agent result "<X>% of residential clusters can reach a candidate centre at `stage_p3m` for `wheelchair`" (measured, [evaluation-plan § 5](../03-product/evaluation-plan.md)) | Demo + results slide |
| Management finds it useful and honestly worded | Feedback session with 1–2 township/ops people (n = 1–2, reported as such) | Deck "results" slide |
| Sustainability / climate resilience (secondary) | Shade/covered-path preference; closures for flood-damaged walkways; supports climate-resilience reporting; encourages walking over driving between facilities | One line in the deck, not more |
| Sustainable operation (does it last?) | Freshness TTLs + demand-ranked VR queue = maintenance built in | Architecture slide |

**Tactics:** every impact claim gets a number from our own test, or a clearly labelled *target* for the pilot. **No unmeasured superlatives.**

## 3. Innovation & Differentiation (20%)

**Judges want:** originality and a clear improvement over existing solutions.

| Our innovation | Why it's different | Evidence |
|---|---|---|
| **Tri-state, provenance-tracked accessibility facts** (yes / no / unknown + who/when/evidence) | Maps and apps hide unknowns or show unsourced "accessible" icons | [competitors](../02-research/competitors.md) matrix; ADR 0004 |
| **Closed knowledge-gap loop** (question → VR ranked by demand × impact → staff fix → better answers) | Others are static maps, or chatbots over documents | Demo J5 |
| **Agents as testers, not role-play** (constraint profiles + LLM-generated test questions + seeded-fault detection) | Avoids the documented bias of LLM disability personas; novel in the township context | [resident-agent-simulation](../02-research/resident-agent-simulation.md); seeded-fault result |
| **AI for language, algorithms for geometry**, plus a server-side validator | Addresses known LLM spatial-reasoning failures (MapEval, *Lost in Aggregation* 2026) | Eval: 0 unsupported claims |
| **One verified world model, many lenses** (access, flood, waste; more later) | Same paths, levels and facilities serve daily accessibility *and* emergency planning, so one fix improves every lens | Demo (gap loop across lenses) |
| **Honest flood what-if**: HAND scenarios with three classes where unknown is never passable, always "indicative, not a forecast" | Flood tools show water or forecasts at river-point level; none we found gives route-aware, uncertainty-honest "who is cut off" for a township ([flood-disaster-lens § 7](../02-research/flood-disaster-lens.md)) | Demo, competitor matrix |
| **Agents as testers also under flood** ("can every profile reach a centre under scenario X?") | Automatic evacuation checks, not role-play | Eval result |
| **Swappable 3D layer** over open standards (OGC 3D Tiles, OpenSidewalks) | Not locked into one capture method | 3D pipeline doc |

**Tactics:** add one flood comparison row (Google Flood Hub, JPS InfoBanjir: live and authoritative but no scenario routing). Show one competitor screenshot side by side (e.g. a generic map pin vs our entrance-level route with "not checked yet"). Name the 2026 research to show we're current ([trends-2026](../02-research/trends-2026.md)).

## 4. Feasibility & Deliverability (20%)

**Judges want:** practical to implement and **pilot inside an SDP township**.

| Claim | Evidence | Where |
|---|---|---|
| It works today | Deployed URL + demo video (by the proposal date) | Proposal link, demo |
| Scope is buildable: two deep lenses on one shared model | The flood lens reuses the routing engine and the claims model; method = precomputed HAND scenarios on an open DEM ([ADR 0010](../00-overview/decisions/0010-flood-lens-hand-scenarios.md)), a 4-week split in [flood-disaster-lens § 8.6](../02-research/flood-disaster-lens.md); waste is a thin 20–40-point layer | Deck slide 9 |
| Honest about technical limits | 30 m DEM, vertical error under 4 m: three classes + margin, no per-path depths; datum offset calibrated once; Google tile quality over Elmina checked by a Day-1 spike with a fallback chain | Risk register, [risks](../06-pitch/risks.md) |
| Low barrier to adoption | Browser-based, no install, no resident accounts; 3D hero with lite 2.5D and list view always available | Demo on a phone |
| Cheap to run | LLM about USD 1 per 1,000 questions on a small model; free-tier hosting at pilot scale | [business-case](../06-pitch/business-case.md) |
| Repeatable onboarding | Field-verification protocol; hours to onboard our site (measured) | [field-verification-guide](../03-product/field-verification-guide.md) |
| Responsible and compliant | PDPA-aware design; tile licence respected (no heights or extents derived from Google tiles); no people in photos; advisory drafts never auto-sent; official sources always linked | AI design §9; 3D pipeline iron rule |
| Clear pilot plan | 4–8 week pilot in Elmina with KPIs: Lens 1 at one facility, Lens 2 as an ops planning tool using SDP/MBSA data | Business case, final deck |

## 5. Commercial & Value Multiplication (10%)

| Claim | Evidence |
|---|---|
| Value to SDP: fewer repeated enquiries, better facility utilisation, an inclusivity/ESG proof point, a sales-gallery and new-launch differentiator, and a flood-preparedness planning tool for township ops | [business-case](../06-pitch/business-case.md) |
| Scales per facility across SDP's townships (same software, repeat data onboarding) | Onboarding time per facility (measured) × number of facilities |
| Multiplies into other uses: the same model serves three lenses today (access, flood, waste); events wayfinding, maintenance tickets, ops dashboards; **data-centre site screening as a future lens tied to SHIFT32** (roadmap, not built) | Business case "value multiplication" |
| Flood lens value: ops pre-positioning, insurer and ESG climate-resilience conversations | Business case § flood lens (hypotheses to validate, no figures claimed) |
| Data asset: verified accessibility data reusable for planning and MS 1184 audits | Business case |

## 6. Team, Evidence & Pitch Quality (10%)

| Claim | Evidence |
|---|---|
| Rigorous research | This knowledge base; reference library of papers and repos |
| Validated with real users | User study results (small sample, reported honestly) + management feedback session (1–2 people) |
| Working prototype | Live demo + recorded backup |
| Balanced team | BE / FE / AI lanes, each presenting their Enabler part; flood lens split across all three lanes ([flood-disaster-lens § 8.6](../02-research/flood-disaster-lens.md)) |
| Clear pitch | [pitch-narrative](../06-pitch/pitch-narrative.md); [demo-script](../03-product/demo-script.md); 5+ rehearsals |

---

## Required pitch structure → where covered

| Required part | Content | Slides |
|---|---|---|
| **Mechanism**: what it is, how it works, who benefits, why it creates value | Resident story → answer with evidence → gap loop → value to residents and SDP | Narrative slides 1–6 |
| **Enabler**: how technology enables it, UX, township-scale implementation | World model + deterministic routing and flood scenarios + grounded LLM + resident-agent testing + 3D (CesiumJS + Google tiles, with lite and list fallbacks); scale per township and per lens | Narrative slides 7–11 |
