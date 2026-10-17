# T-010 Rebuild the Elmina seed so crossings get real types

- **Status:** blocked
- **Owner:** Control session
- **Branch:** `claude/sweet-davinci-29v7ne`
- **Priority:** P3
- **Lane:** Backend / data: Jun Quan
- **Source:** [PR #1 note](https://github.com/TIONYUNZHE2004/SunNewBee/blob/main/docs/04-architecture/ai-independent-audit-2026-10-17.md)

## Goal

`import_osm.py` reads OSM crossing tags since PR #1, but `data/seed/elmina` was not rebuilt, so every crossing shows "no recorded crossing type". The audit counts zero crossing-type claims in the base graph.

## Acceptance

`pnpm data:build` through `overpass.py`, data committed separately, demo cache re-recorded with the mock (AGENTS.md data pipeline).

## Log

- 2026-10-17 08:39 UTC · control (claude/sweet-davinci-29v7ne) · Created from the independent audit by Codex (`codex/yunzhe-workflow`, merged as PR #4).
- 2026-10-17 09:29 UTC · control (claude/sweet-davinci-29v7ne) · Assigned to control, after T-008 is merged (both change seed data). Needs Overpass network access; control checks it first.
