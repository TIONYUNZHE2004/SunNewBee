# T-030 Demo QA: make the three demo stories impossible to break silently

- **Status:** assigned · **Owner:** cloud Codex #2 (QA) · **Priority:** P1 (demo 23 Oct)
- **Source:** Yunzhe, 22 Oct: "you can assign more tasks to Codex, or open another cloud Codex".

## The three demo stories (davinci, mock LLM unless stated)
1. Resident: "Stroller route from Car Park B to the playground" → route card; with an active works closure on the route the card says "Closed (staff report)" + window and the route avoids it; "Watch the trip" works. No pressure for residents.
2. Flood: river +3 m (and the low-lying layer once cloud Claude merges it) → "!" / warning markers, summary card (counts, flooded path length), "Indicative scenario, not a forecast", "Flash floods from heavy rain are not shown." Resident asks "Which places are cut off if the river rises 3 m?".
3. Manager marathon: "I want to host a 5 km marathon starting at Elmina Valley Central Park on Sunday 6–10 am. Which roads and what is affected?" → proposed course with road names in order, impact, detours with pressure, suggestions with plain-words basis; then "avoid Persiaran Tamarind" re-plans.

## Build (lanes: evals/, apps/web/e2e/, data/scripts/demo_check.py and its tests; nothing else)
1. Golden cases (evals) for each story and for refusals: no "safe"/"selamat"/"安全", no water depth, no jam minutes or vehicle counts, residents never get pressure, "Proposed course on mapped roads, not an approved route." present, marathon length within ±10% of the target.
2. `data/scripts/demo_check.py`: starts nothing; calls a running API (default http://127.0.0.1:8000) for the three stories via REST (`/routes`, `/scenarios/{id}/affected`, `/closures/simulate`, `/marathon/plan`, `/layers/road-labels`) and via `/chat` with the mock, prints PASS/FAIL per check, and times the cold and warm marathon run. Exit 1 on any FAIL.
3. Playwright e2e (List view, tiny fixture, mock) for what the tiny fixture supports; mark Elmina-only checks clearly as demo_check.py items instead.
4. Run everything against davinci and report bugs: one PR comment per bug on the owner's PR or a short issue list in your PR (owner: Codex #1 for spatial/api marathon, cloud Claude for agent/web/flood). Do not fix other lanes' code.

## Rules
- Branch `codex/t030-demo-qa` from `origin/claude/sweet-davinci-29v7ne`; one PR into davinci; merge davinci into your branch at the start of each task.
- Checks with `set -o pipefail`: `pnpm lint`, `uv run pytest data/scripts/tests -q`, `pnpm golden`, `pnpm --filter @tl/web e2e`.
- No live model calls unless control asks (then at most 3, log the cost).
- End every task with "Status <UTC>: done …; checks …; bugs found …; next …".

## Log
- 2026-10-22 02:40 UTC · control · Created.
