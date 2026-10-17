# Stylised City on Three.js — Phase 3 (hero district) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the opt-in Three.js view (`?engine=three`) look and behave like the reference in the hero district, around the Lakeside Mall and Elmina Valley 1–2. That means:
- styled fallback buildings;
- keyframe lighting on the Elmina clock;
- roads and land cover;
- trees, lamps and street furniture;
- moving traffic and people;
- sourced signage;
- the ported overlays;
- picking and cards;
- the spec §5 honesty tests.

The phase ends at the owner's visual and performance gate.

**Architecture:**
- Everything is drawn inside the existing `three/engine.ts` scene. New content arrives through a small number of engine slots: `setGround`, `setProps`, `setMotion`, `setSigns` and `setOverlays`.
- Each slot takes an object with `{ group, update?, dispose }`, built by a pure planner plus a thin Three.js builder in `three/<area>/`.
- Lighting becomes a continuous function of a **mood clock**: the real Elmina clock, a pinned mood, or Elmina Day playback `day.t`. It drives the sun, hemisphere, fog and the role-material glow uniforms.
- Overlays read `useScene` exactly as the Cesium layers do and reuse their pure helpers (`styles.ts`, `groupEdgesByStatus`, `parseGaps`, `diffLines`, `dotsAt`, ...). Only the drawing is new.
- Picking uses one raycast pipeline with a fixed priority order. Decorative content is never hit.

**Tech stack:**
- three 0.186.1: `InstancedMesh`, `Line2`/`LineMaterial`, `ShaderMaterial` patches, `CanvasTexture`.
- `troika-three-text`, exact-pinned, only if Task 9's spike shows `CanvasTexture` text is unreadable. Ruling below.
- vitest 5, Playwright 1.64.
- Python 3.13 + uv + shapely for the data lane.
- Blender 5.2 headless for the one new archetype variant.

**Spec:** `docs/superpowers/specs/2026-10-17-stylised-city-threejs-overhaul-design.md`, §2.1, §2.4–§2.8, §3, §4 Phase 3 and §5, with ADR 0012 and ADR 0013.
- Read the previous plan's handoff first: `docs/superpowers/plans/2026-10-17-stylised-threejs-phase-2-assets.md`, and the 2026-10-18 entry in `docs/superpowers/overnight-log.md`.
- Read `AGENTS.md` and `CLAUDE.md`.

**Scope:** spec §4 Phase 3 only, in the hero district. Rolling out across the whole township (streaming, township-wide props) is Plan P4, and it starts only after the owner passes this plan's gate. Flipping the default engine is Plan P5.

**Session handoff: the state at the start of P3 (2026-10-18)**

**Branch and assets**
- **Branch:** `feat/stylised-threejs`, local only. Phase 2 ends at `docs: phase 2 assets of the three.js stylised overhaul` (`f3d7d42`).
- **Phase 2 delivered:**
  - 13 archetypes, 3 landmarks and 5 kits in `apps/web/public/city/` (2.0 MB, manifest v1);
  - the loader `three/assets/` (`library`, `fit`, `plan`, `cityInstances`, `roleMaterial`, `showroom`);
  - building `front_deg` on 59.9 % of non-generic buildings;
  - two-storey bungalows.
- **Owner verdicts from P2:**
  - All asset gates passed.
  - People and vehicles stay true scale in the assets. **P3 enlarges them at runtime with camera distance** (1× near, rising to about 3× at hero-mid), as decorative display.
  - Kanopi and Masjid Denai Alam get outlines traced from a public site plan, with the source recorded.
  - The before/after comparison showed that **tan fallback extrusions dominate close-ups**. This is the first P3 item.

**What already works in Three.js**
- The extruded city, instanced archetypes with LODs, the Lakeside Mall on its outline, the route line, camera intents, three discrete lighting presets, quality tiers, the perf overlay (`?perf=1`) and bookmarks (`?bookmark=hero-near|hero-mid|township`).

**What is missing**
- Everything listed in the goal.
- `LightPreset.windowEmissive` is not wired to `roleUniforms.uWindowGlow`.
- `setLighting` swaps in a new `THREE.Fog` on every call. At `township` (range 7000 m) the city disappears into fog (far 3500 m).
- Nothing raycasts.

**Performance and environment**
- **Measured performance** (RTX 2050, 1440×900, Medium, hero-mid): about 127 fps, 54–61 draws, at most 2.2 M tris over all passes, about 13 MB. The budget is 150 draws and 2.5 M tris, so props must be capped by tier (see Global Constraints).
- **Machine:** 8 GB RAM. The dev server was stopped twice by the memory reaper. Run one heavy process at a time, and use `--maxWorkers=3` for vitest.
- **Ledger:** `.superpowers/sdd/2026-10-18-stylised-threejs-phase-3/` (create `progress.md`). P2 ledger: `.superpowers/sdd/2026-10-17-stylised-threejs-phase-2-assets/progress.md`. Search it for "P3 input".

**Prerequisites (coordinator)**
1. Fast-forward the worktrees `../SunNiuBi-wt/fe`, `../SunNiuBi-wt/data` and `../SunNiuBi-wt/blender` to `feat/stylised-threejs` (`git -C <wt> merge --ff-only feat/stylised-threejs`).
2. In each worktree, run `pnpm install && uv sync --all-packages --all-groups`.

## Global Constraints

**Scene and rendering**
- Realistic stays on Cesium. Mapbox lite and List are unchanged. Three.js stays opt-in with `?engine=three` until the P3 gate passes; flipping the default is P5.
- Every renderer reads `useScene`. The agent never touches the scene.
- The error-boundary chain Three.js → Mapbox → List must keep working.
- Local frame: x is east, y is up, z is −north, in metres from `site.center` (`three/frame.ts`).
- Lifts above ground, to avoid z-fighting:

  | Layer | Lift |
  |---|---|
  | ground and land cover | 0.00–0.06 m |
  | roads | 0.08 m |
  | markings | 0.10 m |
  | flood overlay | 0.30 m |
  | status lines | 0.40 m |
  | route | `ROUTE_LIFT_M` = 0.6 m (unchanged) |

- **Routes and status paths always draw on top** of props and buildings: overlay pass with `depthTest:false` and `renderOrder ≥ 10`, as the route already does (spec §3).

**Honesty** (spec §2.1, AGENTS.md)
- **Decorative content is never pickable, never cited and never described by the assistant.** Decorative content means: props, people, vehicles, birds, window flicker, cloud shadows, base water, decorative land-cover tints and fallback-building styling. It gets `raycast = NOOP` and `userData.decorative = true`.
- The scene shows **"Decorative details are illustrative."** inside the Three.js view (a chip in the `notes` slot) whenever any decorative layer is drawn.
- **Flood stays a tinted, hatched ground overlay** with classes `likely_flooded` and `possible`. Never draw a water surface, a rising plane or a depth.
  - Flood colours come from `styles.ts`: `flooded_likely #C53030`, `flooded_possible #DD6B20`, scenario water `#1e6fb8` at alpha 0.55, draped.
  - **Base and land-cover water stays `#7fb6c9`**, never the flood blue. It is never hatched and never touches flood layers.
- **Signs need a source:** `text`, `source_url` and `as_of`, already filtered by the API. Text only, no logos. A sign card shows "Source: OpenStreetMap, as of <as_of>" with a link. A shopfront without a sign gets the blank `light`-role sign band from the asset.
- **Building cards** show "Building type: <archetype label> · Source: OSM" plus " · Height: <display_height_source label>". A fallback building's card says "Building type: <archetype or 'unclassified'> (shown as a simple block)".
- **Land cover is fill only.** Empty land is never filled with invented buildings. Construction land is drawn as a construction site (bare earth plus kit props).
- Landmarks are placed only from a `landmarks.geojson` feature with that `model`.
- Never derive anything from Google tiles. AGENTS.md's Google rule is never edited.

**Motion** (spec §2.6, Q25)
- Driven by real time, never by frame count. A single motion clock runs at most 30 fps.
- **Pause** when the tab is hidden or the map is off screen.
- **Stop** when `useSceneSettings().motion` is false or `prefers-reduced-motion` is set.
- Decorative people and vehicles **fade out over 1.0 s** while `useScene().day.on || useScene().rollout.on`, and fade back when both are off. Birds, sway, water shimmer and window flicker may stay.

