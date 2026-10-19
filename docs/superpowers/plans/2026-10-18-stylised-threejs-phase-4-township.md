# Stylised City on Three.js — Phase 4 (township rollout and quality) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the opt-in `?engine=three` view from the hero district to the whole City of Elmina, and fix what the owner disliked at the P3 gate:
- rich content (trees, lamps, furniture, roads, signs, traffic) streams in around the camera **anywhere** in the township, with the hero district the richest;
- buildings look like buildings: a procedural facade for the ~2,000 extruded blocks and the ~3,500 `generic` placements, a detail pass on the Blender archetypes, dressed big roofs, and lit windows at night on every building type;
- no empty-looking land: textured ground, grass verges and shrubs, parking lots drawn as lots, construction land dressed by area;
- smooth motion: traffic and people at display rate with no end-of-path teleports or corner snaps, and smooth birds;
- the remaining gate notes: smaller street trees, Kanopi's podium roof, residents legible at hero-mid.

The phase ends at the owner's visual and performance gate. Making Three.js the default engine stays in Plan P5 (owner, 2026-10-18).

**Architecture:**
- **Task 1 first:** `ThreeScene.tsx` (1,111 lines, ~36 effects coupled through refs) is split into concern hooks under `three/scene/`, with no behaviour change, so streaming has clean seams. This also removes the double `CityInstances` build.
- **Streaming:** a camera-driven **tile grid** (`three/stream/`). The township is cut into 250 m tiles in the local frame. Each tile's content is planned by the existing planners, now given a tile box, deterministically and lazily, then kept in an LRU cache. The engine's existing 250 ms LOD schedule drives the active set: rings around the camera target, with caps per ring and a hero multiplier.
- **Building quality** has two halves:
  - **fe lane:** a procedural facade generator for real footprints at real heights (window grid by storey, parapets, roof dressing), used for extruded and `generic` buildings;
  - **blender lane:** a detail pass on the archetype models, behind an owner gate.
- **Everything new is decorative** except what it decorates. The facade and roof dressing sit on real OSM footprints and heights; the windows, rooftop units and verges are decoration (`userData.decorative`, never cited). The building itself stays pickable.

**Tech stack:**
- three 0.186.1: `InstancedMesh`, `BatchedMesh` only if Task 3 measures it as better, `ShaderMaterial` patches, `DataTexture`.
- vitest 5, Playwright 1.64.
- Blender 5.2 headless for the asset lane.
- Python 3.13 + uv + shapely for the data lane.

**Spec:** `docs/superpowers/specs/2026-10-17-stylised-city-threejs-overhaul-design.md`, §2.1, §2.4–§2.8, §3, §4 Phase 4 and §5, with ADR 0012 and ADR 0013.
- Read the P3 plan's Global Constraints first: `docs/superpowers/plans/2026-10-18-stylised-threejs-phase-3-hero-district.md`. They all still bind and are not repeated here, except where this plan changes them (marked **changed**).
- Read the 2026-10-18 P3 entry in `docs/superpowers/overnight-log.md` and the P3 ledger `.superpowers/sdd/2026-10-18-stylised-threejs-phase-3-hero-district/progress.md` (rulings, deferred minors).

**Scope:**
- In: spec §4 Phase 4 (LODs, instancing, streaming by distance, performance tuning), plus the owner's P3 gate notes listed in the goal.
- Out (P5): flipping the default engine and retiring `cesium/stylised/`.
- Out: the Masjid Denai Alam outline. It stays deferred, because no public drawing exists (owner, 2026-10-18).

**Session handoff: the state at the start of P4 (2026-10-18)**

**Branch**
- `main` at `eb750e0` contains all of P0–P3 (merged as `2a80f30`) plus the CI timeout fix, and it is pushed. GitHub CI on `main` is green (run 39110386778).
- `feat/stylised-threejs-p4` was branched from `main` (`eb750e0`), and this plan is its first commit. It is local only.
- **Prerequisites (coordinator):**
  1. `git -C ../SunNiuBi-wt/<wt> checkout -B lane/<x> feat/stylised-threejs-p4` for `fe`, `blender` and `data`. These worktrees still sit on their P3 lane branches, which are fully merged into `main`, so resetting them is safe. Check `git -C <wt> status` is clean first.
  2. Add `fe-b` per the schedule.
  3. Run `pnpm install && uv sync --all-packages --all-groups` in each.
- **Ledger:** run the skill's `sdd-workspace` on this plan file (it gives `.superpowers/sdd/2026-10-18-stylised-threejs-phase-4-township/`), create `progress.md`, and copy P3's `working-rules.md`, `reviewer-rules.md` and `rereview-rules.md` into it, updating the branch and worktree names.
- **Owner decisions already made (2026-10-18):**
  - P3 notes in scope: flat roofs, building quality (blocks, Blender models, big roofs, night look), empty land (bare land, construction), unsmooth motion (vehicles, people, trees, birds), trees too big.
  - Not in scope: the flood + route clutter.
  - Rollout: rich content everywhere around the camera, with the hero district richest.
  - The Masjid stays deferred.
  - Three.js stays opt-in until P5.

**Measured at the end of P3** (SwiftShader orbit medians; the owner passed the gate):
- hero-mid Medium: 100 draws, 2.36 M tris.
- hero-near Medium: 113 draws, 3.07 M tris.
- township Medium: 60 draws, 0.93 M tris.

**Fallback reasons, whole township** (`data/scripts/report_fallbacks.py --radius-m 20000`, before the P3 front swap):
- `generic`: 3,522 fit and 1,406 fallbacks. Of the fallbacks, `sz` is 967, `fill` 325, `sy` 89 and `sx` 25.
- `factory sx`: 237.
- `link_*`: 280, which the P3 swap reduced.
- The web side counts 1,740 `no_fit` and 325 `generic_fill`.

**Known motion defects:**
- The motion clock is capped at 30 fps (`motion/motionClock.ts:7`).
- `poseAt` (`motion/agents.ts:70`) wraps `offset % length`, so an agent teleports from the end of its polyline back to the start.
- Yaw follows each segment's tangent, so it snaps at corners.
- Birds move per motion tick.

