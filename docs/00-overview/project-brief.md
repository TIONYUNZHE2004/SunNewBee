# TownshipLens: Project Brief (living)

> The **current** one-page truth about the project. When something changes, update this page and add an ADR. The original concept note is frozen in [original-idea.md](original-idea.md).
> Last updated: 14 Oct 2026.

## One-liner
**An AI assistant that understands your township, not just its documents.** Residents ask how to reach a place; TownshipLens answers from a *verified* map of entrances, paths and amenities, shows the route in 3D, says honestly what hasn't been checked, and turns every gap into a task for the township team.

## Problem
Township information is scattered across maps, notices, websites and staff memory. A pin tells you *where* a facility is, not *which entrance* to use, *whether there are stairs*, *where to rest*, or *whether a walkway is closed today*. For parents with strollers, older residents, wheelchair users and first-time visitors, that gap means wasted trips, carrying, and avoiding facilities altogether. Even when "accessible" labels exist, nobody knows **who checked, or when**.

## Solution: four parts
| Part | What it does | Doc |
|---|---|---|
| **Verified world model** | A graph of places, entrances and path segments. Every accessibility fact is yes/no/**unknown**, with a source and a date | [world-model-schema](../04-architecture/world-model-schema.md) |
| **Grounded assistant** | An LLM that calls six deterministic tools; a routing engine decides feasibility; every claim is cited; uncited claims are rejected | [ai-assistant-design](../04-architecture/ai-assistant-design.md) |
| **3D + 2D + text views** | Google Photorealistic 3D Tiles backdrop with our overlay; MapLibre and text fallbacks | [3d-pipeline](../04-architecture/3d-pipeline.md) |
| **Gap loop + resident agents** | Unknowns become ranked verification requests for staff. Persona profiles test every journey to find gaps first | [resident-agents-design](../04-architecture/resident-agents-design.md) |

## Differentiator
**A closed loop from resident questions to verified facts.** Unknowns are visible, ranked by demand and impact, fixed by staff in minutes, and every later answer improves. Competitors either guess ("accessible ✓") or stop at a static map. See [competitors](../02-research/competitors.md).

## Users
Residents (Aisyah: stroller · Uncle Lim: older adult · Priya: wheelchair · Daniel: visitor) and staff (Farah: ops · Encik Rahman: facility manager). See [personas-and-journeys](../03-product/personas-and-journeys.md).

## Hackathon fit
- **Track:** People. Sub-themes: accessibility & inclusion, getting around, digital living, community wellbeing.
- **Mechanism:** make township knowledge spatially specific, verifiable and maintainable.
- **Enabler:** a structured spatial model + deterministic routing + tool-using LLM + persona testing + existing 3D data.
- Criteria mapping: [judging-criteria-mapping](../01-hackathon/judging-criteria-mapping.md).

## MVP scope
One facility and its surroundings in one SDP township ([site-selection](../02-research/site-selection.md)). 30+ nodes, 50+ edges, 4+ entrances; 4 profiles; 6 tools; staff console; persona simulation; EN/BM/中文. Full list: [mvp-spec](../03-product/mvp-spec.md). **Not in scope:** own 3D capture, indoor turn-by-turn, live sensors, compliance certification, resident accounts.

## Stack (summary)
Vite + React 19 + R3F 9 + 3d-tiles-renderer · MapLibre · FastAPI + Pydantic 2 + NetworkX · Postgres (Supabase SG) · Claude Haiku 5.5 / Sonnet 5.5 via a hand-written tool loop · Promptfoo evals · Cloudflare Pages + Cloud Run (Singapore). See [stack-decision](../04-architecture/stack-decision.md).

## Key dates
Proposal **23 Oct** · Top 10 **28 Oct** · Mentoring **2–6 Nov** · Final submission **11 Nov** · Pitch **14 Nov** · Awards **3 Dec**. Plan: [timeline](../05-team/timeline.md).

## Success looks like
- Proposal submitted with a working proof-of-life screenshot or video.
- **Zero unsupported claims** on the golden set; 100% correct route-status decisions.
- A measured **before → after** improvement in confirmed journeys after one verification round.
- A small real user test showing faster, more correct entrance-finding than map + FAQ, with users understanding what's unverified.
- SDP leadership sees a credible **4–8 week pilot** path.
