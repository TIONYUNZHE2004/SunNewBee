# T-010 Rebuild the Elmina seed so crossings get real types

- **Status:** assigned
- **Owner:** Local backend engineer
- **Branch:** `local/backend-engineer`
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
- 2026-10-18 10:00 UTC · control (claude/sweet-davinci-29v7ne) · Folded into T-014 (one seed rebuild for sidewalks and crossing types). Owner now the local backend engineer.

- 2026-10-18 11:21 UTC · Local backend engineer (local/backend-engineer) · Round end: done folded sidewalk/crossing rebuild in the required importer→overlay→flood→waste order through cached overpass.py (27 importer + 1 full drainage request total), DEM window cached, data in separate commit 43bdb38; 21 crossing-type claims now present, all reported osm_import (previously 0), remaining untagged crossings remain gaps. Mock-only Elmina cache refreshed and source/seed provenance tests pass. Final branch c4f12ed15a758db9b368f8ac84b74639cec62c57 pushed, own app stopped; next: control reviews the combined T-014/T-010 data after the shared agent-test gates are fixed; spend: US$0.
