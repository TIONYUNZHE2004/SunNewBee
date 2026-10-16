# Stylised city: quality report

Date: 2026-10-16. Branch `feat/stylised-city` (Project 2, Task 8). Spec:
[stylised-city design](../superpowers/specs/2026-10-16-stylised-city-design.md). Plan:
[2026-10-16-stylised-city](../superpowers/plans/2026-10-16-stylised-city.md).

This is the quality pass on the **real** OSM seed (`data/seed/elmina/base/buildings.geojson`, 7,803
buildings, and `trees.geojson`, 491 trees). Earlier task reports measured synthetic 20k-building
data; the numbers below replace them.

## How it was checked

- **Keyless browser:** API and web started with the real seed (no `TL_DATA_DIR` override), mock
  LLM, and all three map keys set to empty strings. This is the same key setup as
  `apps/web/playwright.config.ts`. The browser was Chrome through the Chrome DevTools MCP, on an
  NVIDIA RTX 2050 (ANGLE D3D11) with a display of about 128 Hz.
- **Two servers:**
  - Vite dev on :5473 with the API on :8300.
  - A production build (`pnpm --filter @tl/web build`, keys empty) served by `vite preview` on
    :5474, which proxies `/api` to the same API.
- **No billable requests.** Every check listed all network requests. The only hosts were
  `localhost`, `fonts.googleapis.com` and `fonts.gstatic.com`. There were no requests to
  `tile.googleapis.com`, `api.cesium.com` or `mapbox.com`, and no Google 3D tiles were loaded.
- **How frame times were taken:**
  - An init script counted WebGL draw calls per `requestAnimationFrame`.
  - "City first frame" is the first frame with the buildings drawn: draw calls jump from 1–2 (bare
    globe) to 50+. It is measured from navigation start.
  - Orbit is a 10 s scripted Ctrl-drag. The viewer uses `requestRenderMode` and draws 0 frames
    when idle, so every counted frame is a real re-render caused by the camera moving.

## Numbers

| Measure | Dev (Vite, StrictMode) | Production build | Budget |
|---|---|---|---|
| City first frame (nav start to buildings drawn) | 2.96 s, 3.15 s | **1.56 s**, 1.94 s (cache bypassed) | <= 3 s |
| Same, CPU throttled 4x | — | 4.55 s | (informational) |
| Everything ready (roads, trees, cars, overlays) | about 6.7 s | about 4.5 s | — |
| `/layers/buildings` response | 0.49–1.38 s, about 260 KB gzipped | 0.72–0.81 s | — |
| Orbit 10 s, home view (2.5 km) | 53–57 fps (p95 20–22 ms) | **48.9 fps** (p95 22 ms) | >= 30 fps |
| Orbit 10 s, street level (Lakeside Mall route view) | 59.6 fps (p95 19 ms) | **56.1 fps** (p95 20 ms) | >= 30 fps |
| Worst single frame while orbiting | 205–278 ms | 149–212 ms | — |

All orbit runs had the status-line layer on (the access lens), and some also had the route. That
is the heaviest normal state. Task 6 measured about 80 fps without overlays and 39–53 fps with them
on synthetic data. The real data is lighter (7.8k buildings against 20k), but the existing
16k-edge status layer still dominates the frame cost.

## Check table

"Mock" means the assistant ran on the deterministic mock LLM, not a live model.

| Check | Result | Notes |
|---|---|---|
| Stylised auto-selected on `/` with the real seed, keyless | PASS | Map style shows **Stylised** checked. **Realistic photos (Google)** is disabled with the visible reason "Needs a Google Maps key". "Decorative details are illustrative." is shown. |
| No billable tile requests | PASS | Hosts: localhost and Google Fonts only (dev and production). |
| Home view framing (`stylisedHomeView`, 2.5 km, 45° pitch) | PASS (with a limit) | Most of the township is in frame, with real footprints, roads, water and markers. At this range most buildings are 2–3 storeys (median 8.6 m; 79% at or under 10 m; mostly default heights), so the city reads as a coloured plan, not a skyline. See Known limits. |
| Day and Night at home and street level | PASS | Screenshots below. Theme switches in place with no rebuild. |
| Windows visible | PASS at street level | Lit windows are clear at Night on the Lakeside Mall route view. They can't be seen at the 2.5 km home view. |
| Roads and trees | PASS | Roads draw under the status lines. OSM trees and street trees are visible at street level (small). |
| Route, flood and place overlays legible | PASS (mock) | Wheelchair route to Lakeside Mall (mock): blue route, markers on top. River +3 m (mock): red flood edges, draped indicative water, the "not a forecast" note, and the centre label. See finding 3. |
| First frame <= 3 s | PASS (production) | 1.56–1.94 s in production. Dev is 2.96–3.15 s, at the limit because of unbundled modules. |
| Orbit >= 30 fps | PASS | 48.9–59.6 fps, home and street, dev and production. |
| Lighthouse accessibility, Day | PASS: 100 | Dev snapshot 100. Production navigation run 100. |
| Lighthouse accessibility, Night | PASS: 100 | Dev snapshot 100, also 100 with the settings popover open. Production snapshot 100. |
| Keyboard: settings popover | PASS | Tab reaches **Map settings**. Enter opens it and focuses the first radio. Tab moves through the radios to **Stylised**, which shows a focus ring. Arrow keys skip the disabled Realistic option. Escape closes the popover and returns focus to **Map settings**. |
| Responsive 390x844, 820x1180, 1440x900 | PASS | `scrollWidth == innerWidth` at all three sizes (no horizontal scroll). Below `lg` the map stacks above the assistant. See finding 4. |
| Console clean (no GL or shader errors) | PASS | Only Vite and React DevTools info lines in dev. Earlier runs had the known `/favicon.ico` 404. |
| Realistic comparison (Google tiles) | NOT RUN | Skipped on purpose for cost. The Stylised to Realistic switch is covered only by unit tests with fakes (`realistic.test.ts`). |
| Independent evaluator (plan Task 8 step 2) | NOT RUN here | The controller runs it after this pass. |
| `pnpm lint` | PASS | 0 errors. 155 Biome warnings, which predate this branch's docs pass. |
| `uv run pytest -q` | PASS | 864 passed. |
| `pnpm -r --if-present typecheck` | PASS | |
| `pnpm -r --if-present test` | PASS | vitest: 67 files, 440 tests. |
| `pnpm gen && git diff --exit-code packages/api-client` | PASS | No drift. |
| `pnpm golden` | PASS (mock) | 13/13 on the mock LLM. |
| `pnpm --filter @tl/web build` | PASS | Built with empty keys. Cesium assets OK. |
| `pnpm --filter @tl/web e2e` | PASS (mock) | 9/9. Tiny fixture, mock LLM, keyless, list view (the fixture has no buildings). |