**Hero-only limits today:** `HERO_CENTRE`/`HERO_RADIUS_M` (`bookmarks.ts:6-9`) feed `planProps` (`ThreeScene.tsx:360-378`), `planAgents` (`:698-713`), `planSigns` (`:587-596`), the road ribbons (`:744-753`) and `createAmbient` (`:617`). Land cover, the city and the overlays already cover the whole township.

**Where the P3 code lives (read these before dispatching)**
- **Scene:** `three/engine.ts` holds the slots (`setCity`, `setAssets`, `setGround`, `setDecor(slot)`, `setMotion`, `setOverlays`), the render loop, and the 250 ms LOD schedule at `:537`. `three/ThreeScene.tsx` holds the React side.
- **Content:**
  - `assets/` (`plan.ts`, `cityInstances.ts`, `roleMaterial.ts`, `fit.ts`);
  - `props/` (`propsPlan.ts`, `caps.ts`, `lampPools.ts`);
  - `motion/` (`agents.ts`, `motionClock.ts`, `motionLayer.ts`);
  - `ground/` (`ribbons.ts`, `landcover.ts`, `bands.ts`, `groundLayer.ts`);
  - `signs/`, `ambient/`, `overlays/` (`accessLayers.ts`, `lines.ts`, `floodLayer.ts`, `markers.ts`, `residents.ts`, `useResidents.ts`);
  - `pick.ts`, `mood.ts`, `lighting.ts`, `fallbackStyle.ts`, `cityMesh.ts`, `honesty.test.ts`.
- **Cards:** `features/map-ui/BuildingCard.tsx`, `SignCard.tsx`.
- **Patterns to keep:**
  - Batched pickables carry `userData.pick = { kind }` plus an id table, resolved by `signIdAt` / `markerIdAt` / `residentIdAt` / the `buildingIdOf` face table.
  - Decorative objects carry `userData.decorative = true` and a no-op raycast.
  - The ground bands use renderOrder 1–5, lamp pools and cloud shadows 6–7, and the flood fill 8 (main scene).
  - Overlays use 10–15 in the overlay scene (depthTest off, drawn after AO).
- **Assets:** `assets/blender/tl_assets/` (`specs.py`, `archetypes.py`, `landmarks.py`, `kits.py`, `run.py`, `pack.py`). Build with `uv run python assets/blender/run.py --all && uv run python assets/blender/pack.py`. Blender 5.2 runs headless.
- **Data:** `data/seed/elmina/base/` (`buildings.geojson` has `archetype`, `front_deg`, `display_height_m`, `display_height_source`; also `landcover.geojson`, `landmarks.geojson`, `signage.geojson`, `precincts.geojson`, `walk.geojson`).
- **SDD helpers:** `bash <superpowers>/skills/subagent-driven-development/scripts/{sdd-workspace,task-brief,review-package}`. P3 kept shared prompt files you can copy into the new workspace: `working-rules.md`, `reviewer-rules.md`, `rereview-rules.md` in `.superpowers/sdd/2026-10-18-stylised-threejs-phase-3-hero-district/`. Copy them and update the branch and worktree names.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, plus the session's own `Claude-Session:` line.

**Machine:**
- 8 GB RAM. Run one heavy process at a time and use `--maxWorkers=3` for vitest (`--maxWorkers=2` while two lanes run in parallel; see the schedule below).
- Subagents must kill **only the PIDs they started**. A blanket node/python kill took down the MCP servers in P3.
- The Playwright MCP may be disconnected. Scripted Playwright (`pnpm --filter @tl/web exec node <script>`) is the fallback for screenshots and budgets.

## Global Constraints

Everything in the P3 plan's Global Constraints still binds. Changes and additions:

**Budgets (changed and extended)**
- hero-mid Medium stays at ≤ 150 draws, ≤ 2.5 M tris (all passes), ≤ 150 MB geometry and instance buffers, and ≥ 30 fps at 1440×900 on the owner's laptop.
- **New: any-position budget.** The same limits hold at Medium for the six **probe views** in `bookmarks.ts` (Task 2): hero-mid, township, and four non-hero precincts at mid range (800 m).
- **New: streaming hitch budget.** Planning a tile takes ≤ 8 ms on the main thread, and no frame may plan more than one tile. Tile planning that exceeds this moves to a worker (Task 4 decides by measurement).
- Low tier: no props, agents, signs or ambient (unchanged), and no procedural facade detail. Facades fall back to the P3 palette extrusion.

**Streaming**
- Tile size: 250 m squares in the local frame, keyed `"<i>,<j>"` from the frame origin.
- Rings, measured as the Chebyshev tile distance from the tile under the camera target:
  - **ring 0:** the target tile;
  - **ring 1:** the 8 tiles around it;
  - **ring 2:** up to 2 tiles out.
- Ring 2 only applies when the camera range is ≤ 1500 m. Beyond that, only ring 0–1 content shows, and only trees and roads.
- Per-tile caps: `TILE_CAPS[tier][ring]`, multiplied by `HERO_BOOST = 1.6` for tiles whose centre is within `HERO_RADIUS_M` of `HERO_CENTRE`. The sum over active tiles must stay within the tier's frame budget (Task 2 test).
- Determinism: a tile's content depends only on its key, the tier and the data, never on visit order. The seed is `hash01(tileKey, salt)`.
- LRU of planned tiles: 64 tiles. Evicted tiles dispose their GPU buffers.

**Motion (changed)**
- At High and Medium, the motion clock runs at **display rate** (one tick per rAF while running). At Low, motion is off.
- If the frame monitor reports < 45 fps median during motion, the clock falls back to 30 fps (`MOTION_FRAME_MS`) for the session.
- All other P3 motion rules hold: real time, the pause and stop gates, and the 1.0 s Day/Rollout fade.

**Trees (owner override of spec §2.4 true scale, P3 gate)**
- Street and verge trees use smaller forms:
  - `rain_tree` at a display scale of 0.55–0.7 (an 11–14 m canopy);
  - `flame_tree`, `frangipani` and the palms at 0.8–1.0.
- Park and forest trees keep 0.8–1.1.
- No tree canopy may overhang a footway or path centreline by more than 1.0 m at y < 3 m. This is the paths-hidden note.