**Lighting** (spec §2.5, Q26)
- Mood source precedence:
  1. Elmina Day playback (`day.on`) uses `day.t` minutes after midnight;
  2. a pinned theme (`useTheme().choice !== "auto"`);
  3. the real Asia/Kuala_Lumpur clock.
- Mood blends continuously between the Day, Dusk and Night keyframes. A change of source crossfades over 3000 ms (day ↔ dusk) or 2000 ms (any other change). Reduced motion applies the target at once.

**Budgets**
- Hero-mid on Medium, measured on all passes: ≤ 150 draw calls, ≤ 2.5 M tris, ≤ 150 MB geometry and instance buffers, and **≥ 30 fps at 1440×900** on the owner's laptop.
- Props are capped per tier through `PROP_CAPS` (Task 6).

**Data**
- Data from the browser only: `GET /layers/buildings` (buildings, trees, water, parks, landcover, signage, landmarks) and `GET /layers/access` (walk LineStrings with `type`).
- No new API endpoints, except the landmark outlines that the data lane adds to the seed.
- **Road widths by walk `type`** (from `cesium/stylised/ground.ts` `WIDTH_BY_TYPE`, reused not copied):

  | Type | Width |
  |---|---|
  | `major_road` | 10 m |
  | `street` / `residential` / `service` | 6 m |
  | `footway` / `path` / `pedestrian` / `steps` / `crossing` | 2.5 m |
  | unknown | 3 m |

**Machine, commits and cost**
- **Machine:** 8 GB RAM. One Blender process at a time. Never run Blender, the dev server, a browser and vitest together. Use `--maxWorkers=3` for vitest.
- **Commits:**
  - Conventional with a scope.
  - Data regeneration goes in its own `data: …` commit.
  - Stage explicit paths.
  - End every message with:
    ```
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01ABPsGqAf7MUCUpLKt3qAqQ
    ```
- **Lanes:**

  | Lane | Tasks | Paths |
  |---|---|---|
  | `fe` | Tasks 1, 3–9, 11–16 | `apps/web/**` |
  | `blender` | Task 2 | `assets/blender/**`, `apps/web/public/city/**` |
  | `data` | Tasks 2 (analysis step) and 10 | `data/**` |

  - The coordinator merges with `--no-ff` into `feat/stylised-threejs` and never into `main`. The owner pushes only on request.
- **Cost:** `LLM_PROVIDER=mock`. The Three.js view loads no Google tiles; the Cesium Realistic style does, so never open it while testing.
- **Done** means the AGENTS.md CI checklist run with `set -o pipefail`, each check reported PASS / FAIL / BLOCKED / NOT RUN. Mark mock-backed checks as mock-backed.

**Rulings (record in the ledger at the start):**
- "Text rendering: try `CanvasTexture` sign quads first (no dependency). Adopt `troika-three-text` (MIT) only if a 1440×900 screenshot at hero-near shows unreadable text. Cost if wrong: one dependency, pinned exactly."
- "Roads are drawn as ribbons from walk LineStrings, not polygons, because no road polygon data exists. Cost if wrong: junctions overlap slightly, and a P4 polygon builder replaces them."
- "Motion agents follow walk edges as polylines with a seeded start offset, with no routing or collision. Cost if wrong: cars may pass through each other at junctions. This is decorative and labelled."
- "The hero-district radius for props and motion is 1200 m around `HERO_CENTRE`. P4 lifts it. Cost if wrong: an empty-looking edge, tuned at the gate."

## Review Focus

1. **A prop, tree or building hiding a route or status path at hero-near** must never happen. Routes and overlays draw in the overlay pass. This is pinned in Task 11 (`renderOrder`, `depthTest:false`, and a test that an overlay line is never occluded).
2. **Scrubbing Elmina Day playback back and forth** must move lighting smoothly with `day.t`, with no flicker and no fog jump. Decorative traffic stays faded until playback ends. This is pinned in Task 3 (`moodAt` is monotone around keyframes, and `day.t` wins over a pinned theme) and Task 8 (`decorativeOpacity`).
3. **A tab left hidden, the map scrolled off screen, Motion off, or reduced motion** must leave no rAF loop running. The engine idles at render-on-demand. This is pinned in Task 8 (`motionRunning` truth table and a fake-timer test that no ticks are scheduled).
4. **Flood and base water drawn together** must stay visually distinct: flood is hatched `#1e6fb8`/red/orange on top, base water is `#7fb6c9` underneath. Neither turns into a water surface. This is pinned in Task 12 (a geometry test that flood meshes are flat at the overlay lift and have no vertical extent, plus a colour test) and Task 15.
5. **The Low tier or a weak GPU with many props** must keep the frame budget. Props and agents scale down by `PROP_CAPS[tier]` and turn off entirely at Low. This is pinned in Task 6 (`capFor`) and Task 16 (a perf check at Medium plus a tier-change test).

---

## Part A — The city first (owner priority 1)

All paths are under `apps/web/src/features/scene/three/` unless stated otherwise.

### Task 1: Styled fallback buildings and fallback statistics

**Files:**
- Modify: `cityMesh.ts` (fallback styling), `ThreeScene.tsx` (statistics on the DOM and the perf overlay), `../cesium/PerfOverlay.tsx` (`usePerfStats` gains `fallback`)
- Create: `fallbackStyle.ts`
- Test: `fallbackStyle.test.ts`, `cityMesh.test.ts`, `ThreeScene.dom.test.tsx`

**Interfaces:**
- Consumes: `CityPlan.stats.fallback` (`no_archetype | no_asset | no_fit | generic_fill`) and the `extrude` set (Phase 2); `manifest.palettes`; `precinctGroupOf`, `paletteFor`.
- Produces:
  ```ts
  // fallbackStyle.ts
  export interface FallbackColours { wall: string; roof: string; trim: string }
  /** Colours for an extruded building, so fallbacks blend with the instanced archetypes: walls from the
   *  archetype (else residential/commercial) palette primary, roof from secondary, a 0.6 m parapet band in trim. */
  export function fallbackColours(p: { archetype?: string; kind?: string; precinct?: string; id: string },
    m: Manifest | null, groups: [string, string][]): FallbackColours;
  // cityMesh.ts
  buildCityGeometry(layer, frame, opts?: { only?: ReadonlySet<string>; colours?: (props) => FallbackColours })
  ```
- When `colours` is set, each extruded building has walls in `wall`, a roof cap in `roof`, and a parapet band (top 0.6 m of the walls) in `trim`. Without it, today's `KIND_COLOUR` tan stays: it is the fallback when there is no manifest.
- DOM: `data-fallback="<no_fit>,<generic_fill>,<no_archetype>,<no_asset>"`. `usePerfStats.fallback` prints in `?perf=1` as `fb nf/gf/na/ns`.

- [ ] **Step 1: Write the failing tests.**
  - `fallbackStyle.test.ts`:
    - A `link_intermediate` in "Elmina Valley 2" gets `wall` equal to the valley palette entry's primary and `roof` equal to its secondary.
    - A generic `kind:"commercial"` building gets the `commercial` palette.
    - The result is deterministic for the same id.
    - `m === null` returns the neutral `{wall:"#ece8df", roof:"#3d4147", trim:"#d8d3c8"}`.
  - `cityMesh.test.ts`: with `colours`, the top-face (roof) vertex colour equals `roof`, the wall vertex colour equals `wall`, and the vertex count per building is unchanged plus the parapet band, which adds 24 vertices per building ring edge pair. Assert the count you implement and write the formula in a comment.
  - `ThreeScene.dom.test.tsx`: `data-fallback` matches `plan.stats.fallback`.
