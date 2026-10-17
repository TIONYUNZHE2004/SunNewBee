# T-008 Invented toilet returned as ordinary evidence (audit A1, Cannon F1)

- **Status:** assigned
- **Owner:** Codex worker
- **Branch:** `codex/yunzhe-workflow`
- **Priority:** P1 (before open demo)
- **Lane:** Backend / data: Jun Quan
- **Source:** [A1, Cannon F1](https://github.com/TIONYUNZHE2004/SunNewBee/blob/main/docs/04-architecture/ai-independent-audit-2026-10-17.md)

## Goal

`nearby_amenities` returns the demo "Urban Park toilet" with no demo label and `via_unverified: false`. Place existence needs provenance, and demo warnings must pass through every lookup, amenity, route and MCP result.

## Acceptance

The exact query exposes demo provenance; UI and assistant keep it. Outside Yunzhe's lanes: tracked here, fixed by Backend.

## Log

- 2026-10-17 08:39 UTC · control (claude/sweet-davinci-29v7ne) · Created from the independent audit by Codex (`codex/yunzhe-workflow`, merged as PR #4).
- 2026-10-17 09:29 UTC · control (claude/sweet-davinci-29v7ne) · Assigned to Codex worker (Yunzhe: our agents may change Backend when needed). In scope B: the toilet is in the deep spot. List Backend files in the PR so Jun Quan can review.

- 2026-10-17 09:46 UTC · Codex (codex/yunzhe-workflow) · Started after T-012 checklist passed. Worker merged latest control (already current at 95e9e56). Plan: explicit placeholder existence claims on generated overlay places; preserve them in name evidence, lookups, details, amenities, route metadata/evidence and MCP. No changes to edge evaluation or route selection. Code and regenerated data will be separate commits; all Backend files will be listed in PR #7. Live turns 0.

- 2026-10-17 09:49 UTC · Codex (codex/yunzhe-workflow) · Finding: overlay place names were synthesized into reported/world_model evidence, dropping provenance. Targeted tests now cover lookup/details/amenity/route/MCP/citation and surveyed replacement; route status and distance are unchanged. No OSM cache is present, so using a documented idempotent --provenance-only regeneration to add existence claims without re-importing or changing geometry; full seed rebuild remains T-010. No validator/draft changes needed.