**Honesty (additions)**
- Procedural facades, rooftop units, skylights, verges, shrubs, parked cars, parking-stall markings and construction dressing are **decorative**: `userData.decorative = true`, no-op raycast, never cited.
- The building mesh under a facade stays pickable as the same building (P3 ruling R-A).
- Facades never change a building's footprint or height. Window storeys come from the displayed height divided by 3.2 m. A building whose `display_height_source` is `default` gets the same treatment, because its card already says "Default estimate".
- Parking stalls are drawn only on land-cover `parking` polygons or OSM `amenity=parking` areas, never invented elsewhere.

**Lanes**

| Lane | Tasks | Paths |
|---|---|---|
| `fe` (`fe-a`, `fe-b`) | 1–6, 8–15, split per the schedule below | `apps/web/**` |
| `blender` | 7 | `assets/blender/**`, `apps/web/public/city/**` |
| `data` | 10 (parking areas, if the seed lacks them) | `data/**` |

- The coordinator merges with `--no-ff` into `feat/stylised-threejs-p4`. Merging into `main` and pushing happen only on owner request.
- Commits: conventional with a scope; data regeneration in its own `data:` commit; explicit paths; trailer as in P3.

**Rulings to record in the ledger at the start:**
- "Facades are generated procedurally in the browser (instanced window quads plus parapet and roof meshes per building), not as Blender assets per footprint, because 5,500 unique footprints can't be modelled. Cost if wrong: a uniform look; mitigated by per-precinct palettes and a hash-seeded window style."
- "Tiles are planned on the main thread first; a worker only if Task 4's measurement exceeds 8 ms per tile. Cost if wrong: a hitch while flying, caught by the Task 4 test."
- "Street-tree scale drops below the spec's true-scale rain tree, because the owner's gate note says the trees are too big. Cost if wrong: re-tune constants."
- "The hero district gets `HERO_BOOST` 1.6 on caps (owner: 'hero richest'). Cost if wrong: one constant."

## Parallel execution schedule (the owner is in a hurry)

Tasks run in **waves**. Inside a wave, each lane has its **own worktree and branch**, so parallel implementers never share files:
- **fe-a:** `../SunNiuBi-wt/fe` on `lane/fe`;
- **fe-b:** `../SunNiuBi-wt/fe-b` on `lane/fe-b`;
- **blender:** `../SunNiuBi-wt/blender` on `lane/blender`.

Create `fe-b` with `git worktree add ../SunNiuBi-wt/fe-b -b lane/fe-b feat/stylised-threejs-p4`, then run `pnpm install && uv sync --all-packages --all-groups` in it. The coordinator merges every lane into `feat/stylised-threejs-p4` (`--no-ff`) at the end of each wave and fast-forwards the lanes before the next wave. **At most 2 implementers run vitest at once** (8 GB RAM). Blender counts as one, so while Task 7 builds, only one fe lane runs tests.

**Split tasks.** Tasks 6, 8, 9 and 10 split into a pure half and a wiring half:
- the pure half (planner + layer + tests, new files only) can run early;
- the wiring half (into the Task 1 hooks and the Task 4 streamer) waits.

Brief them as `6a/6b`, `8a/8b`, `9a/9b` and `10a/10b`.

| Wave | fe-a | fe-b | blender | Needs |
|---|---|---|---|---|
| 1 | **T1** hooks split (touches `ThreeScene.tsx`, `assets/cityInstances.ts`) | **T2** tiles and caps (new `stream/*`, `bookmarks.ts`), then **6a** facade plan and layer (new `facade/*`) | **T7** archetype detail (runs all wave long; owner preview at the end of wave 2) | — |
| 2 | **T5** tile-bucketed LOD (`cityInstances.ts`; needs T1 and T2), then **6b** facade wiring (`scene/useCityAssets.ts`, `assets/plan.ts`) | **T3** planners take a box (`propsPlan`, `agents` planner, `signPlan`, `ribbons`; needs T2), then **8a** roof plan and layer (new files) | T7 continues | wave 1 merged |
| 3 | **T4** streamer and wiring (needs T1, T2, T3; touches `engine.ts`, the `scene/use*` hooks) | **T12** smooth motion (`poseAt`, `motionClock`, `motionLayer`, `ambient`; does **not** touch `engine.ts`, so its display-rate hook is a small follow-up in wave 4), then **9a** and **10a** planners (new files) | — | wave 2 merged |
| 4 | **8b**, **9b**, **10b** wiring into the streamer and hooks, then the T12 engine hook | **T11** tree scale (`propsPlan.ts`, after T3), then **T13** night windows and residents (after T7 merged) | — | wave 3 merged |
| 5 | **T14** honesty, e2e, README | — | — | wave 4 merged |
| 6 | **T15** merge, CI, budgets, owner gate (coordinator) | — | — | all |

**Conflict notes**
- T3 and T12 both touch `motion/agents.ts`: T3 changes `planAgents`, T12 changes `poseAt`. They are in different waves, which keeps the merge trivial.
- Only T4 (wave 3) and the T12 follow-up (wave 4) touch `engine.ts`.
- T5 and T1 both touch `cityInstances.ts`, so T5 waits for T1.

**Expected speed-up:** about 6 waves instead of 15 serial tasks, roughly 40–50 % less wall-clock. Reviews still run per task. Dispatch a wave's two reviews in parallel too; reviewers only read, so they are cheap on memory.

## Review Focus

1. **Flying across the township must not hitch or leak.** Fly from hero-mid to a far precinct and back three times: no frame over 50 ms caused by planning, GPU memory flat after the LRU fills, and no leftover meshes. Pinned in Task 4 (one tile per frame, LRU disposal test) and Task 15 (scripted fly with a memory sample).
2. **Any camera position must stay in budget,** not just hero-mid. A dense precinct with many signs and agents at Medium is the worst case. Pinned in Task 2 (`TILE_CAPS` sum test against the frame budget) and Task 15 (the six probe views).
3. **A facade must never misstate a building.** No extra storeys beyond the displayed height, no windows drawn below ground or above the parapet, and the card unchanged. Pinned in Task 5 (storey count and bounds tests) and Task 14 (honesty).
4. **Motion must look continuous:** no agent ever jumps more than its speed × dt between frames, including path ends and Day/Rollout fades, and yaw changes are bounded per frame. Pinned in Task 12 (pose continuity property test).
5. **Overlays and routes stay on top of the new decor.** Verges, shrubs, parking cars and facade quads must not hide a route or status path at hero-near (P3 Review Focus 1). Pinned in Task 14 (overlay `depthTest`/`renderOrder` checked across all new objects).

