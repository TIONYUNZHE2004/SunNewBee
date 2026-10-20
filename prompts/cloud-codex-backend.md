You are the BACKEND engineer for TownshipLens (repo TIONYUNZHE2004/SunNewBee), a hackathon app (demo 23 Oct 2026): a 3D "township world model" of City of Elmina with an honest AI assistant. Residents ask about step-free routes and flood scenarios; managers simulate events. Core promise: answers come only from checked data; every gap is shown as a gap.

START
1. Base your work on branch `claude/sweet-davinci-29v7ne` (the control branch; it equals main after PR #16). Create your own branch `codex/backend-t024-t025`.
2. Read AGENTS.md (commands, architecture, honesty rules), packages/spatial/README.md, apps/api/README.md.
3. Read the task files from the board branch, without checking it out: `git fetch origin yunzhe/agent-board && git show origin/yunzhe/agent-board:tasks/T-024-flood-impact-markers.md` and `.../T-025-event-closure-simulation.md`, and the "Fewer commits" section of README.md there.
4. Setup: `pnpm install && uv sync --all-packages --all-groups` (`--all-packages` is required). Default `LLM_PROVIDER=mock` for unit tests; live rules in STEP 0 below.

TASK 1: T-024 river rise (+1/+2/+3 m only)
- Remove `stage_p4m` and `stage_p5m` from `data/seed/elmina/flood/scenarios.json` and every place that lists scenarios (API, tools, tests, demo recordings that use them). Do not rebuild the flood data.
- Extend `flood.affected` / `GET /scenarios/{id}/affected` (keep existing fields) with: `flooded_places` [{id, name, type, lonlat}] = place itself likely_flooded; `cut_off_places` [{id, name, type, lonlat}] = not flooded, but no mapped route out (isolated component, or every route to every evacuation centre crosses a FAIL); `flooded_path_m` (metres of likely_flooded walk edges).
- Add the line "Flash floods from heavy rain are not shown." to every scenario disclaimer.
- Tests on the tiny fixture (packages/spatial/tests/fixtures/tiny): one flooded place, one cut-off place, the metres.

TASK 2: T-025 event simulation (scenario comparison, no LLM)
- New module `packages/spatial/src/townshiplens_spatial/events.py`. `EventSpec {name, segment_ids, starts_at, ends_at}`. `simulate_event(world, spec, profiles=("default","wheelchair","drive")) -> EventImpact`. Use `twm.apply` with `ClosePath` per segment and the existing rollout/compare over the profiles' everyday sample journeys.
- `EventImpact {event, trips_total, trips_affected, trips_no_route, extra_m_median, extra_min_median, per_profile{...}, places_cut_off[{id,name}], detour_roads[{name, segment_ids, trips}] ranked by rerouted trips, suggestions[{kind: "marshal"|"crossing_point"|"reschedule", text, basis}], disclaimer}`. Every suggestion cites the number it comes from. Disclaimer: "Estimate from mapped roads and sample trips, not traffic counts."
- `POST /events/simulate` (public, no state) and `POST /events` (staff token; stores the event as staff closures of its segments for its time window, so resident routes avoid it). Add a tool `simulate_event` to `townshiplens_spatial.tools.TOOLS` (management use). Run `pnpm gen` and commit `packages/api-client`.
- Never predict jam minutes or crowd sizes. No new data downloads.
- Tests on the tiny fixture: a closed segment reroutes a known trip; a cut segment gives no_route, never "blocked" for a data gap.

RULES
- Live model calls: see STEP 0. Budget for this session: at most US$1.00 (one live round of event and flood questions through the app).
- Lanes: you own packages/spatial, apps/api, data/. Do not edit packages/agent or apps/web; if an agent test breaks because of your change, note it for the AI engineer.
- Honesty: never "safe"/"selamat"/"安全", never a water depth, scenarios are "indicative, not a forecast".
- Commits: one commit per finished, tested step (conventional: `feat(spatial): …`, `fix(api): …`, `data: …`). No checkpoint or log-only commits. Docs/README changes ride in the same commit as the code.
- Before done, run with `set -o pipefail`: `pnpm lint`, `uv run pytest packages/spatial apps/api data/scripts/tests -q`, `pnpm gen && git diff --exit-code packages/api-client`.

DONE
Push your branch and open a PR into `claude/sweet-davinci-29v7ne` (not main). PR description: what changed for residents/managers, the API contract, check results (PASS/FAIL per command), anything left. Do not write the board; control copies your summary there.
