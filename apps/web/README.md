# @tl/web

The TownshipLens browser app: a Vite + React 19 SPA with two screens and a day/night theme.

- `/` **Main** (`features/main/MainPage.tsx`): the map on the left (`MapStage`: Cesium 3D, Mapbox
  lite or the List view) with overlays (route tag, flood note, settings popover, place and path
  overlays), and the **assistant** panel on the right (stacked, map first, below the `lg`
  breakpoint). The assistant has modes with starter questions (`features/assistant/starters.ts`),
  answer cards with citations and uncertainty banners, and a Gaps section of unverified facts.
- `/tickets` **Tickets** (`features/tickets`): the verification queue, grouped "To check" and
  "Checked". Pick a ticket to see its detail and a before/after of the assistant's answer, and
  record the outcome. There is no `/manage` route any more.
- A shared **Shell** (`app/Shell.tsx`) carries the navigation between the two screens and the
  day/night toggle.

## Run

```bash
pnpm dev                     # from the repo root: API on :8000 + web on :5173 (/api is proxied)
pnpm --filter @tl/web test   # vitest
pnpm --filter @tl/web e2e    # Playwright smoke on ports 5273/8100 (see below)
pnpm --filter @tl/web build  # tsc + vite build + Cesium asset check
```

## Views and fallbacks

The scene is one of three renderers. `selectView.ts` picks the first available one; the user can
switch with the view buttons.

| View | Needs | Falls back to |
| --- | --- | --- |
| 3D (Cesium + Resium): **Stylised** city, or **Realistic** (Google photorealistic tiles, else Cesium OSM Buildings) | WebGL2, and building data (`/layers/buildings`) or `GOOGLE_MAPS_API_KEY` or `CESIUM_ION_ACCESS_TOKEN` | Lite map |
| Lite map (Mapbox GL Standard, GeoJSON layers) | `MAPBOX_ACCESS_TOKEN` (must start with `pk.`) | List |
| List (text, no map) | nothing | n/a |

With no keys the app shows the stylised 3D city when the world has building data (the Elmina
seed does), else the list view, and everything still works. Renderers are lazy-loaded
(the Cesium chunk is large) and wrapped in an error boundary, so a bad key, a missing WebGL
context or a failed chunk drops to the list instead of a blank page.

## Environment keys

The three browser keys are read from the **repo-root `.env`** by `vite.config.ts` and mapped
explicitly with `define` (`__GOOGLE_MAPS_API_KEY__`, `__CESIUM_ION_ACCESS_TOKEN__`,
`__MAPBOX_ACCESS_TOKEN__`, surfaced as `ENV` in `src/lib/env.ts`). No other variable reaches the
browser (`envPrefix` is `TL_PUBLIC_`).

**These keys ship to the browser, so they are public.** Restrict each by HTTP referrer in its
console (Google: Map Tiles API only; Mapbox: URL restriction) and set quota and budget alerts.
Never put a server secret (`OPENROUTER_API_KEY`, `STAFF_TOKEN`) in a browser variable. Process
environment variables override `.env` in `loadEnv`, so setting a key to an empty string (as the
Playwright config does) forces a keyless run (stylised city or list view, never billable tiles).
**Windows PowerShell 5.1 deletes a variable assigned `''`**, so `$env:GOOGLE_MAPS_API_KEY=''`
lets the `.env` keys through. Start a keyless server from Git Bash instead
(`GOOGLE_MAPS_API_KEY= CESIUM_ION_ACCESS_TOKEN= MAPBOX_ACCESS_TOKEN= pnpm dev`), or from Node, as
Playwright does.

## Resident features

- **Starters:** the assistant offers plain starter questions per mode. A starter with a persona
  (stroller, wheelchair, older adult needing rest, default) switches the mobility profile first,
  then sends the question with that profile.
