# Stylised city enhancement: time-of-day theme, camera, look and motion (Project 3)

Status: design approved section by section with the owner on 2026-10-16. Builds on Project 2 (`docs/superpowers/specs/2026-10-16-stylised-city-design.md`, merged on `main`). A separate spec covers the UI-component polish done in the same round.

Owner's intent: the stylised 3D map should look much closer to a hand-built isometric low-poly diorama (reference image shared in the session: dusk light, soft shadows, glowing windows, varied buildings, pavements, lamps, props), in **Day as well as Night**. The theme follows the clock by default and the user can override it. The map gains gentle motion (birds, clouds, ambient). The camera opens close in and is easy to move in 3D with the mouse. Heavier GPU load is acceptable, but keep it as low as reasonably possible.

## Goal

At the same camera, side-by-side screenshots of Day, Dusk and Night read clearly closer to the reference than today's flat extrusions, while the view stays smooth on a typical laptop (targets in "Performance") and every existing layer (routes, flood, places, path statuses) and scene intent works unchanged.

## Honesty and licence constraints (unchanged rules, restated for the new work)

- Everything added here is **display only**: building shapes (parapets, shopfronts, setbacks, roof clutter), lamps, light pools, birds, clouds, cloud shadows, tree sway, water shimmer, window flicker. None of it is read by routing, evaluation, flood or answers. It is covered by the existing "Decorative details are illustrative." label, hidden from assistive tech and never pickable.
- Heights still come from OSM tags or the deterministic defaults (`height_source`). New shapes are decoration, not data. Never derive anything from Google 3D tiles.
- **No moving traffic.** Parked cars stay static; cars driving along roads could read as live traffic data.
- **No invented landmarks or signage**: no balloon, no bridge, no shop names on shopfronts.
- Decorative base water stays visibly distinct from the flood-scenario blue in all three moods (tested), and the shimmer material is only ever attached to base water, never to flood layers (tested).
- The theme clock is display-only lighting; it never changes any fact.

## Scope

In: three-mood theme with Auto (clock) and manual choice; stylised home view, field of view, mouse/touch/keyboard camera controls, on-screen camera cluster, first-visit hint; lighting model, shadows, ambient occlusion, bloom, FXAA, gradient sky; building geometry upgrades; ground (roads, pavements, parks, water); props (lamps, light pools, trees, cars, roof clutter); motion (birds, clouds and cloud shadows, ambient); quality tiers and a perf overlay; tests, docs, ADR.

Out: moving cars, boats, balloons; new access/flood facts; per-building click cards; changes to the Realistic (Google) style beyond the dusk tint and the shared theme type; the UI-component polish (separate spec); the List view look.

## 1. Theme and clock

- `apps/web/src/ui/theme.ts`: `Theme = "day" | "dusk" | "night"` (the look shown) and `ThemeChoice = "auto" | Theme` (what the user picked). The store persists `choice` in localStorage `tl.theme` (legacy `"day"` / `"night"` values still load as manual choices) and derives `theme`.
- Default choice is **`auto`** (replacing "device light/dark preference").
- `themeAt(date)` (pure) uses Asia/Kuala_Lumpur wall-clock time via `Intl.DateTimeFormat`, independent of the viewer's timezone: Day 07:00–18:00, Dusk 18:00–19:30, Night 19:30–07:00 (start inclusive, end exclusive).
- With `auto`, a 60 s timer re-evaluates, so the theme changes live without reload. The scene crossfades palettes over about 2 s; the fade is skipped under `prefers-reduced-motion`.
- UI: the header ☾/☀ toggle becomes a small menu **Auto · Day · Dusk · Night**; the button shows the current mood icon with an "A" badge on Auto. The Map settings popover offers the same four options.
- Every `"night"` branch gains an explicit dusk case: stylised palette and window glow, `mapboxLightPreset` (dusk maps to Mapbox `"dusk"`), and the Realistic tile tint (`timeOfDay.ts`).
- UI chrome has **two skins**, derived from the mood: `skinFor("day" | "dusk") = "light"`, `skinFor("night") = "dark"`. The root element carries both `data-theme` (mood) and `data-skin` (chrome); CSS tokens key off `data-skin`. Day and Dusk share the Light chrome and differ only in the 3D map. The skins themselves are specified in `docs/superpowers/specs/2026-10-16-ui-polish-design.md`.
- Tests: `themeAt` at 06:59, 07:00, 17:59, 18:00, 19:29, 19:30 under several process timezones; legacy storage values; choice to theme derivation; the timer switches when crossing 18:00 (fake timers).

## 2. Camera and controls

