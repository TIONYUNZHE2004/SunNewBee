# @tl/web

The TownshipLens browser app: a Vite + React 19 SPA with two routes.

- `/` resident page: layer toggles (Access / Flood / Waste), the flood scenario bar, the scene,
  the chat panel and the disclaimer banner.
- `/manage` management console: **Verification queue** (resolve with a staff token) and
  **Flood briefing** (cut-off places, isolated areas, evacuation centres, a draft advisory).

## Run

```bash
pnpm dev                     # from the repo root: API on :8000 + web on :5173 (/api is proxied)
pnpm --filter @tl/web test   # vitest
pnpm --filter @tl/web e2e    # Playwright hero smoke (see below)
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
  features/
    chat/                   ChatPanel, useChatStream, parseSse, chatReducer, EvidenceCard,
                            UncertaintyBanner (every claim shows its verification status)
    flood/                  ScenarioBar ("River +3 m (indicative)"), DisclaimerBanner
    scene/                  SceneHost (view choice + boundary), sceneStore, selectView, status, styles,
                            StatusLegend; cesium/, mapbox/, list/ adapters
    manage/                 ManagePage (tabs), VerificationQueue + resolve form, FloodBriefing, advisory
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
the access hero (route status and evidence), the flood hero ("not a forecast", never "safe"),
that the kiosk question's gap appears in `/manage`, that the flood briefing labels Official PPS
and Candidate centres, and that every button, textbox and select on both pages has an accessible
name. Playwright uses its own ports (web 5273, API 8100) and waits for `/api/site`, so a dev server you have running on :5173/:8000 is never reused. First run: `pnpm --filter @tl/web exec playwright install chromium`.

## What to build next (FE lane)

- Water-rise animation between scenario levels (levels currently switch).
- Demo replay: `?replay=` plays a scripted conversation and scene for the pitch.
- Accessibility audit with axe (`@axe-core/playwright` is not yet a dependency; the smoke only checks accessible names).
- Mobile performance: Cesium chunk weight, `requestRenderMode`, test on a mid-range phone.
- A proper legend component shared by all three renderers.
- Evidence photos on evidence cards and in the VR resolve form.