- **Tappable markers:** a place, evacuation-centre or waste marker (Cesium, Mapbox) or list row
  opens the place card with its claims, status chips, evidence photo and, for evacuation centres
  and waste points, a source banner ("Official PPS" or "Candidate (OSM), not an official relief
  centre"; collection day "unknown, ask MBSA").
- **"Why this path?":** selecting a flood-coloured path (map click or list row) opens a card with
  the scenario, class (always "indicative"), method, elevation data, margin and disclaimer.
- **Honest labels:** `lib/evidence.ts` shows `team_survey_placeholder` facts as "Demo value · not
  surveyed", never as verified, with no checked date. `lib/routeStatus.ts` shows `no_data` as "No
  mapped connection (data gap)", never "Not reachable" or "Blocked".
- **Photo evidence:** a claim's staff-uploaded photo (from `photo_url`, served by the API at
  `/evidence/<id>`, requested under `/api`) renders on evidence cards and the place card. Only
  JPEG or PNG up to 5 MB are accepted for upload.

## Tickets and staff access

- **Where tickets come from:** each ticket is a verification request (VR) the assistant filed for
  a gap (`GET /verification-requests`). `ticketModel.ts` groups them into "To check" and "Checked";
  `queueLabels.ts` turns the attribute, element and reason into words (never a raw id).
- **How a ticket is resolved:** staff open a ticket and choose an outcome in `OutcomeForm`
  (verify, correct or reject), with a value for a correction and an optional photo (JPEG or PNG up
  to 5 MB, uploaded with `POST /evidence` and attached via `evidence_id`). The save goes to
  `POST /verification-requests/{id}/resolve`; the queue and the assistant's answers refetch, so the
  `BeforeAfter` panel shows how the answer changes once the fact is checked. A second resolver gets
  "Someone else already resolved this ticket."
- **Staff token field:** a "Staff access" password field (`StaffAccess.tsx`) is shown in the
  outcome form. The value is one shared token (`useStaffToken`), kept in `sessionStorage`
  (`tl.staffToken`) and sent as `X-Staff-Token`. Without it, the form says "Staff access needed".
  The API answers 503 while `STAFF_TOKEN` is the default `change-me`.
- **Attribute catalogue:** `features/tickets/attributeCatalogue.ts` mirrors
  `packages/spatial/.../attributes.py`; a drift test keeps them equal.

## Theme (day / night)

`src/ui/theme.ts` is the single source of day/night. The `useTheme` zustand store (`theme`,
`setTheme`, `toggle`) persists the choice in `localStorage` (`tl.theme`, wrapped in try/catch),
falls back to the device preference (`prefers-color-scheme: light` gives day), else night, and
writes `data-theme="day|night"` on `<html>`. Colours are CSS custom properties defined per theme;
components use semantic tokens such as `bg-surface`, `bg-raised`, `text-fg`, `text-fg-soft` and
`border-edge`, not raw palette values. Status is never colour only: `src/ui/status.ts` and
`StatusChip` pair every status with an icon, a border or pattern and a label in both themes, and
own the honest wording. `ThemeToggle` sits in the Shell. The map follows the theme: Cesium night is
a dark sky with dimmed tiles (`scene/cesium/timeOfDay.ts`; Google tiles cannot be relit), Mapbox
uses its light presets, and the List view follows the page.

## Map styles (Stylised and Realistic)

Inside the 3D view there are two map styles. The user picks one with the **Map style** radios in
the settings popover.

- **Stylised** (the default when the world has buildings): a low-poly city drawn from committed OSM
  footprints (`GET /layers/buildings`: buildings, trees and base water). It has a Day palette and a
  Night palette with lit windows. It needs no key and makes no billable request.
- **Realistic photos (Google)**: Google Photorealistic 3D tiles. Without a Google key, but with an
  Ion token, it falls back to Cesium Ion world imagery and OSM Buildings.
- **Choosing the style:** `sceneStore` holds `mapStyle` and `mapStyleChosen`.
  - `defaultMapStyle(hasBuildings, hasGoogle)` returns `stylised` when buildings exist. The
    default applies once the buildings request settles, unless the user has chosen a style.
  - `resolveMapStyle` returns the style that is actually drawn. An impossible choice falls back
    to the other style.
  - `useMapStyle()` returns `{style, hasBuildings, hasGoogle, settled}`.
- **Disabled options:** an unavailable option is disabled, with its reason as visible text: "Needs
  building data", "Needs a Google Maps key" or "Needs a 3D-capable device". A disabled option is
  never checked.
