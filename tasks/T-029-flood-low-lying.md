# T-029 Flood: river rise plus low-lying areas that collect water

- **Status:** done · **Owner:** cloud Codex (builds) · cloud Claude (judge) · **Priority:** P1
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
- 2026-10-22 01:40 UTC · control · Roles swapped (Yunzhe): Codex builds the marathon engine, cloud Claude audits it; cloud Claude builds the flood low-lying layer (its container reaches the Copernicus DEM; Codex got proxy 403), Codex audits it. Decision: low-lying terrain is UNKNOWN for every profile, driving included (option A). Overnight 21→22 Oct: Codex delivered T-028 backend 1–6 and the T-029 method on PR #29; cloud Claude hit its usage limit at 17:50 UTC and did nothing until 01:35 UTC.
- 2026-10-22 13:40 UTC · control · Done. Squash-merged to main as #37 (a66f32f), CI green; main (shaoxian demo polish) merged into davinci first, both sides kept. Integration run on the seed (mock) passed. Open: live-AI smoke and a browser click-through by Yunzhe; closure_labels.json has 4 labels 'near .'; compact JSON after the demo.