- [ ] **Step 2: Run:** `pnpm --filter @tl/web exec vitest run src/features/scene/three/fallbackStyle.test.ts src/features/scene/three/cityMesh.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** In `ThreeScene`, pass `colours: (p) => fallbackColours(p, manifest, manifest.precinctGroups)` when the manifest loaded. Convert colours to linear sRGB the way `cityMesh` does today.
- [ ] **Step 4: Run** the same command, then `pnpm --filter @tl/web exec vitest run src/features/scene/three --maxWorkers=3`. Expect PASS.
- [ ] **Step 5: Measure and log.**
  - Open `/?engine=three&perf=1&bookmark=hero-mid` with the dev server on mock.
  - Record the four fallback counts for the whole city and for the hero (the perf line), using the Task 2 script for the hero split.
  - Add the counts to the ledger.
- [ ] **Step 6: Commit** (`feat(web): fallback extrusions take the archetype palette, fallback counts on the perf line`).

### Task 2: Fewer fallbacks in the hero rows (data analysis, plus a `link_corner` variant if the data says so)

**Files:**
- Create: `data/scripts/report_fallbacks.py`, `data/scripts/tests/test_report_fallbacks.py`
- Modify, if needed (blender lane): `assets/blender/tl_assets/specs.py`, `archetypes.py`, `tests/test_blender_pipeline.py`; `apps/web/public/city/**` as a data commit
- Modify, if needed (fe lane): `three/assets/fit.ts`, `fit.test.ts`

**Interfaces:**
- Produces:
  ```python
  # report_fallbacks.py: mirrors fit.ts rules 1–3 (fill, row, scale bands) in Python for analysis only, reading specs.ASSETS bands
  def classify(feature, spec) -> str  # "fit" | "fill" | "sx" | "sz" | "sy" | "no_asset" | "no_archetype"
  def main(argv) -> None  # --radius-m 1200 --center 101.5095,3.1805; prints a table per archetype x reason, plus a histogram of OBB w for link rows that fail on sx
  ```
- The decision rule: if at least 20 % of the hero `link_*` fallbacks are row-end units failing `sx` with an OBB width of 7.5–10 m, add `link_intermediate` variant `corner` and `link_long` variant `corner`:
  - size 8.6 × 8.5 × 15.5 (link_long: 8.9 × 8.5 × 24.0);
  - a side wall with windows on +x and a side garden strip;
  - the same LOD caps as `gable`.
  - In `fit.ts`, a row whose last unit's width is ≥ 1.2 × `size.w` places that end unit as `corner` (mirrored on the −x end) instead of stretching it.
  - Otherwise, record a ruling "corner variant not needed — <numbers>" and skip the asset steps.

- [ ] **Step 1: Write the failing pure test.** `test_report_fallbacks.py`:
  - A 6.4 × 15.5 footprint gives "fit".
  - An L-shape gives "fill".
  - A 6.4 × 40 footprint gives "sz".
  - A missing archetype gives "no_archetype".
  - A 3-unit row with an 8.8 m end unit is reported in the end-unit histogram.
- [ ] **Step 2: Run** `uv run pytest data/scripts/tests/test_report_fallbacks.py -q`. Expect FAIL, then implement, then PASS.
- [ ] **Step 3: Run the report** for the hero radius and paste the table into the ledger. Apply the decision rule and record a ruling either way.
- [ ] **Step 4 (only if the rule fires; blender lane): the `corner` variant.**
  - Extend `test_link_houses` so `corner` gets the same checks as `gable`, plus: no openings on −x, glass on +x, and size bounds.
  - Implement it in `archetypes.py`.
  - Build and pack all assets (`uv run python assets/blender/run.py --all && uv run python assets/blender/pack.py`). Confirm that only the link glbs and `manifest.json` changed.
  - Run the asset tests, including the Blender-marked ones.
  - **Owner gate (coordinator):** show the `link_intermediate_lod0.png` preview next to `refs/A/eg4-design3.png`, at most 2 rounds.
  - Make two commits: `feat(assets): link house corner variant`, then `data: link corner variant glbs`.
- [ ] **Step 5 (only if the rule fires; fe lane): fitting.**
  - `fit.test.ts`: a 3-unit row 6.4 + 6.4 + 8.8 m wide gives units `[gable, gable, corner]`, with the corner unit at sx ≈ 8.8/8.6. A row with no wide end gives no corner unit.
  - Implement the rule in `fitArchetype` behind `spec.variants.corner` existing.
  - Commit `feat(web): row-end units use the corner variant`.
- [ ] **Step 6: Re-measure** the Task 1 fallback counts at hero-mid and ledger the before/after.

---

## Part B — Light and atmosphere (owner priority 2)

### Task 3: Keyframe lighting on the mood clock, the fog fix and glow uniforms

**Files:**
- Create: `mood.ts`, `mood.test.ts`
- Modify: `lighting.ts` (add `blendPresets`), `engine.ts` (`setLighting` mutates the existing `Fog`; new `setFogScale`), `ThreeScene.tsx` (the mood loop replaces the theme-only effect), `lighting.test.ts`, `ThreeScene.dom.test.tsx`, `engine.create.test.ts`

**Interfaces:**
- Consumes: `LIGHT_PRESETS`, `keyLightDir`, `sunPosition` (`sun.ts`); `useTheme` (`choice`, `theme`); `useScene().day` (`on`, `t`); `RoleUniforms` (`uWindowGlow`, `uLitShare`, `uLightGlow`).
- Produces:
  ```ts
  // mood.ts
  export type MoodSource = { kind: "day"; t: number } | { kind: "pinned"; theme: Theme } | { kind: "clock"; now: Date };
  export function moodSource(s: { dayOn: boolean; dayT: number; choice: "auto" | Theme; now: Date }): MoodSource;
  /** Weights over the keyframes for a source; continuous in time for "day" and "clock" (KL minutes after midnight),
   *  linear ramps between anchors: night→day 06:30–07:30, day→dusk 18:15–19:15, dusk→night 19:15–20:00.
   *  Pinned = a one-hot weight. */
  export function moodWeights(src: MoodSource): { day: number; dusk: number; night: number };  // sums to 1
  export function moodPreset(w: { day: number; dusk: number; night: number }): LightPreset;    // via blendPresets
  /** Glow uniforms for a mood: window glow = night·1.6 + dusk·0.8 (LightPreset.windowEmissive); lit share 0.35 + 0.23·night
   *  (Cesium litFrac day 0.35 → night 0.58); light-role glow = 0.2·dusk + 1.0·night. */
  export function glowFor(w): { uWindowGlow: number; uLitShare: number; uLightGlow: number };
  /** Fog scales with camera range so the township view is never fogged out: near = max(preset.near, 0.6·range), far = max(preset.far, 2.2·range). */
  export function fogFor(p: LightPreset, rangeM: number): { color: string; near: number; far: number };
  // lighting.ts
  export function blendPresets(a: LightPreset, b: LightPreset, k: number): LightPreset;  // colours lerped in linear space
  // engine.ts
  setLighting(p: LightPreset, keyDir: [number, number, number]): void  // mutates scene.fog (no new Fog)
  setFogRange(rangeM: number): void   // called on camera range change; applies fogFor
  ```
- The key light direction for blended moods is `keyLightDir` of the dominant weight. Day uses the real sun position for the clock source, and the time `day.t` mapped onto today's date for the day source.
- The mood loop re-evaluates every 60 s for the clock source and on every `day.t` change. A change of source starts a crossfade (2000 ms, or 3000 ms between day and dusk) using `requestAnimationFrame`. Reduced motion skips the crossfade.

- [ ] **Step 1: Write the failing tests.**
  - `mood.test.ts`:
    - `moodSource` precedence: day beats pinned beats clock.
    - Weights at `t = 12*60` are `day = 1`; at 19:15 `dusk = 1`; at 22:00 `night = 1`; at 18:45 day and dusk are both in (0, 1) and sum to 1.
    - **Review Focus 2:** for t over 05:00–23:00 in 1-minute steps, each weight changes by at most 0.05 per minute.
    - `glowFor` night gives `{1.6, 0.58, 1.0}` and day gives `{0, 0.35, 0}`.
    - `fogFor(day, 7000).far ≥ 15400`.
    - `blendPresets(a, b, 0)` equals `a` and `(…, 1)` equals `b`.
  - `lighting.test.ts`: the invariant `hemiIntensity + envIntensity ≤ 1` holds for blends at 0.25, 0.5 and 0.75 between every pair.
  - `ThreeScene.dom.test.tsx`:
    - Setting `useScene.setState({day: {...on: true, t: 21*60}})` calls `setLighting` with a night-weighted preset, even with `useTheme` pinned to "day".
    - Role uniforms follow `glowFor`.
  - `engine.create.test.ts`: two `setLighting` calls keep the same `scene.fog` object.
- [ ] **Step 2: Run** `pnpm --filter @tl/web exec vitest run src/features/scene/three/mood.test.ts src/features/scene/three/lighting.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** `mood.ts`, `blendPresets`, and the engine changes. In `ThreeScene`, subscribe to `useTheme`, `useScene` (`day.on`, `day.t`), the 60 s clock and the camera range (via `rig.get().rangeM` in `onFrame`, throttled to fog updates when the range changes by more than 10 %).
- [ ] **Step 4: Run** the Step 2 tests, then `src/features/scene/three` in full. Expect PASS.
- [ ] **Step 5: Browser check.** On mock, check `bookmark=township` at day: the city is visible, not fogged out. Use the Elmina Day panel in Management mode and play it: the light passes through dusk around 19:15 and windows light up. Save screenshots to the ledger's `refs/`.
- [ ] **Step 6: Commit** (`feat(web): keyframe lighting on the Elmina clock and Day playback, range-scaled fog, glow uniforms`).

