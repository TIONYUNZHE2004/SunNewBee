# Stylised City on Three.js — Phase 0 (spike) and Phase 1 (data) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Three.js renderer for the Stylised map style that draws the existing Elmina footprints with tone mapping, sun shadows, GTAO and bloom, honours `camera.fly_to` and `route.highlight`, and is measured on the owner's laptop. In parallel, produce the sourced data the full look needs: sampled building heights, archetypes, land cover, signage and landmarks, served by `GET /layers/buildings`.

**Architecture:** Part A (lane `fe`) adds `apps/web/src/features/scene/three/`. Pure, unit-tested modules handle the local frame, geometry, sun, lighting, camera maths and intent targets, and one imperative `engine.ts` owns the WebGL renderer. `ThreeScene.tsx` mounts the engine in place of the Cesium Viewer when the style is Stylised **and** the engine choice is `three`. Until the owner passes the gate (spec §5), `?engine=three` opts in; the Cesium Stylised view stays the default. Part B (lane `data`) adds Python builders under `data/scripts/` that enrich `data/seed/elmina/base/`, and extends the buildings endpoint.

**Tech Stack:** three 0.186.1 (+ `@types/three` 0.186.0), React 19, zustand, Vite 8, vitest 5, Playwright 1.64; Python 3.13, uv, shapely, numpy, rasterio 1.5.2, requests, DracoPy 2.2.0, pygltflib 1.16.5; FastAPI 0.143.

**Spec:** `docs/superpowers/specs/2026-10-17-stylised-city-threejs-overhaul-design.md` (with ADR 0012 and ADR 0013). Read `AGENTS.md` and `CLAUDE.md` first.

**Scope.** This plan covers spec §4 Phase 0 and Phase 1 only. Phase 0's fps measurement decides which rendering techniques Phase 3 can afford (spec §6), and Phase 2 needs the archetype list and heights from Phase 1. So these follow-on plans are written after this plan lands:
- **Plan P2, assets:** Blender scripts for the 12 archetypes, the generic, 3 landmarks and the prop kits, with LODs and glTF export. Needs the Blender MCP session with the owner present.
- **Plan P3, hero district:** keyframe lighting with continuous blending and Elmina Day clock (Q26), motion and gating (Q25), signage, land cover, the overlay port (Access, Gaps, Route, WhatIf, Flood, Waste, Rollout, Day, places), picking and cards, plus the honesty tests in spec §5.
- **Plan P4/P5, rollout and cleanup**, after the gate.

## Global Constraints

- The Realistic map style stays on Cesium, unchanged. Mapbox lite and List are unchanged.
- Scene contract unchanged: renderers read `useScene` (`apps/web/src/features/scene/sceneStore.ts`). The agent never touches the scene.
- Error fallback chain: Three.js fails → Mapbox (if available) → List.
- Local frame: east-north-up centred on `site.json` `center`; Three.js axes are x = east, y = up, z = −north (metres).
- Camera: about 45° pitch, vertical FOV 30°, zoom 30 m to the whole township, pitch never above −5°. The side-panel off-centre frustum stays.
- Quality tiers High / Medium / Low with auto-detect and auto-lower (`pickTier`, `createFrameMonitor`, `lowerTier` from `cesium/stylised/quality.ts`).
- Performance target: ≥ 30 fps at 1440×900, Medium, default view, on the owner's laptop (RTX 2050 4 GB, Ryzen 7 7435HS, 8 GB RAM).
- Google data exemption (spec §2.3), scoped to this overhaul only: Google Photorealistic 3D Tiles may be used as a **building-height source**. Never in routing, evaluation, flood, the agent, answers or evidence. **Do not edit AGENTS.md's Google rule.** One deliberate sampling run, cached in `data/cache/gtiles/`, derived heights committed, no re-fetch loops. Never print or log the key.
- Overpass only through `data/scripts/overpass.py`, with `--max-requests`.
- Fill empty land with real land cover only (OSM first, ESA WorldCover 10 m for gaps); never invent buildings. Base water is decorative and never touches flood layers.
- Signage: real names only (OSM `name` / `brand`), text only, every sign carries a source and an as-of date. No source → no sign text.
- Unmatched footprints get archetype `generic`; record the archetype and how it was chosen per building.
- Dependencies pinned exactly. Prefer MIT/Apache-2.0/BSD (three: MIT, DracoPy: Apache-2.0, pygltflib: MIT).
- Cost: `LLM_PROVIDER=mock`. No Google tile loads except the sampling run and Realistic mode. Browser checks of the Three.js view use `?engine=three` (no billable tiles).
- Commits: Conventional with scope (`feat(web): …`, `feat(api): …`, `feat(data): …`, `data: …`, `docs: …`). Data regeneration is its own `data:` commit. Stage explicit paths, never `git commit -am`. End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019Xp4Af8HaoKvPwzeVf7zuc
  ```
- Branching: worktrees `../SunNiuBi-wt/fe` (branch `lane/fe`, Tasks 1–8) and `../SunNiuBi-wt/data` (branch `lane/data`, Tasks 9–15) are cut from `feat/stylised-threejs`. The two lanes share no files except `package.json` (root, Task 10 only) and run in parallel. The coordinator merges both into `feat/stylised-threejs` with `--no-ff` (Task 16), never into `main`. Ledger: `.superpowers/sdd/2026-10-17-stylised-threejs-p01/`.
- Done = the AGENTS.md CI checklist, run with `set -o pipefail`, each check reported PASS / FAIL / BLOCKED / NOT RUN.

**Ruling (record in the ledger at start):** "Three.js is opt-in via `?engine=three` (persisted as `tl.engine`) until the owner passes the gate; default stays `cesium` — because the spike lacks most overlays and must not regress the demo — cost if wrong: one default flip in Phase 5."

## Review Focus

1. **A footprint the mesher can't use** (MultiPolygon, < 3 distinct points, self-touching, clockwise ring) must be skipped and counted, never crash the scene or produce inward-facing walls. Pinned in Task 3.
2. **The Three.js engine failing to start** (no WebGL2 context, context lost, shader compile error) must fall back to Mapbox or List with the existing alert, not leave a blank map. Pinned in Task 2 (`effectiveView`) and Task 7 (constructor throws → boundary).
3. **Leaving the Stylised view** (style switch, view switch, route change away) must dispose the renderer and stop the rAF loop; no render after dispose, no GPU leak across repeated toggles. Pinned in Task 7.
4. **OSM names that are mapper notes, not names** ("Only seen in Google Maps. Not OSV.", "Clinic (unnamed, OSM)", "fixme") must never become a sign. Pinned in Task 13 (and re-checked at the API in Task 15).
5. **A height sample polluted by trees, a neighbour or missing tile coverage** must fall back (coverage < 50 %, < 2.5 m, > 200 m, or > 3× the archetype's storey height for a low-rise archetype) instead of committing a wrong height. Pinned in Tasks 10 and 12.

---

## Part A — Phase 0: Three.js spike (lane `fe`)

All new web files live in `apps/web/src/features/scene/three/`. Tests sit next to their module (`*.test.ts` in node, `*.dom.test.tsx` with `// @vitest-environment jsdom`).

### Task 1: Three.js dependency and the local frame

**Files:**
- Modify: `apps/web/package.json` (dependencies)
- Create: `apps/web/src/features/scene/three/frame.ts`
- Test: `apps/web/src/features/scene/three/frame.test.ts`