---

## Part A — Structure

All paths are under `apps/web/src/features/scene/three/` unless stated.

### Task 1: Split ThreeScene into concern hooks (no behaviour change)

**Files:**
- Create in `scene/`:
  - `useEngine.ts`: engine, canvas size, bounds, tier, perf and DOM attributes, auto-drop;
  - `useCityAssets.ts`: manifest, library, city plan, city mesh, `CityInstances`, landmarks;
  - `useGround.ts`: land cover, roads, ground layer;
  - `useDecor.ts`: props instances, lamp pools, signs, ambient;
  - `useMotion.ts`: gates, driver, agents;
  - `useMood.ts`: mood loop, fog, background;
  - `useOverlays.ts`: overlay layer, residents;
  - `usePicking.ts`: click to pick to dispatch;
  - `useCameraOps.ts`: intents, start pose, view offset, bookmarks.
- Modify: `ThreeScene.tsx` becomes composition plus JSX, ≤ 250 lines.
- Tests: the existing `ThreeScene.dom.test.tsx` must pass unchanged, except imports. Add `scene/useCityAssets.dom.test.tsx` for the single-build rule.

**Interfaces:**
- Produces: each hook takes `{ engine, frame, tier, … }` and returns a small handle (e.g. `useCityAssets(...) → { plan: CityPlan | null; setKits(kits: Map<string, Placement[]> | null): void; assetsState; decorAssets }`).
- Cross-hook data passes through hook return values, never shared refs declared in `ThreeScene`.
- **Single build:** `CityInstances` is created once per (plan, tier) and kits are applied through `setKits`. Add a `CityInstances.setKits(kits, kitLodScale)` that rebuilds only kit buckets, leaving archetype buckets alone. It lives in `assets/cityInstances.ts`.

- [ ] **Step 1: Write the failing test.** `useCityAssets.dom.test.tsx`:
  - On load with props, `createCityInstances` is called **once**;
  - a later props plan calls `setKits`, not `createCityInstances`;
  - a tier change Medium → High calls `setKits` again but does not rebuild archetype buckets (spy on the bucket build).
- [ ] **Step 2: Run** `pnpm --filter @tl/web exec vitest run src/features/scene/three/scene` and expect FAIL.
- [ ] **Step 3: Implement.**
  - Move code verbatim into the hooks, effect by effect.
  - Replace each cross-concern ref (`handedOff`, `cityPlanRef`, `propsKits`, `ambientRef`, `driverRef`, `moodRef`, `tierRef`) with a hook return value or a single `useSceneBus()` zustand slice local to the three view. Record the choice in the commit message.
- [ ] **Step 4: Run** the `three` folder, `ThreeScene.dom.test.tsx` and `three.spec.ts` (e2e, alone). Everything must PASS with the same counts as before.
- [ ] **Step 5: Commit** `refactor(web): split the three.js scene into concern hooks, one city build`.

---

## Part B — Township rollout

### Task 2: Tile grid, rings, caps and probe views

**Files:**
- Create: `stream/tiles.ts`, `stream/tiles.test.ts`, `stream/caps.ts`
- Modify: `bookmarks.ts`, adding probe views `probe-a`…`probe-d`. Choose four non-hero precinct centres from `precincts.geojson` with the most buildings: Elmina Valley 3–5, Elmina Green, Business Park. Record them.

**Interfaces:**
```ts
// stream/tiles.ts
export const TILE_M = 250;
export type TileKey = string;                          // "i,j"
export interface Tile { key: TileKey; i: number; j: number; box: { x0: number; z0: number; x1: number; z1: number } }
export function tileAt(x: number, z: number): Tile;
export function activeTiles(target: { x: number; z: number }, rangeM: number): Array<{ tile: Tile; ring: 0 | 1 | 2 }>;
// ring 2 only when rangeM ≤ 1500; ordered ring 0 first, then by distance
// stream/caps.ts
export type StreamKind = "trees" | "lamps" | "furniture" | "construction" | "people" | "vehicles" | "signs" | "verges" | "parking";
export const TILE_CAPS: Record<Tier, Record<0 | 1 | 2, Record<StreamKind, number>>>;
export const HERO_BOOST = 1.6;
export function tileCap(tier: Tier, ring: 0 | 1 | 2, kind: StreamKind, tile: Tile, frame: LocalFrame): number;
```
- Start the `TILE_CAPS` values from P3's `PROP_CAPS` hero totals spread over the ~23 hero tiles (ring 0 dense, ring 2 trees and roads only). Task 15 tunes them by measurement.

- [ ] **Step 1: Write the failing tests.**
  - `tileAt` is stable at tile edges: a point on the shared edge belongs to the higher index.
  - `activeTiles(…, 800)` returns 1 + 8 + 16 tiles with rings 0/1/2.
  - At `rangeM` 2000 it returns only rings 0–1.
  - Ordering is ring first, then distance.
  - `tileCap` is boosted ×1.6 for a tile inside the hero radius and not for one outside, and is 0 at Low.
  - **Review Focus 2:** for every tier and every `rangeM` in {150, 800, 1500}, the sum over active tiles of (cap × per-kind triangle cost from `stream/caps.ts` `TRIS_PER`) plus the measured city baseline (2.0 M at Medium) stays ≤ 2.5 M at Medium. Store `TRIS_PER` as a documented table from the manifest LODs, using the LOD used at ring distance.
- [ ] **Step 2: Run** `pnpm --filter @tl/web exec vitest run src/features/scene/three/stream` and expect FAIL. Implement. Run again and expect PASS.
- [ ] **Step 3: Commit** `feat(web): township tile grid, rings and per-tile caps`.

### Task 3: Planners take a tile box

**Files:**
- Modify: `props/propsPlan.ts`, `motion/agents.ts`, `signs/signPlan.ts`, `ground/ribbons.ts`, and their tests.