---

## Part C — Ground (owner priority 3)

### Task 4: Roads, pavements and land cover

**Files:**
- Create: `ground/ribbons.ts`, `ground/landcover.ts`, `ground/groundLayer.ts`, and their tests
- Modify: `engine.ts` (`setGround`), `ThreeScene.tsx` (wiring with `useLayer("access","default",null)` and `useBuildings().landcover`)

**Interfaces:**
- Consumes: `WIDTH_BY_TYPE` and road kinds, exported from `../cesium/stylised/ground.ts` (export them if they aren't; don't copy); `frame.toLocal`; land-cover feature `properties.class`.
- Produces:
  ```ts
  // ground/ribbons.ts
  export interface Ribbon { positions: Float32Array; indices: Uint32Array; kind: "major" | "residential" | "footway" | "other" }
  /** Triangle-strip ribbons around walk LineStrings, mitred joins capped at 2×width, at the road lift (0.08 m),
   *  plus dashed centre markings for major roads (0.10 m). Pure. */
  export function ribbonsFromWalk(fc: GeoJSON.FeatureCollection, frame: LocalFrame, opts?: { clipCentre?: [number, number]; clipRadiusM?: number }): Ribbon[];
  // ground/landcover.ts
  export const LANDCOVER_COLOURS: Record<string, string>;  // forest #6f9a5b, grass #9cc483, scrub #8fae6e, farmland #c9c98f,
     // oil_palm #7d9a55, residential #e6e1d6, commercial #e0dbe4, industrial #d9d6cf, parking #c7c4bd, construction #c9b28d,
     // bare #d8ccb3, water #7fb6c9 (base water, never flood blue)
  export function landcoverMesh(fc: GeoJSON.FeatureCollection, frame: LocalFrame): THREE.BufferGeometry;  // vertex colours, triangulated, lifts 0.00–0.06 by class order
  // ground/groundLayer.ts
  export interface GroundLayer { group: THREE.Group; dispose(): void }
  export function createGroundLayer(roads: Ribbon[], landcover: THREE.BufferGeometry, tier: Tier): GroundLayer;
  // engine.ts
  setGround(g: GroundLayer | null): void  // replaces and disposes the previous
  ```
- Land-cover draw order, lowest first: farmland, oil_palm, forest, grass, scrub, residential, commercial, industrial, parking, bare, construction, water.
- Ground meshes receive shadows, are decorative and do not cast.

- [ ] **Step 1: Write the failing tests.**
  - `ribbons.test.ts`:
    - A straight 100 m street gives a ribbon 6 m wide (±0.01) at y = 0.08.
    - A `major_road` is 10 m wide and has markings at y = 0.10.
    - A footway is 2.5 m wide.
    - An unknown type is 3 m wide.
    - A 90° bend's mitre is at most 2 × width.
    - `clipRadiusM` drops segments outside the radius.
  - `landcover.test.ts`:
    - The water class colour is `#7fb6c9`, and no class colour equals `#1e6fb8`.
    - Every class from the brief has a colour, and an unknown class gets `#d8d3c8`.
    - Lifts follow the draw order.
    - The output mesh contains no vertical faces.
  - `groundLayer.test.ts`: every mesh has `userData.decorative === true` and a no-op `raycast`.
- [ ] **Step 2: Run** `pnpm --filter @tl/web exec vitest run src/features/scene/three/ground`. Expect FAIL.
- [ ] **Step 3: Implement.** The access layer is about 5 MB, so fetch it after the first building frame, as Cesium does, and build the ribbons once. Clip the props to the 1200 m hero radius, but draw land cover for the whole township.
- [ ] **Step 4: Run** → PASS. Measure draws and tris at hero-mid on Medium in the browser; the ground must cost at most 6 draws.
- [ ] **Step 5: Commit** (`feat(web): roads, pavements and land cover in the three.js ground`).

---

## Part D — Props and motion (owner priorities 4–5)

### Task 5: Instanced kit renderer (shared by trees, furniture, construction, people and vehicles)

**Files:**
- Modify: `assets/cityInstances.ts` (accept kit placements; static kits go through the same bucket and LOD code), `assets/roleMaterial.ts` (vertex hooks for sway and limbs, plus vehicle light colours)
- Test: `assets/cityInstances.test.ts`, `assets/roleMaterial.test.ts`

**Interfaces:**
- Consumes: `Placement` (Phase 2) and `createRoleMaterial`.
- Produces:
  ```ts
  // roleMaterial.ts: new uniforms (shared object, like the glow ones)
  export interface MotionUniforms { uTime: { value: number }; uSway: { value: number }; uLimb: { value: number } }
  export function createMotionUniforms(): MotionUniforms;  // 0, 1, 1
  createRoleMaterial(opts: { instanced: boolean; uniforms: RoleUniforms; motion?: MotionUniforms; kind?: "tree" | "person" | "vehicle" | "static"; palette? })
  ```
- **Tree:** the vertex x/z offset is `sin(uTime·1.3 + phase)·0.25 m·B·uSway`, where B is `COLOR_0.b` and the phase comes from the instance matrix translation.
- **Person:** rotation about the x axis of the limb pivot is `±0.45 rad·sin(uTime·6 + phase)·uLimb`. Use + for B = 0.25 and − for B = 0.75. The pivot height is 0.9 m for legs (B in the leg band, y < 0.95 m) and 1.35 m for arms, scaled by the instance scale. B = 0.5 does not move.
- **Vehicle:** `light` role with B < 0.5 is a warm white headlight `#fff4d6`; B ≥ 0.5 is a red tail light `#ff3b30`. Both multiply `uLightGlow`, with headlights at a minimum of 0.15 so they stay visible by day.
- `createCityInstances(lib, plan, m, uniforms, extra?: { kits?: Map<string, Placement[]>; motion?: MotionUniforms })`. The new fifth argument carries kit placements, keyed by `kit/variant` as in `plan.placements`, and their buckets use the kit's manifest LODs. Trees use `kind: "tree"` with `motion`, and other static kits use `kind: "static"`.

- [ ] **Step 1: Write the failing tests.**
  - `roleMaterial.test.ts` (shader-stub style, as in Phase 2):
    - `kind: "tree"` injects `uSway` and the sway term.
    - `kind: "person"` injects `uLimb` and pivot logic referencing 0.9 and 1.35.
    - `kind: "vehicle"` includes both light colours.
    - `motion` uniforms are shared objects.
    - A material without `motion` compiles unchanged, which covers the snapshot of the Phase 2 path.
  - `cityInstances.test.ts`:
    - Kit placements create decorative, unpickable buckets.
    - People and vehicle buckets don't cast shadows at LOD1.
    - `stats().instances` counts kits.
- [ ] **Step 2: Run:** `pnpm --filter @tl/web exec vitest run src/features/scene/three/assets`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit** (`feat(web): kit instancing with tree sway, limb swing and vehicle light shaders`).

### Task 6: Static props planner: trees, lamps, furniture and construction sites

**Files:**
- Create: `props/propsPlan.ts`, `props/propsPlan.test.ts`, `props/caps.ts`
- Modify: `ThreeScene.tsx` (plan the props once buildings, land cover and walk are loaded; pass them to `createCityInstances` as kits)