- **Honesty:** while Stylised is active the popover says "Decorative details are illustrative."
  Building heights are mostly defaults by building kind (display only). Cars, street trees,
  colours and lit windows are seeded decoration. Base water is decorative and is never a flood
  scenario. The route, flood and place layers are the same data in both styles.
- **Time of day:** Stylised re-skins itself on theme change (`reskin.ts`: palette, sky, light).
  Realistic uses `timeOfDay.ts`.
- **Camera:** the home view is closer for Stylised (`stylisedHomeView`, at most 2.5 km). Switching
  style keeps the current camera.

### Stylised module map (`features/scene/cesium/stylised/`)

```
model.ts               GeoJSON -> buildings (height, kind, tone, lit seed), grid buckets, trees; hashUnit
palette.ts             paletteFor("day" | "night"): ground, roads, water, walls, roofs, windows, trees, cars, sky
buildingsMesh.ts       walls + roof geometry with metric st (window columns x floors; roof t = -1)
buildingsPrimitive.ts  one Primitive per grid cell + window Material; setTheme, far-range night boost
ground.ts              roadsFromWalk (width by road kind), ClassificationPrimitive roads, decorative water
props.ts               kerbCars, streetTrees, instanced tree and car primitives (allowPicking: false)
reskin.ts              applies a palette to globe, sky, fog, light and every handle
StylisedCity.tsx       mounts it all inside <Viewer>; roads and props start after the buildings' first frame
StylisedPreview.tsx    DEV only: /dev/stylised (bare viewer, Day/Night, window.__tlStylised timing hooks)
```

Related: `cesium/realistic.ts` sets up and cleans up the Google/Ion tiles and imagery,
`cesium/home.ts` has `homeView`, `stylisedHomeView` and `shouldReframe`, and
`cesium/heightRef.ts` clamps overlays to the ground when Stylised is active.

**`/dev/stylised`** is registered only under `import.meta.env.DEV`, and the production build
contains none of it. It renders the city alone for visual and frame-time checks. Add `?overlays=1`
to mount the access and flood layers too. Measured numbers are in
[the quality report](../../docs/03-product/stylised-city-quality-report.md).

## Scene-intent flow

The agent never touches the scene. It emits typed `scene.intent` events over the `/chat` SSE
stream and the browser applies them:

```
POST /chat (SSE) -> parseSse -> useChatStream -> chatReducer   (messages, tool chips, evidence)
                                      |
                                      +-- scene.intent --> useScene.applyIntent (sceneStore)
                                                              route.highlight  -> route
                                                              place.focus      -> focusPlaceId
                                                              flood.set_level  -> scenarioId (+ flood layer on)
                                                              camera.fly_to    -> camera
                                                              layer.toggle     -> lensVisible
                                                              whatif.diff      -> whatIf (imagined diff)
                                                              river.rollout    -> rollout {on, stage, playing}
sceneStore --> Cesium / Mapbox / List renderers (one adapter each) + map overlays + legend
```

Each renderer reads `useScene` and the REST layers (`/layers/{lens}?profile=&scenario_id=`);
edge colour comes from `status_for_profile` (`ok | unknown | blocked | flooded_likely |
flooded_possible`) via `scene/status.ts`, and unknown is drawn dashed and amber, never green.

**What-if (Cycle 1, `ai/world-model`):**

- **The intent.** `whatif.diff` carries a FeatureCollection, and every feature has `whatif: true` and `side: before|after|touched`.
- **The map.** `features/whatif/whatifModel.diffLines` splits it.
  - The Cesium `WhatIfLayer` draws today's lines grey and dashed, the imagined lines lilac, and the imagined changes magenta.
  - The camera frames the diff.
  - `map-ui/WhatIfTag` shows the "What-if · not real" legend, with a clear button.
- **The panel.** `features/whatif/WhatIfLab` (Management mode, top of the assistant panel) calls `GET /what-if/suggestions` and `POST /what-if` without the LLM.
- **Not yet drawn.** The Mapbox lite and List views do not draw the diff; the Lab card still shows the numbers.