- **Home view** (`cesium/home.ts`, `stylisedHomeView`): about 1.2 km range, −35° pitch, centred on `site.json scene.home` (township centre around the Lakeside Mall / Urban Park), field of view about 30° in Stylised. **Whole township** fits the world bounds. Realistic keeps today's home and FOV. Answer fly-tos (`camera.fly_to`, `place.focus`, `route.highlight`) keep their logic; their final framing gets a stylised minimum pitch so they land close and oblique.
- **Mouse mapping** (new `cesium/controls/`; pure maths functions plus a thin Cesium adapter):

  | Input | Action |
  |---|---|
  | Left-drag | Constant-height X/Y pan; the grabbed ground point stays under the cursor; speed scales with height |
  | Scroll wheel | Smooth Z zoom towards the cursor |
  | Right-drag | Orbit about the point under the cursor (left/right rotates, up/down tilts) |
  | Shift + scroll, Ctrl + left-drag | Orbit (trackpad-friendly) |
  | Double-click | Glide in to that spot |
  | Release after drag | Short inertial glide |
  | Touch | One-finger pan; pinch zoom; twist rotate; two-finger drag tilt |

- **Keyboard** (only while the map region has focus, gained by click or Tab; never while typing in chat): WASD / arrows move, Q/E rotate, R/F tilt, +/− zoom.
- **Guard rails**: zoom 30 m to 20 km; tilt from straight down to 5° above horizontal; never below ground; camera centre held within about 5 km of the world bounds; hitting a limit eases to a stop, no snap.
- **Click vs drag**: a press–release with under 4 px movement is a click (place card, route card, "Why this path?" behave as today); anything more is a drag and opens nothing.
- **On-screen cluster** (`CameraControls`, bottom-right beside Map settings), **minimal by default** to honour the handoff's clean-map rule: only a small compass is always visible (click = face north). The full cluster (zoom +/−, tilt, rotate, Home, Whole township) slides out on hover or keyboard focus of that corner. Map settings gains "Always show camera controls". Every button has an accessible name and a tooltip naming its key.
- **First-visit hint**: dismissible card "Drag to move · Scroll to zoom · Right-drag to rotate", dismissal remembered in localStorage.
- Tests: pure unit tests for pan, zoom-to-cursor, orbit and every clamp; jsdom tests that buttons and keys call the camera API and keys are ignored while focus is in the chat input; Playwright asserts the List view (e2e) does not render the cluster.

## 3. The look

### Lighting and post-processing (Stylised only)

- Three-part lighting in our own shaders (buildings, ground, props): warm key, cool sky fill from above, ground bounce from below; colours per mood (Day crisp and bright; Dusk pink-orange key with blue fill; Night cool moon with warm windows).
- Shadows: Cesium shadow map from the key light; buildings and trees cast, ground/roads/water receive; soft, moderate map size, shadow distance about 3 km; **off at Night**.
- Ambient occlusion: Cesium `postProcessStages.ambientOcclusion`, low settings.
- Bloom: `postProcessStages.bloom`, Dusk and Night only, tuned so only windows, lamp heads and light pools glow.
- FXAA on.
- Sky: CSS gradient behind a transparent canvas (Day soft blue to pale horizon; Dusk violet to peach; Night deep indigo with a faint horizon glow). Fog tinted to each mood's horizon colour.

### Buildings (`buildingsMesh.ts`; still a few merged meshes per tone class)

- Roof parapet: lip about 0.6 m high, inset 0.3 m.
- Ground floor 4.2 m (upper floors stay 3.2 m) in a contrasting shopfront tone; wide glazing for commercial / mixed kinds; plain wall and door for residential; no signage text.
- One setback at about 60% of height for buildings over 8 floors.
- Smoothed normals on footprints with many short edges, so round towers shade round.
- Window styles by OSM `kind`: residential punched grid; office / commercial horizontal strips; tall buildings glass curtain bands with a daytime sky-reflection gradient.
- Seeded roof clutter (AC boxes, water tanks) on larger flat roofs, instanced.
- About six wall tones per mood instead of three; Day uses pastel walls with terracotta and slate roofs.

### Ground (`ground.ts`)

- Roads: asphalt grey-violet in every mood; subtle light centre dashes on major roads only. The night orange dash is removed.
- Pavements: raised 0.15 m slabs with kerbs along both sides of residential and major roads, from existing road widths.
- Parks / green areas: grass tint with a slightly raised edge.
- Decorative water: deeper teal with a lighter shoreline band; minimum colour difference (ΔE) from the flood-scenario blue in every mood, tested.

### Props (`props.ts`)

- Street lamps along residential and major roads; at Dusk/Night lamp heads glow and a soft light pool is drawn as a cheap ground decal (no real lights).
- Two-tier tree canopies and a third tree tone.
- Five car colours; cars stay parked.

## 4. Motion