**Interfaces:**
- Consumes: walk LineStrings (`type`), land cover (`class`), buildings (footprints, to avoid), parks, `layer.trees` (OSM tree points), places (`type`), and the manifest kits.
- Produces:
  ```ts
  // props/caps.ts
  export const PROP_CAPS: Record<Tier, { trees: number; lamps: number; furniture: number; construction: number; people: number; vehicles: number }>;
  //   high { 6000, 1500, 600, 300, 400, 250 } · medium { 3500, 900, 350, 200, 220, 140 } · low { 0, 0, 0, 0, 0, 0 }
  export function capFor(tier: Tier, kind: keyof typeof PROP_CAPS["high"]): number;
  // props/propsPlan.ts
  export interface PropsPlan { kits: Map<string, Placement[]>; stats: Record<string, number> }
  export function planProps(input: { walk; landcover; buildings; parks; trees; places; frame: LocalFrame; centre: [number, number];
    radiusM: number; tier: Tier; m: Manifest }): PropsPlan;
  ```
- All placement is seeded through `hash01(id, salt)`, so the same input always gives the same output.
- **Tree rules** (stop at `capFor(tier, "trees")`, nearest to centre first):
  - OSM tree points become `rain_tree` (70 %) or `flame_tree` (30 %).
  - Street trees every 18 m on both kerbs of `street`, offset width/2 + 1.5 m: `rain_tree` 50 %, `frangipani` 30 %, `royal_palm` 20 %. `major_road` medians get `royal_palm` every 14 m.
  - Park and grass polygons get Poisson-disc samples at 22 m (`rain_tree`, `flame_tree`, `shrub_round`).
  - Forest at 9 m: `rain_tree` and `coconut_palm`.
  - Oil_palm land gets an 8 m grid of `oil_palm`.
  - Never within 1.5 m of a building footprint or on a ribbon.
- **Lamps:**
  - `lamp_single` every 30 m on one kerb of `street`, alternating sides.
  - `lamp_double` every 35 m on `major_road` medians.
- **Furniture:**
  - `bench` and `bin` pairs at 25 m along park edges and within 15 m of places of type `park`, `playground` or `shelter`.
  - `bus_shelter` at places of type `shelter`.
  - `bollard` rows (1.5 m spacing, 5 per entrance) at mall and school entrances: places with `entrance_ids` whose `type` is `school` or `mall`.
- **Construction:** inside each `construction` land-cover polygon:
  - `hoarding_6m` along the boundary every 6 m, facing outward;
  - one `site_cabin`;
  - `material_stack` ×2;
  - `excavator` if the area is over 2,000 m²;
  - `tower_crane` if the area is over 8,000 m², one per polygon at its centroid.
- Every placement uses `jitterFor(spec, id)` and a seeded yaw.

- [ ] **Step 1: Write the failing tests.** Use synthetic layers built through `frame.toLonLat`.
  - Planning twice gives deep-equal results.
  - Medium caps are respected, and Low gives an empty plan.
  - No tree sits within 1.5 m of a building or on a ribbon (point-in-polygon and distance checks).
  - A 100 m street gives 11 trees per kerb (18 m spacing, inclusive ends) and 4 lamps.
  - Construction land of 9,000 m² gives exactly one tower crane, and a 1,000 m² plot gives none.
  - Oil palms are only on oil_palm land.
  - Everything is inside `radiusM`.
  - Every kit key exists in the manifest.
- [ ] **Step 2: Run** `pnpm --filter @tl/web exec vitest run src/features/scene/three/props`. Expect FAIL.
- [ ] **Step 3: Implement.** Use `geo` helpers already in the repo. Write the Poisson disc as a seeded grid-jitter (a cell size of radius/√2 and one candidate per cell), not Bridson.
- [ ] **Step 4: Run** → PASS. Browser: hero-mid on Medium must stay within budget (≤ 150 draws, ≤ 2.5 M tris). If it doesn't, lower `PROP_CAPS.medium` and ledger the change.
- [ ] **Step 5: Commit** (`feat(web): seeded trees, lamps, furniture and construction sites in the hero district`).

### Task 7: Night lights and ambient life: lamp pools, window flicker, water shimmer, cloud shadows and birds

**Files:**
- Create: `props/lampPools.ts`, `ambient/ambient.ts`, and their tests
- Modify: `assets/roleMaterial.ts` (window flicker), `ground/landcover.ts` (water shimmer), `ThreeScene.tsx`

**Interfaces:**
- Produces:
  ```ts
  // props/lampPools.ts
  export function createLampPools(lamps: Placement[], uniforms: RoleUniforms): { mesh: THREE.InstancedMesh; dispose(): void };
  // ambient/ambient.ts
  /** Birds: seeded flocks (count = TIERS[tier].birds from ../cesium/stylised/quality, by day only), small instanced
   *  chevrons at 40–90 m altitude flying slow loops. Cloud shadows (by day, count = TIERS[tier].clouds): large soft
   *  dark ground decals at y = 0.11 drifting 3 m/s. Both decorative, driven by the Task 8 motion clock. */
  export function createAmbient(tier: Tier, frame: LocalFrame, centre: [number, number], seed: string):
    { group: THREE.Group; tick(nowMs: number, weights: { day: number; dusk: number; night: number }): void; dispose(): void };
  ```
- **Lamp pools:** one instanced ground quad of 14 m × 14 m at y = 0.12, using a radial-gradient `CanvasTexture` (warm `#ffcf8a`) with additive blending, no depth write, and opacity `uLightGlow / 1.6`. Decorative, does not cast.
- **Window flicker** (role material): a lit window whose `COLOR_0.b < uLitShare` flickers by a factor of `0.9 + 0.1·step(0.97, fract(sin(seed·9301 + floor(uTime·0.5))·43758))`. This runs only when `uFlicker` is 1 (night weight > 0.5 and motion running).
- **Water shimmer:** land-cover and base-water vertices get a colour modulation of `±4 %` driven by `uTime`. The colour stays `#7fb6c9`, so the shimmer is never mistaken for flood water.
- The spec allows birds, sway, shimmer and flicker to keep running during Day and Rollout playback (§2.6). They stop when motion stops.
- Task 7 builds these pieces with a `tick` and uniforms, and they render static until Task 8 exists. **Task 8 wires them to the motion clock:** it calls `ambient.tick`, and sets `uTime` and `uFlicker`.

- [ ] **Step 1: Write the failing tests.**
  - `lampPools.test.ts`: one instance per lamp; opacity follows the uniform (0 by day, 1 at night); decorative and unpickable.
  - `ambient.test.ts`:
    - Bird and cloud counts follow `TIERS[tier]`: Low gives 0 clouds.
    - Birds hide when the night weight is above 0.5, and clouds hide when the day weight is below 0.5.
    - The output is deterministic per seed.
    - Everything is decorative.
  - `roleMaterial.test.ts`: the flicker term is gated by `uFlicker`.
  - `landcover.test.ts`: the shimmer amplitude stays within 4 % of the base colour.
- [ ] **Step 2: Run, implement, then run again** (`vitest run src/features/scene/three/props src/features/scene/three/ambient src/features/scene/three/assets/roleMaterial.test.ts src/features/scene/three/ground`) → PASS.
- [ ] **Step 3: Commit** (`feat(web): lamp light pools, window flicker, water shimmer, cloud shadows and birds`).

### Task 8: Motion: traffic, pedestrians, distance scale-up, gating and the Day/Rollout fade

**Files:**
- Create: `motion/agents.ts`, `motion/motionClock.ts`, `motion/motionLayer.ts`, and their tests
- Modify: `engine.ts` (`setMotion`, plus a motion tick inside the render loop when active), `ThreeScene.tsx`

