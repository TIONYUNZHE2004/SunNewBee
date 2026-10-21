# T-027 UI: flood markers and the closure (traffic) screen, in shaoxian04's style

- **Status:** done · **Owner:** cloud Claude (moved from cloud Codex, Yunzhe 21 Oct) · **Priority:** P1
- **Source:** Yunzhe, 21 Oct: "we do the UI ourselves, but read the style from shaoxian's work and match it"

## Style source (read before writing any UI)
`apps/web/src/features/journey/` (EventCard, CardSourceRow, SimulationLabel, kindStyle, JourneyHud), `apps/web/src/features/whatif/` (RisingRiverPanel, WhatIfLab), `apps/web/src/features/map-ui/`, `apps/web/src/ui/` (Button, StatusChip, status.ts, icons, theme.ts), `apps/web/src/features/scene/styles.ts` and `scene/three/`. Reuse their components, tokens, icon set, spacing, card shapes and dark/light handling. No new colour system, no new UI library.

## 1. Flood impact on the map (T-024 data)
From `GET /scenarios/{id}/affected`: a "!" marker on each place in `flooded_places` ("Likely flooded (indicative)") and a warning-triangle marker on each place in `cut_off_places` ("Cut off: no mapped way in or out (indicative)"), in the 3D view and the List view. A summary card: places flooded, places cut off, metres of flooded paths, plus "Indicative scenario, not a forecast" and "Flash floods from heavy rain are not shown." River options +1/+2/+3 m only.

## 2. Closure / traffic screen (Management tab, T-026 contract)
Pick roads (click segments or type a road / "road between A and B"), choose reason (event, works, accident, flooding, other), one or more closures with time windows, run `POST /closures/simulate`. Detour roads coloured by `pressure` (low / medium / high, managers only), with the `weights_note` and `disclaimer` shown. Show: the closed course in red, detour roads coloured by pressure band, cut-off places with the warning marker, and a result card (trips affected, newly without a route, data gaps kept apart, suggestions with their numbers, the estimate label). A "Watch the detour" button may reuse the journey follow camera.

## 3. Resident view
An active closure shows on the route card with its name and window, and the route line avoids it.

## Rules
- Lane: apps/web only; list every file in the PR for shaoxian04. No backend changes; ask in the PR.
- Honesty labels exactly as the API gives them; never "safe", never a depth, never jam minutes.
- Tests: vitest for each model function, one `*.dom.test.tsx` per new panel; e2e stays on the List view (tiny fixture).
- Checks: `pnpm lint`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `pnpm --filter @tl/web build`, `pnpm --filter @tl/web e2e`.
- Screenshots of each new screen (light and dark) in the PR.

## Screenshot gate (Yunzhe, 21 Oct)
The PR must include light and dark screenshots of: the flood summary card with "!" and warning markers, the closure screen with a result, and a resident route card with an active closure. Control compares them with shaoxian04's journey cards and what-if panels before merging. If the style does not match after one fix round, cloud Claude takes over.

## Log
- 2026-10-21 00:52 UTC · control · Created from Yunzhe's decisions (1: we build the UI in shaoxian's style; 2: ignore his developer-lens work).
- 2026-10-21 07:38 UTC · control · Owner: cloud Codex with the screenshot gate.
- 2026-10-21 13:35 UTC · control · Owner moved to cloud Claude (Yunzhe: A), so the UI runs in parallel with the Codex T-026 backend. Screenshot gate unchanged. Prompt: `prompts/cloud-claude-t027-ui.md`.
- 2026-10-21 16:45 UTC · control · Done. Backend #25 (Codex) + binding #27 + UI #26 (cloud Claude) in davinci; squash-merged to main as #28 (f623afa), CI green.
