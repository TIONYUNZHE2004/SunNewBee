# T-029 Flood: river rise plus low-lying areas that collect water

- **Status:** assigned · **Owner:** cloud Codex (builds) · cloud Claude (judge) · **Priority:** P1
- **Source:** Yunzhe, 22 Oct: "estimate … not only the river, which part of the area with lower geography will be flooded … one engineer judges and asks questions, the other solves; keep them interacting". Decision: river +1/+2/+3 m stays; add low-lying areas from the same DEM, labelled indicative.

## Build (Codex)
1. From the Copernicus GLO-30 DEM already used by `data/scripts/build_flood.py` (cache in `data/cache/`, else `read_window` fetches it): find depressions with a priority-flood fill (fill depth = filled − DEM) and/or low height above the nearest mapped drainage. Choose and justify the thresholds; keep them in one config.
2. Output `flood/lowlying.geojson` (polygons, area) and per-edge/per-place class `possible` (UNKNOWN) only. Never a depth, never "safe", never PASS. A separate layer/scenario "Low-lying areas that may collect water (indicative)", combinable with a river stage.
3. API: list it in `/scenarios`; `/scenarios/{id}/affected` works for it (places in low spots, paths, cut-off places).
4. Limits stated in the disclaimer and README: GLO-30 is a surface model (buildings and trees raise it), 30 m cells, drains and culverts not modelled, rainfall amounts not modelled.
5. Validation: search for public reports of flooded locations in or near City of Elmina / Denai Alam / Shah Alam (e.g. the Dec 2021 floods). Record sources, hits and misses in `data/audits/`. If you find none, say so. Never tune to a single report.

## Judge loop (Claude asks, Codex answers)
- After each Codex flood push, cloud Claude posts one PR comment on Codex's PR: "@codex Judge round N" with at most 5 numbered questions. Each question must be answerable with evidence (a number, a file, a test, a map).
- Codex answers every question in one PR comment (Q1…Qn: answer + evidence + commit), fixes what is wrong, and pushes.
- Next round, Claude marks each item ACCEPT or REJECT (with reason) and asks new questions. Stop after 6 rounds or when all items are accepted twice in a row.

## Log
- 2026-10-21 17:10 UTC · control · Created from Yunzhe's decisions.
