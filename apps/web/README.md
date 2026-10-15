# @tl/web

The TownshipLens browser app: a Vite + React 19 SPA with two routes.

- `/` resident page: layer toggles (Access / Flood / Waste), the flood scenario bar (with a
  "Where can I go?" button once a scenario is on), "Jump to" deep-spot buttons (from
  `site.deep_spots`; each flies the camera, turns its layer on and, for a flood spot, sets
  `stage_p3m`), the scene, the chat panel, the place card and the "Why this path?" popover.
- `/manage` management console: KPI tiles (open verification requests, median hours to resolve,
  journeys confirmed from the latest run) above three tabs: **Verification queue** (resolve with
  a staff token), **Flood briefing** (cut-off places, isolated areas, evacuation centres, a draft
  advisory, an "Assumptions" section with the selected profile's thresholds) and **Journey
  tests** (run the resident-agent batch, outcome matrix, top data gaps, invariant violations,
  recent runs, file a verification request for a gap).

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
| 3D (Cesium + Resium; Google photorealistic tiles, else Cesium OSM Buildings) | `GOOGLE_MAPS_API_KEY` or `CESIUM_ION_ACCESS_TOKEN`, and WebGL2 | Lite map |
| Lite map (Mapbox GL Standard, GeoJSON layers) | `MAPBOX_ACCESS_TOKEN` (must start with `pk.`) | List |
| List (text, no map) | nothing | n/a |

With no keys the app shows the list view and everything still works. Renderers are lazy-loaded
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
Playwright config does) forces the keyless list view.

## Resident features

- **Persona chips:** the chat suggests plain questions for the active layer (flood, else waste,
  else access). A chip with a persona (stroller, wheelchair, older adult needing rest, default)
  switches the profile selector first, then sends the question with that profile.
- **"Where can I go?"** in the scenario bar asks the assistant from the active flood scenario.
- **Tappable markers:** a place, evacuation-centre or waste marker (Cesium, Mapbox) or list row
  opens the place card with its claims, status chips, evidence photo and, for evacuation centres
  and waste points, a source banner ("Official PPS" or "Candidate (OSM), not an official relief
  centre"; collection day "unknown, ask MBSA"). With a staff token entered on `/manage`, the card
  also offers per-attribute editing and the audit history.
- **"Why this path?":** selecting a flood-coloured path (map click or list row) opens a card with
  the scenario, class (always "indicative"), method, elevation data, margin and disclaimer.
- **Honest labels:** `lib/evidence.ts` shows `team_survey_placeholder` facts as "Demo value · not
  surveyed", never as verified, with no checked date. `lib/routeStatus.ts` shows `no_data` as "No
  mapped connection (data gap)", never "Not reachable" or "Blocked".
- **Photo evidence:** a claim's staff-uploaded photo (from `photo_url`, served by the API at
  `/evidence/<id>`, requested under `/api`) renders on evidence cards and the place card. Only
  JPEG or PNG up to 5 MB are accepted for upload.

## Management features

- **Verification queue:** Open / Resolved / All tabs plus reason, attribute and element filters
  (sent as `?status=&reason=&attribute=&element_id=`). The resolve form (verify, correct, reject)
  takes an optional photo, uploaded with `POST /evidence` and attached via `evidence_id`.
- **Staff token:** one shared token for all tabs, kept in `sessionStorage` (`tl.staffToken`) and
  sent as `X-Staff-Token`.

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
sceneStore --> Cesium / Mapbox / List renderers (one adapter each) + ScenarioBar + legend
```

Each renderer reads `useScene` and the REST layers (`/layers/{lens}?profile=&scenario_id=`);
edge colour comes from `status_for_profile` (`ok | unknown | blocked | flooded_likely |
flooded_possible`) via `scene/status.ts`, and unknown is drawn dashed and amber, never green.

## File map

```
src/
  main.tsx, app/            router (/ and /manage), providers (TanStack Query), ResidentPage
  lib/api.ts, env.ts        typed client (openapi-fetch over @tl/api-client), ENV keys
  lib/profileStore.ts       selected mobility profile, persisted
  lib/evidence.ts, routeStatus.ts, EvidencePhoto.tsx   honest labels, photo rules and rendering
  features/
    chat/                   ChatPanel, useChatStream, parseSse, chatReducer, EvidenceCard, suggestions
                            (persona chips), UncertaintyBanner (every claim shows its verification status)
    flood/                  ScenarioBar ("River +3 m (indicative)", "Where can I go?"), DisclaimerBanner,
                            FloodPathPopover ("Why this path?")
    places/                 PlaceCard, SourceBanner, placeModel
    scene/                  SceneHost (view choice + boundary), sceneStore, selectView, status, styles,
                            StatusLegend, DeepSpots; cesium/, mapbox/, list/ adapters
    manage/                 ManagePage (KPI tiles + tabs), VerificationQueue (filters, resolve form),
                            FloodBriefing + Assumptions, JourneyTests, AttributeEditor, AuditHistory,
                            CreateVrButton, advisory
e2e/heroes.spec.ts          Playwright smoke
playwright.config.ts        webServer env (see below)
scripts/check-cesium-assets.mjs   build-time check that /cesium assets were copied
```

Cesium's static assets are copied to `/cesium` by `vite-plugin-static-copy` (`stripBase: 4` so
files land at `/cesium/<Dir>/...`, matching `CESIUM_BASE_URL`); they are gitignored.

## E2E smoke (Playwright)

`playwright.config.ts` starts `pnpm dev` with a deterministic environment: `LLM_PROVIDER=mock`,
`TL_DATA_DIR` pointing at the tiny fixture world, a fresh SQLite file (`.data/e2e.db`, deleted
before each run), `STAFF_TOKEN=e2e-token`, and all three map keys empty (list view). It checks
the access hero (route status and honest demo evidence), the flood hero ("not a forecast", never
"safe"), that the kiosk question's gap appears in `/manage`, that staff can correct a numeric fact
from the queue, that the flood briefing labels Official PPS and Candidate centres, that every
button, textbox and select on both pages has an accessible name, that a list-view place card opens
and Esc returns focus, that the journey tests run, and that a fact edited to Unknown shows in its
history. Playwright uses its own ports (web 5273, API 8100) and waits for `/api/site`, so a dev
server on :5173/:8000 is never reused (a leftover e2e server on :5273 is reused locally, never in
CI). First run: `pnpm --filter @tl/web exec playwright install chromium`.

## What to build next (FE lane)

- Water-rise animation between scenario levels (levels currently switch).
- Demo replay in the UI: `?replay=` plays a scripted conversation and scene for the pitch (the API side, `DEMO_MODE`, replays recorded turns).
- Accessibility audit with axe (`@axe-core/playwright` is not yet a dependency; the smoke only checks accessible names).
- Mobile performance: Cesium chunk weight, `requestRenderMode`, test on a mid-range phone.
- A proper legend component shared by all three renderers.
