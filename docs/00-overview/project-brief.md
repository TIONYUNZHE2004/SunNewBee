# TownshipLens: Project Brief (living)

> The **current** one-page truth about the project. When something changes, update this page and add an ADR. The original concept note is frozen in [original-idea.md](original-idea.md).
> Last updated: 14 Oct 2026, after the pivot to a world-model platform (ADR [0009](decisions/0009-township-world-model-platform.md)).

## One-liner
**A 3D world model of the township that residents and township managers can ask anything, and trust the answer.** TownshipLens turns City of Elmina into a living 3D model with "lenses" on top. Residents find step-free routes, toilets and shelter. Managers rehearse "what if it floods tonight?" and see which paths, facilities and residents get cut off. Everything the AI says comes from checked data, and gaps become tasks for the township team.

## Problem
Township knowledge is scattered across maps, notices, WhatsApp groups and staff memory, and none of it is spatial or verified.
- **Residents** can find *where* a facility is, but not *how* to get there without stairs, where to rest, or whether a path is closed. Where "accessible" labels exist, nobody knows who checked them or when.
- **Township managers** can't easily answer "if heavy rain hits, which walkways, entrances and community facilities go under, who is cut off, and where should people go?" Shah Alam's December 2021 floods showed what that costs.
- Both groups depend on the same underlying facts (paths, levels, entrances, facilities, drainage), but nobody keeps those facts in one trustworthy place.

## Solution: one world model, many lenses

```
  Ask anything ─► AI assistant (cites evidence, says "unknown" honestly)
                        │ calls deterministic tools
  Lenses:   ① Accessibility & getting around   ② Flood / disaster what-if   (+ recycling layer, roadmap lenses)
                        │
  World model (Elmina): terrain · buildings · paths & entrances · facilities ·
                        drains & retention ponds · evacuation centres · waste points
                        every fact = yes/no/unknown + source + date
                        │
  3D view of the whole township (photoreal) + 2D/text fallbacks
```

| Part | What it does | Doc |
|---|---|---|
| **World model** | Layered, verified spatial data for City of Elmina; every accessibility- or safety-relevant fact is yes/no/**unknown** with a source and a date | [world-model-schema](../04-architecture/world-model-schema.md) (being extended) |
| **Lens 1: Accessibility & getting around** (deep) | Step-free / rest-point / wheelchair routes, entrances, toilets, shelter; honest unknowns; staff verification loop | [accessibility-and-routing](../02-research/accessibility-and-routing.md) |
| **Lens 2: Flood / disaster what-if** (deep) | Pick a scenario → water rises in 3D → cut-off paths and facilities → re-routed safe and evacuation routes → affected-area summary for managers. Indicative, not a forecast | [flood-disaster-lens](../02-research/flood-disaster-lens.md) |
| **Recycling / waste** (thin) | Recycling and e-waste points, collection info as a layer + Q&A | [township-3d-engine-and-data](../02-research/township-3d-engine-and-data.md) |
| **Roadmap lenses** | Planning / site screening (e.g. data centres, tied to SDP's SHIFT32), events, maintenance | pitch only |
| **Grounded AI assistant** | Calls deterministic tools (routing, scenarios, lookups); every claim is cited; uncited claims are rejected | [ai-assistant-design](../04-architecture/ai-assistant-design.md), [agent-harness-2026](../02-research/agent-harness-2026.md) |
| **Resident agents (testers)** | Automatic journey tests per profile, including under flood scenarios ("can everyone still reach an evacuation centre?") | [resident-agents-design](../04-architecture/resident-agents-design.md) |
| **3D experience** | Photoreal 3D of the whole of Elmina; the AI drives the camera, routes glow, water rises | CesiumJS + Google photoreal tiles ([ADR-0007](decisions/0007-3d-engine-cesium.md), [3d-pipeline](../04-architecture/3d-pipeline.md)) |

## Differentiator
1. **One verified model, many uses.** The same paths, levels and facilities serve daily accessibility *and* emergency planning. That is where the value multiplies for SDP.
2. **Honest by design.** "Unknown" is a first-class answer; every fact has a source and a date; scenarios are labelled indicative.
3. **Closed loop.** Gaps found by residents, flood what-ifs or test agents become ranked tasks for staff, and fixes improve every lens at once.
4. **3D you can query.** Not a pretty fly-through: ask a question and the township shows you the answer.

## Users
- **Residents:** Aisyah (stroller), Uncle Lim (older adult), Priya (wheelchair), Daniel (visitor).
- **Management:** Farah (township ops), Encik Rahman (facility manager), plus a **township safety / emergency lead** (flood lens).
- See [personas-and-journeys](../03-product/personas-and-journeys.md) (includes flood journeys J7–J9).

## Hackathon fit
- **Track: People.** Sub-themes: accessibility & inclusion, safety & security, getting around, digital living, community wellbeing. The flood lens touches Planet's climate resilience, but it's framed as *resident safety*.
- **Mechanism:** one trustworthy, spatial, queryable model of the township that residents and managers both use, and that improves itself through the verification loop.
- **Enabler:** photoreal 3D + layered world model + deterministic routing and scenario engines + a grounded, tool-calling LLM (PydanticAI over OpenRouter) + automated persona testing.

## MVP scope
- **Coverage:** the whole of City of Elmina in 3D with open base data (buildings, paths, terrain, waterways, facilities).
- **Deep spots:** Elmina Urban Park + Lakeside Mall frontage (accessibility, verified on site), and the **Sungai Subang corridor + downstream neighbours** (Kampung Kubu Gajah / Paya Jaras) for the flood lens ([ADR-0010](decisions/0010-flood-lens-hand-scenarios.md)).
- **Lenses:** Accessibility (deep), Flood what-if (deep), Recycling (thin).
- **Not in scope:** forecasting real floods, live sensor feeds, own 3D capture, indoor navigation, compliance certification, resident accounts, a working data-centre siting tool.

## Stack (summary)
React 19 + Vite · CesiumJS + Resium + Google Photorealistic 3D Tiles (ADR-0007), Mapbox lite view · FastAPI + Pydantic 2 + NetworkX · GeoJSON/GeoParquet files + SQLite, no PostGIS for the MVP · PydanticAI over OpenRouter (model set in env) · Promptfoo/pytest evals · Cloudflare Pages + Cloud Run (Singapore).

## Key dates
Proposal **23 Oct** · Top 10 **28 Oct** · Mentoring **2–6 Nov** · Final submission **11 Nov** · Pitch **14 Nov** · Awards **3 Dec**. Plan: [timeline](../05-team/timeline.md).

## Success looks like
- A 3D Elmina demo where one question shows a verified step-free route, and one scenario shows water rising, routes re-planning and an affected-facilities summary.
- Zero unsupported AI claims on the golden set; scenario answers always labelled indicative.
- Measured before → after improvement in confirmed journeys after one verification round.
- A small real user test (residents) plus feedback from at least one township/ops person on the flood lens.
- SDP sees a credible 4–8 week pilot: Lens 1 at one facility, Lens 2 as an ops planning tool.