**Interfaces:**
- Each planner gets `area: { box: Tile["box"]; seed: string }` **instead of** `centre` + `radiusM`.
- Points are kept when inside `box` (half-open: `x0 ≤ x < x1`, `z0 ≤ z < z1`), so adjacent tiles never double-place.
- Caps come from `tileCap`.
- Lines (roads, agent paths) are clipped to the box with a 20 m overlap margin for ribbons. Each ribbon segment belongs to the tile containing its midpoint, so nothing is drawn twice.
- The hero special case disappears from the planners. It lives only in `tileCap`.

- [ ] **Step 1: Write the failing tests.**
  - Planning tiles A and B separately and together gives the same placements as planning their union (no duplicates and no gaps at the shared edge), for props, agents and signs.
  - Ribbons of two adjacent tiles have no duplicated segment.
  - Determinism per tile key holds.
  - The P3 tests are adapted: their circle fixtures become a single 2,400 m box.
- [ ] **Step 2: Run** the props, motion, signs and ground folders and expect FAIL. Implement. Run again and expect PASS.
- [ ] **Step 3: Measure.** With a throwaway script on the Elmina seed, record per-tile planning time (median and p95 over all township tiles) for props, agents, signs and ribbons.
- [ ] **Step 4: Commit** `refactor(web): planners plan a tile box, not a hero circle`.

### Task 4: Streaming manager

**Files:**
- Create: `stream/streamer.ts`, `stream/streamer.test.ts`, `scene/useStream.ts`
- Modify: `engine.ts`, adding `onLodTick(cb)` so the streamer runs on the existing 250 ms LOD schedule; `scene/useDecor.ts`; `scene/useMotion.ts`; `scene/useGround.ts`

**Interfaces:**
```ts
// stream/streamer.ts
export interface TileContent {
  kits: Map<string, Placement[]>; lamps: Placement[]; agents: Agent[]; signs: SignPlacement[]; ribbons: Ribbon[];
  verges?: { strips: Float32Array; shrubs: Placement[] };          // Task 9
  parking?: { stalls: Float32Array; cars: Placement[] };          // Task 10
  tracks?: Float32Array;                                          // Task 10 construction tracks
  dispose?(): void;
}
export interface Streamer {
  update(target: { x: number; z: number }, rangeM: number, nowMs: number): { changed: boolean };  // plans ≤ 1 tile per call
  active(): Array<{ key: TileKey; ring: 0 | 1 | 2; content: TileContent }>;
  setTier(t: Tier): void;   // invalidates every tile
  dispose(): void;
}
export function createStreamer(plan: (tile: Tile, ring: 0 | 1 | 2, tier: Tier) => TileContent, opts?: { lru?: number /*64*/; budgetMs?: number /*8*/ }): Streamer;
```
- Rendering merges the active tiles' content into the existing layers. The kit buckets get the union of placements (rebuilt only when the active set changes). The motion layer gets the union of agents, signs a batched layer, and ribbons the ground layer's road meshes per tile group (≤ 6 ground draws total, unchanged).
- If Task 3's p95 is > 8 ms for any planner, move that planner into a module Worker (`stream/plan.worker.ts`) with the same signature over transferable `Float32Array`s. Otherwise record "worker not needed — p95 <numbers>".

- [ ] **Step 1: Write the failing tests** (`streamer.test.ts`, fake planner with a counter, fake timers).
  - **Review Focus 1:**
    - at most 1 tile is planned per `update`;
    - a planner that exceeds `budgetMs` still plans only one tile per call;
    - leaving and returning reuses the cache (no re-plan);
    - exceeding the LRU size calls `dispose` on evicted content exactly once;
    - `setTier` invalidates and re-plans.
  - The active set is ordered ring 0 first, so near content appears first.
  - A dom test confirms flying the rig across 10 tiles never builds more than 1 tile per LOD tick.
- [ ] **Step 2: Run** `vitest run src/features/scene/three/stream` and expect FAIL. Implement. Run again and expect PASS.
- [ ] **Step 3: Wire it.** `useDecor`, `useMotion` and `useGround` read `streamer.active()` instead of the hero memos. Remove `HERO_CENTRE` from every content path (it stays only in `tileCap` and bookmarks). Ambient birds and clouds follow the camera target, not `HERO_CENTRE`.
- [ ] **Step 4: Run** the `three` folder and `three.spec.ts` and expect PASS. Then, in the browser on mock (scripted Playwright if the MCP is down), record draws and tris at the six probe views at Medium.
- [ ] **Step 5: Commit** `feat(web): stream trees, props, roads, signs and traffic by camera tile`.

### Task 5: Instance LOD and culling cost for the whole township

**Files:**
- Modify: `assets/cityInstances.ts`, `assets/cityInstances.test.ts`

**Interfaces:**
- `update(camera)` stops looping every placement every tick. Placements are pre-bucketed into the Task 2 tiles. A tile beyond the last LOD `maxM` of every asset in it is skipped whole; only tiles within range are visited per LOD tick.
- Add per-tile frustum culling of instance writes (tile AABB vs frustum). It must not change draw counts.
- Produces: `CityInstances.stats()` gains `visitedPerTick: number`.

- [ ] **Step 1: Write the failing test.** At the township bookmark with a synthetic 8,000-placement city, `visitedPerTick` is < 25 % of all placements. At hero-near it is < 10 %. LOD results are identical to the old full loop for a sample of 500 placements.
- [ ] **Step 2: Run, implement, run** `vitest run src/features/scene/three/assets` and expect PASS.
- [ ] **Step 3: Commit** `perf(web): tile-bucketed instance LOD updates`.

---

## Part C — Buildings

### Task 6: Procedural facades for extruded and generic buildings

**Files:**
- Create: `facade/facadePlan.ts` (pure), `facade/facadeLayer.ts`, and their tests
- Modify: `cityMesh.ts` (parapet and roof stay; the walls get UVs per storey), `assets/plan.ts` (`generic` placements can opt into a facade), `scene/useCityAssets.ts`