## Screenshots (real seed, keyless, 768x709 map region)

- `stylised-city/real-day-home.png`: Day home view, Walking profile.
- `stylised-city/real-night-home.png`: Night home view, Walking profile.
- `stylised-city/real-day-street-route.png`: Day street level, wheelchair route to Lakeside Mall
  (mock answer).
- `stylised-city/real-night-street-route.png`: Night street level, the same view.
- `stylised-city/real-day-flood-3m.png`: River +3 m indicative scenario (mock answer) with the
  flood note.

The synthetic screenshots from Tasks 5 and 6 (`t5-synthetic-*`, `t6-synthetic-*`) were deleted.

### Against the handoff reference image (judged by eye)

The reference is a close isometric night illustration: tall, varied blocks with dense lit
windows, round trees, cars, a stadium and a bridge.

- **Close to the reference:** at street level at Night. Indigo ground, lilac roofs, warm lit
  windows in floor rows on the walls, teal round trees and parked cars. The Lakeside Mall block
  reads as a lit low-rise.
- **Different from the reference:**
  - **Scale and height.** Elmina is a low-rise suburb, and 94% of heights are kind-based
    defaults (median 8.6 m, 79% at or under 10 m). So there are no towers, and the home view looks like a pastel
    plan.
  - **Camera.** The reference is a close isometric vignette. Ours opens on the whole township at
    2.5 km. Nothing frames it like an illustration.
  - **Overlays.** Our green, amber and red status lines run over most streets (16k edges). They
    dominate the home view, at Night especially, and the reference has none.
  - **Missing elements.** No street lamps, signs, landmarks, bridge or bloom glow.
- **Day:** a sand ground, pastel rose, lilac and terracotta buildings, and teal decorative water.
  Clean and readable, but flatter than the reference's lighting.

## Findings

Nothing in this pass needed a code fix. The findings are recorded so they can be prioritised:

1. **Keyless start in PowerShell is not keyless (process issue, not a product defect).** Windows
   PowerShell 5.1 deletes a variable assigned `''`, so `$env:GOOGLE_MAPS_API_KEY=''` lets the
   repo-root `.env` keys reach the dev bundle. This was confirmed: the first dev server had a
   39-character Google key and an Ion token in `ENV`. No billable request was made, because the
   stylised default needs none and Realistic was never selected. The server was restarted from Git
   Bash (`GOOGLE_MAPS_API_KEY= pnpm dev`) and the empty keys were verified in the page. The same
   pitfall caused 12 Google loads in the Project 1 evaluation. It is now written into
   `apps/web/README.md`.
2. **The home view shows no windows.** At 2.5 km the real low-rise buildings are too small for
   window rows. A closer or more oblique opening view would be closer to the reference, but it
   would hide most of the township. This is a product call and was left as is.
3. **On flood views the route is thin under amber dashed status lines.** It stays visible and the
   route tag names it, but it is less prominent than the flood edges.
4. **At phone width (390 px) the home view is dominated by status lines.** The lines merge into
   blobs. This is the existing status layer, not the stylised renderer.
5. **Worst-frame hitches of 150–280 ms while orbiting.** Probably tile and primitive updates on
   first view of a new angle. The p95 stays at 20–22 ms.

## Known limits

- **Heights:** 94% of building heights are deterministic defaults by building kind (7,330 of
  7,803). 460 come from `building:levels` and 13 from `height`. Heights are display-only and never
  feed routing, flood or any answer.
- **Decorative props and water:** cars, street trees, building colours and lit windows are seeded
  decoration ("Decorative details are illustrative."). Base water is OSM `natural=water`, drawn in a
  teal-grey that is kept different from the flood-scenario water. It is never a flood scenario.
- **Realistic switch:** tested only with fakes, never against live Google tiles in this project.
- **Ion-only world:** with only a Cesium Ion token (no Google key and no buildings), Realistic
  draws Ion/OSM, and no Map style option is checked (both are disabled with reasons).
- **Synthetic vs real data:** Tasks 5–7 measured 20k synthetic buildings (5.6 MB). The real seed is
  7.8k buildings (2.35 MB on disk, about 260 KB gzipped on the wire), so build cost and fetch are
  lower. Real footprints are irregular (concave), so triangulation goes through Cesium's
  `PolygonPipeline`. Most buildings are low, which changes the look (see above).
- **Multipolygon buildings** (7 relations) and holes are not imported.
- **Mobile GPU:** not measured on a phone. All numbers are from one laptop with an RTX 2050.
