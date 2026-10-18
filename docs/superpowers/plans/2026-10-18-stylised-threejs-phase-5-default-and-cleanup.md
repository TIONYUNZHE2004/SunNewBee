# Stylised City on Three.js — Phase 5 (default engine, Cesium Stylised retirement, P4 carry-overs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Three.js stylised city the default 3D view, retire the Cesium Stylised code, and close the P4 carry-overs the owner chose (hitch budget, look polish, mosque check, code cleanup). End with the owner's gate and a merge to `main`.

**Architecture:**
- **Shared modules first (Task 1).** Three.js still imports `Tier`/`pickTier` (`cesium/stylised/quality.ts`), `hashUnit`/`toBuildings` (`cesium/stylised/model.ts`) and `WIDTH_BY_TYPE`/`KIND_BY_TYPE`/`ROAD_WIDTH_UNKNOWN`/`roadsFromWalk` (`cesium/stylised/ground.ts`). They move to a neutral `features/scene/shared/` folder before anything is deleted.
- **Default flip, then deletion (Tasks 2–3).** `rendererFor` picks Three.js for every Stylised view. The `?engine=` switch and the "Experimental 3D engine · Switch back" chip go away, and so does `cesium/stylised/` with the Stylised branches of `CesiumScene.tsx`. Realistic (Google tiles, else Ion) stays on Cesium, unchanged. The fallback chain stays Three.js / Cesium Realistic → Mapbox lite → List.
- **Hitch budget (Task 5).** Tile planning moves into a module Worker (`stream/plan.worker.ts`) with the world data posted once. The main thread keeps a synchronous fallback for environments without Workers (vitest, old browsers). Merged-layer rebuilds get a per-frame time slice.

**Tech stack:** three 0.186.1, React 19, zustand, Vite 8 (module workers via `new Worker(new URL(...), { type: "module" })`), vitest 5, Playwright 1.64, Blender 5.2 headless, Python 3.13 + uv.

**Spec:** `docs/superpowers/specs/2026-10-17-stylised-city-threejs-overhaul-design.md` §4 Phase 5 ("Retire the Cesium Stylised code … Update docs: `apps/web/README.md`, `data/README.md` and the AGENTS.md architecture notes about Stylised (but **not** its Google rule). Write an overnight-log entry."), with ADR 0012 and ADR 0013. The P4 plan's Global Constraints (`docs/superpowers/plans/2026-10-18-stylised-threejs-phase-4-township.md`) still bind, except where this plan changes them (marked **changed**).

**Scope (owner, 2026-10-18):**
- In: the default flip, the Cesium Stylised retirement and its docs, the hitch-budget fix, the look polish list, the mosque check, the code cleanup list, and merging `main` in, gating, then merging to `main` at the end.
- Out: moving Realistic to Three.js (ADR 0012 keeps it deferred), new data sources, the flood + route clutter, Masjid Denai Alam's own model (no public drawing exists).

**Session handoff: the state at the start of P5**
- `feat/stylised-threejs-p4` holds all of P4. The final head is `bae9f96` or later, local and not pushed. The owner passed the P4 gate and the Task 7 round-1 previews.
- P4's ledger, with every ruling and deferred minor, is in `.superpowers/sdd/2026-10-18-stylised-threejs-phase-4-township/progress.md`. Read its rulings P4-A to P4-AG and the deferred-minor lines before dispatching.
- `origin/main` has a commit after `eb750e0` ("resident trip card behind the assistant scope flag", CI run 39115746595). Task 9 merges it in.
- **Branch:** create `feat/stylised-threejs-p5` from `feat/stylised-threejs-p4`. Reset the lane worktrees (`fe`, `fe-b`, `blender`, `data`) to it with `checkout -B lane/<x>`, after checking each is clean.

**Facts measured at the end of P4** (headless Chromium on an RTX 2050, indicative):
- **Budgets:** worst Medium is hero-near: 117 draws (Night), 2.26 M tris (Day).
- **Fly test:** plan p95 8.5 ms, max 15.7 ms, 17 of 258 over 8 ms. Merge max 36.9 ms. Cold first merge 195–274 ms.
- **Memory:** flat.