**Interfaces:**
```ts
// facade/facadePlan.ts (pure)
export interface FacadeSpec { buildingId: string; storeys: number; windowStyle: 0 | 1 | 2 | 3; bayM: number; groundFloor: "shop" | "plain" | "garage"; palette: FallbackColours }
/** storeys = max(1, round(displayHeightM / 3.2)); bayM 3.0–4.5 m by kind; windowStyle and groundFloor by kind,
 *  archetype and hash01(id). Never more storeys than the height allows. */
export function facadeFor(b: { id: string; heightM: number; kind?: string; archetype?: string; precinct?: string }, m: Manifest | null): FacadeSpec;
/** Window quads (offset 0.05 m from each wall, inset 0.6 m from corners, none within 0.5 m of the top), as
 *  instance matrices per window style, plus ground-floor shopfront quads. Pure. */
export function facadeInstances(ring: Array<[number, number]>, heightM: number, minHeightM: number, spec: FacadeSpec): { windows: Float32Array /* mat4 per window */; shopfronts: Float32Array; count: number };
// facade/facadeLayer.ts
export function createFacadeLayer(buildings: Array<{ ring; heightM; minHeightM; spec: FacadeSpec }>, uniforms: RoleUniforms, tier: Tier):
  { group: THREE.Group; dispose(): void };   // ≤ 4 InstancedMesh (window styles) + 1 shopfront; decorative; uses uWindowGlow/uLitShare/uFlicker
```
- `generic` placements whose asset would be stretched (`sx` or `sz` outside 0.8–1.25) become extrusions with a facade instead of a stretched generic box. This also absorbs the 967 `generic sz` fallbacks.
- Windows light at night per the role-material rules: `COLOR_0.b`-equivalent per instance, a lit share from `uLitShare`, and flicker. This fixes "towers with no lit windows" for extrusions.
- Facade instances stream per tile (Task 4 ring ≤ 1); far tiles show the P3 palette extrusion only.

- [ ] **Step 1: Write the failing tests.**
  - **Review Focus 3:**
    - a 9.6 m building gets exactly 3 storeys;
    - a 3.0 m building gets 1;
    - no window quad's top is above `heightM − 0.5` or its bottom below `minHeightM + 0.3`;
    - quads stay within 0.06 m of their wall plane;
    - a 6 m wall gets ⌊(6 − 1.2)/bayM⌋ windows per storey.
  - Determinism per id holds.
  - The layer is decorative and its raycast returns nothing; the building mesh beneath is still picked as that building (pick test).
  - At Low the layer is empty.
  - A `generic` with `sz` 2.0 becomes an extrusion with a facade in `plan.extrude`, and its card says "(shown as a simple block)" unchanged.
- [ ] **Step 2: Run** `vitest run src/features/scene/three/facade src/features/scene/three/assets` and expect FAIL. Implement. Run again and expect PASS.
- [ ] **Step 3: Browser check** at hero-near and probe-a, Day and Night. Screenshots go to the ledger's `refs/T6/`. Record draws and tris.
- [ ] **Step 4: Commit** `feat(web): procedural facades for extruded and generic buildings`.

### Task 7: Archetype detail pass (blender lane, owner gate)

**Files:**
- Modify: `assets/blender/tl_assets/archetypes.py`, `landmarks.py`, `specs.py`, `tests/test_blender_pipeline.py`; `apps/web/public/city/**` (as a data commit)

**Requirements** (per archetype, LOD0 only unless stated; tri caps from `specs.py` may rise ≤ 25 %):
- **Facade depth:** window reveals 0.15 m, sills, and a plinth.
- **Link, semi-D and bungalow:** gate and fence posts, car-porch columns, AC condenser units on the side wall, a water tank behind the roof.
- **Shop office:** five-foot-way columns and soffit, a blank sign band (the `light` role), roller-shutter texture by `COLOR_0` banding on closed bays.
- **Highrise:** balcony slabs every storey with glass balustrade, a crown, and a lit-window share that matches the role material at night.
- **Factory and mall:** roof monitor or skylight strips, rooftop units, loading-bay doors (factory), a canopy and entrances (mall).
- **Kanopi:** a podium-roof landscape deck (planters, a pool-coloured plane in the `water` role at 1.2 m above the podium roof, pergola). Decorative. The card already says design height and under construction.
- LOD1 keeps the silhouette features (balconies, roof units as boxes). LOD2 is unchanged.

- [ ] **Step 1: Extend the tests.** For each archetype: tri counts within the new caps, the role colours present, LOD0 bounds unchanged within ±2 % (fit must not change), and every new feature named in a node-name check (e.g. `*__ac_unit*`, `*__balcony*`).
- [ ] **Step 2: Build and pack** (`uv run python assets/blender/run.py --all && uv run python assets/blender/pack.py`). Run the asset tests, including the Blender-marked ones. Confirm the total asset size is ≤ 4 MB.
- [ ] **Step 3: Owner gate (coordinator):** show LOD0 previews (new vs P2) for link, shop office, highrise, factory, mall and Kanopi. At most 2 rounds.
- [ ] **Step 4: Commit** `feat(assets): archetype detail pass` and `data: archetype detail glbs`.

### Task 8: Big roofs dressed

**Files:**
- Create: `facade/roofPlan.ts`, `facade/roofLayer.ts`, and their tests
- Modify: `scene/useCityAssets.ts`

**Interfaces:**
```ts
// facade/roofPlan.ts (pure)
/** For roofs ≥ 600 m² (extrusions, mall, factory, school, generic boxes): rooftop units (1 per 250 m², 2×1.2×1 m),
 *  skylight strips (factory/mall: every 12 m along the long axis, 1.5 m wide), a 0.4 m roof-edge band and a roof
 *  colour from the precinct palette's secondary instead of flat grey. Seeded per building id; nothing within
 *  1.0 m of the roof edge. */
export function roofDressing(b: { id: string; ring: Array<[number, number]>; heightM: number; kind?: string; archetype?: string }, palette: FallbackColours): { units: Float32Array; skylights: Float32Array; tint: string };
export function createRoofLayer(items, uniforms, tier): { group: THREE.Group; dispose(): void };  // ≤ 3 InstancedMesh; decorative
```
- [ ] **Step 1: Failing tests:**
  - units and skylights lie inside the roof polygon, inset ≥ 1.0 m, at y = height + 0;
  - no dressing below 600 m²;
  - determinism;
  - the Lakeside Mall (landmark) gets no dressing (it is modelled);
  - the layer is decorative.
