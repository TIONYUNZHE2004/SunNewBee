# @tl/web

The TownshipLens browser app: a Vite + React 19 SPA with two screens and a time-of-day theme (Day / Dusk / Night).

- `/` **Main** (`features/main/MainPage.tsx`): on wide screens a stone frame holds a slim rail
  (`app/Rail.tsx`), the map (`MapStage`: Three.js or Cesium 3D, Mapbox lite or the List view) as a
  rounded card, and the **assistant** docked beside it as its own card (a bottom sheet on phones).
  Overlays sit in map slots (route tag, flood banner, settings popover, place
  and path overlays). The assistant has modes with starter questions (`features/assistant/starters.ts`),
  answer cards with a summary strip, collapsed evidence and uncertainty banners, and a Gaps section
  of unverified facts. See "Layout", "Answers" and "Phone bottom sheet" below.
- `/tickets` **Tickets** (`features/tickets`): the verification queue, grouped "To check" and
  "Checked". Pick a ticket to see its detail and a before/after of the assistant's answer, and
  record the outcome. There is no `/manage` route any more.
- A shared **Shell** (`app/Shell.tsx`) carries the navigation between the two screens and the
  theme menu.

## Run

```bash
pnpm dev                     # from the repo root: API on :8000 + web on :5173 (/api is proxied)
pnpm --filter @tl/web test   # vitest
pnpm --filter @tl/web e2e    # Playwright smoke on ports 5273/8100 (see below)
pnpm --filter @tl/web acceptance -g baseline  # visual/perf harness against a running server (see below)
pnpm --filter @tl/web build  # tsc + vite build + Cesium asset check
```

## Views and fallbacks

The scene is one of three renderers. `selectView.ts` picks the first available one; the user can
switch with the view buttons.

| View | Needs | Falls back to |
| --- | --- | --- |
| 3D: **Stylised** city (Three.js), or **Realistic** (Cesium + Resium: Google photorealistic tiles, else Cesium OSM Buildings) | WebGL2, and building data (`/layers/buildings`) or `GOOGLE_MAPS_API_KEY` or `CESIUM_ION_ACCESS_TOKEN` | Lite map |
| Lite map (Mapbox GL Standard, GeoJSON layers) | `MAPBOX_ACCESS_TOKEN` (must start with `pk.`) | List |
| List (text, no map) | nothing | n/a |

With no keys the app shows the stylised 3D city when the world has building data (the Elmina
seed does), else the list view, and everything still works. `three/engineChoice.ts`
(`rendererFor(view, style)`) sends the 3D view to Three.js for Stylised and to Cesium for
Realistic. Renderers are lazy-loaded (the Cesium chunk is large) and wrapped in `RendererBoundary`,
so a bad key, a missing WebGL context or a failed chunk drops to the next one (Three.js or Cesium,
then Mapbox lite, then List) instead of a blank page.

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
- **Rehearse my trip (Cycles 19–21):**
  - **Entry:** a chip beside "Travelling as" opens a card (`features/day/TripPlanner.tsx`).
  - **Scope:** the chip and card show only when `GET /assistant/scope` says `all` (`ASSISTANT_SCOPE=all`). Under the default scope B (T-011, access and flood only) the resident screen hides them, so it offers nothing the assistant would refuse. The staff screens are unchanged.
  - **Ends:** search a mapped place, or "tap a point on the map" (`tripPickStore`). Points stay in the tab and are sent once, in a POST body.
  - **Result:** `POST /day/{id}/trip` plays the trip in the rehearsed day. `TripStrip` shows one cell per 10-minute departure (colour plus glyph, words for screen readers); tapping a cell re-rehearses it.
  - **Map:** `MyTripLayer` (Cesium) and the Lite map draw the usual route, the trip, the flooded cut and "You" at the clock. The List view repeats the strip.
  - **From the assistant:** the same answer comes back with a `day.trip` intent.
  - **Wording:** what happened in the rehearsal, never advice ("leave by") or "safe".
- **Photo evidence:** a claim's staff-uploaded photo (from `photo_url`, served by the API at
  `/evidence/<id>`, requested under `/api`) renders on evidence cards and the place card. Only
  JPEG or PNG up to 5 MB are accepted for upload.

## Tickets and staff access

- **Where tickets come from:** each ticket is a verification request (VR) the assistant filed for
  a gap (`GET /verification-requests`). `ticketModel.ts` groups them into "To check" and "Checked";
  `queueLabels.ts` turns the attribute, element and reason into words (never a raw id).
- **Queue layout:** "To check" and "Checked" are tabs (`role="tablist"`, roving tabindex: Left and
  Right arrows move between tabs with wrapping, Home and End jump to the first and last, only the
  selected tab is in the Tab order). Each "To check" row carries an **asked meter**, a bar exposed as
  `role="meter"` with the label "Asked N time(s)", scaled to the most-asked open ticket. The selected
  row is marked with an accent **outline** and a left bar, and `aria-pressed="true"`.
- **Outcome choice cards:** the outcomes are native radios styled as cards (Tab and Space work).
  The chosen card gets a 2 px accent border, a tinted fill and a check glyph (decorative,
  `aria-hidden`).
- **Before/after highlight:** after a save, the "Now" side of `BeforeAfter` is highlighted for
  1.2 s with the focus-colour ring and an offset, so it shows on the accent-filled card.
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

## Theme (Auto / Day / Dusk / Night)