**Interfaces:**
- Consumes: `LonLat` from `../geo`.
- Produces:
  ```ts
  export interface LocalFrame {
    origin: LonLat;
    /** Metres: x east, z = −north (Three.js y-up). */
    toLocal(lon: number, lat: number): [x: number, z: number];
    toLonLat(x: number, z: number): LonLat;
  }
  export function createFrame(origin: LonLat): LocalFrame;
  ```

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @tl/web add three@0.186.1 && pnpm --filter @tl/web add -D @types/three@0.186.0`
Expected: both pinned exactly (no `^`) in `apps/web/package.json`; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { createFrame } from "./frame";

const f = createFrame([101.5099, 3.1813]);
describe("createFrame", () => {
  it("puts the origin at 0,0", () => expect(f.toLocal(101.5099, 3.1813)).toEqual([0, 0]));
  it("maps 0.01° north to about 1105.8 m along −z", () => {
    const [x, z] = f.toLocal(101.5099, 3.1913);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(-1105.8, 0);
  });
  it("maps 0.01° east to about 1111.5 m along +x", () => {
    expect(f.toLocal(101.5199, 3.1813)[0]).toBeCloseTo(1111.5, 0);
  });
  it("round-trips", () => {
    const [lon, lat] = f.toLonLat(...f.toLocal(101.47, 3.23));
    expect(lon).toBeCloseTo(101.47, 9);
    expect(lat).toBeCloseTo(3.23, 9);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/three/frame.test.ts`
Expected: FAIL, cannot resolve `./frame`.

- [ ] **Step 4: Implement `createFrame` in `frame.ts`**

Use a local tangent plane with WGS84 radii of curvature at the origin latitude (a = 6378137, e² = 0.00669437999014): meridional M = a(1−e²)/(1−e² sin²φ₀)^1.5, prime vertical N = a/√(1−e² sin²φ₀); x = Δλ·N·cosφ₀, north = Δφ·M (radians), z = −north. The error stays under 1 m across the township.

- [ ] **Step 5: Run to verify they pass** (same command; expected PASS)

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/features/scene/three/frame.ts apps/web/src/features/scene/three/frame.test.ts
git commit -m "feat(web): three.js dependency and the local ENU frame"
```

### Task 2: Engine choice and renderer routing

**Files:**
- Create: `apps/web/src/features/scene/three/engineChoice.ts`
- Test: `apps/web/src/features/scene/three/engineChoice.test.ts`
- Modify: `apps/web/src/features/scene/selectView.ts` (`effectiveView`)
- Modify: `apps/web/src/features/scene/selectView.test.ts`
- Modify: `apps/web/src/features/map-ui/MapStage.tsx` (renderer switch, lazy `ThreeScene`)

**Interfaces:**
- Consumes: `View` (`selectView.ts`), `MapStyle` (`sceneStore.ts`), `useMapStyle` (`useMapStyle.ts`).
- Produces:
  ```ts
  export type StylisedEngine = "three" | "cesium";
  /** `?engine=three|cesium` wins and is persisted as `tl.engine`; else the stored value; else "cesium". */
  export function readStylisedEngine(search: string, store?: Pick<Storage, "getItem" | "setItem">): StylisedEngine;
  export const stylisedEngine: () => StylisedEngine; // reads location.search + localStorage once per page load
  export type Renderer = "three" | "cesium" | "mapbox" | "list";
  export function rendererFor(view: View, style: MapStyle, engine: StylisedEngine): Renderer;
  ```
  `effectiveView(view, available, rendererFailed)` keeps its signature. On failure it now returns `"mapbox"` when `view === "cesium"` and Mapbox is available, else `"list"`.

- [ ] **Step 1: Write the failing tests**

`engineChoice.test.ts`:
- `readStylisedEngine("?engine=three", mem)` → `"three"`, and `mem.getItem("tl.engine") === "three"`.
- `readStylisedEngine("", mem)` after the above → `"three"`; with an empty store → `"cesium"`.
- `readStylisedEngine("?engine=bogus", emptyStore)` → `"cesium"`, nothing written.
- A store whose `getItem` throws → `"cesium"` (no throw).
- `rendererFor("cesium", "stylised", "three")` → `"three"`; `rendererFor("cesium", "realistic", "three")` → `"cesium"`; `rendererFor("cesium", "stylised", "cesium")` → `"cesium"`; `rendererFor("mapbox", "stylised", "three")` → `"mapbox"`; `rendererFor("list", "stylised", "three")` → `"list"`.

Add to `selectView.test.ts`:
- `effectiveView("cesium", ["cesium","mapbox","list"], true)` → `"mapbox"`.
- `effectiveView("cesium", ["cesium","list"], true)` → `"list"`.
- `effectiveView("mapbox", ["cesium","mapbox","list"], true)` → `"list"`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/three/engineChoice.test.ts src/features/scene/selectView.test.ts`
Expected: FAIL (module missing, and the new `effectiveView` cases).

- [ ] **Step 3: Implement `engineChoice.ts` and the new `effectiveView` rule.** Wrap storage access in try/catch, like `sceneSettingsStore.ts` does.

- [ ] **Step 4: Wire `MapStage.tsx`**

Add `const ThreeScene = lazy(() => import("../scene/three/ThreeScene"));`. Compute `const renderer = rendererFor(effective, style, stylisedEngine())`, where `style` comes from `useMapStyle()`. Render `ThreeScene`, `CesiumScene` or `MapboxLite` by `renderer`, and use `key={renderer}` on `RendererBoundary` so a style switch remounts. Until Task 7 lands, create `ThreeScene.tsx` as a placeholder default export that renders `<section data-testid="three-scene" aria-label="3D map" />`. Pass `effectiveView(view, available, rendererFailed)` from the store, replacing the hard-coded `false`, so a crash moves along the chain.

