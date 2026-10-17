# @tl/web

The TownshipLens browser app: a Vite + React 19 SPA with two screens and a time-of-day theme (Day / Dusk / Night).

- `/` **Main** (`features/main/MainPage.tsx`): a full-bleed map (`MapStage`: Cesium 3D, Mapbox
  lite or the List view) with a floating glass **assistant** panel over its right edge (a bottom
  sheet on phones). Overlays sit in map slots (route tag, flood banner, settings popover, place
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
mood: Stylised re-lights per mood, Realistic Cesium night is a dark sky with dimmed tiles
(`scene/cesium/timeOfDay.ts`; Google tiles cannot be relit), Mapbox uses its light presets, and the
List view follows the page.

## Skins and glass (Project 4)

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
rule swaps in the opaque `--c-surface`. Because `.glass` owns the border and shadow, **selection
states use `outline`** (not border or ring), for example the selected ticket row.

## Layout (Project 4)

- **Full-bleed map:** the map section fills the area under the header (`absolute inset-0`); nothing
  is laid out beside it.
- **Floating panel (lg and up):** `AssistantPanel` is a glass card inset 16 px from the top, right
  and bottom, with a width of 30% of the viewport clamped to 360-440 px (`panelWidthPx`). A tab on
  its left edge hides it (focus moves to the show button, and back). The open state persists in
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
  Building heights are mostly defaults by building kind, and the parapet adds 0.6 m (display only).
  Everything else is decoration, seeded and never a fact: the six facade tones and window styles,
  lit windows, rooftop clutter, cars, street trees, lamps and light pools (flat ground imagery under
  the route and flood lines), birds, clouds and cloud shadows, parks, pavements, kerbs and markings, and base water. Base water is never a flood
  scenario. The route, flood and place layers are the same data in both styles. The full rules are
  under "Honesty (decorative rules)" below.
- **Time of day:** Stylised re-skins itself on theme change (`reskin.ts`: palette, sky, light) with a crossfade.
  Realistic uses `timeOfDay.ts`.
- **Camera:** the home view is closer for Stylised: `framingFor("stylised", home)` gives a 1200 m
  range, a -35 degree pitch and a 30 degree vertical field of view (`fovForVertical` converts it to
  Cesium's horizontal `fov` for the canvas aspect); Realistic keeps -45 degrees and 60. Switching
  style keeps the current camera.

### Three.js Stylised engine (opt-in)

A spike renderer for the Stylised style, in `features/scene/three/`. Realistic stays on Cesium;
Mapbox lite and List are unchanged.

- **Turning it on:** `?engine=three` (persisted as `tl.engine` in `localStorage`; `?engine=cesium`
  switches back). It only replaces the Stylised style on the 3D view. If it crashes (no WebGL2,
  chunk error), the renderer boundary falls back to Mapbox, else List.
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
- **Display only:** the same rules as the Cesium Stylised city. Kind tints, default heights, parks
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
  one console warning. Footprints an archetype cannot fit, and archetypes with no asset, stay
  extruded.
- **`?assets=0`:** skip the assets (no manifest fetch); the extruded city only.
- **`?showroom=1`:** replace the plan with `assets/showroom.ts`: every asset variant once at LOD0,
  one row per asset, 30 m apart, centred on `HERO_CENTRE`, and no extruded buildings. For owner
  review of the models.
- **DOM contract additions:** `data-assets="off|loading|ready|failed"` and `data-instances` (placed
  units plus landmarks).
- **`?perf=1` fields:** draw calls and triangles per frame, both summed over every pass
  (`renderer.info` with `autoReset` off), and MB of geometry plus instance buffers (extruded city,
  library and instance attributes). Budgets at `hero-mid` on Medium: 150 draw calls, 2.5 M
  triangles, 150 MB.
- The glbs and manifest live in `public/city/` (lane `blender`); `vite build` copies them to
  `dist/city/`.

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

### Motion

Birds, clouds with cloud shadows, canopy sway, base-water ripple, lamp fade and night window
flicker. All are decorative, seeded and deterministic, and never tied to data. There is no moving
traffic. Water animation touches only decorative base water, never a flood scenario. One loop,
capped at 30 fps, drives it, and it stops when the tab is hidden, the map is off-screen, Motion is
Off or `prefers-reduced-motion` is set. Switch it off with **Motion: Off** in the settings popover
(stored in `tl.motion`). With Motion off (or reduced motion) the scene is a still frame: birds are
hidden and canopies are rebuilt without the sway shader.

Wing flap and canopy sway are vertex-shader effects clocked by `czm_frameNumber`, because a custom
appearance vertex shader cannot read a material uniform in Cesium 1.146. They run at their designed
speed at the loop's 30 fps and faster while the camera moves (more frames). Clouds are drawn at
50% opacity and hidden while a route is highlighted or a flood scenario is active, so they never
cover the answer. Leaving Stylised (for Realistic) restores the viewer's own resolution, FXAA,
bloom, ambient occlusion and shadow settings.

### Quality

**Quality** (Auto / High / Medium / Low, stored in `tl.quality`) is picked from the GPU string and
device memory (`quality.ts`, `pickTier`) and lowered automatically when the median frame rate during
camera movement stays under 24 fps; a slow device is also offered the List view. Tiers set shadow
type and map size, bloom, the maximum pixel ratio (2 / 1.5 / 1, applied with
`useBrowserRecommendedResolution = false` plus `resolutionScale`), bird and cloud counts and the
small-detail range. Ambient occlusion is off at every tier: Cesium's HBAO caused streak artifacts on
this scene. Buildings, trees and cars cast shadows only (`CAST_ONLY`). Add `?perf=1` to the URL for a
performance readout (its "draws" is Cesium's command list, which includes ~40 globe tiles).

Draw budget (2026-10-17, RTX 2050 via ANGLE D3D11, 1440x900, Home view): the decorative ground was
stencil ClassificationPrimitives and the buildings 64 class primitives, giving High 15 fps / 175
commands. Now the ground decals and light pools are globe imagery (`groundImagery.ts`), all
buildings are one primitive with one material, and flocks and clouds are one primitive each: High
60 fps (the headless vsync cap) with 61 commands at Night and 65 at Day, Low 58. With Motion off
(or reduced motion) a still scene renders 0 frames: Cesium 1.146's `PerspectiveFrustum.clone`
dropped the panel-reserve `xOffset`, so the camera never matched its per-frame clone and the scene
rendered continuously; `cesium/frustumClone.ts` patches the clone, and `Camera.getPickRay` so picks
follow the same off-centre frustum (double-click glide, zoom-to-cursor).

### Honesty (decorative rules)

Everything above is display-only and covered by "Decorative details are illustrative." There is no
moving traffic and there are no invented landmarks or signage. Pavements, kerbs, markings and parks
are painted into globe imagery (a tiled canvas `ImageryProvider`, one layer per palette, crossfaded by
layer alpha), so every route, path-status, gap and flood overlay draws on top and imagery is never
pickable. Light pools are their own imagery layer above the ground decals (alpha 0.35 x glow), so they
never tint a route or flood line, and they show only at Dusk and Night. Parks are display-only and read
`base/parks.geojson`, which the seed does not currently contain (Overpass was blocked); fetch it
with `uv run python data/scripts/build_buildings.py --parks --max-requests 40`. Water is a
GroundPrimitive with a shimmer material and is never drawn as a flood scenario. See
[ADR 0011](../../docs/00-overview/decisions/0011-time-of-day-theme-and-decorative-motion.md).

### Stylised module map (`features/scene/cesium/stylised/`)

```
model.ts               GeoJSON -> buildings (height, kind, one of six tones, window style grid|strip|curtain, lit seed), grid buckets, trees; hashUnit
palette.ts             paletteFor("day" | "dusk" | "night"): ground, roads, water, six facade tones, roofs, windows, trees, cars, sky
buildingsMesh.ts       walls + roof geometry with metric st (window columns x floors; roof t = -1, parapet t = -2); parapet draws 0.6 m above the data height (decorative)
buildingsPrimitive.ts  every building in one Primitive (split past 2M vertices) + one window Material; tone and
                       window style decoded per vertex from st.s (TONE_STRIDE 1024)
groundImagery.ts       decals -> grid index -> tiled canvas ImageryProvider (whole globe, geographic, ~0.2 m/px
                       deepest level); ground layers crossfaded per palette; light-pool layer
ground.ts              roadsFromWalk (width by road kind); groundDecals (roads, pavements, kerbs, markings,
                       shore, parks) drawn as imagery; decorative water is a GroundPrimitive with a shimmer
props.ts               kerbCars, streetTrees, streetLamps, instanced primitives (allowPicking: false, CAST_ONLY shadows)
colour.ts              hex <-> rgb and colour mixing helpers
lighting.ts            shared shader light model (key, fill, bounce, cloud-shadow `tl_cloud`)
postfx.ts              per mood and tier post-processing (bloom values)
quality.ts             High / Medium / Low tier specs, pickTier, lowerTier, frame monitor
crossfade.ts           palette fade between moods (3 s Day to Dusk, otherwise 2 s)
lines.ts               pure line helpers: dedupe, offsetLine, dashSegments (kerbs, markings)
roofs.ts               seeded AC boxes and water tanks on larger flat roofs
motion/clock.ts        one capped (30 fps) loop for all decorative motion
motion/flocks.ts       seeded bird loops and cloud spots
motion/sky.ts          one bird and one cloud primitive (per-instance flock / offset attributes; never
                       pickable, no shadows, hidden at Night)
reskin.ts              applies a palette to globe, sky, fog, light and every handle
StylisedCity.tsx       mounts it all inside <Viewer>; roads and props start after the buildings' first frame
StylisedPreview.tsx    DEV only: /dev/stylised (bare viewer, Day/Night toggle, window.__tlStylised timing hooks)
```

Camera and overlays, beside `stylised/`:

```
cesium/controls/*      CameraControls (button cluster, hint), cameraOps, cameraMath (limits, clamps),
                       configureControls (mouse/touch mapping, bounds), movedInputs, cameraUiStore
cesium/PerfOverlay.tsx ?perf=1 readout (frame time, tier)
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
                                                              day.show         -> day {on, scenario, t} paused (+ its river stage)
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