`src/ui/theme.ts` is the single source of the mood (Day, Dusk or Night) and the skin. The
`useTheme` zustand store holds `{choice, theme, setChoice, refresh}`: `choice` is what the user picked
(`auto|day|dusk|night`, persisted in `localStorage` as `tl.theme`, wrapped in try/catch, default
Auto) and `theme` is the resolved mood. `startThemeClock()` re-checks Auto against the Elmina clock
on a timer. It writes `data-theme="day|dusk|night"` and `data-skin="light|dark"` on `<html>`: three
moods and two skins, with Night the only dark skin. Colours are CSS custom properties keyed on the
skin; components use semantic tokens such as `bg-surface`, `bg-raised`, `text-fg`, `text-fg-soft`
and `border-edge`, not raw palette values. Status is never colour only: `src/ui/status.ts` and
`StatusChip` pair every status with an icon, a border or pattern and a label in both skins, and own
the honest wording. `ThemeMenu` (Auto / Day / Dusk / Night) sits in the Shell. The map follows the
mood: Stylised (Three.js) re-lights per mood, Realistic Cesium night is a dark sky with dimmed tiles
(`scene/cesium/timeOfDay.ts`; Google tiles cannot be relit), Mapbox uses its light presets, and the
List view follows the page.

## Skins and glass (Project 4, restyled Oct 2026)

The Oct 2026 redesign (`docs/superpowers/specs/2026-10-18-ui-redesign-design.md`) replaced the
lavender palette: Light is warm stone and ink, Dark is charcoal, type is Geist / Geist Mono, and
Sime Darby Property red (`--c-brand-red`) appears only on the logo mark (`ui/Logo.tsx`). Status
tones follow the map legend hues in `scene/styles.ts` (`--c-ok` green, amber not checked, red not
passable and likely flooded, orange possibly flooded), tuned per skin for AA text contrast.

Two skins, set on `<html data-skin>` by `ui/theme.ts`: **Light** (Day and Dusk) and **Dark** (Night).
`index.css` defines the palette as `--c-*` custom properties per skin (`--c-bg`, `--c-surface`,
`--c-raised`, `--c-fg`, `--c-fg-soft`, `--c-edge`, `--c-accent`, `--c-on-accent`, `--c-focus`,
`--c-lantern`, `--c-lilac`, `--c-flood`, `--c-rose`, `--c-peach`, the tints, and `--c-glass`,
`--c-glass-edge`, `--c-shadow`). The Tailwind 4 `@theme` block maps them to `bg-surface`, `text-fg`,
`border-edge` and so on, so components never use raw palette values. `skins.test.ts` checks the
contrast of the text tokens in both skins.

`.glass` and `.glass-strong` are Tailwind 4 `@utility` definitions (layered, so variants such as
`lg:glass` work and utilities can override them): a translucent `--c-glass` background, a blur and
saturate `backdrop-filter`, and a hairline border and shadow. An `@supports not (backdrop-filter)`
rule swaps in the opaque `--c-surface`. Glass is now kept for small pills floating over the map
(brand pill, tags, attribution); cards use `bg-surface` with `border-edge`, and a selected ticket
row shows an ink border and lift.

## Layout (Project 4, framed Oct 2026)

- **Frame (lg and up):** `Shell` lays out the rail and the page with a 12 px padding and gap
  (`FRAME_GAP_PX`). The rail has the logo, Map, Assistant (toggle), Tickets (Management, or on
  Tickets) and the theme menu. Below lg a compact header replaces the rail.
- **Map card:** the map section is a rounded card that fills the space left of the assistant. Its
  top-left brand pill (wordmark, site, Resident / Management) renders into the `brand` map slot,
  first in the `TopStack`, so the other top tags stack below it.
- **Docked panel (lg and up):** `AssistantPanel` is a card beside the map, 28% of the viewport
  clamped to 360-420 px (`panelWidthPx`). It never covers the map, so `--panel-w` is 0 on wide
  screens and `mapPanelOverlapPx()` gives the renderers no look-point offset. The close button in
  its corner hides it (focus moves to the show button on the map card, and back). The open state persists in
  `localStorage` (`tl.panel.open`, try/catch). Narrow screens start with the panel closed and
  ignore the stored choice.
- **`--panel-w`:** `MainPage` sets `--panel-w` (the width the panel covers, 0 when closed or on a
  narrow screen) on the map wrapper. Map furniture offsets itself with it, for example the camera
  controls (`right-[calc(var(--panel-w,0px)+4.5rem)]`), the settings gear and the flood banner
  (centred in the visible area).
- **Frustum offset:** `CesiumScene` sets `camera.frustum.xOffset` (`frustumXOffset` in
  `main/viewport.ts`) so the camera's look point sits at the centre of the visible map, not behind
  the panel. It is 0 below 1024 px and is applied after the field-of-view effect.
- **Map slots:** `map-ui/mapSlots.tsx` has `TopStack` (route tag, flood banner, camera hint) and
  `BottomStack` (place card and notes). Overlays render into a slot with `InSlot`, so they stack
  instead of overlapping.
- **Legend:** `StatusLegend` draws line samples with butt caps and dash patterns scaled to the
  stroke width, taken from `features/scene/styles.ts`, so they match the map. Status is never
  colour only.

## Phone bottom sheet

Below `lg` the assistant is `BottomSheet`, mounted at all times, with three heights set by a drag
handle (a 44 px target, with step buttons and keyboard: arrows, Home, End, Escape):

| Height | Size | Shows |
| --- | --- | --- |
| peek | 9.5 rem | the composer only |
| half | 55 dvh | the conversation |
| full | `calc(100% - var(--top-h, 6rem) - 0.5rem)` | the conversation, leaving the top stack (route tag, flood banner) clear |