- [ ] **Step 5: Run to verify they pass** (same command, plus `pnpm --filter @tl/web exec vitest run src/features/map-ui`; expected PASS)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/scene/three/engineChoice.ts apps/web/src/features/scene/three/engineChoice.test.ts apps/web/src/features/scene/three/ThreeScene.tsx apps/web/src/features/scene/selectView.ts apps/web/src/features/scene/selectView.test.ts apps/web/src/features/map-ui/MapStage.tsx
git commit -m "feat(web): opt-in three.js engine for the stylised style, crash falls back to mapbox"
```

### Task 3: City geometry from the buildings layer

**Files:**
- Create: `apps/web/src/features/scene/three/cityMesh.ts`
- Test: `apps/web/src/features/scene/three/cityMesh.test.ts`

**Interfaces:**
- Consumes: `LocalFrame` (Task 1); `toBuildings`, `Building` from `../cesium/stylised/model` (pure, no Cesium import); `waterPolygons` from `../geo`; `BuildingsLayer` from `../../../lib/api`.
- Produces:
  ```ts
  export interface CityGeometry {
    buildings: THREE.BufferGeometry; // non-indexed; position, normal, color
    parks: THREE.BufferGeometry;     // flat, y = PARK_Y
    water: THREE.BufferGeometry;     // flat, y = WATER_Y (decorative base water)
    ground: { center: [number, number]; size: [number, number] }; // building bounds + 500 m margin
    bounds: THREE.Box3;
    skipped: number;
  }
  export const PARK_Y = 0.05;
  export const WATER_Y = 0.08;
  export const KIND_COLOUR: Record<string, string>; // residential, commercial, industrial, civic, other, building
  export function buildCityGeometry(layer: BuildingsLayer | null | undefined, frame: LocalFrame): CityGeometry;
  ```

- [ ] **Step 1: Write the failing tests** (in each, a 10 m × 10 m square near the origin is built through `frame.toLonLat`)

- `one square building, height 9 → bounds.max.y === 9, bounds.min.y === 0, buildings vertex count === 30` (2 roof + 8 wall triangles).
- `clockwise and counter-clockwise rings give outward wall normals`: for each wall triangle, dot(normal, triangleCentroid − footprintCentroid) > 0 in xz.
- `min_height_m 3 lifts the wall base to y = 3`.
- `MultiPolygon, 2-point ring and non-finite coordinates are skipped and counted` → `skipped === 3`, no throw.
- `empty or null layer → empty geometries, skipped 0, no throw`.
- `parks sit at PARK_Y and water at WATER_Y; water is never coloured like the flood WATER_COLOR` (compare against `WATER_COLOR` from `../styles`).
- `vertex colour follows KIND_COLOUR[kind]`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/three/cityMesh.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `buildCityGeometry`.** Triangulate roofs with `THREE.ShapeUtils.triangulateShape`. Normalise each ring to counter-clockwise in (x, −z) before building walls. Merge everything into one geometry per layer (one draw call each). Parks come from `layer.parks` Polygon outer rings, and water from `waterPolygons(layer.water)`, with holes passed to the triangulator.

- [ ] **Step 4: Run to verify they pass** (same command; expected PASS)

- [ ] **Step 5: Commit** (`git add` the two files; message `feat(web): merged city geometry for the three.js spike`)

### Task 4: Sun, lighting presets and tiers

**Files:**
- Create: `apps/web/src/features/scene/three/sun.ts`, `lighting.ts`, `quality.ts`
- Test: `sun.test.ts`, `lighting.test.ts`, `quality.test.ts` (same folder)

**Interfaces:**
- Consumes: `Theme` (`apps/web/src/ui/theme.ts`), `Tier` (`../cesium/stylised/quality`).
- Produces:
  ```ts
  // sun.ts — NOAA solar position
  export function sunPosition(date: Date, lat: number, lon: number): { azimuthRad: number; elevationRad: number }; // azimuth from north, clockwise
  export function sunVector(azimuthRad: number, elevationRad: number): [number, number, number]; // unit, local frame (x east, y up, z = −north)
  // lighting.ts
  export interface LightPreset {
    sunColor: string; sunIntensity: number;
    hemiSky: string; hemiGround: string; hemiIntensity: number;
    envIntensity: number; exposure: number; background: string;
    fog: { color: string; near: number; far: number };
    windowEmissive: number; // 0 by day, > 0 at dusk and night
  }
  export const LIGHT_PRESETS: Record<Theme, LightPreset>;
  /** Day: the real sun (clamped to ≥ 10° elevation). Dusk: azimuth 285°, elevation 8°. Night: moon at azimuth 120°, elevation 40°. */
  export function keyLightDir(theme: Theme, now: Date, lat: number, lon: number): [number, number, number];
  export function fitShadowCamera(focus: [number, number], radiusM: number, dir: [number, number, number]):
    { position: [number, number, number]; target: [number, number, number]; halfSize: number; near: number; far: number };
  // quality.ts
  export interface ThreeTierSpec { shadows: boolean; shadowMapSize: number; ao: boolean; bloom: boolean; maxPixelRatio: number }
  export const THREE_TIERS: Record<Tier, ThreeTierSpec>;
  ```
  Tier values (Phase 0 will re-tune them): high `{true, 4096, true, true, 2}`; medium `{true, 2048, true, true, 1.25}`; low `{false, 0, false, false, 1}`.

- [ ] **Step 1: Write the failing tests**

`sun.test.ts` (Elmina, 3.1813 N, 101.5099 E):
- `2026-03-20T05:21:00Z` (local solar noon) → elevation > 80°.
- `2026-03-19T23:00:00Z` (just before sunrise) → elevation between −6° and 0°.
- `2026-06-21T05:20:00Z` → azimuth within 30° of north (declination exceeds latitude).
- `sunVector(0, π/2)` ≈ `[0, 1, 0]`; `sunVector(π/2, 0)` ≈ `[1, 0, 0]`; `sunVector(0, 0)` ≈ `[0, 0, -1]`.

`lighting.test.ts`:
- `LIGHT_PRESETS.night.sunIntensity < LIGHT_PRESETS.dusk.sunIntensity < LIGHT_PRESETS.day.sunIntensity`.
- `LIGHT_PRESETS.day.windowEmissive === 0` and night's > dusk's > 0.
- `keyLightDir("day", 03:00 MYT date, …)` still has y ≥ sin(10°) (clamped).
- `fitShadowCamera([100, -50], 400, d)`: target is `[100, 0, -50]`, normalise(position − target) ≈ d, and halfSize ≥ 400.

`quality.test.ts`: low has no shadows, AO or bloom; `maxPixelRatio` does not increase from high to low.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/three/sun.test.ts src/features/scene/three/lighting.test.ts src/features/scene/three/quality.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Use the NOAA general solar position equations (fractional year, equation of time, declination, hour angle), from the UTC date. Preset colours start from the reference image (spec §2.5 table): night is a deep blue-violet ambient (`hemiSky` around `#2a2350`), day a warm sun (`#fff1d6`), dusk an orange-pink (`#ff9a6a`). The owner tunes them in Phase 3.

- [ ] **Step 4: Run to verify they pass** (same command; expected PASS)

- [ ] **Step 5: Commit** (six files; message `feat(web): solar position, lighting presets and tiers for three.js`)

### Task 5: Camera rig, limits and camera ops

**Files:**
- Create: `apps/web/src/features/scene/three/cameraRig.ts`, `bookmarks.ts`
- Test: `cameraRig.test.ts`, `bookmarks.test.ts`

**Interfaces:**
- Consumes: `LocalFrame` (Task 1); `CameraOps` from `../cesium/controls/cameraOps` (implemented structurally: `glideTo` receives `{x, y}`).
- Produces:
  ```ts
  export interface Pose { target: [number, number]; rangeM: number; pitchDeg: number; headingDeg: number } // heading 0 = facing north
  export const VFOV_DEG = 30;
  export const LIMITS = { minRangeM: 30, maxRangeM: 9000, minPitchDeg: -89, maxPitchDeg: -5, maxCentreOffsetM: 5000 };
  export function poseToCamera(p: Pose): { position: [number, number, number]; target: [number, number, number] };
  export function clampPose(p: Pose, bounds: { min: [number, number]; max: [number, number] }): Pose;
  export function tweenPose(a: Pose, b: Pose, t: number): Pose; // eased; heading along the shortest arc
  /** Arguments for camera.setViewOffset so the look point sits mid-way across the area left of the panel. */
  export function viewOffsetFor(w: number, h: number, panelPx: number): [number, number, number, number, number, number];
  export interface CameraRig { get(): Pose; set(p: Pose): void; flyTo(p: Pose, durationMs: number): void; pick(screen: { x: number; y: number }): [number, number] | null }
  export function createThreeCameraOps(rig: CameraRig, home: () => Pose, whole: () => Pose, onUserMove?: () => void): CameraOps;
  // bookmarks.ts
  export type BookmarkId = "hero-near" | "hero-mid" | "township";
  export const HERO_CENTRE: LonLat; // [101.5095, 3.1805], Elmina City Centre / Urban Park, Persiaran Garcinia
  export const BOOKMARKS: Record<BookmarkId, { centre: LonLat; rangeM: number; pitchDeg: number; headingDeg: number }>;
  export const DEFAULT_BOOKMARK: BookmarkId; // "hero-mid"
  export function bookmarkFromSearch(search: string): BookmarkId | null; // ?bookmark=hero-near
  ```
  Bookmark values: hero-near is 150 m at −40°, hero-mid is 800 m at −45°, township is site centre `[101.5099, 3.1813]` at 7000 m and −55°. All headings are 0.

- [ ] **Step 1: Write the failing tests**

`cameraRig.test.ts`:
- `poseToCamera({target:[0,0], rangeM:100, pitchDeg:-45, headingDeg:0})` → position ≈ `[0, 70.71, 70.71]` (south of the target, above it), target `[0,0,0]`.
- heading 90 → the camera sits west of the target (position x ≈ −70.71).
- `clampPose` enforces 30 ≤ range ≤ 9000, −89 ≤ pitch ≤ −5, and pulls the target back within 5000 m of the bounds.
- `tweenPose(a, b, 0)` equals a, `(…, 1)` equals b, and the heading from 350° to 10° passes through 0, not 180.
- `viewOffsetFor(1440, 900, 400)` → `[1440, 900, 200, 0, 1440, 900]`; with `panelPx = 0` the x offset is 0.
- `createThreeCameraOps` on a fake rig: `zoom(0.5)` halves the range, `faceNorth()` sets heading 0, `home()` calls `flyTo` with `home()`, and every action calls `onUserMove` first.