- **One animation clock** (`stylised/motion/clock.ts`). The viewer keeps `requestRenderMode`. While motion is on and visible, a single loop requests renders at a capped 30 fps and updates one `time` uniform; all animation runs in shaders, no per-frame geometry rebuild. Interaction still renders at full rate. The loop pauses when the tab is hidden (`visibilitychange`), the map is off-screen (`IntersectionObserver`), motion is off, or `prefers-reduced-motion` is set; paused costs zero renders.
- **Birds** (Day and Dusk): 3–5 flocks of 5–9, one instanced primitive, 4-triangle low-poly bird with vertex-shader wing flap; each flock follows a seeded closed smooth loop 40–90 m up over parks and water with per-bird offsets; fade in/out about 2 s at mood changes; none at Night; not pickable, no shadows.
- **Clouds** (Day and Dusk): 6–10 low-poly clouds (flattened ellipsoid clusters) drifting slowly 250–400 m up, wrapping at the world edges; hidden at Night.
- **Cloud shadows**: not in the shadow map; ground and building shaders sample a scrolling soft noise that darkens patches by about 15%.
- **Ambient**: tree sway in the vertex shader (stronger at the canopy top, per-tree phase); shimmer and ripple on decorative base water only; street lamps fade on over about 3 s at Dusk and off at Day; at Night a few windows toggle every ~20 s.
- **Settings and accessibility**: "Motion" toggle in Map settings, default on, persisted; defaults off under `prefers-reduced-motion`, where mood changes also snap. With motion off the scene is a still frame of the same look (birds hidden, clouds frozen).

## 5. Performance and quality tiers

Targets, measured on the Elmina seed at the stylised home view, 1440×900:

- Typical integrated-GPU laptop (Intel Iris Xe / AMD Radeon 680M class): ≥ 30 fps panning, ≥ 30 fps with motion on.
- Discrete GPU: ≥ 55 fps.
- Idle with motion off: 0 renders per second.

| Tier | Shadows | Ambient occlusion | Bloom | Pixel ratio | Birds / clouds | Roof clutter, lamps |
|---|---|---|---|---|---|---|
| High | soft, 2048 map | on | Dusk/Night | device, max 2 | full | full |
| Medium | hard, 1024 map | on, low | Dusk/Night | max 1.5 | fewer | within 1.5 km |
| Low | off | off | off | 1 | birds only | off |

- Start tier from the GPU name (`WEBGL_debug_renderer_info` when available) and `navigator.deviceMemory`, else Medium. A frame-time monitor (median over about 3 s while the camera moves) drops one tier when below 24 fps; it never raises automatically. Map settings: "Quality: Auto / High / Medium / Low", persisted.
- Draw-call budget: under about 60 for the whole stylised scene (buildings merged per tone class; every prop type instanced per colour). Small details use `DistanceDisplayCondition`. Shadows only from the key light, at most 3 km, off at Night.
- Dev-only overlay at `?perf=1`: fps, frame time, draw calls, current tier. Before/after numbers per phase go in `docs/superpowers/overnight-log.md`.
- Fallback order is unchanged: Cesium, then Mapbox lite, then List. If Low tier stays under 15 fps the user is offered the List view.

## 6. Testing, verification and delivery

- **Unit (vitest, node)**: `themeAt` and theme derivation; camera maths and clamps; mesh builder (parapet, ground floor, setback, smooth normals, window style selection, vertex/index budget); seeded determinism of props, lamps, roof clutter, bird and cloud paths (closed loops, height bands); tier picker and the drop rule.
- **Palette**: every mood defines every colour; decorative water vs flood blue ΔE minimum in all moods; `skinFor` maps day and dusk to light, night to dark.
- **Fake-Cesium** (`fakeCesium.test-util.ts` pattern): re-theme touches every layer; the motion loop starts/stops on visibility, toggle and reduced motion; the shimmer material attaches only to base water; nothing decorative is pickable.
- **jsdom**: theme menu, Motion and Quality settings, camera buttons and keys, keys ignored in chat, hint dismissal.
- **E2E (Playwright)**: tiny fixture, List view: theme menu and settings work; List view unaffected. WebGL visuals are not checked in CI.
- **Manual visual check** (Stylised only, no Google tile cost): before/after screenshots at the same home camera in Day, Dusk and Night, plus one close-up and one Whole township view, compared with the reference and shared with the owner after each phase, with perf overlay numbers.
- **Delivery phases**, each merge-able and passing the full CI checklist (reported PASS / FAIL / BLOCKED / NOT RUN):
  1. Theme and clock; camera and controls.
  2. Lighting and post-processing; ground and roads.
  3. Building shapes; props.
  4. Motion; quality tiers.
- **Docs**: update `apps/web/README.md` (theme, controls, motion, quality); new ADR in `docs/00-overview/decisions/` covering the time-based theme and the decorative-motion honesty rules.
