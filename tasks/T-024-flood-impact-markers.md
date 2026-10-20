# T-024 River rise: +1/+2/+3 m only, with "flooded" and "cut off" markers

- **Status:** assigned · **Owner:** cloud backend worker (data, API) + shaoxian04 (map markers) · **Priority:** P1
- **Source:** Yunzhe, 20 Oct (decision: option A)

## Decision
Scenarios are **+1 m, +2 m and +3 m** above normal. +4 and +5 m are removed (extreme; JPS danger levels are usually 1-3 m above normal). Add one line everywhere scenarios show: "Flash floods from heavy rain are not shown."

## Backend
1. Drop `stage_p4m` and `stage_p5m` from `flood/scenarios.json` and the UI options; keep files only if tests need them.
2. One impact summary per scenario (extend `/scenarios/{id}/affected`): places **flooded** (place itself in likely_flooded), places **cut off** (not flooded, but no route out: isolated component or every route to a centre crosses FAIL), flooded path length in metres, each with ids and coordinates for markers.
3. Tests on the tiny fixture: one flooded place, one cut-off place, the counts.

## Frontend (shaoxian04)
"!" marker on flooded places, warning-triangle marker on cut-off places, and a summary card (counts + metres). Labels: "Likely flooded (indicative)" and "Cut off: no mapped way in or out (indicative)". Never "safe", never a water depth.

## Log
- 2026-10-20 16:05 UTC · control · Created from Yunzhe's decision (A).
- 2026-10-20 17:52 UTC · control · Backend done by cloud Codex in PR #17 (flooded_places, cut_off_places, flooded_path_m; +1/+2/+3 m only; disclaimer line). CI red on 9 agent tests (old +5 m wording, removed stages, simulate_event allowlist); the AI worker merges #17 and fixes them in its next PR.
