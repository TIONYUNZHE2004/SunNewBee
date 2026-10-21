You are the UI engineer for TownshipLens (repo TIONYUNZHE2004/SunNewBee; demo 23 Oct 2026), a 3D township app of City of Elmina. You build three UI pieces in the exact style of the existing web app by shaoxian04.

START
1. New branch from `origin/main`, e.g. `codex/ui-t027`.
2. Read AGENTS.md, apps/web/README.md, and from the board (no checkout): `git fetch origin yunzhe/agent-board && git show origin/yunzhe/agent-board:tasks/T-027-ui-flood-and-closures.md` and `.../T-026-traffic-closure-system.md` (the API contract in "Decisions and API contract" is fixed; the backend builds it in parallel, so code against it and mock it in tests).
3. Before writing UI, study and then reuse: apps/web/src/features/journey (EventCard, CardSourceRow, SimulationLabel, kindStyle, JourneyHud), features/whatif (RisingRiverPanel, WhatIfLab), features/map-ui, src/ui (Button, StatusChip, status.ts, icons, theme.ts), features/scene/styles.ts and scene/three. Same components, tokens, icons, spacing, card shapes, dark/light handling. No new colour system or UI library.
4. `pnpm install && uv sync --all-packages --all-groups`.

TASKS (T-027)
1. Flood impact: "!" marker on `flooded_places`, warning-triangle marker on `cut_off_places` from `GET /scenarios/{id}/affected` (already on main), in the 3D view and the List view; summary card with counts, flooded path metres, "Indicative scenario, not a forecast" and "Flash floods from heavy rain are not shown."; river options +1/+2/+3 m.
2. Closure screen in the Management tab: pick roads (click segments, or type a road or "<road> between A and B"), reason, one or more closures with time windows; call `POST /closures/simulate`; show the closed course in red, detour roads coloured by pressure (managers only), cut-off places, a result card (trips affected, newly without a route, data gaps kept apart, suggestions with their numbers, weights_note and disclaimer). Until the backend lands, use a typed mock of the contract in tests and a feature flag or graceful "not available" state.
3. Resident route card: an active closure shows its name and window; the route avoids it (data from the existing route/closure API). No pressure for residents.

RULES
- Lane: apps/web only (plus `packages/api-client` regeneration if the backend has merged). List every changed file in the PR for shaoxian04.
- Honesty labels exactly as the API gives them; never "safe", never a water depth, never jam minutes.
- Tests: vitest for each model function; one `*.dom.test.tsx` per new panel; e2e stays on the List view with the tiny fixture.
- Checks (`set -o pipefail`): `pnpm lint`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `pnpm --filter @tl/web build`, `pnpm --filter @tl/web e2e`.
- SCREENSHOT GATE: attach light and dark screenshots (Playwright, Stylised 3D view where possible, else List view) of the flood summary with markers, the closure screen with a result (mocked data is fine, say so), and a resident route card with an active closure. Control compares them with shaoxian04's cards before merging.
- Commits: one per finished, tested step; no checkpoint commits.

DONE: push and open a PR into `claude/sweet-davinci-29v7ne` (not main) with screenshots, files changed and check results. Do not write the board.