**Interfaces:**
- Consumes: walk LineStrings, places, `PROP_CAPS`, kit specs, `MotionUniforms` (Task 5), `useSceneSettings().motion`, `prefersReducedMotion`, `useScene` (`day.on`, `rollout.on`), and the mood weights (Task 3).
- Produces:
  ```ts
  // motion/agents.ts (pure)
  export interface Agent { id: string; kind: "vehicle" | "person"; variant: string; path: Float32Array /* xz pairs */; length: number; speed: number /* m/s */; offset: number }
  /** Vehicles on street/major_road edges (speed 8–11 m/s, major 12–16), people on footway/path/pedestrian (1.2–1.5 m/s,
   *  jogger 2.5, cyclist 4.5); spawn weight ×3 within 150 m of places of type school|mall|park. Count = cap × densityFor(weights). */
  export function planAgents(input: { walk; places; frame; centre; radiusM; tier; m; seed: string }): Agent[];
  /** Density by mood: day 1.0, dusk 1.15 (commuter rush), night 0.45 ("fewer but clearly present"). Blended by weights. */
  export function densityFor(w: { day: number; dusk: number; night: number }): number;
  export function poseAt(a: Agent, tSec: number): { x: number; z: number; yaw: number };  // loops along the path, yaw from the tangent
  /** Display scale-up for legibility (owner ruling P2): 1 within 150 m of the camera, rising linearly to 3 at 800 m, capped at 3. Decorative only. */
  export function displayScale(distanceM: number): number;
  // motion/motionClock.ts
  export function motionRunning(s: { enabled: boolean; reduced: boolean; visible: boolean; onScreen: boolean }): boolean;
  /** Opacity for decorative people and vehicles: 0 while day.on || rollout.on, crossfading over 1000 ms. */
  export function decorativeOpacity(prev: number, target: 0 | 1, dtMs: number): number;
  // motion/motionLayer.ts
  export interface MotionLayer { group: THREE.Group; tick(nowMs: number, camera: THREE.Vector3): void; setOpacity(o: number): void; dispose(): void }
  export function createMotionLayer(agents: Agent[], lib: AssetLibrary, m: Manifest, uniforms: RoleUniforms, motion: MotionUniforms): MotionLayer;
  // engine.ts
  setMotion(l: MotionLayer | null, running: () => boolean): void  // while running(), the loop schedules frames at ≤ 30 fps and calls l.tick
  ```
- Agent matrices are rewritten per tick, but only for agents within the frustum, plus a 50 m margin. Agents beyond `maxM` of their LOD are hidden.
- The engine keeps render-on-demand: when `running()` is false, no rAF is scheduled for motion.

- [ ] **Step 1: Write the failing tests.**
  - `agents.test.ts`:
    - `planAgents` is deterministic.
    - Vehicles sit only on street or major_road edges, and people only on footway, path or pedestrian edges.
    - Counts are at most the cap × density.
    - `densityFor` of pure night is 0.45.
    - `poseAt` at t and t + length/speed are equal (it loops).
    - `displayScale(100) = 1`, `(800) = 3` and `(5000) = 3`.
    - A 1.74 m person at 800 m renders 5.22 m tall, which is display-only, and the assets are unchanged.
  - `motionClock.test.ts`:
    - The `motionRunning` truth table: false when any of `!enabled`, `reduced`, `!visible` or `!onScreen` holds.
    - `decorativeOpacity` reaches 0 within 1000 ms ± one tick and is monotone.
  - `motionLayer.test.ts` (fake library):
    - `tick` moves instances.
    - `setOpacity(0)` hides people and vehicles.
    - Meshes are decorative with a no-op `raycast`.
  - `engine.create.test.ts`, **Review Focus 3** (fake timers): with `running() → false`, no rAF is requested after an initial frame. With `true`, frames are spaced at least 33 ms apart.
  - `ThreeScene.dom.test.tsx`: `useScene.setState({day: {...on: true}})` sets motion opacity toward 0, and `rollout.on` does the same.
- [ ] **Step 2: Run** `pnpm --filter @tl/web exec vitest run src/features/scene/three/motion`. Expect FAIL.
- [ ] **Step 3: Implement.**
  - **Visibility:** `document.visibilityState` plus an `IntersectionObserver` on the section.
  - **Shader uniforms:** `uTime` comes from the motion clock in seconds, and `uSway` and `uLimb` are 1 while running.
  - **Trees:** they sway whenever motion runs, independent of the Day/Rollout fade.
  - **Task 7 pieces:** wire them to the same clock. Call `ambient.tick(now, weights)` each tick. Set `uFlicker` to 1 when the night weight is above 0.5 and motion is running. The shimmer uses `uTime`.
- [ ] **Step 4: Run** → PASS. Browser: at hero-mid and hero-near on Medium, fps stays ≥ 30 and draws ≤ 150. Toggling Motion off in settings stops movement, and starting Elmina Day fades the traffic out.
- [ ] **Step 5: Commit** (`feat(web): decorative traffic and pedestrians with distance scale-up, gating and the playback fade`).

---

## Part E — Signage and landmarks

### Task 9: Sourced signage, text only

**Files:**
- Create: `signs/signPlan.ts`, `signs/signLayer.ts`, and their tests; `../../map-ui/SignCard.tsx` and its `.dom.test.tsx`
- Modify: `ThreeScene.tsx`, `../sceneStore.ts` (`selectedSignId` and `selectSign`, mutually exclusive with `selectPlace` and `selectFloodEdge`)

**Interfaces:**
- Consumes: the signage features (`id`, `text`, `building_id`, `source_url`, `source_label`, `as_of`) and the building footprints.
- Produces:
  ```ts
  // signs/signPlan.ts (pure)
  export interface SignPlacement { id: string; text: string; x: number; y: number; z: number; yaw: number; widthM: number; source: { url: string; label: string; asOf: string } }
  /** One sign per feature with non-empty text and source: on the facade of building_id facing the nearest walk street,
   *  at y = min(4.2, 0.45·height), width = clamp(0.45·textLength, 2, 0.8·facade width). Signs without a source or
   *  with no building are dropped (and counted). */
  export function planSigns(signs, buildings, walk, frame): { signs: SignPlacement[]; dropped: Record<"no_source" | "no_building", number> };
  // signs/signLayer.ts
  export function createSignLayer(signs: SignPlacement[], uniforms: RoleUniforms): { group: THREE.Group; dispose(): void };
  // one CanvasTexture atlas page per 64 signs, white text on a dark band, emissive scaled by uLightGlow (glow at dusk/night);
  // mesh userData.pick = { kind: "sign", id }
  ```
- The sign card shows the text, then "Source: OpenStreetMap, as of 2026-10-17", then an "Open source" link to `source_url`.

- [ ] **Step 1: Write the failing tests.**
  - `signPlan.test.ts`: a sign without `source_url` or `as_of` is dropped and counted (honesty, no sign without a source). A sign whose `building_id` is missing is dropped. Width clamps hold. The sign is offset outside the facade by 0.15 m.
  - `signLayer.test.ts`: each sign is pickable with `{kind: "sign", id}`, and emissive follows `uLightGlow`.
  - `SignCard.dom.test.tsx`: it shows the text, the source line and a link with `rel="noopener noreferrer"`.