`bookmarks.test.ts`: `bookmarkFromSearch("?bookmark=hero-near")` → `"hero-near"`; unknown → `null`; `BOOKMARKS["hero-mid"].rangeM === 800`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/three/cameraRig.test.ts src/features/scene/three/bookmarks.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Forward vector = (sin h·cos p, sin p, −cos h·cos p); position = target − forward·range. `createThreeCameraOps` mirrors the Cesium ops semantics in `cesium/controls/cameraOps.ts`: same step sizes (`STEP` from `cameraMath.ts`), and reduced motion jumps instead of flying.

- [ ] **Step 4: Run to verify they pass** (same command; expected PASS)

- [ ] **Step 5: Commit** (four files; message `feat(web): three.js camera rig, limits, ops and gate bookmarks`)

### Task 6: Camera intents and route line

**Files:**
- Create: `apps/web/src/features/scene/three/intents.ts`, `routeLine.ts`
- Test: `intents.test.ts`, `routeLine.test.ts`

**Interfaces:**
- Consumes: `useScene` state shape (`route`, `focusRouteRequest`, `whatIf`, `focusPlaceId`, `camera`); `diffLines` (`../../whatif/whatifModel`); `LocalFrame`.
- Produces:
  ```ts
  export interface CameraGoal { centre: LonLat; rangeM: number }
  type IntentSlice = Pick<SceneState, "route" | "focusRouteRequest" | "whatIf" | "focusPlaceId" | "camera">;
  /** Same precedence as cesium/camera.ts: new route → route re-focus → new what-if → new place focus → new camera. */
  export function intentGoal(s: IntentSlice, prev: IntentSlice, focusPoint: (id: string) => LonLat | null): CameraGoal | null;
  export function boundsGoal(points: LonLat[]): CameraGoal | null; // centre of the bounding circle; rangeM = max(radiusM × 2.5, 300)
  // routeLine.ts
  export const ROUTE_LIFT_M = 0.6;
  export function lineToLocal(coords: LonLat[], frame: LocalFrame, liftM?: number): Float32Array; // xyz triplets; drops non-finite points; < 2 points → empty
  ```
  `SceneState` must be exported from `sceneStore.ts` as a type (add `export` to the interface; no behaviour change).

- [ ] **Step 1: Write the failing tests**

`intents.test.ts`:
- A new route over two points 1 km apart gives a centre at the midpoint (±1e-6°) and rangeM ≈ 1250 (±5).
- A new route of one short segment (10 m) gives rangeM 300.
- A new `focusPlaceId` with a known point gives rangeM 400; with an unknown id it gives `null`.
- A new `camera` `{center, rangeM: 1500}` gives that goal.
- An identical state gives `null`.
- A route and a camera change in the same update: the route wins.
- `focusRouteRequest` equal to `route.id` re-frames the route.

`routeLine.test.ts`: 3 coords give length 9, and every y equals `ROUTE_LIFT_M`; a NaN coordinate is dropped; 1 coord gives an empty array.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/three/intents.test.ts src/features/scene/three/routeLine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Measure the radius in metres through `createFrame(centre)`.

- [ ] **Step 4: Run to verify they pass** (same command; expected PASS)

- [ ] **Step 5: Commit** (five files including `sceneStore.ts`; message `feat(web): scene intents to camera goals and route line for three.js`)

### Task 7: Engine and `ThreeScene`

**Files:**
- Create: `apps/web/src/features/scene/three/engine.ts`
- Replace: `apps/web/src/features/scene/three/ThreeScene.tsx` (the Task 2 placeholder)
- Test: `apps/web/src/features/scene/three/ThreeScene.dom.test.tsx`
- Modify: `apps/web/README.md` (a "Three.js Stylised engine (opt-in)" section: `?engine=three`, `?bookmark=`, `?perf=1`)

**Interfaces:**
- Consumes: Tasks 1–6; `useBuildings`, `useSite` (`lib/api`); `useTheme`; `useSceneSettings` (quality, motion); `usePanel` (`features/main/panelStore`), `isWide`, `panelWidthPx`, `PANEL_INSET_PX`; `CameraControls`, `handleMapKey`; `PerfOverlay`, `SlowBanner`, `usePerfStats`; `pickTier`, `createFrameMonitor`, `lowerTier`, `gpuName`; `ROUTE_STYLE` (`../styles`).
- Produces:
  ```ts
  export interface Engine {
    readonly frames: number;
    setCity(g: CityGeometry): void;
    setRoute(positions: Float32Array | null): void;
    setLighting(p: LightPreset, keyDir: [number, number, number]): void;
    setTier(t: Tier): void;
    setViewOffset(panelPx: number): void;
    resize(w: number, h: number): void;
    rig: CameraRig;
    requestRender(): void;
    onFrame(cb: (dtMs: number, info: { calls: number; moving: boolean }) => void): () => void;
    gl(): WebGL2RenderingContext;
    dispose(): void;
  }
  export function createEngine(canvas: HTMLCanvasElement, tier: Tier): Engine; // throws when WebGL2 is unavailable
  export default function ThreeScene(props: { onOps?: (ops: CameraOps | null) => void; createEngineFn?: typeof createEngine }): JSX.Element;
  ```
  DOM contract (Task 8 and the gate scripts rely on it): `<section data-testid="three-scene" aria-label="3D map. …same text as CesiumScene…" tabIndex={0} data-frames={n} data-route={"on"|"off"}>`, with `data-frames` updated at most every 500 ms.

**Engine decisions:**
- `WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" })`, `toneMapping = AgXToneMapping`, `outputColorSpace = SRGBColorSpace`, `shadowMap.type = PCFSoftShadowMap`.
- IBL: `PMREMGenerator.fromScene(new RoomEnvironment())`, with `scene.environmentIntensity = preset.envIntensity`.
- Composer (from `three/addons/postprocessing/`): `RenderPass` → `GTAOPass` (when the tier has AO) → `UnrealBloomPass(strength 0.6, radius 0.4, threshold 0.85)` (when it has bloom) → `OutputPass`.
- Lights: `DirectionalLight` placed with `fitShadowCamera` around the current camera target (radius = range × 1.2), plus a `HemisphereLight`.
- Buildings use `MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })` and cast and receive shadows. The ground is a `PlaneGeometry` that receives shadows.
- Route: `Line2` + `LineMaterial({ color: ROUTE_STYLE.color, linewidth: ROUTE_STYLE.width, depthTest: false, transparent: true })`, `renderOrder = 10`. It is never hidden by buildings.
- Controls: `MapControls` (`three/addons/controls/MapControls.js`). Its distance and polar limits come from `LIMITS`; its `change` event calls `requestRender`.
- Render on demand: the rAF loop runs only while the scene is dirty, a tween is active or the controls are damping. It pauses while `document.visibilityState !== "visible"`. Animation uses real time (`performance.now()`), never frame counts.
- `dispose()` cancels rAF, disposes controls, composer, geometries, materials, PMREM and renderer, and calls `renderer.forceContextLoss()`. Calls made after `dispose()` do nothing.

- [ ] **Step 1: Write the failing DOM tests** (jsdom, with a fake engine passed through `createEngineFn`; use the query-client helpers in `src/test/helpers.tsx`, and mock `fetch` for `/api/layers/buildings` and `/api/site`)

