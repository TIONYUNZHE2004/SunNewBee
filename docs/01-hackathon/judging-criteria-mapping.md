# Judging Criteria → Our Evidence

> For each official criterion: what judges want, what we claim, the **evidence** that backs it, and **where** it appears (proposal, demo, deck). Use this as the checklist for the proposal review on Thu 22 Oct and the final review on Sun 8 Nov.
> Weights are from the [hackathon brief](hackathon-brief.md).

## Summary scorecard (self-assessment; update after each milestone)

| Criterion | Weight | Our strongest card | Biggest gap today | Self-score (1–5) |
|---|---|---|---|---|
| Strategic Fit & Theme | 15% | Hits 4 People sub-themes; township facilities are SDP's product | SDP-specific numbers and site detail | 4 |
| **Impact & Sustainability** | **25%** | Measurable before→after gap closure; inclusive by design | No user data yet | 2 → target 4 |
| Innovation & Differentiation | 20% | Verified tri-state world model + closed gap loop + agents as testers | Need a crisp competitor matrix | 4 |
| Feasibility & Deliverability | 20% | Existing 3D data, open schema, browser app, near-zero cost; working spike | Site access and data permission | 3 → target 4 |
| Commercial & Value Multiplication | 10% | Per-facility onboarding scales across ~20+ townships | Pricing and who pays | 3 |
| Team, Evidence & Pitch | 10% | Research depth (this KB), live demo, eval numbers | Rehearsal, user study | 3 → target 4 |

---

## 1. Strategic Fit & Theme Relevance (15%)

**Judges want:** clear alignment with People or Planet, and with SDP's township priorities.

| Claim | Evidence | Where shown |
|---|---|---|
| Directly answers the People question ("every resident … healthier, safer, more connected") | Explicit mapping to sub-themes 3 (accessibility & inclusion), 4 (getting around), 5 (digital living) and 1 (community wellbeing) | Proposal §1, deck slide 2 |
| Fits SDP's business: facilities and community spaces are what SDP builds and manages | SDP township and facility context: [sdp-context.md](sdp-context.md) | Proposal §1 |
| Built for an actual SDP site, not a generic city | Site choice + map/3D screenshots: [site-selection](../02-research/site-selection.md) | Proposal §3, demo |
| Supports SDP's sustainability/ESG and inclusivity messaging | Quote SDP's own commitments (from sdp-context) | Deck "why SDP" slide |

**Tactics:** use SDP's own vocabulary (from their reports); name the real facility; open with a resident story set in that township.

## 2. Impact & Sustainability Value (25%), the biggest weight

**Judges want:** *measurable* benefits for residents, communities (and the environment).

| Claim | Evidence (measured) | Where |
|---|---|---|
| Residents find the right entrance faster and more reliably | User study: success rate + time, TL vs map+FAQ ([evaluation-plan § 4](../03-product/evaluation-plan.md)) | Deck "results" slide |
| Residents understand what's verified vs not | Uncertainty-comprehension score from the study | Deck "results" |
| The information base improves over time | Persona journeys confirmed **before → after** one verification round | Demo J5/J6 + deck |
| Staff effort is small | Minutes per gap fixed (timed on the field visit) | Deck |
| Reach | Malaysian OKU, 60+ and young-family statistics (cited, from [accessibility-and-routing § 2](../02-research/accessibility-and-routing.md)) | Proposal §2 |
| Sustainability (secondary) | Shade/covered-path preference; closures for flood-damaged walkways; encourages walking over driving between facilities | One line in the deck, not more |
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
| **Swappable 3D layer** over open standards (OGC 3D Tiles, OpenSidewalks) | Not locked into one capture method | 3D pipeline doc |

**Tactics:** show one competitor screenshot side by side (e.g. a generic map pin vs our entrance-level route with "not checked yet"). Name the 2026 research to show we're current ([trends-2026](../02-research/trends-2026.md)).

## 4. Feasibility & Deliverability (20%)

**Judges want:** practical to implement and **pilot inside an SDP township**.

| Claim | Evidence | Where |
|---|---|---|
| It works today | Deployed URL + demo video (by the proposal date) | Proposal link, demo |
| Low barrier to adoption | Browser-based, no install, no resident accounts, works on 2D/text too | Demo on a phone |
| Cheap to run | LLM about USD 1 per 1,000 questions on a small model; free-tier hosting at pilot scale | [business-case](../06-pitch/business-case.md) |
| Repeatable onboarding | Field-verification protocol; hours to onboard our site (measured) | [field-verification-guide](../03-product/field-verification-guide.md) |
| Responsible and compliant | PDPA-aware design; tile licence respected; no people in photos | AI design §9; 3D pipeline iron rule |
| Clear pilot plan | 4–8 week pilot at one facility with KPIs | Business case, final deck |

## 5. Commercial & Value Multiplication (10%)

| Claim | Evidence |
|---|---|
| Value to SDP: fewer repeated enquiries, better facility utilisation, an inclusivity/ESG proof point, a sales-gallery and new-launch differentiator | [business-case](../06-pitch/business-case.md) |
| Scales per facility across SDP's townships (same software, repeat data onboarding) | Onboarding time per facility (measured) × number of facilities |
| Multiplies into other uses: events wayfinding, facility booking, emergency info, maintenance tickets, ops dashboards | Business case "value multiplication" |
| Data asset: verified accessibility data reusable for planning and MS 1184 audits | Business case |

## 6. Team, Evidence & Pitch Quality (10%)

| Claim | Evidence |
|---|---|
| Rigorous research | This knowledge base; reference library of papers and repos |
| Validated with real users | User study results (small sample, reported honestly) |
| Working prototype | Live demo + recorded backup |
| Balanced team | BE / FE / AI lanes, each presenting their Enabler part |
| Clear pitch | [pitch-narrative](../06-pitch/pitch-narrative.md); [demo-script](../03-product/demo-script.md); 5+ rehearsals |

---

## Required pitch structure → where covered

| Required part | Content | Slides |
|---|---|---|
| **Mechanism**: what it is, how it works, who benefits, why it creates value | Resident story → answer with evidence → gap loop → value to residents and SDP | Narrative slides 1–6 |
| **Enabler**: how technology enables it, UX, township-scale implementation | World model + deterministic routing + grounded LLM + persona testing + 3D tiles; scale per facility | Narrative slides 7–10 |