**Rising river (Cycle 3):**
- **Panel.** `features/whatif/RisingRiverPanel` (Management mode, under the What-if Lab) fetches `GET /river-rollout` through `useRiverRollout`. It has stage buttons and play/pause, which steps one stage every 2.5 s and drives `setScenario` so the flood layer follows. It shows per-persona "N of M still reach a centre" bars.
- **Map.** `scene/cesium/RolloutLayer` draws the synthetic residents as one `PointPrimitiveCollection` with one `clock.onTick`:
  - yellow residents walk their engine-computed route for the current stage;
  - red residents are cut off and stand still;
  - grey residents have no mapped connection.

  `map-ui/RolloutTag` (top right) always says "simulation, not a forecast".
- **Pure helpers** are in `whatif/rolloutModel`.

## File map

```
src/
  main.tsx, app/            routes.tsx (/ and /tickets), Shell (nav, theme toggle), providers (TanStack Query)
  ui/                       theme.ts (useTheme), ThemeToggle, Button, StatusChip, status.ts (honest wording)
  lib/api.ts, env.ts        typed client (openapi-fetch over @tl/api-client), ENV keys
  lib/profileStore.ts       selected mobility profile, persisted
  lib/evidence.ts, routeStatus.ts, EvidencePhoto.tsx   honest labels, photo rules and rendering
  features/
    main/                   MainPage (map + assistant layout)
    assistant/              AssistantPanel, AnswerCard, starters
    chat/                   useChatStream, parseSse, chatReducer, EvidenceCard, CitationList, uncertainty
    gaps/                   GapsSection, gapModel (what is not checked yet)
    map-ui/                 MapStage and overlays: RouteTag, FloodNote, SettingsPopover, PlaceOverlay, PathOverlay
    flood/                  floodPath ("Why this path?" facts, always indicative)
    places/                 SourceBanner, placeModel
    scene/                  sceneStore (incl. mapStyle), selectView, useMapStyle, status, styles, StatusLegend;
                            cesium/ (incl. stylised/, realistic.ts), mapbox/, list/ adapters
    tickets/                TicketsPage, TicketList, TicketDetail, OutcomeForm, BeforeAfter,
                            StaffAccess, useStaffToken, attributeCatalogue
e2e/heroes.spec.ts          Playwright flows
playwright.config.ts        webServer env (see below)
scripts/check-cesium-assets.mjs   build-time check that /cesium assets were copied
```

Cesium's static assets are copied to `/cesium` by `vite-plugin-static-copy` (`stripBase: 4` so
files land at `/cesium/<Dir>/...`, matching `CESIUM_BASE_URL`); they are gitignored.

## E2E (Playwright)

`playwright.config.ts` starts `pnpm dev` with a deterministic environment: `LLM_PROVIDER=mock`,
`TL_DATA_DIR` pointing at the tiny fixture world, a fresh SQLite file (`.data/e2e.db`, deleted
before each run), `STAFF_TOKEN=e2e-token`, and all three map keys empty (list view).
`e2e/heroes.spec.ts` covers the two-screen flow: the access and flood questions (route status,
honest demo evidence, "not a forecast", never "safe"), a gap that becomes a ticket, resolving a
ticket with the staff token, and the assistant's answer changing after the ticket is resolved.
Playwright uses its own ports (web 5273, API 8100) and waits for `/api/site`, so a dev server on
:5173/:8000 is never reused (a leftover e2e server on :5273 is reused locally, never in CI). First
run: `pnpm --filter @tl/web exec playwright install chromium`.

## What to build next

- Stylised city: measured heights for more buildings (94% are defaults), multipolygon buildings, a
  framing of the opening view that shows lit windows.
- Water-rise animation between scenario levels (levels currently switch).
- Accessibility audit beyond accessible names (axe-core is MPL-2.0, outside the MIT/Apache/BSD licence policy; use a manual screen-reader pass or a permitted checker).
- Mobile performance: Cesium chunk weight, `requestRenderMode`, test on a mid-range phone.

## Recorded answers

With `DEMO_MODE=true` the API replays recorded answers for questions it has seen (see
`data/demo/README.md`); the web app needs no change. The earlier `/?demo=hero` control bar and
the `/manage` console were removed with the redesign.