- `mounts a focusable 3D map section with the CesiumScene aria-label`.
- `calls setCity once buildings data arrives`.
- `route.highlight sets a route (data-route="on") and clearRoute removes it (setRoute(null), "off")`.
- `camera.fly_to calls rig.flyTo with the goal converted to a Pose (pitch -45, range from the intent)`.
- `?bookmark=hero-near frames that bookmark first; without it, DEFAULT_BOOKMARK`.
- `theme change calls setLighting with LIGHT_PRESETS[theme]`.
- `unmount calls dispose exactly once` (covers Review Focus 3).
- `createEngineFn throwing propagates to an error boundary` (render inside a minimal test boundary and assert its fallback; covers Review Focus 2).
- `opening the panel calls setViewOffset with panelWidthPx(innerWidth) + 2 × PANEL_INSET_PX on wide screens`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/three/ThreeScene.dom.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `engine.ts` and `ThreeScene.tsx`.** `ThreeScene` picks the tier from `useSceneSettings().quality`: `auto` → `pickTier(gpuName(engine.gl()), navigator.deviceMemory)`, then auto-lowers through `createFrameMonitor` on `onFrame`. It feeds `usePerfStats.update({fps, frameMs, drawCalls, tier, slow})`. It subscribes to `useScene` with `intentGoal` and sets the route with `lineToLocal`. Map keys are handled by `handleMapKey(e, ops)` on the section only.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/three && pnpm --filter @tl/web typecheck && pnpm --filter @tl/web build`
Expected: PASS. The build still passes the Cesium asset check.

- [ ] **Step 5: Browser check.** Start `townshiplens-dev-mock` (`preview_start`) and open `/?engine=three&perf=1`. Confirm that footprints, shadows and the theme switch all work, and that the console is clean after a reload. Ask the assistant a route question and confirm the route draws above the buildings and the camera flies to it. Prefer `get_page_text` / `read_page`; take one screenshot per theme for the ledger.

- [ ] **Step 6: Commit** (`engine.ts`, `ThreeScene.tsx`, the test and `apps/web/README.md`; message `feat(web): three.js engine with AgX, soft shadows, GTAO and bloom`)

### Task 8: 3D smoke test and the Phase 0 measurement

**Files:**
- Create: `apps/web/e2e/three.spec.ts`
- Modify: `docs/superpowers/overnight-log.md` (measurement entry)

**Interfaces:**
- Consumes: the Task 7 DOM contract.

- [ ] **Step 1: Write the e2e test**

```ts
import { expect, test } from "@playwright/test";

// Headless Chromium no longer falls back to SwiftShader on its own.
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

const ring = (x: number, y: number, d = 0.0001) => [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]];
const BUILDINGS = {
  buildings: { type: "FeatureCollection", features: [0, 1, 2].map((i) => ({
    type: "Feature",
    properties: { id: `t${i}`, height_m: 9 + i * 6, kind: "residential" },
    geometry: { type: "Polygon", coordinates: ring(101.5095 + i * 0.0004, 3.1808) },
  })) },
  trees: { type: "FeatureCollection", features: [] },
  as_of: "2026-10-17",
  attribution: [],
};