- [ ] **Step 2: Run, implement, run.** Then a browser check at hero-mid with screenshots to `refs/T8/`.
- [ ] **Step 3: Commit** `feat(web): dressed roofs on large buildings`.

---

## Part D — Ground

### Task 9: Ground detail: texture, verges and shrubs

**Files:**
- Create: `ground/verges.ts`, `ground/groundDetail.ts`, and their tests
- Modify: `ground/landcover.ts` (detail shader patch), `ground/groundLayer.ts`, `stream/streamer.ts` (verges per tile)

**Interfaces:**
```ts
// ground/groundDetail.ts
/** Land-cover detail: world-space value noise (2 octaves, 6 m and 1.5 m) modulating brightness ±6 %, plus a sparse
 *  dark speckle on grass and bare; colours stay within ±6 % of LANDCOVER_COLOURS (water ±4 % shimmer unchanged). */
export function applyGroundDetail(material: THREE.Material, uniforms: { uTime: { value: number } }): void;
// ground/verges.ts (pure, per tile)
/** Grass verge strips 1.5 m wide on both kerbs of street/residential roads (not major_road medians, not footways),
 *  and shrub_round/shrub_hedge rows along verges every 4 m, skipping driveways (gaps where a building footprint is
 *  within 3 m of the kerb) and never on a ribbon. */
export function planVerges(walk, buildings, tile: Tile, frame: LocalFrame, cap: number): { strips: Float32Array; shrubs: Placement[] };
```
- Verge strips render in the ground band between land cover and roads: lift 0.07 m, below roads at 0.08 m. Add the band to `ground/bands.ts` with its order.
- [ ] **Step 1: Failing tests:**
  - detail colours stay within ±6 % of the base for every class;
  - water is unaffected and never approaches the flood blue;
  - verges lie between 3.0 and 4.5 m from a 6 m street centreline;
  - no verge or shrub sits on a ribbon or inside a footprint;
  - shrub spacing is 4 m ± jitter;
  - the ground band order (lift and renderOrder) is land cover ≤ 0.04 < parks 0.05 < water 0.06 < verges 0.07 < roads 0.08 < markings 0.10.
- [ ] **Step 2: Run, implement, run** `vitest run src/features/scene/three/ground src/features/scene/three/stream`.
- [ ] **Step 3: Commit** `feat(web): ground detail, grass verges and shrub rows`.

### Task 10: Parking lots and construction land

**Files:**
- Create: `ground/parking.ts`, `props/construction.ts` (split out of `propsPlan.ts`), and their tests
- Data lane, only if needed: `data/scripts/build_landcover.py` keeps OSM `amenity=parking` polygons as class `parking` if not already. Check `landcover.geojson` for `parking` first and record the count.

**Interfaces:**
```ts
// ground/parking.ts (pure, per tile)
/** Stall markings (2.5 × 5.0 m, white 0.1 m lines at y 0.10) in rows along the polygon's long axis with 6 m aisles,
 *  inset 1 m; parked cars (vehicles kit, parked variants: hatch/sedan/MPV) in 40–70 % of stalls by hash01(stall id),
 *  day 70 %, night 40 % (lerp by mood night weight at plan time per tile). Only inside parking polygons. */
export function planParking(lots: GeoJSON.Feature[], tile: Tile, frame: LocalFrame, cap: number): { stalls: Float32Array; cars: Placement[] };
// props/construction.ts
/** Construction land by area: hoarding every 6 m (as P3), plus 1 site_cabin per 3,000 m², material_stack per 1,500 m²,
 *  excavator per 2,500 m², tower_crane per 10,000 m² (≥ 1 if > 8,000 m²), earth-track decals (dark tan 4 m bands)
 *  crossing the site, and a gravel tint. */
export function planConstruction(polys: GeoJSON.Feature[], tile: Tile, frame: LocalFrame, cap: number): { kits: Map<string, Placement[]>; tracks: Float32Array };
```
- Parked cars are decorative. They never move and never fade with Day playback, because they cannot be read as residents. Record that as a ruling.
- [ ] **Step 1: Failing tests:**
  - stalls and cars lie only inside parking polygons;
  - none overlaps a ribbon;
  - the car share is within the bounds per mood;
  - a 30,000 m² construction site gets 10 cabins, 20 stacks, 12 excavators and 3 cranes, capped by `cap`;
  - tracks stay inside the site;
  - all output is decorative.
- [ ] **Step 2: Run, implement, run.** Browser check of a construction precinct and a parking lot (`refs/T10/`).
- [ ] **Step 3: Commit** `feat(web): parking lots and dressed construction land` (plus a `data:` commit if the land cover changed).

---

## Part E — Motion, trees and life

### Task 11: Smaller street trees and clear footways

**Files:**
- Modify: `props/propsPlan.ts` (scale bands by context), `props/propsPlan.test.ts`

**Interfaces:**
- `TREE_SCALE: Record<"street" | "verge" | "park" | "forest", Record<TreeVariant, [number, number]>>`, with the values from Global Constraints.
- Canopy clearance: a street or verge tree whose scaled canopy radius would overhang a footway or path centreline by more than 1.0 m is moved outward or dropped.

- [ ] **Step 1: Failing tests:**
  - street `rain_tree` scale lies in [0.55, 0.7];
  - park scale in [0.8, 1.1];
  - no street tree's canopy reaches more than 1.0 m over any footway centreline (geometric check using the manifest canopy size × scale / 2).
- [ ] **Step 2: Run, implement, run.** Commit `fix(web): smaller street trees, clear footways`.

### Task 12: Smooth traffic, people and birds

**Files:**
- Modify: `motion/agents.ts`, `motion/motionClock.ts`, `motion/motionLayer.ts`, `engine.ts` (display-rate motion), `ambient/ambient.ts`, and their tests

**Interfaces:**
- `poseAt` gains continuity:
  - agents on open polylines **ping-pong** (walk to the end, turn around over 1.5 s) instead of wrapping;
  - agents on closed loops (first point = last point within 1 m) keep looping.