- [ ] **Step 2: Run** `pnpm --filter @tl/web exec vitest run src/features/scene/three/signs src/features/map-ui/SignCard.dom.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement.** Then run the readability spike: take a screenshot at hero-near on mock. If the text is unreadable at 1440×900, adopt `troika-three-text` (pin it exactly and record it in CREDITS.md) and record the ruling.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** (`feat(web): sourced, text-only shop signs with source cards`).

### Task 10: Kanopi and Masjid Denai Alam outlines (data lane, with owner sourcing)

**Files:**
- Create: `data/seed/elmina/sources/landmark_outlines.geojson`, `data/scripts/tests/test_landmark_outlines.py`
- Modify: the landmarks builder (find it with `rg -n "landmarks.geojson" data/scripts`), `data/README.md`, `assets/blender/tl_assets/specs.py` (`placement` "deferred" becomes "obb" for traced landmarks; blender lane), `apps/web/public/city/manifest.json` (repack; data commit)

**Interfaces:**
- Each outline in `landmark_outlines.geojson` is a Polygon with these properties:
  - `model` (`kanopi` | `masjid_denai_alam`);
  - `name`;
  - `source_url`: the public site plan or official drawing;
  - `source_label`;
  - `traced_by`: "coordinator";
  - `traced_on`: a date;
  - `method`: "traced from a georeferenced public site plan".
- The landmarks builder adds these features to `landmarks.geojson` with `match: "traced_outline"`, and `building_id` set to the overlapping OSM building if any, else null.
- [ ] **Step 1: Source the outlines (coordinator, owner).**
  - Find a public site plan or official drawing for each building, such as the Sime Darby Property Kanopi page or a mosque authority document.
  - Georeference it against OSM streets: trace the outline by hand from the image, using at least 3 street-corner control points, and record their residuals.
  - Show the owner the traced polygon over the OSM base and the source image. **The owner approves each outline.**
  - If no source exists for one of them, record a ruling and leave it deferred.
- [ ] **Step 2: Write the failing test.** Every outline has `source_url`, `source_label`, `traced_on` and `method`. Each polygon is valid with an area between 400 and 6,000 m². After a build, `landmarks.geojson` contains both models with `match: "traced_outline"`.
- [ ] **Step 3: Implement the builder change, then run.** Run `uv run pytest data/scripts/tests/test_landmark_outlines.py -q` → PASS, then rebuild `landmarks.geojson`.
- [ ] **Step 4: Switch the placement (blender lane).** Change `placement` to "obb" for any traced landmark, repack, and run the asset tests.
- [ ] **Step 5: Commit** in three parts: `feat(data): traced landmark outlines with sources`, `data: kanopi and masjid outlines`, and `data: landmark placements`.
- [ ] **Step 6: Browser check.** Kanopi and the Masjid stand on their outlines at hero-mid. The landmark card (Task 14) shows the traced-outline source.

---

## Part F — Overlays, picking and cards (spec §3 port)

### Task 11: Overlay renderer, plus the Access, Gaps, Route and What-if layers

**Files:**
- Create: `overlays/lines.ts`, `overlays/accessLayers.ts`, and their tests
- Modify: `engine.ts` (`setOverlays(o: OverlayLayer | null)`; the existing route line migrates into it), `ThreeScene.tsx`

**Interfaces:**
- Consumes the pure helpers from `../cesium/layers.tsx` and `../styles.ts`. Move any that are not exported into a shared `../overlayModel.ts` without changing their behaviour:
  - `groupEdgesByStatus`, `lineFeatures`, `pointFeatures`, `statusStyle`, `gapsActive`;
  - `parseGaps`, `GAP_BANDS`;
  - `diffLines`, `WHATIF_STYLE`;
  - `ROUTE_STYLE`, `CESIUM_DASH`.
- Produces:
  ```ts
  // overlays/lines.ts
  export interface LineStyle { color: string; widthPx: number; dash?: { sizePx: number; pattern: number } ; opacity?: number }
  /** Line2 batch at a lift, overlay pass: depthTest false, renderOrder ≥ 10, worldUnits false. Dash patterns follow
   *  CESIUM_DASH semantics (16-bit pattern over sizePx). */
  export function createLineBatch(lines: Float32Array[], style: LineStyle, liftM: number, renderOrder: number): THREE.Object3D;
  // overlays/accessLayers.ts
  export interface OverlayLayer { group: THREE.Group; update(state: OverlayState): void; dispose(): void }
  export interface OverlayState { access: AccessData | null; accessVisible: boolean; gaps: GapsData | null; gapsOn: boolean;
    route: LineString | null; whatIf: WhatIf | null }
  export function createOverlayLayer(frame: LocalFrame): OverlayLayer;
  ```
- Render orders: status lines 10, gaps 11, what-if 12, route 13.
- Gaps replace the status lines while `gapsActive` holds, as in Cesium.

- [ ] **Step 1: Write the failing tests.**
  - `lines.test.ts`:
    - A batch has `depthTest === false` and `renderOrder ≥ 10`.
    - The dash for `blocked` is 12 px with pattern `0xf000`.
    - The lift equals `liftM`.
  - `accessLayers.test.ts`:
    - Status groups produce one batch per status in `statusStyle` colours.
    - `gapsOn` hides the status batches and shows the gap batches.
    - The route batch is `#2B6CB0` at 8 px with order 13.
    - The what-if before, after and touched colours follow `WHATIF_STYLE`.
    - **Review Focus 1:** for every overlay object, `material.depthTest === false` and `renderOrder > 0`.
    - All overlays are pickable only through the Task 14 picker, so no `raycast` override.
- [ ] **Step 2: Run** `pnpm --filter @tl/web exec vitest run src/features/scene/three/overlays`. Expect FAIL.
- [ ] **Step 3: Implement.** Migrate `setRoute` into the overlay layer, and keep `data-route` behaviour.
- [ ] **Step 4: Run** → PASS. Then run `pnpm --filter @tl/web exec playwright test three.spec.ts`; the route test must still pass.
- [ ] **Step 5: Commit** (`feat(web): access, gaps, route and what-if overlays in three.js`).

### Task 12: Flood, waste, place markers and evacuation centres

**Files:**
- Create: `overlays/floodLayer.ts`, `overlays/markers.ts`, and their tests
- Modify: `overlays/accessLayers.ts` (compose them), `ThreeScene.tsx`

**Interfaces:**
- Consumes: `useScenarioWater`, `useLayer("flood")`, `useEvacCentres`, `useLayer("waste")`, `pointFeatures`, `centreMapMarker`, `WATER_COLOR`, and the flood status styles.
- Produces:
  ```ts
  // overlays/floodLayer.ts
  /** Draped scenario water: flat triangulated polygons at y = 0.30 m, colour #1e6fb8 α 0.55, with a 45° hatch from a
   *  repeating CanvasTexture (4 px lines, 12 px pitch). No vertical faces, no height, no animation. Flood edge lines
   *  (flooded_likely, flooded_possible) via createLineBatch at order 12, width +2 px as in Cesium. */
  export function createFloodLayer(water, floodEdges, frame): { group: THREE.Group; dispose(): void };
  // overlays/markers.ts
  /** Screen-space markers (Sprite, sizeAttenuation false): place #0f5c63 9 px (16 px focused, 2 px white outline), waste
   *  #6B46C1 9 px, evac centre per centreMapMarker 12 px; labels as Sprite text only within 1500 m or when focused.
   *  userData.pick = { kind: "place", id } | { kind: "evac", id } | { kind: "waste", id }. */
  export function createMarkers(input, frame): { group: THREE.Group; setFocus(id: string | null): void; dispose(): void };
  ```

- [ ] **Step 1: Write the failing tests.**
  - `floodLayer.test.ts`, **Review Focus 4**:
    - All flood mesh vertices have y = 0.30 ± 1e-6, meaning no vertical extent and no water surface.
    - The colour is `#1e6fb8` at α 0.55.
    - The hatch texture is present.
    - Nothing uses `#7fb6c9`.
    - Flood edges use the flood styles.
  - `markers.test.ts`: the sizes and colours as specified; a focused place gets 16 px and a label; markers carry `userData.pick`; labels are hidden beyond 1500 m.
- [ ] **Step 2: Run** `pnpm --filter @tl/web exec vitest run src/features/scene/three/overlays`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** (`feat(web): flood, waste, place and evacuation-centre overlays in three.js`).

### Task 13: Elmina Day and river rollout residents

**Files:**
- Create: `overlays/residents.ts` and its test
- Modify: `ThreeScene.tsx`

**Interfaces:**
- Consumes: `useDay`, `prepare`, `dotsAt`, `DAY_STYLE`, `useScene().day`, `useRiverRollout`, `RESIDENT_STYLE`, `kindAt`, `routeAt`, `pointAlong`, `phase`, `useScene().rollout`.
- Produces: `createResidents(frame): { group; setDay(dots: DayDot[], focus: string | null): void; setRollout(points: RolloutPoint[]): void; dispose() }`.
  - Restyle them as small low-poly capsule markers, 1.2 m wide and 2.4 m tall, at y = 0, instanced.
  - Keep the state colours: walking `#F6E05E`, driving `#63B3ED`, waiting `#F56565`; rollout colours from `RESIDENT_STYLE`.
  - The focused resident is 1.6× larger with a white ring.
  - Apply `displayScale` from Task 8 so they stay legible.
  - Each carries `userData.pick = {kind: "resident", id}`. Residents are real simulation output (synthetic but cited by the Day legend), so they are not decorative.
  - The Day legend `DAY_LEGEND` shows in the `notes` slot while `day.on`.