`MainPage`'s root is `absolute inset-0` inside the Shell's `main`, which gives the map area a
definite height on phones too (below `lg` the Shell is only `min-h-screen`). It publishes
`--sheet-h` (the height the sheet covers) and `--top-h` (the TopStack's bottom, measured with a
ResizeObserver). The Shell publishes `--attr-h` on `main` (the attribution strip's measured
height, 0 when hidden); the place/path card stack, the Map settings gear and popover and the camera
controls sit `--sheet-h + --attr-h` above the bottom, so they never cover the attribution.
Playwright checks the layout at 390×844 and that the gear clears the strip on desktop and phone.
At `full` the map attribution strip is rendered on the sheet's bottom edge, since the map strip
would be covered (the licence requires it to stay visible); the map controls and card stack hide
(`invisible`). Going narrow (rotation) resets the sheet to `peek`. Asking a question from `peek` opens the
sheet to `half`. On wide screens, an ask from elsewhere (Tickets "Ask the question again", a place
card's "Ask about this place") opens a closed assistant panel first. The sheet state lives in `panelStore` (`usePanel().sheet`).

## Icons

`ui/icons.tsx` is a small in-repo set of stroked 24 px SVG paths (`<Icon name=... />`: walk,
stroller, wheelchair, older, car, flood, recycle, pin, route, check, ticket, compass, chevron, send,
camera, close), tested in `icons.test.tsx`. There is deliberately no icon package: a pack adds a
dependency and a licence to audit (the repo allows only MIT, Apache-2.0 and BSD), and sixteen
glyphs do not justify it. Add a glyph by adding a path to `PATHS` and a name to `IconName`.

## Answers (summary strip and evidence)

- **Summary strip:** `AnswerCard` renders `RouteSummary` above the text. It is built from fields the
  server attaches to the `route.highlight` scene intent (`route_status`, `distance_m`,
  `est_minutes`), not from the model's words. It shows a route-status chip (`ROUTE_CHIP`: "No known
  barrier", "Some parts not checked yet", "Not passable", "No mapped connection (data gap)"),
  distance and minutes, and for a flood answer "River +N m · indicative" (never a depth reading).
- **Demo-value chip:** whenever the answer cites `team_survey_placeholder` evidence, the strip shows
  "Demo value · not surveyed", even without a route chip, so a bare status never reads as surveyed
  fact.
- **Show on map:** the button appears only on the card whose route is the scene's current route, and
  only in the 3D view (List and Lite map ignore it); it flies the camera to the route
  (`requestRouteFocus`). Older cards do not offer it.
- **Evidence collapses:** the evidence list sits behind a header such as "Evidence · 3 sources ·
  2 with demo values (not surveyed)", with singular forms for one ("Evidence · 1 source · 1 with a
  demo value (not surveyed)"). Open it for the claim-by-claim list.
- **Honesty notes never collapse:** the uncertainty note ("Not verified"), the flood disclaimer
  ("indicative scenario, not a forecast", MBSA / JPS / NADMA) and the tickets-created line are
  always visible.
- The demo cache (`data/demo/*.jsonl`) was re-recorded with the mock so replayed intents carry the
  same route fields.

## Map styles (Stylised: Three.js, Realistic: Cesium)

Inside the 3D view there are two map styles. The user picks one with the **Map style** radios in
the settings popover.

- **Stylised** (the default when the world has buildings): a low-poly city drawn by Three.js from
  committed OSM footprints (`GET /layers/buildings`: buildings, trees and base water). It has Day,
  Dusk and Night moods with lit windows. It needs no key and makes no billable request.
- **Realistic photos (Google)**: Cesium with Google Photorealistic 3D tiles. Without a Google key, but with an
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
  Building heights are mostly defaults by building kind (display only). Everything else is
  decoration, seeded and never a fact. The route, flood and place layers are the same data in both
  styles. The full rules are under "Decorative content, tiers, picking and honesty (Three.js)" below.
- **Time of day:** Stylised re-lights per theme mood (palette, sky, light) in `ThreeScene`.
  Realistic uses `cesium/timeOfDay.ts`.
- **Camera:** each renderer has its own camera rig (`three/cameraRig.ts`, `cesium/camera.ts`).
  Each style is its own renderer, so a style switch remounts it and the camera does not carry
  over. Instead the new renderer re-frames the view on the current focus: on mount it jumps to the
  intent standing in `sceneStore` (route, then what-if, then focused place, then the last
  `camera.fly_to`; Realistic also frames a rehearsed trip), else to its start view (Three.js: the
  `hero-mid` bookmark; Cesium: the site home). Ruling P5-14: no camera-pose hand-off.

### Stylised (Three.js)

The Stylised renderer, in `features/scene/three/`. Realistic stays on Cesium; Mapbox lite and List
are unchanged. The old Cesium Stylised code and the `/dev/stylised` route are gone. Stylised never falls back to Cesium:
a Three.js crash goes to Mapbox lite, else List.

- **Selection:** `rendererFor(view, style)` (`three/engineChoice.ts`) returns `"three"` for the 3D view
  with Stylised; there is no `?engine=` parameter. `clearLegacyEngineChoice` removes a stale
  `tl.engine` from `localStorage` once on `MapStage` mount. If it crashes (no WebGL2, chunk error),
  `RendererBoundary` falls back to Mapbox, else List.
- **Shared modules:** `features/scene/shared/{quality,model,roads}.ts` hold
  the tiers, the building model and the road tables used by Three.js.
- **`?bookmark=hero-near|hero-mid|township`:** the start view for the gate screenshots
  (`bookmarks.ts`); without it the camera opens on `hero-mid`.
- **`?perf=1`:** the fps / frame time / draw calls / tier readout (`PerfOverlay`).
- **Split:** `engine.ts` owns all WebGL (renderer with Neutral tone mapping, PCF shadows, room IBL,
  composer with GTAO and bloom per tier, `MapControls`, render on demand); `ThreeScene.tsx` is the
  React side (site frame, buildings, intents, lighting per theme, quality tier, panel offset, camera
  ops). DOM tests inject a fake engine through `createEngineFn`.
- **DOM contract:** `<section data-testid="three-scene" data-frames data-route="on|off">`, with
  the same aria-label and keyboard handling as `CesiumScene`. `data-frames` updates at most every
  500 ms.
- **Display only:** Kind tints, default heights, parks
  and base water are illustrative; base water is never a flood scenario.

#### City assets

`ThreeScene` fetches `/city/manifest.json` (`assets/manifest.ts`), loads the meshopt glbs into an
`AssetLibrary` (aborted on unmount, which also frees its geometry), fits archetypes to footprints
with `planCity`, extrudes only `plan.extrude` (`buildCityGeometry(layer, frame, { only })`) and hands
the instanced archetypes to `engine.setAssets` (`assets/cityInstances.ts`, one draw call per asset,
variant and LOD). The engine re-buckets LODs at most every 250 ms while the camera moves, and once
after it stops.

- **Never holes:** the full extruded city is drawn until the assets are ready, and stays drawn when
  they fail (manifest 404, malformed or non-JSON manifest, every glb missing, a build error), with
  `data-assets="failed"`. If at least one asset loads, the state is `ready` and buildings of failed
  assets stay extruded. Each load logs at most one console warning, naming every failed glb and
  dropped manifest entry (the library collects failures in `failed`; it never warns). Footprints an
  archetype cannot fit, and archetypes with no asset, stay extruded.
- **`?assets=0`:** skip the assets (no manifest fetch); the extruded city only.
- **`?showroom=1`:** replace the plan with `assets/showroom.ts`: every asset variant once at LOD0,
  one row per asset (landmarks on the outer rows). Each row spaces its variants max(30 m, widest
  + 5 m) apart and rows sit max(30 m, half their depths + 5 m) apart, so nothing overlaps and one big
  landmark never stretches the small rows. The middle row sits on `HERO_CENTRE`. There are no
  extruded buildings, and the camera frames the whole grid once the assets are ready. For owner
  review of the models.
- **DOM contract additions:** `data-assets="off|loading|ready|failed"` and `data-instances` (placed
  units plus landmarks).
- **`?perf=1` fields:** draw calls and triangles per frame, both summed over every pass
  (`renderer.info` with `autoReset` off), and an estimate (shown as "≈ MB") of geometry plus
  instance buffers, from CPU array sizes (extruded city, library and instance attributes). Budgets at `hero-mid` on Medium: 150 draw calls, 2.5 M
  triangles, 150 MB.
- The glbs and manifest live in `public/city/` (lane `blender`); `vite build` copies them to
  `dist/city/`.

#### Streaming (Three.js)

Decorative content is planned per 250 m tile around the camera target (`stream/`), not for a fixed
hero district.

- **Tiles and rings:** ring 0 is the target tile, ring 1 the 8 around it, ring 2 two tiles out (only
  while the camera range is ≤ 1500 m). Beyond 1500 m only rings 0–1 show, and only trees and roads.
  Caps per tile come from `tileCap` (`TILE_CAPS[tier][ring]`, ×1.6 in the hero district); seeds come
  from the tile key, so a tile's content depends only on its key, the tier and the data, never on
  visit order, the mood or Day playback.
- **Streamer:** `createStreamer` runs on the engine's 250 ms LOD tick (`engine.onLodTick`) and asks
  for at most one tile per tick. Plans are kept in an LRU of 64 (tile × ring); a tile whose ring or
  tier changed keeps its old content until its re-plan.
- **Planning in a Worker:** `planClient.ts` posts the inputs once (`init`) to a module Worker
  (`stream/plan.worker.ts`) and then one `plan` at a time; the result is applied on a later tick.
  At most one plan is in flight: a newer request supersedes a waiting one (its promise rejects with
  `Superseded`) and a stale reply is dropped. Without `Worker`, or if constructing it throws, planning
  runs on the main thread, one tile per call. A Worker `error` switches the session to the main
  thread and re-plans the pending tile there. Determinism is the same on both paths (the planners
  are pure and seeded by tile key). The planners' layer caches are warmed once per input set: in the
  Worker on `init`, and on the main thread (`warmPlanners`, idle callback) only in the fallback. The
  sign font is warmed once per sign set (`warmSignFont`) so a cold glyph does not stall a sign
  rebuild.
- **Merging:** `useDecor` (kits via `setKits`, lamp pools, signs), `useMotion` (agents), `useRoads`
  (the `roads` decor slot) and `useFacades` (facades for ring ≤ 1 tiles only, no shadows) rebuild
  only when the active tiles change. The scene's `data-tiles` attribute is the active tile count.
- **Sliced rebuilds:** when a merge or layer build exceeds 8 ms, merged layers (kits, lamps, signs,
  roads, ground decor) are rebuilt in steps by `sliceWork` (`scene/idle.ts`), at most 8 ms of steps
  per frame. A layer swaps in only when complete (`onDone`); a newer job replaces a pending one.
  Facades and roofs keep their own idle task.
- **Shaders and swaps:** before a replaced decor layer is shown, `engine.ts` runs
  `renderer.compileAsync` against the scene pass target (the old layer stays drawn meanwhile; if it
  throws, the layer is shown anyway and compiles on first render, with one console warning).
  Compiled shader programs are pinned (`pinPrograms`) so a layer that disappears (beyond 1500 m) and
  returns does not link again. Replaced layers are disposed after the next render.
- **Measures:** User Timing `tl:stream-plan` (main-thread plan), `tl:stream-reply` (one Worker
  reply), `tl:stream-init` (one-off `init` post), `tl:stream-merge` (only the passive-effects share
  of a merge, so not comparable with P4), `tl:stream-slice` (one sliced frame), per-layer
  `tl:stream-{kits,lamps,signs,roads,ground,facades,roofs,union}`, and `tl:stream-upload` (the first
  render after a swap). `tl:worker-plan` is the Worker's own time and is not a main-thread task.
- **Fly measurement:** `scripts/measure-fly.mjs` (a mock dev server running) flies hero-mid, probe-c,
  probe-a, hero-mid three times at Medium and reports every `tl:*` measure. Its gate is no
  `tl:stream-*` measure above 16 ms during the fly loops; load-time `tl:stream-init` and the cold
  first merge are outside it (ruling P5-15). `--no-worker` A/Bs the main-thread path. Numbers are
  indicative (one machine, GPU).
- **Status (honest):** on the final code the 16 ms gate passed in 1 of 3 runs. The residual spikes
  are GC pauses and unattributed time around 19-20 ms, plus facade idle builds up to 18.5 ms. Owner
  ruling P5-19 accepted this for P5; it is logged for P6.
- **Facades (decorative):** `useFacades` (the `facades` decor slot) lays procedural window and
  shopfront quads (`facade/facadePlan.ts`, `facade/facadeLayer.ts`; at most 5 draws) 0.05 m out
  from the walls of the extruded buildings in ring ≤ 1 tiles. Window storeys come from the displayed
  height ÷ 3.2 m, including `default` heights (their card already says "Default estimate"). A facade
  never changes a footprint or a height and never rises above the roof; the building under it stays
  pickable as the same building. Farther tiles, and every tile at Low, show the plain palette
  extrusion. Shopfront palettes are chosen per unit, and facades and roofs rebuild only when
  the tier moves between Low and not-Low.
- **Roofs (decorative):** `useRoofs` (the `roofs` decor slot) draws rooftop units, skylights and an
  edge band on the extruded roofs of 600 m² or more in ring ≤ 1 tiles (`facade/roofPlan.ts`,
  `facade/roofLayer.ts`; no shadows, none at Low). Landmark buildings get none. The OSM podium
  under the Kanopi tower gets a podium deck instead (planters, a pool in base-water `#7fb6c9`, a
  pergola; `facade/podiumDeck.ts`) and stays pickable. Large extruded roofs whose palette roof is
  grey take one of four `ROOF_TINTS` (warm concrete, terracotta, sand, cool membrane) at every tier.
- **Ground decor, verges and lots (decorative):** `planTileVerges` plans grass verge strips (ring
  ≤ 1, skipping parks and water; Medium ring 0 only, ruling P4-Z: hitch budget) and ring 0 shrubs; `planTileLots`
  (`stream/lotsPlan.ts`) plans parking stalls and parked cars only on land-cover `parking`
  polygons, plus construction sites (gravel tint, earth tracks, by-area kit props). Verges and the
  construction ground share one ground-decor mesh (`useGroundDecor`, the `ground-decor` slot,
  `ground/groundDecor.ts`); stall lines ride the road-markings mesh (`useRoads`). The ground stays at
  6 draws (`ground/bands.ts`). Parked cars are their own stream kind `parked` (costed per car at
  the worst variant), ride the static kit buckets with the `parked` material (unlit at every
  mood, unlike moving traffic), fill a fixed 70 % of the stalls (`CARS_SHARE`, ruling P4-AF: never
  mood-dependent), and never move or fade with Day / Rollout.
  None of it at Low or beyond 1500 m.
- **Culling:** `CityInstances.update` gets the view frustum padded by the shadow extent (`cull.ts`),
  so an off-screen shadow caster is never left stale.
- **Probe views:** `probe-a`…`probe-d` in `bookmarks.ts` are 800 m views over four non-hero
  precincts (Elmina Valley 3, Elmina Green, Subang Galaksi, Seksyen U16); with `hero-mid` and
  `township` they are the six views the any-position budget holds at Medium. Open one with
  `?bookmark=probe-a`. `scripts/measure-probes.mjs` records draws, tris and MB at all
  six (`pnpm --filter @tl/web exec node scripts/measure-probes.mjs`, with a mock dev server running).
- **Per tier:** High and Medium stream everything above (Medium draws verges at ring 0 only); Low
  plans roads only: no facade detail, roof dressing, verges, shrubs, lots, props, agents or signs.

#### Motion (Three.js)

Decorative traffic and pedestrians (`motion/`), plus the birds, cloud shadows, tree sway, water
shimmer and window flicker, all move on one motion clock (`motion/motionClock.ts`, driven by
`engine.ts`). It runs on real time: one tick per rAF (display rate) at High and Medium, and 30 fps
for the rest of the page session once the clock measures a median below 45 fps during motion. At
Low, motion is off: there is no motion driver, no motion frame or timer, and sway, shimmer and
flicker hold their rest pose. It runs only while Motion is on, `prefers-reduced-motion` is off, the tab is visible
and the map is on screen (`IntersectionObserver`). Otherwise no frame is scheduled: the engine idles
at render on demand and holds a still pose. Motion time excludes stopped spans, so agents resume
where they stopped instead of jumping. Every rebuilt agent layer shares one smoothed-yaw memory.

- **Agents:** `planAgents` puts seeded vehicles on `street`/`major_road` edges and people on
  `footway`/`path`/`pedestrian` edges of each streamed tile, weighted ×3 near schools, malls and
  parks. The count is the tile's cap × mood density (day 1.0, dusk 1.15, night 0.45). Agents loop along the
  edges with no routing or collision, so cars can pass through each other.
- **Drawing:** `motionLayer` uses one InstancedMesh per kit, variant and LOD. Matrices are rewritten
  each tick, but only for agents in view (with a 50 m margin). Agents beyond their last LOD's `maxM`
  are hidden. Agents cast no shadows and are left out of the AO pass.
- **Scale-up:** agents are drawn 1× within 150 m of the camera, rising to 3× at 800 m, for
  legibility. This is display only; the models are unchanged.
- **Day/Rollout fade:** people and vehicles fade out over 1 s while Elmina Day or Rollout playback
  is on, and fade back in when both are off.
- **Honesty:** decorative only (`userData.decorative`, no-op raycast), never picked or described.

#### Decorative content, tiers, picking and honesty (Three.js)

**What is decorative** (`userData.decorative = true`, a no-op `raycast`, skipped by `pickAt`; never
described by the assistant or the cards): the ground layer (land-cover tints, road surfaces,
markings, water shimmer), the prop kits (trees, lamps, street furniture, construction), lamp light
pools, people and vehicles (motion layer), birds and cloud shadows (ambient), window flicker, and any
landmark the manifest marks `decorative`; and the P4 decor: procedural facades, rooftop units,
skylights and roof bands, the Kanopi podium deck, grass verges, verge shrubs, parked cars, parking
stall lines and the construction ground (gravel tint, earth tracks). The stylised fallback building is *not* decorative: it is a
real, pickable OSM building, and only its colours are display styling (derived from the manifest
palette; its card says "(shown as a simple block)"). While any decorative layer is drawn the map shows
the note **"Decorative details are illustrative."** (`DecorativeChip`, `notes` slot).
`honesty.test.ts` guards the spec section 5 list: decorative tags and no-op raycasts, signs only with a
source, the 1 s Day/Rollout fade, flat matte flood water at 0.30 m, and no land-cover or base-water
colour (`#7fb6c9`) equal to a flood colour (`#C53030`, `#DD6B20`, `#1e6fb8`). For the streamed
decor it also checks (on a really planned tile and the Elmina seed): every new layer is decorative
and raycasts to nothing; the building under a facade, and the Kanopi podium (`w1545153991`) under its
deck, still pick as themselves; parked cars (`pk:` ids) are never agents and keep their opacity
through the Day/Rollout fade; facades never rise above a building's height or leave its walls; no
decor colour (stalls, gravel, tracks, verges, deck pool, roof tints, kit palettes) equals a flood
colour; and every overlay keeps `depthTest` off and a `renderOrder` ≥ 10, above every decor object
(the ambient birds sit at 12 inside the main scene, which the overlay pass draws over).

**Query params:**

| Param | Effect |
|---|---|
| `?perf=1` | Show the perf line. |
| `?bookmark=hero-near\|hero-mid\|township\|probe-a\|probe-b\|probe-c\|probe-d` | Start view (default `hero-mid`). |
| `?assets=0` | Extruded city only, no manifest fetch. |
| `?showroom=1` | Model showroom grid instead of the city. |

**Perf fields** (`?perf=1`): `fps`, frame ms, draw calls, triangles, `≈ MB` (geometry estimate), the
tier, and `fb nf/gf/na/ns` when buildings fall back to a block: `nf` no_fit, `gf` generic_fill, `na`
no_archetype, `ns` no_asset (the same counts as `data-fallback`).

**Tiers** (Auto picks from the GPU and drops one tier when frames run slow; or choose one in Map
settings):

- Props are capped per streamed tile, not per city: `TILE_CAPS[tier][ring][kind]`
  (`three/stream/caps.ts`), read through `tileCap`, which multiplies by `HERO_BOOST` (×1.6) when
  the tile centre is in the hero district. Ring 0 caps (before the boost), High / Medium: trees
  145 / 60, lamps 80 / 60, furniture 50 / 36, construction 12 / 6, people 24 / 14, vehicles
  16 / 10, signs 60 / 40, verges 50 / 37, parking stalls 200 / 120, parked cars 24 / 20. Ring 1
  is roughly half that (Medium ring 1 has no verges, ruling P4-Z), and ring 2 draws trees only
  (High 60, Medium 40). Low caps everything at 0. `caps.ts` is the source of truth; its comments
  give the triangle budget the caps are sized for.
- `KIT_LOD_SCALE` multiplies kit LOD distances at run time (High 0.75, Medium 0.5, Low 1); archetypes
  are not scaled.
- **Low draws no props and no agents** (no lamps, people, vehicles, birds or clouds), and no signs.

**Picking priority** (one shared `pickAt`, first match wins): place, evac, waste, sign, landmark,
resident, flood edge (within 8 px), then building. Markers, residents and flood edges live in the
overlay pass, so a building never hides them; a sign or landmark behind a nearer building is
occluded. Batched meshes resolve to ids through lookup tables (`markerIdAt`, `signIdAt`,
`residentIdAt`).

**Sources:** a shop sign is drawn only with text, `source_url` and `as_of` (the buildings layer's
`signage`; anything else is dropped and never shown), and its card links the source. A landmark is
its OSM building drawn with a model; the card names the match method, and a traced outline or design
height names its own source from the manifest.

### Theme: Auto, Day, Dusk, Night

The theme menu offers **Auto** (follows the Elmina clock, Asia/Kuala_Lumpur: Day 07:00-18:00, Dusk
18:00-19:30, Night 19:30-07:00; re-checked on a timer), or a fixed Day, Dusk or Night. The choice is
display-only lighting and never changes a fact. Chrome has two skins: light (Day and Dusk) and dark
(Night). Dusk chrome uses the light skin, so CSS keys on `data-skin`, not `data-theme`.

### 3D controls (Cesium)

| Input | Action |
|---|---|
| Left-drag | Pan at constant height (grabbed point stays under the cursor) |
| Right-drag, middle-drag, Ctrl+left-drag, two-finger drag | Orbit and tilt |
| Wheel, pinch | Zoom towards the cursor |
| Shift+wheel | Tilt |
| Double-click | Glide in |
| Arrow keys or WASD | Move |
| Q / E | Rotate left / right |
| R / F | Tilt up / down |
| + / - | Zoom |
| N | Face north |

A camera cluster (bottom right, revealed on hover or focus): Home view, Whole township, zoom, tilt,
rotate, and a compass button that faces north. A one-time hint ("Drag to move, Scroll to zoom,
Right-drag to rotate") can be dismissed. The camera is bounded: its position is clamped to the
township plus a 5 km margin, and pitch and range have limits. Home always recovers. A click versus
a drag is decided by Cesium's `ScreenSpaceEventHandler` click tolerance (5 px of pointer movement);
the click itself picks with `scene.drillPick` over an 8 px window, so thin ground lines are easy to
hit and place markers win over paths. The compass reads its own heading store
(`controls/cameraHeadingStore.ts`), so camera moves re-render only the camera controls.

### Realistic camera and overlays (Cesium)

```
cesium/controls/*      CameraControls (button cluster, hint), cameraOps, cameraMath (limits, clamps),
                       configureControls (mouse/touch mapping, bounds), movedInputs, cameraUiStore
cesium/PerfOverlay.tsx ?perf=1 readout (frame time, tier)
```

`cesium/realistic.ts` sets up and cleans up the Google/Ion tiles and imagery, and `cesium/home.ts`
has `homeView`, `framingFor` and `shouldReframe`. `cesium/heightRef.ts` picks the height reference for
markers and labels (clamp to Google tiles when configured, else to the ground). `cesium/frustumClone.ts`
patches Cesium 1.146's `PerspectiveFrustum.clone`, which dropped the panel-reserve `xOffset` (so the
camera never matched its per-frame clone and a still scene rendered continuously under
`requestRenderMode`), and `Camera.getPickRay`, so picks follow the same off-centre frustum
(double-click glide, zoom-to-cursor). The decorative motion, quality tiers and honesty
rules for Stylised are under "Stylised (Three.js)" above; see also
[ADR 0011](../../docs/00-overview/decisions/0011-time-of-day-theme-and-decorative-motion.md) and
[the quality report](../../docs/03-product/stylised-city-quality-report.md) (historical Cesium numbers).

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
                                                              day.show         -> day {on, scenario, t} paused (+ its river stage)
                                                              day.trip         -> day at the leave time (any mode) + myTrip (+ its river stage)
                                                              journey.play     -> journey (the JourneyPlan) + useJourney.load (paused at t = 0)
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
- **Every view (Cycle 8).** The diff also carries a `meta` member: the engine summary, action labels and profile. Before/after features carry `from_name`/`to_name`, and touched features carry `label`.
  - `MapboxLite` draws the same three line layers. Its filter requires `whatif == true`.
  - The List view's `scene/list/WhatIfListSection` spells out the diff as text: the imagined changes, today vs what-if counts, and the journeys that change.
  - The pure helpers are `diffMeta`, `diffJourneys` and `touchedLabels`.
- **The panel.** `features/whatif/WhatIfLab` (Management mode, top of the assistant panel) calls `GET /what-if/suggestions` and `POST /what-if` without the LLM.

**Rising river (Cycle 3):**
- **Panel.** `features/whatif/RisingRiverPanel` (Management mode, under the What-if Lab) fetches `GET /river-rollout` through `useRiverRollout`. It has stage buttons and play/pause, which steps one stage every 2.5 s and drives `setScenario` so the flood layer follows. It shows per-persona "N of M still reach a centre" bars.
- **Map.** `scene/cesium/RolloutLayer` draws the synthetic residents as one `PointPrimitiveCollection` with one `clock.onTick`:
  - yellow residents walk their engine-computed route for the current stage;
  - red residents are cut off and stand still;
  - grey residents have no mapped connection.

  `map-ui/RolloutTag` (top right) always says "simulation, not a forecast".
- **Pure helpers** are in `whatif/rolloutModel`.

**Resident journey (D-T4, spec 2026-10-19 §6.2 and §6.4):**
- **Contract.** `journey.play` carries the backend's `JourneyPlan` (`intent.journey`). `sceneStore.applyIntent` stores it as `journey` and loads `features/journey/journeyStore` paused at the start; `chatReducer` notes `journey: {routeId, startTime}` on the answer. Changing the profile or scenario, or `reset`, drops the journey.
- **Timeline.** `features/journey/timeline.ts` is pure: `buildTimeline(plan)` gives phases (`dive` 4 s, `walk` at 20x, one `event` hold per plan event with the screen time from `HOLD_SCREEN_S` and the plan's `hold_s` as simulated time, `pull` 5 s); `stateAt(timeline, t)` gives distance, simulated seconds, the "HH:MM" clock, rests taken and minutes outdoors (paused on the covered event's span). Holds never move the hero along the route, so the HUD at each event start equals the plan.
- **Store.** `journeyStore` (zustand): `plan`, `timeline`, `t`, `playing`, `camMode` (`follow|overview|free`); `load`, `play`, `pause`, `seek`, `restart`, `setCam`, `advance(dt)` (the player's frame tick), `clear`. `journeyStateOf(store)` reads the HUD state. No rendering yet; auto-play is not here.
- **Fixture.** `features/journey/fixtures/demoPlan.json` is the real `POST /journeys` plan for the §2 demo route (09:00). Regenerate with `uv run python apps/web/scripts/build-journey-fixture.py` (needs the Elmina seed; excluded from Biome as generated data).

## File map

```
src/
  main.tsx, app/            routes.tsx (/ and /tickets), Shell (nav, theme menu), providers (TanStack Query)
  ui/                       theme.ts (useTheme, startThemeClock), ThemeMenu, Button, StatusChip, icons.tsx, status.ts (honest wording)
  lib/api.ts, env.ts        typed client (openapi-fetch over @tl/api-client), ENV keys
  lib/profileStore.ts       selected mobility profile, persisted
  lib/evidence.ts, routeStatus.ts, EvidencePhoto.tsx   honest labels, photo rules and rendering
  features/
    main/                   MainPage (full-bleed map + panel), BottomSheet, panelStore, viewport
    assistant/              AssistantPanel, AnswerCard, RouteSummary, TravelChip, starters
    chat/                   useChatStream, parseSse, chatReducer, EvidenceCard, CitationList, uncertainty
    gaps/                   GapsSection, gapModel (what is not checked yet)
    map-ui/                 MapStage and overlays: mapSlots (TopStack, BottomStack), RouteTag, FloodNote, SettingsPopover, PlaceOverlay, PathOverlay
    flood/                  floodPath ("Why this path?" facts, always indicative)
    places/                 SourceBanner, placeModel
    scene/                  sceneStore (incl. mapStyle), selectView, useMapStyle, status, styles, StatusLegend;
                            three/ (Stylised), cesium/ (Realistic, incl. realistic.ts), shared/ (quality, model, roads), mapbox/, list/ adapters
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
`e2e/three.spec.ts` covers the Three.js Stylised renderer: frames, a route, the
decorative note, a place pick, the real city assets, and tile streaming at `probe-a` (`data-tiles` >
0; the tiny fixture lies ~1.5 km away, so the rig clamps the target near the world bounds and the
tiles around it stream).
Playwright uses its own ports (web 5273, API 8100) and waits for `/api/site`, so a dev server on
:5173/:8000 is never reused (a leftover e2e server on :5273 is reused locally, never in CI). First
run: `pnpm --filter @tl/web exec playwright install chromium`.

## Acceptance harness (resident journey)

`acceptance/` holds the visual and performance checks of the resident-journey work (spec
`docs/superpowers/specs/2026-10-19-resident-journey-simulation-design.md` §3, §9). It is not part of
CI: it needs a real GPU and the Elmina seed.

- Start a server yourself (`LLM_PROVIDER=mock pnpm dev`, Stylised map), then run
  `ACCEPTANCE_BASE_URL=http://localhost:5173 pnpm --filter @tl/web acceptance -g baseline`.
  No webServer; 1440x900 at DPR 1; ANGLE D3D11 on the high-performance GPU with vsync and the frame
  limit off (the renderer string is recorded; a software renderer fails the run).
- Specs are `*.accept.ts`, so neither `e2e` nor vitest picks them up. The pure helpers' unit tests
  (`acceptance/support/*.test.ts`) do run in vitest.
- `support/bookmarks.ts`: the five evaluation bookmarks (`overview`, `hero-mid`, `street`,
  `link-low`, `night-mid`) and `gotoBookmark(page, name)`, which forces `tl.quality=high` and the
  bookmark's `tl.theme`, closes the assistant panel and the camera tips (map notes stay), sets the
  pose and waits for streaming (tiles, assets, road layer) to settle.
- `support/scene.ts`: `pickGrid` / `pickMask(page, kind)` (building, ground, road, sky; cells under UI
  chrome are left out) and `decodePng`. `support/pixels.ts`: `lumaHistogram`, `fractionBelow`,
  `countColour(img, hex, tol)`, `laplacianVariance(img, box)`, `greyShare`; all take a box, points or
  a per-pixel mask (`mapArea`: the canvas less UI chrome). `support/frames.ts`:
  `captureFrameStats(page, seconds)`: display-paced orbit fps plus uncapped frame time
  (`engine.renderNow` + `gl.finish`) for headroom. `support/journey.ts`: `journey.seek/play/pause`
  over `window.__journey` (Phase D; throws "not available" until then).
- `baseline.accept.ts` writes five PNGs and `metrics.json` to `ACCEPTANCE_OUT` (default: the
  journey-sim ledger folder `.superpowers/sdd/journey-sim/acceptance/baseline`).
- The app side is `window.__tlAcceptance` (`three/scene/useAcceptanceHook.ts`): `setPose`, `getPose`,
  `size`, `frames`, `pickGrid(step)`, `measure(seconds, orbitDegPerSec)`,
  `measureUncapped(frames, degPerFrame)`, `roadVertices`, `gpu`. It is installed only in
  dev builds (`import.meta.env.DEV`) or when the page is loaded with `?acceptance=1`; it moves the
  camera and reads the scene, never data or settings.

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