test("three.js stylised scene mounts, renders and draws a highlighted route", async ({ page }) => {
  await page.route("**/api/layers/buildings", (r) => r.fulfill({ json: BUILDINGS }));
  await page.goto("/?engine=three");
  const scene = page.getByTestId("three-scene");
  await expect(scene).toBeVisible();
  await expect.poll(async () => Number(await scene.getAttribute("data-frames"))).toBeGreaterThan(0);
  const show = page.getByRole("button", { name: "Show assistant" });
  if (await show.isVisible()) await show.click();
  await page.getByRole("textbox", { name: "Your question" }).fill(
    "Can I push a stroller from Car Park B to the playground without stairs?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(scene).toHaveAttribute("data-route", "on");
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @tl/web exec playwright test three.spec.ts`
Expected: PASS. If SwiftShader is unavailable on the machine, report BLOCKED with the console output; do not skip the test silently. Then run the full suite (`pnpm --filter @tl/web e2e`) to confirm `heroes.spec.ts` is unaffected (its List-view tests do not intercept buildings).

- [ ] **Step 3: Phase 0 measurement (owner present).** The owner opens `http://localhost:5173/?engine=three&perf=1&bookmark=hero-mid` at 1440×900 on the laptop with quality pinned to Medium, then High and Low. They orbit for 10 s at each tier. Record the median fps and draw calls from the perf readout, per tier and per theme. Repeat with `bookmark=township`.
- [ ] **Step 4: Record the result.** Append a timestamped entry (`date`) to `docs/superpowers/overnight-log.md`, and add a ruling to the ledger: "Phase 3 technique budget: … — because measured … fps at Medium — cost if wrong: …". If Medium is below 30 fps, re-tune `THREE_TIERS` before Plan P3 and record the change.
- [ ] **Step 5: Commit** (`apps/web/e2e/three.spec.ts`, `docs/superpowers/overnight-log.md`; message `test(web): three.js stylised smoke test and phase 0 measurement`)

---

## Part B — Phase 1: data (lane `data`)

New scripts follow `data/scripts/build_buildings.py`: a module docstring, `ROOT`/`OUT` constants, pure functions tested in `data/scripts/tests/`, and `main(argv)` with `--max-requests` and `--dry-run` where they fetch. Outputs are compact GeoJSON (`_dump` style, `newline="\n"`), each under 6 MB.

**Pipeline order** (Task 10 adds it as root script `data:city`): `build_buildings.py` → `build_landcover.py` → `build_archetypes.py` → `build_signage.py` → `build_landmarks.py`. `sample_heights.py` is **not** part of `data:city`, because it is billable. Its output `base/height_samples.json` is committed and read by `build_archetypes.py`.

### Task 9: Google 3D Tiles client

**Files:**
- Modify: `pyproject.toml` (`data` group: `DracoPy==2.2.0`, `pygltflib==1.16.5`), `uv.lock`
- Create: `data/scripts/gtiles.py`
- Test: `data/scripts/tests/test_gtiles.py`

**Interfaces:**
- Produces:
  ```python
  ROOT_URL = "https://tile.googleapis.com/v1/3dtiles/root.json"
  CACHE = ROOT / "data" / "cache" / "gtiles"
  class TilesBudgetExceeded(RuntimeError): ...
  def ecef(lon: float, lat: float, h: float = 0.0) -> np.ndarray: ...            # WGS84, metres
  def enu_matrix(lon0: float, lat0: float) -> np.ndarray: ...                     # 4x4 ECEF -> ENU
  def bbox_sphere(bbox: tuple[float, float, float, float]) -> tuple[np.ndarray, float]: ...  # (w,s,e,n) -> ECEF centre, radius
  def box_hits_sphere(box: list[float], sphere: tuple[np.ndarray, float]) -> bool: ...       # 3D Tiles OBB (12 numbers)
  def cache_key(url: str) -> str: ...                                             # sha1 of URL without `key` and `session`
  def redact(text: str, key: str) -> str: ...
  class Fetcher:
      def __init__(self, key: str, max_requests: int, cache: Path = CACHE, get=requests.get): ...
      requests_made: int
      def __call__(self, url: str) -> bytes: ...   # cache first; appends key (and keeps session); raises TilesBudgetExceeded
  def traverse(bbox, fetch: Callable[[str], bytes], max_error: float, plan_only: bool = False
               ) -> Iterator[tuple[np.ndarray, str, bytes | None]]: ...  # (tile world transform 4x4, content url, glb or None when plan_only)
  def glb_positions(glb: bytes) -> np.ndarray: ...  # (n,3) tile-local, node transforms applied, glTF y-up -> 3D Tiles z-up; Draco via DracoPy
  ```

- [ ] **Step 1: Add the dependencies**

Run: `uv add --group data DracoPy==2.2.0 pygltflib==1.16.5 && uv sync --all-packages --all-groups`
Expected: installs on Python 3.13 / Windows. If DracoPy has no wheel for this platform, stop and report BLOCKED with the uv output.

- [ ] **Step 2: Write the failing tests** (no network: fake `get`, a hand-built tileset JSON, and a tiny glb built with pygltflib)

- `enu_matrix(101.5, 3.18) @ ecef(101.5, 3.18)` → `[0,0,0]` (±1e-6); a point 0.001° north → about `[0, 110.6, 0]` (±0.5).
- `box_hits_sphere` returns True for a box that contains the bbox centre and False for one 50 km away.
- `cache_key("…/x.glb?key=A&session=S")` equals `cache_key("…/x.glb?session=T&key=B")`.
- `Fetcher` serves a cached URL without calling `get`. The `max_requests + 1`-th uncached call raises `TilesBudgetExceeded`, and its message passes `redact` (the key never appears).
- `traverse` on the fixture tileset: skips the non-intersecting child, does not descend past `geometricError <= max_error`, resolves relative child URIs against the parent, and with `plan_only=True` yields `None` content without fetching any glb.
- `glb_positions` on a one-triangle glb with vertex `(0, 1, 0)` and a node translation `(10, 0, 0)` → contains `(10, 0, 1)` (y-up → z-up).

- [ ] **Step 3: Run to verify they fail**

Run: `uv run pytest data/scripts/tests/test_gtiles.py -q`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement `gtiles.py`.** Follow the 3D Tiles 1.1 traversal: compose `transform`s down the tree and resolve `content.uri` (JSON → recurse, `.glb` → yield). Write the cache as files named `<cache_key>.bin`. Log only request counts.

- [ ] **Step 5: Run to verify they pass** (same command; expected PASS)

- [ ] **Step 6: Commit** (`pyproject.toml`, `uv.lock`, `data/scripts/gtiles.py`, `data/scripts/tests/test_gtiles.py`; message `feat(data): cached google 3d tiles client for height sampling`)

### Task 10: Height sampling

**Files:**
- Create: `data/scripts/sample_heights.py`
- Test: `data/scripts/tests/test_sample_heights.py`
- Modify: `package.json` (root): add `"data:city"` with the pipeline order above (scripts from later tasks are appended as they land)
- Output (data commit): `data/seed/elmina/base/height_samples.json`

**Interfaces:**
- Consumes: `gtiles` (Task 9); `base/buildings.geojson`.
- Produces:
  ```python
  HERO_BBOX = (101.500, 3.172, 101.520, 3.190)   # w, s, e, n — Elmina City Centre
  def build_dsm(points_enu: np.ndarray, extent: tuple[float, float, float, float], cell_m: float = 1.0) -> np.ndarray: ...  # max z per cell, NaN where empty
  def footprint_sample(ring_enu: np.ndarray, dsm: np.ndarray, extent, others_mask: np.ndarray) -> dict | None: ...
      # {"height_m", "roof_p90", "ground_p10", "coverage"}; roof = p90 inside footprint eroded 1 m;
      # ground = p10 in the 3–15 m ring outside, excluding other footprints;
      # None if coverage < 0.5 or height < 2.5 or height > 200
  def main(argv) -> None  # --bbox hero|township|w,s,e,n  --max-error 2.0  --max-requests 300  --plan
  ```
  `height_samples.json`: `{"as_of": "YYYY-MM-DD", "source": "Google Photorealistic 3D Tiles (display only)", "samples": {"<building id>": {height_m, roof_p90, ground_p10, coverage}}}`. Merge into an existing file, never discard earlier samples. Heights are relative (roof − local ground), so geoid and ellipsoid datums never mix.

- [ ] **Step 1: Write the failing tests** (synthetic DSMs only)

- Flat ground at 10 m with a 10×10 m box roof at 19 m → height 9.0 ± 0.5, coverage ≥ 0.9.
- A 12 m tree canopy in the ground ring beside the box still gives 9.0 ± 0.5 (p10 ground).
- A footprint with only 30 % of cells filled → `None`.
- A roof 1 m above ground → `None`; 250 m → `None`.
- A neighbouring footprint inside the ring is excluded through `others_mask`.

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest data/scripts/tests/test_sample_heights.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement `sample_heights.py`.** It reads `GOOGLE_MAPS_API_KEY` from the environment (`.env` loaded the way the API does it), never prints it, and exits 2 with `BLOCKED: …` (redacted) on HTTP 401/403. If the key is browser-referrer restricted, report that to the owner; do not spoof a Referer.

- [ ] **Step 4: Run to verify they pass** (same command; expected PASS)

- [ ] **Step 5: Commit the code** (`sample_heights.py`, its test, root `package.json`; message `feat(data): per-footprint heights from google 3d tiles`)

- [ ] **Step 6: Plan the run (JSON only).** Run: `uv run python data/scripts/sample_heights.py --bbox hero --plan --max-requests 60`. Report the number of JSON requests made and glb tiles needed. Do the same for `--bbox township`. **Stop and show the owner both counts**; the township run goes ahead only if they confirm it as part of the one-time approval.

- [ ] **Step 7: Sampling run.** Run: `uv run python data/scripts/sample_heights.py --bbox hero --max-requests <approved>`, then township if approved. Report the sample count, the share of footprints with a sample, and these sanity values: Elmina Lakeside Mall (`name` in buildings) about 6–15 m; the median of residential-kind samples about 6–11 m; Kanopi Residences ≥ 100 m if its footprint exists. If the checks are far off, stop and report; do not commit.

- [ ] **Step 8: Data commit**

```bash
git add data/seed/elmina/base/height_samples.json
git commit -m "data: building heights sampled from google 3d tiles (display only)"
```

### Task 11: Land cover

**Files:**
- Create: `data/scripts/build_landcover.py`
- Test: `data/scripts/tests/test_build_landcover.py`
- Modify: `data/seed/elmina/site.json` attribution (data commit): add `"ESA WorldCover 10 m 2021 v200 © ESA WorldCover project, CC-BY 4.0"`
- Output (data commit): `data/seed/elmina/base/landcover.geojson`

**Interfaces:**
- Produces:
  ```python
  CLASSES = ("forest", "scrub", "grass", "farmland", "oil_palm", "construction", "parking",
             "residential", "commercial", "industrial", "water", "wetland", "bare")
  WORLDCOVER_URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N03E099_Map.tif"
  WORLDCOVER_CLASS = {10: "forest", 20: "scrub", 30: "grass", 40: "farmland", 60: "bare", 80: "water", 90: "wetland", 95: "wetland"}  # 50 built-up: not drawn
  def landcover_query(tile) -> str: ...
  def osm_class(tags: dict) -> str | None: ...
  def osm_polygons(elements) -> list[dict]: ...          # Features with {"class", "source": "osm", "osm": "way/<id>"}
  def gap_polygons(raster: np.ndarray, transform, covered) -> list[dict]: ...  # {"class", "source": "esa_worldcover_2021"}; drop < 2000 m², simplify 5 m
  def main(argv) -> None  # --max-requests, --dry-run; bbox = build_buildings.bbox_around(home, radius from site.json buildings.radius_m)
  ```
  `osm_class` rules: `landuse=forest`/`natural=wood` → forest; `natural=scrub` → scrub; `landuse=grass|meadow`/`natural=grassland` → grass; `landuse=farmland|orchard|plantation` → oil_palm when `crop`, `produce` or `trees` contains `oil_palm`, else farmland; `landuse=construction|brownfield` → construction; `amenity=parking` (area) → parking; `landuse=residential|commercial|retail|industrial` → that class (retail → commercial); `natural=water`/`landuse=reservoir|basin` → water; `natural=wetland` → wetland; `natural=bare_rock|sand` → bare. Parks stay in `parks.geojson` and are not duplicated here.

- [ ] **Step 1: Write the failing tests:** `osm_class` cases for every rule above, plus `{"landuse": "plantation", "crop": "oil_palm"}` → `oil_palm`, and `{"leisure": "park"}` → `None`. `gap_polygons` on a 20×20 synthetic raster: an area already covered by OSM yields nothing; a 3×3-cell speck (900 m²) is dropped; a class-50 block yields nothing; a 10×10 class-10 block yields one `forest` feature with source `esa_worldcover_2021`.
- [ ] **Step 2: Run to verify they fail**: `uv run pytest data/scripts/tests/test_build_landcover.py -q` → FAIL.
- [ ] **Step 3: Implement.** Read the WorldCover window with rasterio from `/vsicurl/` and cache it as `data/cache/worldcover_<bbox hash>.npy`, plus its transform (the `build_flood.py` DEM pattern). Vectorise with `rasterio.features.shapes`, and use shapely for the union, difference and simplify steps.
- [ ] **Step 4: Run to verify they pass** (same command; PASS)
- [ ] **Step 5: Commit code** (`build_landcover.py`, its test; append it to `data:city`; message `feat(data): land cover from OSM with ESA WorldCover gap fill`)
- [ ] **Step 6: Run and data-commit.** Run: `uv run python data/scripts/build_landcover.py --max-requests 40`. Report the counts per class and source, and the file size. Then commit:

```bash
git add data/seed/elmina/base/landcover.geojson data/seed/elmina/site.json
git commit -m "data: elmina land cover (OSM + ESA WorldCover)"
```

### Task 12: OSM tags, precincts and archetypes

**Files:**
- Modify: `data/scripts/build_buildings.py` (`build_features` keeps `osm` tags subset)
- Modify: `data/scripts/tests/test_build_buildings.py`
- Create: `data/scripts/build_archetypes.py`
- Test: `data/scripts/tests/test_build_archetypes.py`
- Create: `data/seed/elmina/base/archetype_overrides.json` (starts as `{}`; visual checks go here)
- Output (data commit): `base/buildings.geojson` (enriched), `base/precincts.geojson`, `base/archetype_coverage.json`, `site.json`

**Interfaces:**
- Consumes: `height_samples.json` (Task 10), `landcover.geojson` (Task 11), `overpass`.
- Produces in each building's properties: `osm` (`{building, amenity, religion, shop, "building:levels"}`, only keys present), `precinct` (str or absent), `archetype`, `archetype_method`, and final `height_m` / `height_source` with precedence `google_3dtiles > osm_height > osm_levels > archetype_storeys > default`.
  ```python
  ARCHETYPES = ("link_intermediate", "link_long", "superlink", "semi_d", "bungalow", "townhouse",
                "shop_office", "highrise", "school", "mosque", "factory", "mall", "generic")
  STOREY_HEIGHT_M = {"link_intermediate": 8.5, "link_long": 8.5, "superlink": 9.0, "semi_d": 9.0,
                     "bungalow": 5.5, "townhouse": 6.0, "shop_office": 11.0, "school": 14.0,
                     "mosque": 15.0, "factory": 10.0, "mall": 9.0}   # highrise and generic: none
  LOW_RISE = set(STOREY_HEIGHT_M) - {"school", "mosque", "mall", "factory"}
  def precincts_query(tile) -> str: ...   # place=suburb|neighbourhood|quarter nodes; named landuse=residential ways
  def build_precincts(elements) -> list[dict]: ...
  def precinct_of(lon: float, lat: float, precincts: list[dict]) -> str | None: ...  # containing named polygon, else nearest place node ≤ 1500 m
  def shape_metrics(ring: list[list[float]]) -> dict: ...  # width_m (short side), length_m, area_m2, fill (area / min rotated rect)
  def assign(props: dict, m: dict, precinct: str | None, landuse: str | None, height: float | None) -> tuple[str, str]: ...
  def final_height(props: dict, archetype: str, sample: dict | None) -> tuple[float, str]: ...
  def main(argv) -> None  # --max-requests (precinct query only), --dry-run
  ```
  `assign` rules, first match wins (method in brackets):
  1. An override in `archetype_overrides.json` (`override`).
  2. `building=mosque`, or `amenity=place_of_worship` with `religion=muslim` and a name not starting with "Surau" (`osm_tag`). Surau stay generic.
  3. `building=school|kindergarten`, `amenity=school|kindergarten`, or a name matching `^(SK|SJK|SMK|SMA|Sekolah|Tadika)\b` (`osm_tag`).
  4. Kind `industrial`, or landuse `industrial` (`osm_tag` / `landuse`) → factory.
  5. Height ≥ 30 m, or `building=apartments` with height ≥ 20 m (`height`) → highrise.
  6. Kind `commercial` or landuse `commercial`: area ≥ 4000 m² → mall (`osm_tag+size`); a row shape (width 15–26 m, length ≥ 2.5 × width, fill ≥ 0.8) → shop_office (`shape`).
  7. `building=bungalow|detached|house|villa` with area 150–600 m² and fill ≥ 0.6 → bungalow; `building=townhouse` → townhouse (`osm_tag`).
  8. Kind `residential`/`other` in landuse `residential`, with fill ≥ 0.8 (`shape`, or `shape+precinct` for superlink):
     - width 5.5–7.5 and length 18–23 → link_intermediate;
     - width 5.5–7.5 and length 23–26.5 → link_long;
     - width 10.2–11.8, length 19–23 and precinct matching `/ridge/i` → superlink;
     - width 11.5–13.5 and length 22–26.5 → semi_d;
     - a row (width 18–26 = depth, length ≥ 2.5 × width) → link_intermediate when depth < 23, else link_long.
  9. Otherwise generic (`generic`).

  `final_height`: a sample wins, unless the archetype is in `LOW_RISE` and the sample is > 3 × `STOREY_HEIGHT_M[archetype]`, which is rejected as an outlier. Next come the OSM tag heights, then `STOREY_HEIGHT_M` (`archetype_storeys`), then the existing default.

- [ ] **Step 1: Write the failing tests.** Cover each `assign` rule with a minimal props/metrics dict, plus these:
  - "Surau Al Falah" with religion muslim → generic.
  - A 6.1×21.3 m rectangle outside a residential landuse → generic (prefer generic over a guess).
  - A superlink-sized lot in precinct "Elmina Green 3" → generic.
  - `shape_metrics` of a 6.1×21.3 m rectangle → width 6.1 ± 0.05, fill ≈ 1.
  - `final_height` precedence, and the outlier rejection (link_intermediate with a 40 m sample → `archetype_storeys`, 8.5).
  - Idempotence: running `main`'s transform twice on the same features gives identical output.
  - `build_features` keeps the `osm` subset and drops unrelated tags.
- [ ] **Step 2: Run to verify they fail**: `uv run pytest data/scripts/tests/test_build_archetypes.py data/scripts/tests/test_build_buildings.py -q` → FAIL.
- [ ] **Step 3: Implement.** `build_archetypes.py` writes `archetype_coverage.json`: per precinct (and `null`), counts by archetype, the generic share and counts by method. It prints the same summary and records `site.json["buildings"]["archetypes_as_of"]`.
- [ ] **Step 4: Run to verify they pass** (same command; PASS)
- [ ] **Step 5: Commit code** (the scripts, tests and empty overrides file; append it to `data:city`; message `feat(data): building archetypes from tags, shape and precinct`)
- [ ] **Step 6: Run and data-commit.** Run: `uv run python data/scripts/build_buildings.py --max-requests 40`. It should be served from the Overpass cache; report the real request count. Then run `uv run python data/scripts/build_archetypes.py --max-requests 10` and report the coverage summary. Then spot-check 10 hero-district buildings per non-generic archetype against Street View or 3D tiles (spec §2.3), and record any corrections in `archetype_overrides.json` with a `note`. Rerun, then commit:

```bash
git add data/seed/elmina/base/buildings.geojson data/seed/elmina/base/precincts.geojson data/seed/elmina/base/archetype_coverage.json data/seed/elmina/base/archetype_overrides.json data/seed/elmina/site.json
git commit -m "data: elmina building archetypes, precincts and final heights"
```

### Task 13: Signage with sources

**Files:**
- Create: `data/scripts/build_signage.py`
- Test: `data/scripts/tests/test_build_signage.py`
- Output (data commit): `data/seed/elmina/base/signage.geojson`

**Interfaces:**
- Produces:
  ```python
  JUNK = re.compile(r"unnamed|not osv|google maps|fixme|todo|\?|^\W*$", re.I)
  def signage_query(tile) -> str: ...   # nodes+ways with name or brand and one of shop|amenity|office|leisure|tourism|craft|healthcare
  def sign_text(tags: dict) -> str | None: ...   # name, else brand; None if JUNK matches or empty; collapse whitespace
  def attach(pt: tuple[float, float], buildings: list[dict], max_m: float = 25.0) -> str | None: ...  # containing footprint, else nearest edge ≤ 25 m
  def build_signs(elements, buildings, as_of: str) -> tuple[list[dict], dict]: ...  # features + stats {kept, junk, unattached, capped}
  ```
  Each sign is a Point feature at the POI (way: its centroid), with properties `id` (`sign-<n|w><osm id>`), `text`, `building_id`, `osm` (`node/<id>`), `source_url` (`https://www.openstreetmap.org/<type>/<id>`), `source_label` (`"OpenStreetMap"`) and `as_of`. A building gets at most 4 signs, kept in OSM id order. There are no logo fields.

- [ ] **Step 1: Write the failing tests:** `sign_text` rejects "Only seen in Google Maps. Not OSV.", "Clinic (unnamed, OSM)", "fixme" and "  "; keeps "Ediya Coffee"; uses brand when there is no name. `attach` returns the containing footprint, the nearest one within 25 m, or `None` beyond. Every built feature has non-empty `source_url` and `as_of`. A building gets at most 4 signs. Duplicate POIs from tiled requests are dropped.
- [ ] **Step 2: Run to verify they fail**: `uv run pytest data/scripts/tests/test_build_signage.py -q` → FAIL.
- [ ] **Step 3: Implement** (the query goes through `overpass.py`; tiles come from `build_buildings.tiles`).
- [ ] **Step 4: Run to verify they pass** (same command; PASS)
- [ ] **Step 5: Commit code** (two files; append it to `data:city`; message `feat(data): sourced text-only signage from OSM`)
- [ ] **Step 6: Run and data-commit.** Run: `uv run python data/scripts/build_signage.py --max-requests 40`. Report the stats, then commit `data/seed/elmina/base/signage.geojson` (message `data: elmina signage from OSM names`).

### Task 14: Landmarks

**Files:**
- Create: `data/scripts/build_landmarks.py`
- Test: `data/scripts/tests/test_build_landmarks.py`
- Output (data commit): `data/seed/elmina/base/landmarks.geojson`

**Interfaces:**
- Produces:
  ```python
  LANDMARKS = [
    {"id": "kanopi-residences", "name": "Kanopi Residences", "model": "kanopi",
     "match": r"kanopi", "info_url": "https://www.simedarbyproperty.com/city-of-elmina/elmina-city-centre/kanopi-residences/"},
    {"id": "elmina-lakeside-mall", "name": "Elmina Lakeside Mall", "model": "lakeside_mall",
     "match": r"elmina lakeside mall", "info_url": "https://www.starproperty.my/news/sdp-launches-elmina-lakeside-mall/130902"},
    {"id": "masjid-denai-alam", "name": "Masjid Denai Alam", "model": "masjid_denai_alam",
     "match": r"masjid\s+denai\s+alam", "info_url": None},
  ]
  def resolve(spec: dict, buildings: list[dict], pois: list[dict]) -> dict | None: ...
      # 1) a building whose name matches; 2) an OSM POI whose name matches -> containing footprint, else nearest ≤ 30 m; else None
  def main(argv) -> None  # --max-requests; prints placed / unplaced
  ```
  Each output feature is the matched footprint polygon, with properties `id`, `name`, `model`, `building_id`, `osm` (`way/<id>` or `node/<id>`), `source_url` (OSM), `info_url` and `as_of`. An unplaced landmark gets no feature and is reported. Never invent a footprint. The spec's other candidates (Urban Park tiger playground and so on) are added to `LANDMARKS` in Plan P3 as they come up.

- [ ] **Step 1: Write the failing tests:** a name match on a building wins; a POI-only match picks the containing footprint; a POI 50 m from every footprint → `None`; an unmatched spec → `None`; output features carry `source_url`.
- [ ] **Step 2: Run to verify they fail**: `uv run pytest data/scripts/tests/test_build_landmarks.py -q` → FAIL.
- [ ] **Step 3: Implement** (the POI query is a small Overpass `nwr[name~"…",i]` over the bbox, through `overpass.py`).
- [ ] **Step 4: Run to verify they pass** (same command; PASS)
- [ ] **Step 5: Commit code** (two files; append it to `data:city`; message `feat(data): landmark placement from OSM matches`)
- [ ] **Step 6: Run and data-commit.** Run: `uv run python data/scripts/build_landmarks.py --max-requests 5`. Report placed and unplaced. If Kanopi is unplaced (its footprint is likely not in OSM yet), add a ledger note for the owner: "Kanopi has no OSM footprint; placing it needs a sourced outline — owner to decide in P3." Commit `base/landmarks.geojson` (message `data: elmina landmarks`).

### Task 15: Serve the new layers

**Files:**
- Modify: `apps/api/src/townshiplens_api/routes/core.py` (`BuildingsLayer`, `buildings_layer`)
- Modify: `apps/api/tests/test_buildings_api.py`
- Regenerate: `packages/api-client/openapi.json`, `packages/api-client/schema.d.ts`
- Modify: `data/README.md` (new builders, pipeline order, `data:city`, the height-sampling run and its scoped Google exemption, attributions), `packages/spatial/README.md` world data contract (optional base files)

**Interfaces:**
- Produces: `BuildingsLayer` gains `landcover`, `signage` and `landmarks` (each `dict[str, Any]`, default empty FeatureCollection). The cache key includes their mtimes. `signage` is filtered server-side to features with non-empty `text`, `source_url` and `as_of`. Building properties pass through unchanged (`archetype`, `archetype_method`, `height_source`, `precinct`).

- [ ] **Step 1: Write the failing tests** (extend `_world` with optional `landcover`, `signage` and `landmarks` files):
  - `test_new_layers_default_empty` (files absent → empty collections, 200).
  - `test_serves_landcover_signage_landmarks`.
  - `test_signage_without_source_is_dropped` (one feature without `source_url`, one with an empty `text` → neither is served).
  - `test_editing_signage_invalidates_cache`.
  - `test_building_archetype_props_pass_through`.
- [ ] **Step 2: Run to verify they fail**: `uv run pytest apps/api/tests/test_buildings_api.py -q` → FAIL.
- [ ] **Step 3: Implement**, then run `pnpm gen`.
- [ ] **Step 4: Run to verify they pass**: `uv run pytest apps/api -q && pnpm gen && git diff --stat packages/api-client` (the diff shows only the three new fields). Expected: PASS.
- [ ] **Step 5: Commit** (`core.py`, the test, `packages/api-client/*`, `data/README.md`, `packages/spatial/README.md`; message `feat(api): serve land cover, signage and landmarks with the buildings layer`)

---

## Integration

### Task 16: Merge, verify and hand over to the gate

**Files:**
- Modify: `docs/superpowers/overnight-log.md`, the ledger `.superpowers/sdd/2026-10-17-stylised-threejs-p01/`

- [ ] **Step 1: Merge.** On `feat/stylised-threejs`: `git merge --no-ff lane/data`, then `git merge --no-ff lane/fe`. The only expected conflict is root `package.json`; keep both sides.
- [ ] **Step 2: Rebuild check.** Run: `uv sync --all-packages --all-groups && pnpm install`, then `pnpm data:city`. It is served from caches; report the Overpass requests made, which must be 0. Then `git status --short data/` shows no diff (the pipeline is reproducible).
- [ ] **Step 3: CI checklist.** Run each with `set -o pipefail` and report PASS / FAIL / BLOCKED / NOT RUN, noting the mock-backed ones (golden, e2e):
  1. `pnpm lint`
  2. `uv run pytest -q`
  3. `pnpm -r --if-present typecheck`
  4. `pnpm -r --if-present test` (map keys blanked, per the local-CI memory)
  5. `pnpm gen && git diff --exit-code packages/api-client`
  6. `pnpm golden`
  7. `pnpm --filter @tl/web e2e`
- [ ] **Step 4: Browser check on the merged branch.** Open `/?engine=three&perf=1` with the Elmina seed and mock LLM. Confirm the scene renders with the sampled heights (hero buildings vary, not a flat 9 m), and that the Cesium Stylised default at `/` is unchanged.
- [ ] **Step 5: Log and hand over.** Write an overnight-log entry (real `date` timestamps) covering the fps table from Task 8, the sampling request counts and coverage, the archetype coverage summary, and unplaced landmarks. Then commit it (`docs: phase 0-1 of the three.js stylised overhaul`). Push only if the owner asks. Next comes Plan P2 (assets), written with the Phase 0 numbers in hand.