- [ ] **Step 1: Write the failing tests.** Colours per state. Focus scale. Instance count equals the dot count. `setDay([])` hides everything. The rollout colours.
- [ ] **Step 2: Run, implement, then run again** (`vitest run src/features/scene/three/overlays/residents.test.ts`) → PASS.
- [ ] **Step 3: Commit** (`feat(web): elmina day and rollout residents restyled for three.js`).

### Task 14: Picking and cards

**Files:**
- Create: `pick.ts`, `pick.test.ts`; `../../map-ui/BuildingCard.tsx` and its `.dom.test.tsx`
- Modify: `ThreeScene.tsx` (a click handler; a drag-threshold of 4 px separates clicks from orbiting), `../sceneStore.ts` (`selectedBuildingId` and `selectBuilding`, mutually exclusive with the other selections)

**Interfaces:**
- Produces:
  ```ts
  // pick.ts
  export type PickHit =
    | { kind: "place"; id: string } | { kind: "evac"; id: string } | { kind: "waste"; id: string }
    | { kind: "sign"; id: string } | { kind: "landmark"; id: string } | { kind: "resident"; id: string }
    | { kind: "floodEdge"; id: string } | { kind: "building"; id: string };
  /** Priority (first wins): place > evac > waste > sign > landmark > resident > floodEdge (within 8 px) > building.
   *  Objects with userData.decorative are never hit; instanced hits map through userData.ids + buildingIdOf. */
  export function pickAt(ndc: { x: number; y: number }, camera: THREE.Camera, roots: THREE.Object3D[], linePickPx?: number): PickHit | null;
  ```
- Dispatch:
  - `place` → `selectPlace`; `floodEdge` → `selectFloodEdge`; `sign` → `selectSign`; `building` and `landmark` → `selectBuilding`.
  - `resident` → `setDay({ focus: id })`.
  - `evac` and `waste` open the place card when the id matches a place, else nothing.
- `BuildingCard` shows: "Building type: <label>", then "Source: OSM · as of <as_of>", then "Height: <label>". Height labels: `osm_height` "OSM height tag", `osm_levels` "OSM building levels", `archetype_storeys` "Typical storeys for this type", `default` "Default estimate".
  - A fallback building adds "(shown as a simple block)".
  - A landmark adds its `name`, `source_url` link and `match` method ("traced outline" or "building name").

- [ ] **Step 1: Write the failing tests.**
  - `pick.test.ts`, built on a tiny real `THREE.Scene` with box meshes and `userData`:
    - The priority order holds when objects overlap.
    - A decorative mesh in front of a building is skipped, so the building is hit (honesty: decorative is never pickable).
    - An instanced hit returns the building id with `#i` stripped.
    - Nothing under the cursor returns null.
  - `BuildingCard.dom.test.tsx`: the four height labels; the fallback suffix; the landmark source link.
  - `ThreeScene.dom.test.tsx`: a click within 4 px dispatches `selectPlace` for a place hit, using a stubbed `pickAt`. A drag over 4 px dispatches nothing.
- [ ] **Step 2: Run** `pnpm --filter @tl/web exec vitest run src/features/scene/three/pick.test.ts src/features/map-ui/BuildingCard.dom.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement.** Mount `BuildingCard` and `SignCard` where `PlaceOverlay` and `PathOverlay` mount, in `map-ui`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** (`feat(web): three.js picking with fixed priority, building and sign cards`).

---

## Part G — Honesty, integration and the gate

### Task 15: Honesty tests, the in-scene disclaimer and e2e

**Files:**
- Create: `honesty.test.ts` (in `three/`)
- Modify: `ThreeScene.tsx` (a `DecorativeChip` in the `notes` slot: "Decorative details are illustrative."), `ThreeScene.dom.test.tsx`, `apps/web/e2e/three.spec.ts`, `apps/web/README.md` (the three.js section: what is decorative, query params, perf fields)

**Interfaces:** consumes every layer factory from Tasks 1–14.

- [ ] **Step 1: Write the failing tests.** `honesty.test.ts` builds each layer with small fixtures and asserts the spec §5 list:
  1. Every decorative object (ground, props, lamp pools, motion, fallback styling) has `userData.decorative`, and its `raycast` returns no hits.
  2. `planSigns` never emits a sign without `source.url` and `source.asOf`.
  3. With `day.on` or `rollout.on`, `decorativeOpacity` targets 0 and the motion layer's people and vehicle meshes reach `visible === false` after 1000 ms.
  4. Flood meshes are flat at 0.30 m with no water-surface material: no `MeshPhysicalMaterial` with transmission, and no animated uniforms.
  5. No land-cover or base-water colour equals a flood colour.
  6. The ThreeScene DOM shows the disclaimer chip whenever `data-assets="ready"` or props are on.

  e2e (`three.spec.ts`), with the tiny fixture plus the stubbed buildings layer from Phase 2:
  - The disclaimer is visible.
  - Clicking a stubbed place marker opens the place card (the Task 14 path). Give the stub a place via a `page.route` on the access layer.
  - With `?engine=three`, `data-frames > 0` after the route intent, as today.
- [ ] **Step 2: Run** `pnpm --filter @tl/web exec vitest run src/features/scene/three/honesty.test.ts` → FAIL. Implement the chip, then run → PASS.
- [ ] **Step 3: Run the e2e:** `pnpm --filter @tl/web exec playwright test three.spec.ts` → PASS.
- [ ] **Step 4: Commit** (`test(web): spec §5 honesty tests and the in-scene decorative disclaimer`).

### Task 16: Merge, verify, budgets and the P3 gate

**Files:** the ledger, `docs/superpowers/overnight-log.md`, `docs/03-product/mvp-spec.md` (status line), and `apps/web/src/features/scene/three/bookmarks.ts` only if the gate needs a dense-precinct bookmark.

- [ ] **Step 1: Merge.** Merge `lane/data`, then `lane/blender`, then `lane/fe` into `feat/stylised-threejs` with `--no-ff`.
- [ ] **Step 2: Run the CI checklist** with `set -o pipefail`, alone (no Blender, browser or dev server):
  1. `pnpm lint`
  2. `uv run pytest -q`
  3. `pnpm -r --if-present typecheck`
  4. `pnpm -r --if-present test`, with map keys blanked and `--maxWorkers=3`
  5. `pnpm gen && git diff --exit-code packages/api-client`
  6. `pnpm golden`
  7. `pnpm --filter @tl/web e2e`

  Report each as PASS / FAIL / BLOCKED / NOT RUN, and mark golden and e2e as mock-backed.
- [ ] **Step 3: Budgets (coordinator, real Chrome on the owner's laptop).** On mock, open `/?engine=three&perf=1`.
  - **Bookmarks:** hero-near, hero-mid and township.
  - **Tiers:** Medium for all three, High for hero-mid.
  - **Moods:** pinned Day, Dusk and Night, plus Elmina Day playback.
  - **Method:** a 10 s scripted orbit for each combination.
  - **Record:** median fps, draws, tris and gpuMB in a table.
  - **Pass condition:** hero-mid Medium ≥ 30 fps, ≤ 150 draws and ≤ 2.5 M tris.
  - **If it fails, pull these levers in order and remeasure:**
    1. lower `PROP_CAPS.medium`;
    2. motion only within 600 m;
    3. LOD1 archetypes cast no shadows;
    4. drop GTAO at Medium.

    Ledger each lever as a ruling.
- [ ] **Step 4: Owner gate (stop and ask the owner): spec §5.**
  - For Day, Dusk and Night, take screenshots at hero-near, hero-mid and township, plus one in Elmina Day playback at 19:30.
  - Show them side by side with the reference images: the spec's reference set, and the P2 `refs/` for the archetypes.
  - The owner orbits for 10 s at hero-mid on Medium on their own laptop, or accepts the coordinator's measurement.
  - **The owner decides pass or fail.** Record the verdict and the notes as rulings. Notes become a fix wave, capped at 2 rounds, or P4 inputs.
- [ ] **Step 5: Log and hand over.**
  - Write the overnight-log entry with real `date` timestamps. Cover: the fallback counts before and after, the mood screenshots, the budgets table, the prop and agent counts, dropped signs and their reasons, landmark sources, the gate verdict, and the open owner decisions.
  - Commit it as `docs: phase 3 hero district of the three.js stylised overhaul`.
  - Push only if the owner asks.
  - Next is Plan P4 (township rollout), written only after the gate passes.
