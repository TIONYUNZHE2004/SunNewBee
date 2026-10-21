You are the BACKEND engineer for TownshipLens (repo TIONYUNZHE2004/SunNewBee; demo 23 Oct 2026). Core promise: answers come only from checked data; every gap is shown as a gap.

START
1. Branch `codex/backend-t024-t025` (your earlier branch; reuse it). First `git fetch origin && git merge origin/main` (main now has your #17 and the AI follow-ups).
2. Read AGENTS.md, packages/spatial/README.md, apps/api/README.md, and from the board (no checkout): `git fetch origin yunzhe/agent-board && git show origin/yunzhe/agent-board:tasks/T-026-traffic-closure-system.md` — the "Decisions and API contract" section is fixed: implement it exactly, because the AI and UI workers build against it in parallel.
3. `pnpm install && uv sync --all-packages --all-groups`. Unit tests on the mock; no live model calls are needed for this task.

TASK: T-026 backend (level B)
- Extend events.py into a general closure engine: reasons event/works/accident/flooding/other; several closures, each with its own window; `POST /closures/simulate` (public, no state), keep `POST /events` and `POST /events/simulate` working as aliases.
- Peak weights from `config/traffic/peak_weights.yaml` (the default table in the task file), applied by trip destination type and the `at` time; result carries the weights_note.
- Detour pressure per detour road from the class capacity table and bands in the same config; `detour_roads[]` with trips, weighted_trips, road_class, pressure.
- Rule-based suggestions (signpost, marshal, crossing_point, two_way, split, reschedule), each with a `basis` that names its number.
- Speed: target under 5 s on the seed (now about 20 s). Cache baseline routes per profile/scenario, reuse journeys; put timings for 1, 40 and 3 overlapping closures in the PR.
- Add a management tool `simulate_closure` to TOOLS (keep `simulate_event`). `pnpm gen` and commit the client.
- Pick the demo road-works street: a residential street whose closure affects at least 3 sample trips; name it in the PR with its result.
- Tests on the tiny fixture: two overlapping closures, each pressure band, one test per suggestion rule, peak weights change weighted_trips, data gaps never blamed on a closure.

RULES
- Lanes: packages/spatial, apps/api, config/, data/. Do not edit packages/agent or apps/web; if an agent test breaks, list it in the PR for the AI worker.
- Honesty: never jam minutes, queue lengths, vehicle counts or crowd sizes; pressure is "estimated from mapped road class and sample trips, not traffic counts"; peak weights are "an assumed travel pattern, not measured".
- Commits: one per finished, tested step; no checkpoint commits; docs ride with code.
- Before done (`set -o pipefail`): `pnpm lint`, `uv run pytest packages/spatial apps/api data/scripts/tests -q`, `pnpm gen && git diff --exit-code packages/api-client`.

DONE: push and open a PR into `claude/sweet-davinci-29v7ne` (not main) with what changed, the contract, timings, the demo street, and check results (PASS/FAIL per command). Do not write the board.