- Yaw is smoothed: `yaw = slerpAngle(prevYaw, tangentYaw, 1 − exp(−dt/0.25 s))`, carried in the per-agent state of `motionLayer`, not in the pure `poseAt`.
- Speed eases ±15 % per agent on a slow sine (period 20–40 s by hash), so vehicles don't move in lockstep.
- `motionClock`: `MOTION_MODE: "display" | "30fps"`. The display mode ticks every rAF while `running()`, and falls back to 30fps when the frame monitor sees < 45 fps median during motion (once per session). Everything else (gates, fade) is unchanged.
- Birds: positions computed per rendered frame from real time (already pure in `nowMs`); add a wing-flap vertex term (`uTime`) and bank in turns.

- [ ] **Step 1: Failing tests.**
  - **Review Focus 4:** a property test over 200 seeded agents and 2,000 steps of 16.7 ms (including path ends):
    - consecutive positions never differ by more than speed × 1.2 × dt + 0.01 m;
    - smoothed yaw changes by at most 2π × dt / 0.5 s per step.
  - `motionClock`:
    - display mode schedules one tick per rAF;
    - the fallback to 30 fps happens once after a slow median;
    - running → false schedules nothing (the P3 Review Focus 3 test still passes).
  - Ambient: the flap term is present and the bird bank angle is bounded.
- [ ] **Step 2: Run, implement, run** `vitest run src/features/scene/three/motion src/features/scene/three/ambient`, then the engine tests.
- [ ] **Step 3: Browser check** at hero-near, Medium. Record a 10 s GIF or a frame series to `refs/T12/`, and fps with motion on.
- [ ] **Step 4: Commit** `feat(web): smooth traffic and pedestrians at display rate, no path-end jumps, smoother birds`.

### Task 13: Night windows everywhere, and residents at hero-mid

**Files:**
- Modify: `assets/roleMaterial.ts` (lit share per archetype group), `overlays/residents.ts`, and their tests

**Requirements:**
- Every archetype with glass gets a lit share at night ≥ 0.35. The highrise and Kanopi currently show none: check that their glass faces carry the window role and `COLOR_0.b` spread. If the cause is the asset, coordinate with Task 7, whose detail pass must fix it.
- Residents at hero-mid: the minimum on-screen height is 6 px (scale up with distance beyond `displayScale` when needed), plus a 1 px dark outline. They stay at their state colours.

- [ ] **Step 1: Failing tests:**
  - for the highrise, link and shop office glbs (loaded in node as in the P2 library tests), the night lit share is in [0.35, 0.65];
  - a resident at 800 m projects to ≥ 6 px tall at 1440×900, fov as in the engine.
- [ ] **Step 2: Run, implement, run.** Commit `fix(web): lit windows on every glass archetype at night, residents legible at mid range`.

---

## Part F — Honesty, integration and the gate

### Task 14: Honesty and overlay-priority tests for the new decor

**Files:**
- Modify: `honesty.test.ts`, `ThreeScene.dom.test.tsx`, `apps/web/e2e/three.spec.ts`, `apps/web/README.md` (streaming, facades, tiers, probe bookmarks)

- [ ] **Step 1: Extend `honesty.test.ts`.**
  - Every new layer (facades, roofs, verges, shrubs, parking, construction tracks, streamed kits) is decorative and its raycast returns nothing.
  - The building under a facade is picked as the building.
  - **Review Focus 5:** every overlay object still has `depthTest` false and a `renderOrder` above every new decor object's.
  - Parked cars are not in the motion layer and do not fade.
  - Facades never exceed a building's height (sampled over the fixture).
- [ ] **Step 2: e2e.** With `?engine=three&bookmark=probe-a`, the scene renders frames and `data-tiles` (a new DOM attribute: the active tile count) is > 0. The existing 4 tests keep passing.
- [ ] **Step 3: Run** vitest `three` and `three.spec.ts` (alone) and expect PASS. Update the README.
- [ ] **Step 4: Commit** `test(web): honesty and overlay priority for streamed decor and facades`.

### Task 15: Merge, verify, budgets and the P4 gate

**Files:** the ledger, `docs/superpowers/overnight-log.md`, `docs/03-product/mvp-spec.md` (status line), `props/caps.ts` / `stream/caps.ts` (tuning only)

- [ ] **Step 1: Merge** `lane/data` (if used), then `lane/blender`, then `lane/fe` into `feat/stylised-threejs-p4` with `--no-ff`.
- [ ] **Step 2: Run the CI checklist** with `set -o pipefail`, alone. Report each check as PASS / FAIL / BLOCKED / NOT RUN; golden and e2e are mock-backed.
- [ ] **Step 3: Budgets** (scripted Playwright, SwiftShader for draws and tris; the owner's laptop for fps).
  - **Views:** the six probe views plus hero-near, at Medium; hero-mid at High.
  - **Moods:** Day and Night.
  - **Fly test (Review Focus 1):** a scripted flight hero-mid → probe-c → probe-a → hero-mid, three times, recording the max frame time attributable to planning (`performance.measure` marks around `streamer.update`) and `renderer.info.memory` before and after.
  - **Pass condition:** every probe view at Medium is ≤ 150 draws and ≤ 2.5 M tris; no planning frame exceeds 50 ms; geometries and textures are flat (±5 %) after the third loop.
  - **If it fails,** pull these levers in order, recording each as a ruling:
    1. lower `TILE_CAPS` ring 1–2;
    2. ring 2 trees only;
    3. facades only at ring 0;
    4. fewer roof units.
- [ ] **Step 4: Owner gate (stop and ask).**
  - Day, Dusk and Night screenshots at hero-near, hero-mid, township and two probe views, side by side with the P3 `refs/gate2/` set.
  - The owner orbits for 10 s at hero-mid and probe-a on Medium.
  - The owner decides pass or fail. Notes become a fix wave capped at 2 rounds, or P5 inputs.
- [ ] **Step 5: Log and hand over.**
  - An overnight-log entry with real `date` timestamps: tile counts, planning-time p95, budgets table, facade and roof counts, the tree-scale change, the motion mode, and the gate verdict.
  - Commit `docs: phase 4 township rollout of the three.js stylised overhaul`.
  - Push or merge to `main` only if the owner asks. Next is Plan P5 (default engine and Cesium stylised retirement).