## Global Constraints

Everything in the P4 plan's Global Constraints still binds. Changes and additions:

**Engine (changed)**
- Stylised is drawn by Three.js only. There is no `?engine=` parameter and no persisted `tl.engine` choice.
  - A stale `tl.engine` value in `localStorage` is ignored and removed on first read.
  - A `?engine=cesium` URL renders Three.js. No error is shown.
- Realistic is unchanged and stays on Cesium: Google Photorealistic tiles, else Cesium OSM Buildings via Ion. AGENTS.md's Google rule is never edited.
- Fallback order: the 3D renderer (Three.js for Stylised, Cesium for Realistic) → Mapbox lite → List, behind the existing `RendererBoundary` in `map-ui/MapStage.tsx`.
- The tiny e2e fixture has no buildings, so e2e stays on the List view, except `three.spec.ts`, which stubs `/api/layers/buildings`.

**Hitch budget (changed from P4 ruling P4-AA)**
- No main-thread task caused by streaming may exceed **16 ms** while flying at Medium. That covers planning, merging, layer rebuilds and uploads, measured as `tl:stream-*` performance measures.
- Planning runs in a Worker when `typeof Worker !== "undefined"`, and on the main thread otherwise, with the P4 8 ms per-tile rule.
- At most one tile is in flight at a time. Results apply only if their tile key, ring and tier still match the request.

**Honesty (additions)**
- A building is only ever drawn on an OSM (or traced landmark) footprint. A place with no mapped building gets a marker only, never an invented model. This applies to the four masjid places with no footprint: Al-Falah, An-Nur, and both Nurul Amin places.
- Parked cars show no lit lamps. Their `light`-role faces use the body colour.

**Lanes**

| Lane | Tasks | Paths |
|---|---|---|
| `fe-a` (`../SunNiuBi-wt/fe`, `lane/fe`) | 1, 2, 3, 5 | `apps/web/**` |
| `fe-b` (`../SunNiuBi-wt/fe-b`, `lane/fe-b`) | 6, 8 | `apps/web/**` |
| `blender` | 7 | `assets/blender/**`, `apps/web/public/city/**` |
| `data` | — (the mosque check needs no data change; see Task 8) | — |
| coordinator | 4, 9 | docs, merges |

- Commits are conventional, with a scope. Stage explicit paths. The trailer is `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The coordinator merges lanes `--no-ff` into `feat/stylised-threejs-p5`. Merging into `main` and pushing happen only in Task 9, after the owner's gate.
- Machine: 8 GB RAM. At most 2 vitest runs at once (`--maxWorkers=2`), and Blender counts as one. Kill only the PIDs you started.

**Rulings to record in the ledger at the start**
- Ruling: Three.js replaces Cesium Stylised outright, with no opt-out switch. Keeping two Stylised renderers doubles maintenance, and the owner passed P3 and P4 on Three.js. Cost if wrong: a revert of Tasks 2–3.
- Ruling: tile planning moves to a Worker rather than being made lighter. Content stays as the owner approved it, and only the thread changes. Cost if wrong: Worker plumbing for about 5 ms of savings; a main-thread fallback stays.
- Ruling: the four masjid places with no OSM building stay markers only. AGENTS.md says to never invent facts. Cost if wrong: none; mapping them in OSM fixes it.

## Parallel execution schedule

| Wave | fe-a | fe-b | blender | Needs |
|---|---|---|---|---|
| 1 | **T1** shared modules | **T6** look polish (web half) | **T7** Kanopi LOD1 planting + parked-car light role | — |
| 2 | **T2** default flip | **T8** cleanup + mosque guard | T7 if still running | wave 1 merged |
| 3 | **T3** retire Cesium Stylised | — | — | T2 merged |
| 4 | **T5** planning Worker + merge slicing | — | — | T3 merged |
| 5 | coordinator: **T4** docs, **T9** merge main, CI, budgets, owner gate, merge to `main` | | | all |

**Conflict notes**
- T6 and T8 both touch `assets/roleMaterial.ts` (T6 parked lights) and `scene/useFacades.ts`/`useRoofs.ts` (T8 tier deps). They run in the same lane in waves 1 and 2, so they are sequential.
- T1 moves files that T6 and T8 import. Each moved file leaves a re-export stub in its old path until T3 deletes the folder, so T6 and T8 compile either way.
- T5 touches `stream/streamer.ts`, `scene/useStream.ts` and `stream/tilePlan.ts`. It runs alone in wave 4.

## Review Focus

1. **A returning user with a stale `tl.engine=cesium` in localStorage,** or a bookmarked `?engine=cesium` URL, must land on Three.js, not a blank or crashed map. This is pinned in Task 2.
2. **A Three.js crash (no WebGL2, context loss, shader failure) must fall back to Mapbox lite, then List.** It must never go back to Cesium Stylised, which no longer exists. This is pinned in Task 3 (`MapStage.dom.test.tsx`).
3. **Realistic must keep working after the Stylised code is deleted:**
   - camera framing;
   - overlays (route, flood, access);
   - Day and Rollout layers;
   - the perf overlay;
   - the frustum-clone patch.

   This is pinned in Task 3 (the `CesiumScene` and `realistic.test.ts` tests stay green) and in Task 9 (one Realistic smoke screenshot, with a key and on the owner's request only, because Google tiles are billable).
4. **A Worker result for a tile the camera has already left, or for a tier that changed, must be dropped and never drawn.** A Worker error must fall back to main-thread planning for the session. This is pinned in Task 5.
5. **Pan/fly smoothness on the owner's laptop:** no streaming task over 16 ms. This is pinned in Task 5 (the unit time-slice test) and Task 9 (the laptop fly test).

---

## Task 1: Shared scene modules out of `cesium/stylised/`

**Files:**
- Create: `apps/web/src/features/scene/shared/quality.ts`, `shared/model.ts` and `shared/roads.ts`. Each carries over the source file's existing tests, moved alongside it.
- Modify:
  - `cesium/stylised/quality.ts`, `model.ts` and `ground.ts`: replace the moved exports with re-exports from `shared/` (temporary; Task 3 deletes them).
  - Every Three.js importer: switch it to `shared/`. That covers about 30 files: `three/engine.ts`, `three/quality.ts`, `scene/use*.ts`, `ambient/`, `stream/*`, `props/*`, `ground/*`, `facade/*`, `motion/*`, `assets/fit.ts`, `assets/plan.ts`, `signs/signPlan.ts` and `cityMesh.ts`.
  - Also switch `scene/sceneSettingsStore.ts` and `cesium/PerfOverlay.tsx`.

**Interfaces:**
- Produces:
  - `shared/quality.ts`: `Tier`, `TIERS`, `pickTier`, `lowerTier`.
  - `shared/model.ts`: `hashUnit`, `toBuildings`, `HeightOf`, with their current signatures.
  - `shared/roads.ts`: `Road`, `RoadKind`, `WaterPolygon`, `WIDTH_BY_TYPE`, `KIND_BY_TYPE`, `ROAD_WIDTH_UNKNOWN`, `roadsFromWalk`, `waterFromLayer`, `parksFromLayer`. These are the pure exports only; anything typed against Cesium stays behind.
- Consumed by Tasks 2, 3, 5, 6 and 8.

- [ ] **Step 1:** Move the code verbatim and move its tests. Add `shared/imports.test.ts`: a filesystem scan asserting that no file under `features/scene/three/` imports from `cesium/stylised/`.
- [ ] **Step 2:** Run `pnpm --filter @tl/web exec vitest run src/features/scene --maxWorkers=2`, plus typecheck and biome. Expect PASS with the same test count plus the scan test.
- [ ] **Step 3:** Commit `refactor(web): scene/shared for quality tiers, building model and road tables`.

## Task 2: Three.js is the default Stylised renderer

**Files:**
- Modify:
  - `three/engineChoice.ts` and its test;
  - `map-ui/MapStage.tsx` and `map-ui/MapStage.dom.test.tsx`;
  - `three/ThreeScene.tsx` (remove `ExperimentalEngineChip`) and `ThreeScene.dom.test.tsx`;
  - `apps/web/e2e/three.spec.ts` (drop `?engine=three`);
  - `apps/web/scripts/measure-probes.mjs` (drop `engine=three`).

**Interfaces:**
- Produces: `rendererFor(view: View, style: MapStyle): "three" | View`. It returns `"three"` when `view === "cesium" && style === "stylised"`, and otherwise returns `view`. `stylisedEngine`, `readStylisedEngine` and `cesiumEngineHref` are deleted. A one-time `clearLegacyEngineChoice(store: Storage | null): void` removes `tl.engine`, and `MapStage` calls it once on mount.

- [ ] **Step 1: Failing tests.**
  - `rendererFor("cesium","stylised") === "three"`, `rendererFor("cesium","realistic") === "cesium"`, `rendererFor("mapbox","stylised") === "mapbox"`, `rendererFor("list","stylised") === "list"`.
  - `clearLegacyEngineChoice` removes `tl.engine` and tolerates a `null` store or a throwing store.
  - **Review Focus 1:** a `MapStage` dom test with `localStorage["tl.engine"]="cesium"` and URL `?engine=cesium` renders `ThreeScene`, not `CesiumScene`, when the world has buildings.
  - `MapStage.dom.test.tsx`: its crashing-renderer test mocks `ThreeScene` as the crashing renderer and still expects the Mapbox, then List, fallback. Call `vi.resetModules` if anything memoises.
  - No "Experimental 3D engine" text is rendered.
- [ ] **Step 2:** Run `vitest run src/features/map-ui src/features/scene/three` and expect FAIL. Implement. Run again and expect PASS. Run `three.spec.ts` alone and expect PASS.
- [ ] **Step 3:** Commit `feat(web): Three.js is the default stylised 3D view`.

## Task 3: Retire Cesium Stylised

**Files:**
- Delete: `apps/web/src/features/scene/cesium/stylised/` (whole folder, including `fakeCesium.test-util.ts`), and the `/dev/stylised` route in `routes.tsx:25`.
- Modify:
  - `cesium/CesiumScene.tsx`: remove the `style==="stylised"` branches at about l.267 and l.313, and the `paletteFor`/`skyCss`/`StylisedCity` imports.
  - `cesium/home.ts`, `camera.ts`, `controls/cameraMath.ts`, `layers.tsx` and `heightRef.ts`: remove the Stylised-only framing and clamping (`framingFor("stylised")`, `stylisedHomeView`, `STYLISED_PITCH_DEG`) if nothing outside the deleted code uses them.
  - `cesium/realistic.test.ts`: drop the `applyStylisedLook` case.
  - `cesium/PerfOverlay.tsx`: import `Tier` from `shared/`.
  - `scene/sceneStore.ts`, `selectView.ts` and their tests: wording only. The behaviour of `defaultMapStyle`/`resolveMapStyle` is unchanged.

**Interfaces:**
- Consumes `shared/*` (Task 1) and `rendererFor` (Task 2).
- Produces: `CesiumScene` renders Realistic only. Its props are unchanged, and it ignores `style !== "realistic"`, because MapStage never sends Stylised to it after Task 2.

- [ ] **Step 1: Failing tests.**
  - `CesiumScene` dom test: with `style="realistic"` it still mounts the overlays, the Day and Rollout layers and the perf overlay. No `StylisedCity` node exists.
  - The `shared/imports.test.ts` scan is extended: no file under `features/` imports `cesium/stylised`.
  - **Review Focus 2:** in `MapStage.dom.test.tsx`, with Stylised and a crashing `ThreeScene`, the render goes to Mapbox lite when a token exists and to List otherwise, and never to `CesiumScene`.
- [ ] **Step 2:** Delete the code, then run `vitest run src/features`, typecheck, biome, `pnpm --filter @tl/web build` (the Cesium asset check must still pass for Realistic) and `pnpm --filter @tl/web e2e`. Expect PASS. Record the line count removed.
- [ ] **Step 3:** Commit `refactor(web): retire the Cesium stylised renderer`.

## Task 4: Docs for the new default (coordinator, after Task 3)

**Files:**
- `apps/web/README.md`:
  - l.5, 33, 37-39 (renderers);
  - l.214-262 ("Map styles" and "Three.js Stylised engine (opt-in)" become "Stylised (Three.js)");
  - l.402 (the `?engine=three` row is removed);
  - l.474-558 (Stylised-only Cesium notes and the module map are removed);
  - l.625 (layout);
  - l.640-645 (E2E).
- `AGENTS.md`, the Web renderers bullets only, at about l.82-86: Stylised is drawn by Three.js and Realistic by Cesium; code paths `scene/three/` and `scene/shared/`. **The Google rule and the honesty table are not edited.**
- `data/README.md` l.302, 317, 362: the "Cesium Stylised view reads `height_m`" wording becomes the Three.js renderer reading `display_height_m`.
- ADR 0012: add a Consequences note saying Cesium Stylised is retired in P5. ADR 0013: update its status note. ADR 0007: add an "amended by 0012 (Stylised moved to Three.js)" note.
- `docs/03-product/mvp-spec.md`: the status line.

- [ ] **Step 1:** Edit the files.
- [ ] **Step 2:** Run `rg -n "engine=three|cesium/stylised|StylisedCity|Experimental 3D engine" apps docs AGENTS.md CLAUDE.md`. Only historical logs and plans may match.
- [ ] **Step 3:** Commit `docs: Three.js is the stylised renderer; Cesium stylised retired`.

## Task 5: Planning Worker and time-sliced merges (hitch budget)

**Files:**
- Create: `stream/plan.worker.ts`, `stream/planClient.ts`, `stream/planClient.test.ts`.
- Modify: `stream/streamer.ts` (async plan path), `scene/useStream.ts`, `stream/tilePlan.ts` (`TileInputs` serialisable), and the merge paths in `scene/useDecor.ts`, `useRoads.ts`, `useFacades.ts`, `useRoofs.ts`, `useGroundDecor.ts` and `useLots.ts` (time slice).

**Interfaces:**
```ts
// stream/planClient.ts
export interface PlanClient {
  plan(tile: Tile, ring: 0 | 1 | 2, tier: Tier): Promise<TileContent>;   // ≤ 1 in flight; rejects if superseded
  readonly mode: "worker" | "main";
  dispose(): void;
}
export function createPlanClient(inputs: TileInputs, opts?: { worker?: () => Worker | null }): PlanClient;
// stream/streamer.ts (changed)
export function createStreamer(plan: PlanFn | PlanClient, opts?: { lru?: number; budgetMs?: number }): Streamer;
// update() starts at most one plan; applies a result only if key, ring and tier still match.
```
- **Worker protocol:** post `TileInputs` once with `{ type: "init" }`, using transferable `Float32Array`s where the planners already produce them. Then post one `{ type: "plan", key, ring, tier, seq }` at a time. The reply is `{ seq, content }`, or `{ seq, error }`.
- **Fallback:** the main thread is used when `Worker` is undefined or construction throws. The first Worker `error` switches the session to `"main"` and re-plans the pending tile.
- **Merge time slice:** a merged-layer rebuild whose build exceeds 8 ms on its first measured run is split across frames. Use a small `sliceWork(steps, budgetMs = 8)` helper in `scene/idle.ts`. Each frame processes items until it has used 8 ms, and the layer swaps in only when complete.

- [ ] **Step 1: Failing tests.**
  - `planClient.test.ts`, using a fake Worker:
    - one plan in flight at a time;
    - a superseded request rejects, and its late result is dropped;
    - a Worker `error` switches the session to `"main"` and the pending tile completes;
    - with no `Worker`, `mode === "main"`.
  - `streamer.test.ts` with an async client (**Review Focus 4**):
    - a result for a key that is no longer active, or a tier that changed, is never applied;
    - LRU disposal still happens exactly once;
    - the P4 tests still pass with the sync planner.
  - `idle.test.ts`: `sliceWork` never runs more than `budgetMs` + one item per frame (fake clock), and completes all items.
  - Determinism: planning in the Worker and on the main thread give deep-equal `TileContent` for the same key (use the main-thread path in vitest, plus a structured-clone round trip).
- [ ] **Step 2:** Run `vitest run src/features/scene/three/stream src/features/scene/three/scene --maxWorkers=2` and expect FAIL. Implement. Run again and expect PASS. Run the `three` folder and `three.spec.ts` alone.
- [ ] **Step 3:** Measure with the P4 fly script (`.superpowers/.../refs/T15/t15-measure.mjs`, copied into `apps/web/scripts/measure-fly.mjs` and committed). Use the GPU path, Medium, 3 loops. Record the max `tl:stream-*` measure (pass: ≤ 16 ms), plan p95 and memory drift (±5 %).
- [ ] **Step 4:** Commit `perf(web): plan tiles in a worker and slice merged-layer rebuilds`.

## Task 6: Look polish (web half)

**Files:**
- Modify:
  - `assets/plan.ts` (palette per repeated unit);
  - `assets/roleMaterial.ts` (parked light colour);
  - `facade/roofLayer.ts` (skylight night glow);
  - `facade/roofPlan.ts` (unit seating);
  - `ground/verges.ts` (skip park and water polygons);
  - plus their tests.

**Requirements:**
- **Shop-office rows, per unit:** for `repeat: frontage` archetypes (shop office, link), each placed unit takes its own palette entry, `hash01(placementId, "palette")` over the precinct's palette list. Neighbouring units differ when the palette has more than one entry. Today it is one palette per building (P4 ruling P4-AD).
- **Parked cars, no lit lamps:** in the `parked` kind, `light`-role faces take the vehicle body colour, not `#fff1c9`.
- **Skylights at night:** skylight strips' night emissive drops to at most the window-glow level (`uWindowGlow` × 0.6). The owner saw them bright in Subang Galaksi (probe-c).
- **Roof units seated:** the base of each unit sits at the roof-cap height of its own building (`heightM`), never the parapet top or another building's height. One unit at hero-near looked like it was floating.
- **Verges skip parks and water:** no verge strip or shrub is planned inside a park or base-water polygon. They were hidden there anyway (P4 integration note), so this saves triangles.

- [ ] **Step 1: Failing tests.** One per item:
  - adjacent units of a row have different palette indices when the palette has 2 or more entries, deterministic per id;
  - a parked car's light-role colour equals its body colour;
  - skylight night emissive ≤ `uWindowGlow` × 0.6;
  - every unit's base y equals its building's `heightM`, ± 0.01, over the Elmina seed sample;
  - no verge piece's midpoint lies inside a park or water polygon.
- [ ] **Step 2:** Run, implement, run (`vitest run src/features/scene/three/assets src/features/scene/three/facade src/features/scene/three/ground --maxWorkers=2`).
- [ ] **Step 3:** Commit `fix(web): per-unit shop colours, unlit parked cars, softer skylights, seated roof units, no verges in parks`.

## Task 7: Kanopi far-view planting (blender)

**Files:** `assets/blender/tl_assets/landmarks.py`, `tests/test_blender_pipeline.py`, and `apps/web/public/city/**` (data commit).

- [ ] **Step 1: Failing test.** Kanopi LOD1 carries the end-ledge planting again (`*__deck*` and planter parts at LOD1; the P4 Task 7 review noted it was lost). LOD0 bounds stay within ±2 %, the slab depth stays pinned to its traced value, and the tris cap holds.
- [ ] **Step 2:** Build and pack (`uv run python assets/blender/run.py --all && uv run python assets/blender/pack.py`), then run `TL_BLENDER_TESTS=1 uv run pytest assets/blender -q`. Expect PASS.
- [ ] **Step 3:** Commits: `fix(assets): Kanopi keeps its ledge planting at LOD1` and `data: kanopi glb`.

## Task 8: Code cleanup and the mosque guard

**Files:**
- Modify:
  - `cityMesh.ts` (drop the unused per-storey wall UVs, l.209-211 and 261-272, and the `withUv` flag);
  - `props/caps.ts` (delete `PROP_CAPS`/`capFor`; move the test-only uses to `TILE_CAPS`);
  - `scene/useFacades.ts:94` and `useRoofs.ts:80` (rebuild only when Low ↔ not-Low changes, not on Medium ↔ High);
  - test polish from the P4 ledger: `litShare.test.ts` (`toBeTruthy`, no `console.log`, no `!`), the bird-layer guard in `honesty.test.ts` (assert the ambient birds are not under the overlay scene), and `engine.create.test.ts:720` (comment).
- Create: `apps/web/src/features/scene/three/mosques.test.ts`.

**Requirements (mosque guard):**
- For every `places.geojson` feature whose name starts with "Masjid": if an OSM building polygon in `buildings.geojson` contains or touches its point within 30 m, that building's `archetype` is `mosque`.
- At the end of P4, Masjid Denai Alam (`w1508434447`), Jamiul Ehsan (`w1063471271`), Saujana Utama (`w203237476`) and Al-Hidayah (`w781364821`) pass this check.
- Places with no footprint are listed in the test as known markers only: Al-Falah `osm-way-1381608070`, An-Nur `osm-way-1185518246`, and Nurul Amin `osm-way-804547607` and `osm-way-1559276229`. No model is placed for them (honesty).

- [ ] **Step 1: Failing tests.**
  - The mosque guard, as above.
  - `cityMesh` output has no `uv` attribute.
  - A Medium → High tier change does not call `createFacadeLayer` or `createRoofLayer` again, while Medium → Low clears them.
  - The bird-layer guard.
- [ ] **Step 2:** Run, implement, run (the `three` folder and `map-ui`, `--maxWorkers=2`). Record the geometry MB saved by dropping the UVs.
- [ ] **Step 3:** Commit `refactor(web): drop unused wall UVs and dead P3 caps, no identical facade rebuilds, mosque guard`.

## Task 9: Merge, verify, owner gate, merge to `main` (coordinator)

- [ ] **Step 1:** Merge lanes `--no-ff` into `feat/stylised-threejs-p5`: `blender`, then `fe-b`, then `fe`. Then merge `origin/main` into the branch with `git fetch` and `git merge --no-ff origin/main`, resolving any conflicts against the incoming commit's intent.
- [ ] **Step 2:** Run the AGENTS.md CI checklist with `set -o pipefail`, one step at a time. Report each step as PASS / FAIL / BLOCKED / NOT RUN; golden and e2e are mock-backed. The known Windows-only pytest path failure is reported as such.
- [ ] **Step 3: Budgets.** Run the P4 probe script at the seven views, Day and Night, Medium (pass: ≤ 150 draws, ≤ 2.5 M tris). Then run the `measure-fly.mjs` fly test (pass: no streaming task over 16 ms, memory ±5 %). On the owner's laptop: fps while orbiting hero-mid and probe-a at Medium (≥ 30 fps). Optionally, with the owner's consent because it loads billable Google tiles, take one Realistic screenshot to confirm Realistic still renders (**Review Focus 3**).
- [ ] **Step 4: Owner gate (stop and ask).** Show Day, Dusk and Night screenshots at hero-near, hero-mid, township and probe-a, next to the P4 `refs/T15` set. The owner opens `/` with no URL flags and sees Three.js. Notes become a fix wave capped at 2 rounds.
- [ ] **Step 5: Merge to `main` and push**, after the owner says yes. Run `git checkout main && git merge --no-ff feat/stylised-threejs-p5`, re-run `pnpm lint && pnpm -r --if-present test` on `main`, then `git push`. Report the GitHub CI run.
- [ ] **Step 6: Log.** Write an overnight-log entry with real `date` timestamps covering lines removed, worker mode, fly-test numbers, budgets and the gate verdict. Update the `mvp-spec.md` status line. Commit `docs: phase 5 of the three.js stylised overhaul`.
