# Demo polish: implementation plan

- Spec: [specs/2026-10-21-demo-polish-navigation-and-building-design.md](../specs/2026-10-21-demo-polish-navigation-and-building-design.md). **Read it first.** Acceptance ids (AC-…) are defined in its §8.
- Baseline prototype: [docs/03-product/prototypes/demo-storyboards/](../../03-product/prototypes/demo-storyboards/README.md). Run it with `python -m http.server 5191 --bind 127.0.0.1` from that folder; `window.__demo.seek(s)` / `.set("nav"|"bld")`.
- Written 21 Oct 2026 for a **fresh Claude Code session**. Every file:line below was checked on `main` at `2bc9011a`; re-check before editing, since line numbers drift.
- One final owner gate (spec §9). No phase gates. Where something is unclear, decide, log a ruling, and keep going.

## Time box: 15 hours (owner, 21 Oct 2026)

The owner gave this run **15 hours of wall-clock time**. A full run of every task to every AC is estimated at 18–22 h, so work in this priority order. A lower tier starts only once the higher tier is merged and green on `feat/demo-polish`.

| Tier | Tasks | Budget | Notes |
|---|---|---|---|
| **P0 — both demos play end to end** | A1, A2, A3; B1–B11; C1, C2, C5, C6, C7, C8, C11, C12 | ~8 h | A2 riders go on the **existing** two-wheeler models if A4 is not ready yet. |
| **P1 — building impact and look** | A4 (Malaysian vehicles); C3 + C4 (sources, schedule, cost); C9 (Hari Raya hold, monsoon rain, scaffold and netting, lorry route); C10 (move-in) | ~4.5 h | C3 cap: 1 h of research. A figure not found in that hour becomes a labelled assumption, or "Estimate unavailable". |
| **P2 — if time remains** | C9 piling rig; C13 full building e2e beyond the core checks; AC-P1/P2 measurements; full comparison sheet (V2) | ~1 h | If time runs out, V2 shrinks to the 45 s recordings plus a short list of differences. |
| **Always** | V1 checklist + V3 report | last ~1.5 h | **Stop feature work at hour 13.5**, whatever tier you are in. |

Rules:
- Keep a running clock in the ledger: start time, plus the elapsed time at every merge.
- At hours 5, 9 and 12, compare progress with the tier budgets. If a tier is over budget by more than 1 h, cut that tier's remaining tasks to their core (log each cut as a ruling) instead of borrowing time from V1/V3.
- The final report lists every task as done / partly done (what is missing) / not started, and every AC as PASS / FAIL / NOT RUN.

---

## 0. Context primer (read before any task)

### 0.1 Repo rules that bite

- Read `AGENTS.md` + `CLAUDE.md`. CI checklist = 7 steps. Use `set -o pipefail` when piping.
- `uv sync --all-packages --all-groups` (without `--all-packages`, workspace packages get uninstalled).
- Validator, mock and template change **together** (`packages/agent/.../validate.py`, `mock.py`, `template.py`).
- After any API model or route change: `pnpm gen`, then commit `packages/api-client`.
- Demo cache: record with the mock only. `LLM_PROVIDER=mock uv run python -m townshiplens_agent.cli --record "<q>" --profile <p>`. Never `--allow-live`.
- Local `.env` map keys hide CI failures: run vitest with map keys blanked (see memory note "local-ci-env-keys").
- Stage explicit paths. Never `git commit -am`. Data commits go separately from code (`data: …`).
- Concurrency is dynamic, 2–4 lanes (see §1.1). Heavy jobs (Playwright, Blender build, web build, full pytest) are always one at a time.

### 0.2 Backend facts (`SP` = `packages/spatial/src/townshiplens_spatial`, `AG` = `packages/agent/src/townshiplens_agent`)

**Tools**
- `TOOLS` is a dict in `SP/tools.py:933-947` (10 entries), and more are added with `TOOLS["x"] = …` (:1216, 1217, 1265, 1339, 1340, 1393, 1677, 1753, 1871, 1923, 1997). That makes **21**.
- The tool set is pinned in `packages/spatial/tests/test_tools_flood.py:13` and `packages/agent/tests/test_run.py:281`.
- `Ctx` (`tools.py:25`) holds `world`, `vrs`, `closures`. `ToolResult` (`SP/models.py:351`) holds `ok`, `data`, `evidence`, `warnings`. `Evidence` is at `models.py:40`.

**Routes**
- `plan_route(ctx, from_id, to_id, profile, scenario_id=None, question_summary=None, file_vrs=True)` is at `tools.py:448`.
  - It returns `RouteResult.model_dump()` plus `verification_requests`.
  - It files VRs for `route.unknowns`, at most 10 (`MAX_ROUTE_VRS`, :445).
- `RouteResult` is at `models.py:334`; `Route` is at `models.py:292`.
  - `Route` fields: `id`, `status`, `distance_m`, `est_minutes`, `segments`, `unknowns`, `rest_points`, `crossings`, `geometry`, `evidence_ids`, `demo_evidence`, … **There is no `nodes` field.**
- `RouteSegment` (`models.py:249`) has `edge_id`, `eval`, `flood_class`, `access_level`, `rule_id`, `tags_used`.
  - Per-edge evaluation is `evaluate.evaluate_edge(edge, profile, flood_class=None, …) -> (EvalResult, why)` at `SP/evaluate.py:172`. The routing wrapper is `routing._evaluate` (:281).
- `RouteStatus` (`models.py:14`) also has `likely_ok`.
- Pace: `routing._pace_m_per_min(profile)` (:43) gives `speed_kmh*1000/60`, else 70 m/min.

**Verification requests**
- `create_verification_request(ctx, target_id, attribute, reason, question_summary)` is at `tools.py:744`.
- Dedupe is in `SP/vr_store.py:29-40`: a matching OPEN row on (element, attribute, reason) gets `demand+1` and `created=False`.
- `safe_vr_args(world, kwargs, source="chat")` is at `AG/agent.py:197`.
- `impact.fact_impact` (`SP/impact.py:115`) returns `FactImpact` (:45) with `became_confirmed`, `sampled` (20).
- `plan_verifications` (`tools.py:1220`) calls `planner.plan_verifications` (`SP/planner.py:136`).

**Profiles**
- `wheelchair`: hard limits `max_step_count 0`, `max_incline_pct 8.3`, `min_width_m 0.9`; `covered_multiplier 0.86`; `no_sidewalk_is FAIL`.
- `default`: `hard {}`.
- `drive`: `[street, track, major_road]` at 30 km/h; a drive route is never "confirmed".

**Agent**
- `call_tool` (`AG/agent.py:296`) fills `TurnRecord` (`AG/record.py:9`). The `plan_route` branch is at :402-443; the devsim plan goes into `rec.development_plan` at :601-606.
- Validator: `validate_answer` (`AG/validate.py:646`), `measurement_errors` (:391), `devsim_errors` (:1811).
- Mock: `_script` (`AG/mock.py:666`). The access branch is `_ACCESS_Q` (:195) at :946: find_place ×2, then `plan_route`, then `route.highlight` + `journey.play` (:1004).
- Template: `template_answer` (`AG/template.py:587`).

**Intents**
- `AG/events.py`: `IntentKind` :11, `AnswerSceneIntent` :30, `SceneIntent` :51, `ChatEvent` :158.
- The server attaches payloads in `AG/run.py:387-439`.

**REST and codegen**
- `POST /routes` (`apps/api/.../routes/core.py:546`) always uses `file_vrs=False`.
- `POST /developments/simulate` (`routes/devsim.py:57`) is cached per world version.
- `pnpm gen` is `export_openapi.py` + `openapi-typescript` (writes `packages/api-client/src/schema.d.ts`).

**Devsim**
- `DevelopmentPlan` (`SP/devsim_models.py:131`, `total_s=66`) is built by `build_development_plan` (`SP/devsim.py:799`), which calls `place_tower`, `compute_facts` (:441), `build_cast` (:480), `build_beats`, then `check_plan` (:765, raises `DevsimCheckError`).
- Helpers: `_homes_near` (:358, residential within 600 m); `synthesize(world, n_residents=round(homes*3.8), seed=21)` (:491); `walk_minutes` (:277).
- Fixture dump: `python -m townshiplens_spatial.devsim --dump <path>`.
- Fixtures `apps/web/src/features/devsim/fixtures/plan.elmina.json` and `apps/web/e2e/fixtures/devsim-plan.json` must equal the built plan (`packages/spatial/tests/test_devsim.py:339`).

**Day / spotlight**
- `SP/day/spotlight.py`: `choose(pop, n=40)` :98, `facts(sp, trips, decisions)` :180, `allowed_numbers` :311, `check_text(text, f, trip=None)` :339, `template_diary` :382.
- `Spotlight` :63; `Resident` (`day/population.py:58`); `synthesize(world, n_residents=5000, seed=11)` :147.

**Demo cache and golden**
- Demo cache: `AG/demo.py` (`key` :84, `world_fingerprint` :54 includes a code digest). Staleness test: `packages/agent/tests/test_demo_cache_current.py`.
- Golden: `evals/golden/hero.yaml` (format `{id, message, profile, world?, expect{tools_include, intents_include, text_includes, …}}`); runner `evals/run_golden.py`.

**Data**
- `access/overlay.geojson` holds 25 features (18 segments + 7 places, 65 claims, all `team_survey_placeholder`). It is **fully rewritten** by `data/scripts/build_overlay.py:110` (`main`; claims via `_claim` :34; it also computes the P1/P2 Car Park B → Playground paths and rewrites `base/places.geojson`).
- The walk layer has 16,120 edges; only 3 have `highway=steps`: `seg-1346147887-0`, `seg-1323093125-0`, `seg-430198556-0` (`step_count` 1, `reported`, `osm_highway_steps_default`).
- Flood class lookup: `world.flood.edge_classes[scenario][edge_id]`.
- Places: 110 (park 19, clinic 10, school 9, playground 6, seating 6, parking 6, …).
- Attributes available (`SP/attributes.py`, mirrored in `apps/web/src/features/tickets/attributeCatalogue.ts`): `step_count`, `incline_pct`, `width_m`, `covered`, `kerb` (lowered/flush/raised), `seating`, `surface`, `lit`, `crossing`, `handrail`, `tactile_paving`, …

### 0.3 Web facts (`W` = `apps/web/src`)

**Journey playback**
- `WatchTripButton` (`W/features/journey/WatchTripButton.tsx:14`, used in `AnswerCard.tsx:95`).
- `useJourney` store (`journeyStore.ts:123`): `plan`, `timeline`, `t`, `playing`, `camMode`, `vrs`.
- Driver: `useJourneyDriver.ts:55`.
- `timeline.ts`: `buildTimeline` :141, `stateAt` :201.
- `routePath.ts:30` `createRoutePath`; the `JourneyPlan` arrives on the `journey.play` intent.
- `followCamera.ts:140` `createFollowController`.
- Hero: `scene/three/characters/glbHero.ts` (`createGlbHero` :766, `heroVariantFor` :85). The GLBs include **`hero_wheelchair.glb`**.
- Cards: `EventCard`, `cardContent.ts` (copy constants `DEMO_CHIP`, `SIMULATION_LABEL`, `NOT_CHECKED`, `VR_FILED` :24-28).
- `JourneyOverlay.tsx:23` portals into the map slot `sim`.

**Engine** (`W/features/scene/three/engine.ts:124`)
- `setCameraDriver` :239, `setJourney` :255, `setDevsim` :260, `onFrame` :300, `gl()` :312, `pickView()` :314.
- There is **no** multi-viewport or scissor code (only a 1-pixel warm-up at :1035).
- `ThreeScene.tsx:300` mounts `JourneyMount`; `:320` mounts `DevsimMount`.

**Devsim web**
- `useDevsim` (`W/features/devsim/devsimStore.ts:41`).
- `timeline.ts`: acts CON [4,32], HAND [32,44], DAY [44,63]; `END_CARD_AT` 63.3; `feedbackBeats` :420; `stateAt` :446.
- `intent.ts`: `fetchDevsimPlan` :30 (`POST /api/developments/simulate`), `beginDevsim` :56.
- Overlays: `DevsimOverlay.tsx:129`, `Bubble`, `EndCard`, `FeedbackBadge`/`Envelope`, `PlaybackBar`, `DevsimHud`, `HypotheticalLabel`; copy in `copy.ts`.

**Devsim 3D** (`W/features/scene/three/devsim/`)
- `devsimLayer.ts:118`.
- `site.ts`: hoarding :171, crane :235, lorries :377, `lorryPoses` :535.
- `tower.ts:84` (windows `uLitShare`, `litRank` :52).
- `cast.ts` (`MOVERS=8`, `WORKERS=9`).
- `devsimView.ts` (camera), `DevsimSceneMount.tsx:60`.
- No rain effect exists anywhere in 3D.

**Intents and chat**
- `applyIntent` is in `W/features/scene/sceneStore.ts:222`: `route.highlight` :242, `journey.play` :310/325, `movesMap` :192.
- Chat: `useChatStream.ts:105` (scene.intent), :110 (`verification.requested` invalidates `["tickets"]`); `chatReducer.ts:129`.

**Tickets**
- `useTickets.ts` (`["tickets","all"]`, `useOpenTicketCount` :28); the badge is in `W/app/Rail.tsx:41`.

**Shell**
- `useMode` (`W/app/modeStore.ts:5`).
- `MapStage` slots: `brand | route | sim | flood | hint | card | notes` (`map-ui/mapSlots.tsx`).
- Tokens: `W/index.css:60`.
- Honesty word lists: `W/test/honesty.ts` (`BANNED`, `DEPTH`).

**Quality**
- `useSceneSettings.quality` (`sceneSettingsStore.ts`, localStorage `tl.quality`).
- `THREE_TIERS` (`scene/three/quality.ts:14`): high = shadows 4096 + ao + bloom + **dof** + DPR 2; medium = no dof, DPR 1.25.

**Tests**
- vitest runs in the node env; opt in to jsdom with `// @vitest-environment jsdom` (`*.dom.test.tsx`).
- Playwright: ports 5273/8100, tiny fixture, mock LLM, `STAFF_TOKEN=e2e-token`, List view by default, `workers: 1`.
  - Specs: `demoPreset`, `devsim`, `heroes`, `pathStatus`, `three`.
  - Stub API with `page.route(..., r => r.fulfill({json}))`.
  - Acceptance suite: `apps/web/acceptance/*.accept.ts` with `playwright.acceptance.config.ts`.
- Existing hooks: `__journey` (`journeyHook.ts:88`), `__devsim` (`devsimHook.ts:56`), `__tlAcceptance` (`useAcceptanceHook.ts`: `measure`, `frameSummary`, `crowd`).

### 0.4 Three.js city facts (`T` = `W/features/scene/three`)

**Motion planning** (`T/motion/agents.ts`)
- `Agent` :16 `{id, kind, variant, path: Float32Array xz, length, speed, offset, look?}`.
- `TURN_S` :102. `poseAt(a, tSec, out)` :292: ping-pong on open paths, loop on closed ones.
- Edge type sets: `VEHICLE_TYPES` :326, `PEOPLE_TYPES` :327. `PEOPLE_EXCLUDED = {cyclist}` :341 (applied at :786). `MAJOR_ONLY` :359. `SPEED` :360.
- `AGENT_CHUNK_M = 120` :420. `runsOf` :472. `trimPavement` :628.
- `planAgents` :729 (empty on Low): variant pick :796; vehicles build an out-and-back loop at :801-809 **(U-turn cause)**; people :810-825.

**Motion layer** (`T/motion/motionLayer.ts`)
- `avoidRoute` :105. `createMotionLayer` :248: InstancedMesh per (kind, variant, LOD), materials `transparent=true` :299.
- `tick` :547, crowd branch :615-665, `setOpacity` :677.

**Crowd and clock**
- `T/motion/crowdRenderer.ts`: `patchCrowdShader` :82 (baked-animation vertex patch), `createCrowdRenderer` :122 (BatchedMesh).
- `T/motion/motionClock.ts`: `decorativeOpacity` :155, `DECOR_FADE_MS` 1000.

**Streaming**
- `T/stream/tiles.ts` (`TILE_M=250`), `T/stream/caps.ts` (per-tier caps).
- Planning runs in a worker: `T/stream/plan.worker.ts` → `tilePlan.ts:149` → `planAgents`. Every tile receives the whole `walk` FeatureCollection (`tilePlan.ts:26-29`).

**Post-processing**
- `T/engine.ts` `applyTier` :1350: RenderPass → `CityGTAOPass` :1390 → `CityBokehPass` :1421 → overlay → bloom :1439 → output.
  - AO skips motion :1396-1410. The bokeh skip list :1422-1427 does **not** include motion.
  - `overrideStandIns` :876 skips BatchedMesh. No `customDepthMaterial` is used anywhere.
- `T/tiltShift.ts`: `TILT_SHIFT` :20, `dofActive` :61, `tiltShiftParams` :76, slab GLSL :123, `CityBokehPass` :150.

**Assets**
- Blender 5.2: `pnpm assets:build -- --asset vehicles`, then `pnpm assets:pack`. Run `--all` before pack, because a partial pack drops assets from the manifest (`assets/blender/README.md`).
- `assets/blender/tl_assets/specs.py` :403-425 (`_CAR_LODS=(3000,400)`, `_HEAVY_LODS=(5000,600)`).
- `props.py`: `_bike` :1059, `_rider` :1080, `CARS` :1178, `_car` :1247, `_motorcycle` :1327, `_vehicle_builder` :1448.
- Vertex colours: `COLOR_0` R = AO, G = role/7; aux B = lamp code.
- Tests: `assets/blender/tests/test_committed_assets.py` (budgets: kit 1.5 MB, folder 12 MB), `test_specs.py`, `test_vendor.py`.
- Parked cars: `T/ground/parking.ts:48-52`.

**Performance**
- `frameStats.ts:22`; `?perf=1` overlay; `__tlAcceptance.measure(seconds, orbit)`.
- Past gate: ≥ 30 fps at Medium hero-mid; headless ≤ 150 draws, ≤ 2.5 M tris.

---

## 1. Lanes, branches, order

| Lane | Worktree | Branch | Owns |
|---|---|---|---|
| be-nav | `../SunNiuBi-wt/dp-be-nav` | `demo-polish/be-nav` | `SP/compare.py`, compare models, `compare_routes`, `apps/api`, `packages/agent`, `data/scripts`, `evals/`, `packages/api-client` |
| be-dev | `../SunNiuBi-wt/dp-be-dev` | `demo-polish/be-dev` | `SP/devsim*.py`, `SP/devsim_schedule.py`, `SP/devsim_residents.py`, sources doc; `packages/agent` devsim branch only after B4 |
| 3d | `../SunNiuBi-wt/dp-3d` | `demo-polish/3d` | `apps/web/src/features/scene/three/**` (motion, engine, tiltShift, devsim 3D, compare 3D) |
| fe | `../SunNiuBi-wt/dp-fe` | `demo-polish/fe` | `apps/web/src/features/{journey,devsim,assistant,chat,tickets,map-ui}/**`, `apps/web/e2e/**` |
| assets | `../SunNiuBi-wt/dp-assets` | `demo-polish/assets` | `assets/blender/**`, `apps/web/public/city/**`, `CREDITS.md` |

- Integration branch: `feat/demo-polish` (already exists: it holds the spec, plan and prototype commit; lane branches start from it). The coordinator merges lanes with `--no-ff`, runs the full checklist, and never pushes to `main` without the owner's gate.
- Ledger: `.superpowers/sdd/demo-polish/ledger.md` (gitignored). Write a RESUME POINT after every merge.
- Log: `docs/superpowers/overnight-log.md`, timestamped with real `date` values.
- The backend is split into two lanes so they can run side by side:
  - **`be-nav`** (`../SunNiuBi-wt/dp-be-nav`, branch `demo-polish/be-nav`): `SP/compare.py`, the compare models, the `compare_routes` tool, REST, agent (B4), `data/scripts` (B5).
  - **`be-dev`** (`../SunNiuBi-wt/dp-be-dev`, branch `demo-polish/be-dev`): `SP/devsim*.py`, `SP/devsim_schedule.py`, `SP/devsim_residents.py`, `docs/04-architecture/devsim-estimates-sources.md`.
  - Both touch `SP/models.py` / `SP/tools.py` only in separate, additive blocks. `be-dev` does **not** touch `AG/*` until B4 is merged (C7 edits the same `mock.py` / `validate.py`).

### 1.1 Concurrency: dynamic, 2 to 4 lanes

The owner has run 3–4 parallel lanes on this machine without trouble, so concurrency is **dynamic**, not fixed at two.

- **Start with 3 lanes.** Go to **4** when free physical memory stays above **1.5 GB** for a few minutes with 3 lanes busy.
- Drop back **one lane at a time** when:
  - free memory falls below **800 MB**;
  - a process is killed for memory (exit 137, `JavaScript heap out of memory`, Blender crash);
  - the machine starts swapping hard (tests time out that normally pass).
- Never go below 2 lanes because of memory. Instead, pause the heaviest task.
- Check memory before starting each new task, and log the reading in the ledger:
  ```powershell
  (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB   # GB free
  ```
- **Heavy jobs are serialised regardless of the lane count.** At any moment there is at most one of each:
  - Playwright e2e or acceptance run (they share ports 5273/8100);
  - Blender build (`pnpm assets:build`);
  - `pnpm --filter @tl/web build`;
  - full `uv run pytest -q`.
  Narrow tests (one file, `-k`) can run in parallel.
- Do not count the coordinator's own checks as a lane, but do not start a full checklist while 4 lanes are building.

### 1.2 Waves (each wave uses up to 4 lanes; a task starts as soon as its inputs are merged)

1. **Wave 1:**
   - `assets` (A2, then A4);
   - `3d` (A1, then A3);
   - `be-nav` (B1, B2, B3, B5, B6);
   - `be-dev` (C3 research, then C1, C2, C5, C4, C6).
2. **Wave 2:**
   - `be-nav` (B4 agent);
   - `3d` (B8 renderer);
   - `fe` (B7, B9, B10 against the B6 fixture; rebase onto the generated types after B3/B4 merge);
   - `be-dev` (C7, **after B4 is merged**).
3. **Wave 3:**
   - `3d` (C9, C10);
   - `fe` (C8, C11, C12, after C7 is merged);
   - `fe` second agent (B11 navigation e2e, run only when no other e2e is running).
4. **Wave 4:** C13, then V1–V3 (coordinator; fewer lanes).

The tiers in the time box still decide what gets cut. Parallel lanes do not change the hour-13.5 stop.

- Shared-file conflicts to expect:
  - `sceneStore.ts`: B7 owns it.
  - `engine.ts`: A3, B8 and C9 are all in lane 3d and run in sequence.
  - `schema.d.ts`: written only by the be lanes (B3, B4, C7 each run `pnpm gen`); fe rebases after.
  - `SP/models.py`, `SP/tools.py`: be-nav and be-dev each add their own block; the coordinator resolves trivial conflicts at merge.

---

## 2. Tasks

Each task lists: **Files**, **Steps**, **Tests**, **Done when** (AC ids), **Commit**. Run the narrow tests while working, and the full checklist only at merges.

### Part A — living city

#### A1. Road graph and continuous agent paths (lane 3d) — AC-L1, L2, L3, L4, L6, L8

**Files:**
- New: `T/motion/roadGraph.ts` + test.
- Change: `T/motion/agents.ts`, `T/motion/motionLayer.ts`, `T/stream/tilePlan.ts`.
- Fixture: `T/motion/fixtures/elmina-hero-walk.json` (new, ~1 km² cut of the seed walk layer around the hero district; write a small node script under `apps/web/scripts/` to cut it).

**Steps:**
1. `roadGraph.ts`: `buildRoadGraph(walk, frame, kinds)` builds nodes from LineString endpoints snapped at ≤ 1.0 m, and edges with type, width, polyline in local metres, and length. Expose `degree(node)`, `next(edgeId, atNode, rnd)`, which never returns the incoming edge unless degree is 1. Build it once per latched walk layer: cache it like `runsOf` (:472) and build it inside the worker, since `plan.worker.ts` already receives the walk layer.
2. Replace the vehicle out-and-back loop (`agents.ts:801-809`) with a **seeded random walk**:
   - start at the chunk the agent owns today, so the ownership and priority logic at :750-772 stays;
   - extend edge by edge with `next()` until the path is ≥ `speed × 120 s`;
   - offset to the left lane (left-hand traffic, existing `offsetLeft`);
   - round corners with a 3–6 m fillet so yaw is continuous.
   - The result is still `Agent.path` as a Float32Array, so `poseAt` keeps working.
3. Add `Agent.ends: "fade"` (or similar) so `poseAt` **does not ping-pong** for these agents. At the path end, the motion layer fades the agent out over ≤ 1 s (reuse `decorativeOpacity` and per-instance opacity) and restarts it at a new seeded start. Keep ping-pong only for a degree-1 dead end, where the U-turn is real: there, slow down, do a 3-point-style 180° over `TURN_S`, and continue.
4. People: build the graph over `PEOPLE_TYPES` (footway, path, pedestrian, sidewalk, crossing) plus pavements beside streets (today's pavement offset logic). The random walk is the same. Change `trimPavement` (:628) to cut only at real junction nodes; a cut end is a node, not mid-edge. `avoidRoute` (`motionLayer.ts:105`): when the path enters the avoid zone, fade and respawn instead of keeping the longest piece.
5. Bicycles (needs A2's `bicycle` variant): a vehicle-class agent on `street` edges only, at 4.0–5.5 m/s, with lateral offset ≥ 0.35 × road width (kerb side). Add `bicycle` to the vehicle variant pool with the A4 share (2%).
6. Variant pick (`agents.ts:796`): replace the uniform `pool[floor(hash × n)]` with a weighted pick using the A4 shares; `bus` and `lorry` stay `MAJOR_ONLY`.
7. Acceptance counter: in `tick`, keep a per-agent yaw history and count reversals > 150° within 2 s that are not at a degree-1 node. Expose it as `__tlAcceptance.uturns()`. Add `apps/web/acceptance/uturns.accept.ts`, which runs 60 s at Medium in the hero district, asserts 0, and logs agent counts.

**Tests:**
- `roadGraph.test.ts`: snapping; degree; `next` never returns the incoming edge except at degree 1.
- `agents.uturn.test.ts`: property test for AC-L1/L2 on the tiny fixture, a 5×5 grid and the Elmina extract (60 s at 30 Hz).
- Fade test for AC-L3.
- Mix test over 2,000 spawns for AC-L8.
- Bicycle placement and speed for AC-L6.
- Existing `motionLayer.test.ts`, `flow.test.ts`, `crowdRules.test.ts` and `crowdPerf.test.ts` must stay green. Update expectations only where a test encoded the ping-pong behaviour, and note each such change in the ledger.

**Done when:** AC-L1, L2, L3, L6, L8 pass in vitest; AC-L4 passes in the acceptance run; the worker plan time per tile stays ≤ 8 ms (the `caps.ts` budget; log the median).

**Commit:** `fix(web): agents drive and walk through junctions instead of U-turning mid-road`

#### A2. Riders on two-wheelers (lane assets) — AC-L5, L9

**Files:** `assets/blender/tl_assets/props.py` (`_motorcycle` :1327, `_bike` :1059, `_rider` :1080), `specs.py` :403-425, `assets/blender/tests/test_specs.py`, `test_committed_assets.py`.

**Steps:**
1. Split `_rider` into a reusable `_seated_rider(helmet: bool, palette)`. The figure's hands reach the bars; on motorbikes the feet sit on the pegs. Name the object `rider` so the GLB node name is stable.
2. `kapchai` (replaces `motorcycle`): an underbone moped plus `_seated_rider(helmet=True)`.
3. `delivery_moto` (replaces `delivery_motorcycle`): moped + rider + a rear box (role colour for the box; no logo or text).
4. `bicycle`: `_bike` + `_seated_rider(helmet=False)`, as a **vehicles-kit** variant, not the people kit.
5. Add `rider: bool` to the vehicle spec, and a test that every two-wheeler has `rider=True` and the built GLB has a node `rider` at both LODs.
6. Keep vertex-colour conventions (`COLOR_0` R = AO, G = role/7; lamp code in aux B: headlight on motor variants).

**Tests:** `uv run pytest assets/blender/tests -q`.

**Done when:** AC-L5 and AC-L9 pass. Built together with A4 (one `--all` build + pack).

**Commit:** `feat(assets): riders on mopeds, delivery bikes and bicycles`

#### A3. No ghosting on High (lane 3d) — AC-L11, L12, L13

**Files:** `T/tiltShift.ts`, `T/engine.ts` (:1350-1440, `overrideStandIns` :876), `T/motion/crowdRenderer.ts`, `T/motion/motionLayer.ts`, tests `tiltShift.test.ts` + new `bokehDepth.test.ts`.

**Steps:**
1. In the slab GLSL (`tiltShift.ts:123`) and the near parameters (`TILT_SHIFT.near` :20, `subject` mode), make the circle of confusion **0 for depth < focus**. Only far blur remains. Expose a pure TS `cocAt(depth, params)` that mirrors the GLSL, for the unit test.
2. Add the motion layer group and the crowd BatchedMeshes to the bokeh skip list (:1422-1427). The skip list hides objects in the bokeh pass's own depth render (`CityBokehPass.render` :188); check that they still appear in the colour buffer. If skipping makes their pixels take the background's depth and blur, use the other route instead: give the crowd a depth material built with the same `patchCrowdShader` (:82) vertex patch, and use `customDepthMaterial` / a depth override on the motion InstancedMeshes, so the depth silhouette matches. Pick whichever looks right, and log a ruling.
3. Make sure `overrideStandIns` (:876) does not replace these meshes' materials in the bokeh pass.

**Tests:**
- `tiltShift.test.ts`: `cocAt(d < focus) === 0` in orbit and follow params (AC-L11).
- `bokehDepth.test.ts`: the motion group and crowd meshes are in the skip list or carry the depth material (AC-L12).

**Done when:** AC-L11 and AC-L12 pass. Capture the L-1/L-2 screenshot pair for the comparison sheet: High, journey hero follow, crowd person 6–15 m away, FX on vs off.

**Commit:** `fix(web): depth of field no longer blurs or ghosts near people and vehicles`

#### A4. Malaysian-looking vehicles (lane assets, then 3d for the web pool) — AC-L7, L8, L9, L10

**Files:** `assets/blender/tl_assets/props.py` (`CARS` :1178, `_car` :1247), `specs.py`, `apps/web/public/city/kits/vehicles.glb` + `manifest.json` (built), `T/motion/agents.ts` (pool + weights), `T/ground/parking.ts:48-52`, new `W/test/brandNames.test.ts`, new `assets/blender/tests/test_brand_names.py`.

**Steps:**
1. Define the variants from spec §4 A4. Shapes and proportions in metres (length × width × height):
   - `compact_hatch` ~3.9 × 1.7 × 1.5, short bonnet, tall glasshouse;
   - `micro_hatch` ~3.7 × 1.6 × 1.5;
   - `small_sedan` ~4.3 × 1.7 × 1.5 with a short boot;
   - `mpv` ~4.4 × 1.7 × 1.7;
   - `pickup` ~5.3 × 1.85 × 1.8, double cab;
   - `kapchai`, `delivery_moto` and `bicycle` from A2;
   - `bus` ~12 × 2.5 × 3.2, single deck;
   - `lorry` ~7 × 2.2 × 3.0, 3-tonne box.
2. Paint palette as role colours: white, silver, grey (≈ 60% together), red, blue, black, maroon.
3. Remove the old variant ids from specs and the manifest. Update every web reference (grep `hatchback|city_car|sedan|motorcycle|delivery_motorcycle`).
4. Build with `pnpm assets:build -- --all`, then `pnpm assets:pack`. Commit the GLBs and manifest.
5. Web: weighted pool (A1 step 6); parked cars use only the four car variants (AC-L10).
6. Brand-name scans (AC-L7) in vitest and pytest, using the banned list in the spec.

**Tests:** `uv run pytest assets/blender/tests -q`; `pnpm --filter @tl/web exec vitest run src/test/brandNames.test.ts src/features/scene/three/ground`.

**Done when:** AC-L7, L8, L9 and L10 pass. Comparison sheet row L-3 is a screenshot of a street with mixed traffic and riders.

**Commits:** `feat(assets): Malaysian-looking vehicle kit (generic shapes, no brands)`, then `feat(web): weighted local traffic mix and parked-car variants`

### Part B — navigation compare

#### B1. `compare_routes` core (lane be-nav) — AC-B2…B8, B10

**Files:** `SP/compare.py` (new), `SP/models.py` (new `CompareResult`, `ReasonSet`, `StopPoint`, `Poi`, `UncheckedStretch`), `packages/spatial/tests/test_compare.py` (new).

**Steps:**
1. `compare(world, from_id, to_id, profile, scenario_id=None) -> CompareResult`:
   - `fastest` = the route for `default`; `recommended` = the route for `profile`. Reuse the internals `plan_route` uses (`routing` functions), not the tool wrapper.
2. For `fastest`, evaluate every segment under `profile` with `evaluate_edge`:
   - `stop` = the first FAIL;
   - `at_m` = cumulative length before that edge;
   - `attribute`, `value` and `limit` come from the `why` entry and the profile's hard limits;
   - `evidence_id` is the claim's evidence.
3. `reasons(route, profile)`:
   - iterate `route.segments`;
   - for each attribute, use only edges whose claim for that attribute is present with a value and status not `unknown`;
   - compute `steps`, `max_incline_pct`, `min_width_m`, `covered_share` (rounded to 0.05), `rest_stops` (= `route.rest_points` that are not unverified, plus `seating` places within 15 m), `distance_m`, `minutes` = `est_minutes`;
   - a field is null when no edge has a known value for it;
   - collect the evidence ids used.
4. `unchecked`: contiguous runs of edges on `recommended` whose eval is UNKNOWN, grouped by attribute (from `route.unknowns`), with `start_m`, `end_m` and `length_m`.
5. `pois` along `recommended`, ordered by `at_m`:
   - `kerb` for the first lowered/flush kerb crossing;
   - `covered_start` for the first covered edge after a non-covered one;
   - `incline` for the steepest known edge;
   - `seating` for rest stops;
   - `unknown` for the start of each unchecked run;
   - `arrival` at the end;
   - each with `value`, `evidence_ids`, and `demo` (any evidence is `team_survey_placeholder`).
6. `same_path`, `extra_minutes`, and `status` (the recommended route's status; `no_data` and `blocked` short-circuit with no stop and no VR).

**Tests (`test_compare.py`):**
- A hand-built world (follow the patterns in existing `test_routing.py`): a short path with steps and a longer step-free path with one unknown-incline edge. Assert every field (AC-B2, B5, B6, B7).
- `no_data` and `blocked` worlds (AC-B8).
- Hypothesis test (AC-B3): randomise PASS-compatible values on the unknown edges and assert the recommended route id and the reasons are unchanged.
- Traceability (AC-B4): every reason value's evidence id is in the result evidence.

**Done when:** `uv run pytest packages/spatial/tests/test_compare.py -q` is green.

**Commit:** `feat(spatial): compare fastest vs profile route with known-fact reasons`

#### B2. Register the tool, file the VR, compute N (lane be-nav) — AC-B1, B9, B10

**Files:** `SP/tools.py` (new `compare_routes` + `TOOLS["compare_routes"]`), `packages/spatial/tests/test_tools_flood.py:13`, `packages/agent/tests/test_run.py:281`, docs with tool counts (`AGENTS.md:57`, `packages/spatial/README.md:5` and :386, `docs/04-architecture/README.md:25`, `docs/04-architecture/ai-target-design.md:57`, `docs/05-team/dev-setup.md:25` and :187, `docs/03-product/mvp-status-2026-10-15.md:38`).

**Steps:**
1. `compare_routes(ctx, from_id, to_id, profile="wheelchair", scenario_id=None, question_summary=None, file_vrs=True)` wraps `compare()` and returns a `ToolResult` with evidence for every evidence id used.
2. If `file_vrs` and `unchecked` is non-empty, call `create_verification_request` for the **first** unchecked stretch's first edge and attribute, with reason `"unknown"` and `question_summary` as `plan_route` does. The agent layer sanitises the args through `safe_vr_args`. Put `{id, created, target_id, attribute}` in `vr`.
3. `confirm_n` = `impact.fact_impact(world, element_id, attribute, …).became_confirmed` for profile wheelchair. Read `impact.py:115` for the exact signature; if it needs a VR id, pass the one just filed.
4. Fix the tool count in all the docs listed above (22). Note that some say 10 or 20 today, which is stale.

**Tests:**
- Dedupe: a second call gives `created=False` with the same id (AC-B9).
- `confirm_n` cross-check against a direct `fact_impact` call (AC-B10).
- The tool-set tests are updated (AC-B1).

**Commit:** `feat(spatial): compare_routes tool files one survey ticket and counts trips it would confirm`

#### B3. REST and client (lane be-nav) — AC-B11

**Files:** `apps/api/src/townshiplens_api/routes/core.py` (next to `POST /routes` :546), api tests, `packages/api-client/*` (generated).

**Steps:** `POST /routes/compare` with body `{from, to, profile, scenario_id}` (reuse `RouteRequest` :35), calling `compare_routes(..., file_vrs=False)`. Run `pnpm gen` and commit the client.

**Tests:** `uv run pytest apps/api -q -k compare`; then `pnpm gen && git diff --exit-code packages/api-client`.

**Commit:** `feat(api): POST /routes/compare` (the client is in the same commit)

#### B4. Agent: intent, mock, template, validator, golden (lane be-nav) — AC-B12

**Files:** `AG/events.py` (`IntentKind` + `route.compare` payload fields on `SceneIntent` :51), `AG/agent.py` (`call_tool` branch :402-443: record routes of both, `rec.compare`, VR and journeys), `AG/record.py`, `AG/run.py:387-439` (attach the compare payload to the intent), `AG/mock.py` (`_ACCESS_Q` branch :946), `AG/template.py`, `AG/validate.py`, `evals/golden/hero.yaml`, agent tests.

**Steps:**
1. `route.compare` intent payload: both route geometries, `stop`, `pois`, `unchecked`, `reasons`, `extra_minutes`, `vr`, `confirm_n`, `profile`, and from/to names. The server fills it from `rec.compare`; the model never writes numbers into it.
2. Mock: when the profile is wheelchair, stroller or older_adult_rest and the question is a route request, do find_place ×2, then `compare_routes`. Emit `route.compare` **and** `route.highlight` (recommended) **and** `journey.play` (recommended), so the List view and today's journey path still work. `default`-profile route questions are unchanged.
3. Template and mock answer text: one line recommending the route and naming 2–3 known reasons with their numbers (taken from the record); one line about the unchecked stretch ("not checked yet, a survey ticket was filed"); and "demo values, not yet surveyed" when the evidence is placeholder.
4. Validator: numbers in the answer must be in the recorded compare values. Add them to `_recorded_values` / `tool_measures`, as the plan_route record does today.
5. Golden: add `nav-compare-wheelchair` (world elmina, using the B5 corridor question) with `tools_include: [find_place, compare_routes]`, `intents_include: [route.compare, route.highlight]`, `text_includes: ["demo values, not yet surveyed"]`.

**Tests:** `uv run pytest packages/agent -q`; `pnpm golden`.

**Commit:** `feat(agent): route.compare intent for mobility-profile route questions`

#### B5. Demo corridor data (lane be-nav) — AC-B13, B14, B15

**Files:** `data/scripts/pick_demo_corridor.py` (new), `data/scripts/build_overlay.py`, `data/scripts/tests/test_build_overlay_corridor.py` (new), `data/seed/elmina/access/overlay.geojson` (regenerated), `data/demo/*.jsonl` (re-recorded).

**Steps:**
1. `pick_demo_corridor.py`:
   - load the Elmina world;
   - for every place pair within 1.5 km, compute `compare()` with a **temporary** placeholder claim of `step_count = N` on whichever of the 3 steps edges the default route uses;
   - keep pairs where the fastest route crosses a steps edge, the wheelchair route adds 1–4 min, and the recommended route is ≥ 60% footway/path/pedestrian by length;
   - print the top 10 with names, distances, minutes and the steps edge;
   - choose one and write a ruling with the pair and why.
   - Prefer origins with a car park or bus stop, and destinations that are a playground, park or clinic.
2. `build_overlay.py`: add a `DEMO_CORRIDOR` block next to the P1/P2 logic:
   - the chosen from/to ids;
   - placeholder claims for every edge of both routes: `step_count`, `incline_pct`, `width_m`, `covered`, `kerb` at crossings, and `seating` places where real OSM benches exist;
   - the one steps edge on the fastest route gets `step_count = N`, where N is plausible from imagery-free reasoning (3 for a short flight; never invent a staircase where OSM has none);
   - exactly one 30–60 m stretch on the recommended route **without** `incline_pct`;
   - values deterministic and plausible (incline 0–5%, width 1.2–2.0 m on footways).
3. Run `uv run python data/scripts/build_overlay.py`, then run it again and check the output is byte-identical (AC-B14).
4. Pytest on the Elmina world for AC-B13.
5. Re-record the affected demo replays with the mock (at least the corridor question and any replay whose fingerprint changed), then run `test_demo_cache_current.py` (AC-B15).

**Commits:** `feat(data): demo corridor placeholder claims built by build_overlay` (script + test); `data: rebuild overlay with the demo corridor`; `data: re-record demo replays after the corridor overlay`

#### B6. Recorded compare fixture for web tests (lane be-nav) — supports AC-N3

**Steps:** dump the `route.compare` intent for the corridor question to `apps/web/src/features/journey/fixtures/compare.elmina.json` and `apps/web/e2e/fixtures/compare-intent.json`, with a pytest that checks they match a fresh build (same pattern as `test_devsim.py:339`).

**Commit:** `test(web): recorded route.compare fixture from the Elmina corridor`

#### B7. Web store and intent (lane fe) — AC-N1, N9, N10

**Files:** `W/features/journey/compareStore.ts` (new; or extend `journeyStore` with a `compare` field, decide and log), `W/features/scene/sceneStore.ts` (`applyIntent` case `route.compare`; `movesMap`), `W/features/chat/chatReducer.ts`, `WatchTripButton.tsx`, `TripBar.tsx`, `exitTrip.ts`.

**Steps:**
1. Store `compare` (intent payload), `t`, `playing`, with actions `load`, `play`, `pause`, `seek`, `restart`, `clear`. Reuse the `useJourneyDriver` pattern (ref-counted rAF, 0.25 s step cap, pause when hidden).
2. `applyIntent('route.compare')` stores the payload. **Watch trip** starts compare playback when the current answer has one, and journey playback otherwise.
3. Exit trip clears both. Reduced motion (`reducedMotion()` from `cesium/controls/cameraOps.ts:19`): cut instead of fly.
4. List view: show the reasons card and toast (B10) without 3D.

**Tests:** jsdom tests for store transitions and the Watch trip routing (AC-N1, N10); List view (AC-N9).

**Commit:** `feat(web): route.compare intent drives a compare playback`

#### B8. Split-screen renderer (lane 3d) — AC-N2, N7, P1

**Files:** `T/engine.ts` (new `setSplit(split | null)`), `T/compare/` (new folder: `compareLayer.ts`, `compareCameras.ts`), `T/scene/ThreeScene.tsx` (mount), tests.

**Steps:**
1. `engine.setSplit({ left: Camera, right: Camera } | null)`:
   - when set, the render loop draws the scene twice with `renderer.setScissorTest(true)`, two viewports at W/2 each, using the composer per viewport;
   - simplest correct approach first: render passes per viewport with each camera's aspect = (W/2)/H;
   - if post-processing per viewport costs too much, turn off AO and DoF in split mode only (log a ruling).
   - `pickView()` must return the camera under the cursor.
2. `compareCameras.ts`: two follow cameras, using `followCamera.ts` (`createFollowController` :140) per walker, or a slimmer chase cam with the prototype values (back 42 m, up 26 m, look 12 m ahead, lerp 0.08).
   - At 31.5 s, the split ends and one overview camera frames both routes with `routeOverviewFit` (:64), with a bottom inset equal to the reasons card height + 24 px (AC-N7).
3. `compareLayer.ts`:
   - two route ribbons: orange `#e07a3a` fastest, green `#2fa97c` recommended, purple `#8b7fd6` unchecked runs, red `#d2544f` stop edge;
   - two wheelchair heroes (`createGlbHero` with the `wheelchair` variant, two instances, distinct shirt colours), positioned by distance along each route;
   - one greeting resident (crowd look) placed beside the recommended route near the POI the greeting is tied to.
4. Expose screen projections for the overlay: walker positions, POI anchors, the unchecked stretch point, the routes bbox.

**Tests:** vitest for viewport math (halves ±1 px; AC-N2); overview fit with inset (AC-N7, unit level). Run AC-P1 with `__tlAcceptance.measure` and log the numbers.

**Commit:** `feat(web): split-screen compare renderer with two follow cameras`

#### B9. Compare timeline (lane fe) — AC-N3

**Files:** `W/features/journey/compareTimeline.ts` (new) + test.

**Steps:**
- `buildCompareTimeline(payload)`:
  - speed = `recommended.distance_m / 26 s` (start at 3 s, arrive at 29 s);
  - the fastest walker uses the same speed and stops at `stop.at_m`;
  - beat times come from POI `at_m` / speed + 3, clamped to the §5.4 windows; the ticket flight starts when the walker passes `unchecked[0].start_m`;
  - fixed beats: merge at 31.5 s, reasons card at 32 s, end at 45 s.
- `stateAt(tl, t)` returns visible beat ids, walker distances, counters and the camera mode.

**Tests:** with the recorded Elmina fixture, every beat lands within ±1.5 s of §5.4 (AC-N3, unit level).

**Commit:** `feat(web): compare playback timeline from route facts`

#### B10. Compare overlays (lane fe) — AC-N2, N4, N5, N6, N8, N11

**Files:** `W/features/journey/compare/` (new): `CompareOverlay.tsx`, `ComparePills.tsx`, `PoiTag.tsx`, `TicketFlight.tsx`, `TicketsChip.tsx`, `TicketToast.tsx`, `ReasonsCard.tsx`, `GreetingBubble.tsx`, `copy.ts`; mounted in the map slot `sim` like `JourneyOverlay.tsx:23`.

**Steps:**
1. Port the prototype styles (`.pill`, `.tag`, `.ticket`, `#tickets`, `#toast`, `#reasons`, `.bubble`) to Tailwind with the project tokens (`W/index.css:60`). Keep the layout and copy exactly as spec §5.3 / AC-N4–N6.
2. Copy constants live in `copy.ts`. Unchecked tag: `"? Not checked yet · {Attribute} on this {m} m · Not counted for or against"`. Toast and reasons copy are exactly as in the AC text.
3. `TicketFlight`: an 1.8 s arc from the projected unchecked point to the chip. The chip counter goes from 0 to 1 at the end. Invalidate `["tickets"]` so the Rail badge updates (`useOpenTicketCount`).
4. `GreetingBubble`: text from a fixed list (`["Selamat pagi! 👋", "Morning! 👋", "Hai, jalan elok-elok!"]`; pick by seed), labelled "Simulated resident".
5. Every element carries `data-beat`.

**Tests:**
- jsdom: copy and states (AC-N4, N5 null-vr case, N6 null cells, N8 no digits).
- Honesty scan (AC-N11, reuse `W/test/honesty.ts`).

**Commit:** `feat(web): compare overlays — tags, ticket flight, reasons card`

#### B11. Hook and e2e beats for navigation (lane fe) — AC-N3, N5, N7

**Files:** `W/features/demo/demoHook.ts` (new; installs `window.__tl.demo` only when `import.meta.env.DEV` or `VITE_E2E`), `apps/web/e2e/demo-beats.spec.ts` (new).

**Steps:**
1. The hook exposes `seek`, `play`, `pause`, `set("nav"|"bld")`, and `state()` → `{ t, beats: string[], counters, crane, rain, routesBbox, cardTop, towerBbox, panelLeft, … }`.
2. In e2e, stub `/api/chat` with the recorded compare SSE (pattern: `devsim.spec.ts:136`) or call `applyIntent` with `compare-intent.json`. Force Stylised as `three.spec.ts` does (SwiftShader, stub buildings) for the beats that need 3D; List view for N9.
3. For each §5.4 row: seek to its midpoint and assert `data-beat` is visible; seek 0.5 s outside and assert it is hidden. Check the chip counter at 19.3 / 19.5 s. Navigate to `/tickets` and assert the VR row is there (AC-N5). Check the bbox above the card top with 24 px margin (AC-N7).

**Commit:** `test(web): navigation compare beats e2e`

### Part C — building impact

#### C1. Hoarding impact summary (lane be-dev) — AC-C1

**Files:** `SP/devsim.py` (new `hoarding_impact(world, site, lay)`), `SP/devsim_models.py` (`HoardingImpact`, `HoardingOption`), `packages/spatial/tests/test_devsim_impact.py`.

**Steps:**
1. Homes are residential buildings within 500 m. Use `_homes_near` (:358) with radius 500. Snap each to its node (`detour_home_node` :426 pattern).
2. Targets: Lakeside Mall, Urban Park (`_place_by_name` :233), plus the nearest school and nearest clinic **to the site** (one each, so every home uses the same four).
3. Before and after: route in `world` vs `tower_world`-with-closures (reuse how `_detour` :383 closes `frontage_edges` :312), `default` profile minutes.
   - `homes_2min_plus`: homes with any target ≥ 2 min longer.
   - `max_extra_min`.
   - `wheelchair_links_cut`: homes whose wheelchair route to any target was `confirmed`/`partly_unverified`/`likely_ok` before and is `blocked`/`no_data` after.
4. Options: for each frontage side (group `frontage_edges` by the parcel side they run along), compute the same with only that side hoarded. `best_side` = fewest `homes_2min_plus`, ties broken by `max_extra_min`.
5. Performance: cache per (world.version, site); use a single-source Dijkstra per target in reverse (targets → all homes) rather than per-home routing. It must build in < 5 s on Elmina; log the time.

**Tests:** a synthetic grid world with a known answer; an Elmina smoke test (`world: elmina`) asserting the fields are present and the counts are > 0.

**Commit:** `feat(spatial): hoarding impact over every nearby home, per hoarding side`

#### C2. Lorry route (lane be-dev) — AC-C2

**Steps:** a `drive` profile route from the nearest `major_road` node (to the site) to the site gate node (the snapped entrance on the street side). `sensitive` = places of type school, kindergarten, park or playground whose node or outline lies within 50 m of the route geometry, with names, ordered by distance along the route. `school_run_note` = `"School run assumed 7–8 am (typical); not from data"`.

**Tests:** pytest on Elmina (route exists, polyline non-empty, `sensitive` names exist in places).

**Commit:** `feat(spatial): devsim lorry route with sensitive places along it`

#### C3. Estimate sources research (lane be-dev; no code) — AC-C3

**Steps:**
1. Research and record in `docs/04-architecture/devsim-estimates-sources.md`, as a table: figure | value | unit | source title | edition/year | URL | accessed | kind (gazetted / benchmark / climatology / assumption). Figures needed:
   - **Construction cost**: RM per m² GFA, high-rise condominium, Klang Valley / Kuala Lumpur. Latest *Arcadis Construction Cost Handbook Malaysia* or the JUBM/Langdon & Seah equivalent. Take the mid-point and note the range.
   - **GFA per home**: an assumption (e.g. 1,000 sq ft net ≈ 93 m², plus a common-area factor); state both numbers as assumptions.
   - **Durations**: foundation/piling months, structural floor cycle (days per floor), fit-out after topping out (months), from a published Malaysian source (CIDB or a contractor case study). If none is found, record it as an assumption with the reason.
   - **Public holidays, Selangor, 2027–2030**: the gazetted list for the latest published year (Jabatan Perdana Menteri / official Selangor list), with expected dates for later years (Islamic and lunar dates from published calendars). Mark each `gazetted` or `expected`.
   - **Northeast monsoon**: months (Nov–Mar) and typical rainy days per month for Petaling/Subang (MetMalaysia climatology). Lost-day fraction is an assumption.
   - **Hari Raya site shutdown**: working days, as an assumption (industry practice), with a source if one is found.
2. Use the web search tools. Never invent a figure. Where a figure cannot be sourced, it stays an **assumption** and is labelled so in the UI.

**Commit:** `docs: devsim estimate sources (cost, durations, holidays, monsoon)`

#### C4. Schedule and cost model (lane be-dev) — AC-C4

**Files:** `SP/devsim_schedule.py` (new), `packages/spatial/tests/test_devsim_schedule.py`.

**Steps:**
1. `SOURCES` holds the constants from C3, each with `id`, `value`, `kind` and `label`.
2. `schedule(storeys, homes, start=date(2027,1,4)) -> Schedule` (pydantic). Phases are foundation → structure (floor cycle × storeys, extended by lost days) → fit-out.
   - Working days are Mon–Sat; holidays are removed only when they fall on working days.
   - Rain loss = monsoon wet days × lost fraction.
   - Hari Raya shutdown = the assumption, applied to the Raya that falls during structure work (pick the first; that is the set piece).
3. Outputs as in AC-C4, plus `raya_set_piece` {date, month_index, days} and `monsoon_set_piece` {start_month, end_month}: the first monsoon band during structure.
4. Cost: `rate × GFA` total; the monthly S-curve is a cumulative logistic over the months (document the shape as an assumption).

**Tests:**
- Constants equal the doc table (parse the markdown table; AC-C3).
- Holidays on a Sunday are not counted.
- Totals are reproducible.
- The S-curve is monotonic and ends at the total.

**Commit:** `feat(spatial): devsim schedule and cost estimate from sourced benchmarks`

#### C5. Flood exposure and daily-life matrix (lane be-dev) — AC-C5, C6

**Steps:**
1. Flood: for each scenario `stage_p1m`…`stage_p5m`, check whether the route from the tower entrance to the nearest `major_road` node (default profile) crosses an edge with `likely_flooded` (`world.flood.edge_classes[s][edge]`). `cut_from_scenario` = the first such scenario, or null.
2. Nearest evacuation candidate: reuse `list_evacuation_centres` (`tools.py:820`) logic; walk minutes and its label.
3. Matrix: 4 targets × 3 profiles, using `plan_route` internals; a cell is minutes, `"?"` for `partly_unverified`, `"gap"` for `no_data`, `"blocked"` for `blocked`.

**Tests:** pytest on Elmina (types, labels, and the rule for "?").

**Commit:** `feat(spatial): devsim flood exposure and daily-life access matrix`

#### C6. Forty simulated residents (lane be-dev) — AC-C7

**Files:** `SP/devsim_residents.py` (new), `SP/devsim_models.py` (`SimResident`, `ResidentLines`), tests.

**Steps:**
1. Tower residents: from the tower `synthesize(...)` population already built in `build_cast` (:491). Neighbours: from residents whose home node lies in the C1 `homes` set (synthesise neighbours with `day/population.synthesize` restricted to those homes, or reuse the day population if it is cheaper; log a ruling).
2. Selection: `spotlight.choose`-style for a diverse mix of roles, ages, OKU/wheelchair, children, commuters. Force-include today's five cast members with their names and roles.
3. Facts per resident:
   - `extra_walk_min` (neighbours: from C1 for their home; tower: none);
   - `walk_min` to park, mall, clinic and school for their own profile (wheelchair if `wheelchair`, stroller if `toddler`, else default), with `"?"` handling as in C5.
4. Lines: a template library `devsim_lines.py` keyed by persona group × phase × tone (≥ 6 variants per key). Fill in numbers only from facts, and validate with `spotlight.check_text`-style allowed numbers. Every resident gets three lines. Seeded selection makes them deterministic, and no two residents get the identical triple.
5. Keep the Malaysian-English flavour; ≤ 220 characters; no banned words; no "safe".

**Tests:** AC-C7 in full.

**Commit:** `feat(spatial): forty simulated residents with fact-checked phase lines`

#### C7. Plan model, 45 s timeline, bubbles, checks, fixtures (lane be-dev) — AC-C8

**Files:** `SP/devsim_models.py` (`DevelopmentPlan` gets `impact: HoardingImpact`, `lorry_route`, `schedule`, `flood`, `access_matrix`, `residents: list[SimResident]`; `total_s=45`), `SP/devsim.py` (`build_beats`, `_bubbles` :587, `_end_card` :627 → removed or reduced to the brief; `check_plan` :765; `expected_numbers` :731), `AG/validate.py` `devsim_errors` (:1811), `AG/mock.py`/`template.py` devsim branch, fixtures, `test_devsim.py`.

**Steps:**
1. Retime acts and bubbles to spec §6.3:
   - Halim detour 5.5–9;
   - Farid 14–16.5;
   - worker 19.5–22.5;
   - Mei Ling keys 28.5–31.5;
   - Halim welcome 31–33;
   - Zainab park 34–37;
   - Arjun mall 36.5–39.
   - **Remove** the school-run bubble (#5) and its envelope beat.
2. Month mapping keys: playback seconds → schedule month. Hold at `raya_set_piece` for 2 s (11–13 s); slow through `monsoon_set_piece` (18.5–23 s); reach the handover month at 27 s.
3. `check_plan` and `expected_numbers` cover every number in the impact, schedule, flood, matrix, residents and bubbles.
4. API `POST /developments/simulate` returns the bigger plan (the cache stays). Run `pnpm gen`.
5. Regenerate the fixtures with `python -m townshiplens_spatial.devsim --dump …` into both fixture paths.
6. Re-record the devsim demo replay with the mock.

**Tests:** `uv run pytest packages/spatial/tests/test_devsim*.py packages/agent -q`; `pnpm golden` (`devsim-brief`).

**Commits:** `feat(spatial): 45 s development plan with impact, schedule, flood, access and residents`; `data: re-record devsim replay`

#### C8. Timeline bar and HUD (lane fe) — AC-W1, W2

**Files:** `W/features/devsim/timeline.ts` (new acts, no `feedbackBeats` envelope), `DevsimHud.tsx` (Month, Floors, Spent (est.), Days lost + footnote), new `ScheduleBar.tsx` (ticks, monsoon bands, Raya emphasis, now marker, legend), `copy.ts`.

**Steps:** port the prototype `#tl` and `#hud`. Holiday tooltips show the name plus "expected" when not gazetted.

**Tests:** jsdom tests for tick count, emphasis, legend and the HUD values at given t (AC-W1, W2 unit level).

**Commit:** `feat(web): devsim schedule bar and estimate HUD`

#### C9. Construction set pieces and detail (lane 3d) — AC-W3, W4

**Files:** `T/devsim/site.ts`, `T/devsim/cast.ts`, `T/devsim/devsimLayer.ts`, new `T/devsim/rain.ts`, new `T/devsim/pilingRig.ts`, `T/devsim/scaffold.ts` (new or inside `tower.ts`).

**Steps:**
1. **Piling rig** (3.5–8.5 s): a simple procedural rig (base + mast), moving between pile points on the footprint grid.
2. **Crane:** slew with a swinging load during work hours. During the Raya hold, freeze the slew, park the hook and hide workers and lorries. On monsoon "wet beats" (the 18.5–23 s window, every other 1.5 s), stop the slew.
3. **Lorries and mixers:** follow `plan.lorry_route` (replace the current `lorryPoses` :535 path source). Each lorry stays within 3 m of the polyline. Draw the route as a thin orange ribbon during 8.5–27 s.
4. **Scaffold and netting:** a box frame + translucent green netting from the podium top to the top built floor + 1 floor; it rises with the floors and is removed at handover.
5. **Rain** (`rain.ts`): one `Points` or instanced streak system around the site camera (≤ 3,000 drops). The sky and fog tint toward grey, using the existing mood blend in `mood.ts`/`lighting.ts` (no new tier cost when off).
6. Workers in high-vis keep today's cast. Site lights come on when the existing day/night cycle reaches night (keep it if it does not fight the rain; otherwise log a ruling and drop night during construction).
7. Hook `state()` exposes `crane.yaw`, `rain`, `rig.visible`, `lorries[]` positions, `scaffoldTop`, `topFloor`, `netting`.

**Tests:** vitest for scaffold height vs floors, the crane freeze window, and lorry distance to the route. Acceptance hook checks for AC-W3/W4 run in B11-style e2e (C13).

**Commit:** `feat(web): devsim construction set pieces — piling, crane holds, rain, scaffold, lorry route`

#### C10. Move-in scene (lane 3d) — AC-W5, P2

**Files:** `T/devsim/cast.ts` (movers), `T/devsim/tower.ts` (lit share), `T/devsim/site.ts` (boxes, moving lorries), new `T/devsim/moveIn.ts`.

**Steps:**
1. Two moving lorries drive in along the street to the entrance kerb (27–29.5 s) and park.
2. Boxes: ≥ 8 instanced boxes stack by the door, appearing over 29–31 s.
3. Residents: ≥ 10 movers walk from the lorries to the door carrying boxes (reuse `MOVERS` and raise it to 12), entering one by one and fading at the door.
4. Windows: drive the lit share (`uLitShare`) from 0 to ≥ 0.85 between 28 and 33 s, monotonic. An occupancy counter in the HUD follows the lit share × homes.
5. Cars: ≥ 6 cars from the A4 pool park in the tower car park (30–33 s).
6. Children: ≥ 4 child crowd looks play at the nearest playground after 32.5 s.
7. Hook `state()` exposes the counts.
8. Measure AC-P2 and log it.

**Commit:** `feat(web): devsim move-in — lorries, boxes, movers, lit windows, parked cars, kids`

#### C11. Impact Brief panel (lane fe) — AC-W6, W9

**Files:** `W/features/devsim/ImpactBrief.tsx` (new; replaces `EndCard` in the overlay), `DevsimOverlay.tsx`, `copy.ts`, `T/devsim/devsimView.ts` (view offset).

**Steps:**
1. Port the prototype `#brief`: sections and badges; every value comes from the plan; the flood line includes "Indicative scenario, not a forecast."; ESTIMATE and CALENDAR badges carry a source tooltip (from `SOURCES`).
2. Camera: from 33 s, shift the view (`camera.setViewOffset`, as in the prototype) so the tower's screen bbox is left of the panel (AC-W6). Expose `towerBbox` and `panelLeft` in the hook.
3. Remove `FeedbackBadge`/`Envelope` usage (the beat is gone), and the end card's "What residents raised" (replaced by the residents panel).

**Tests:** jsdom (sections, badges, flood copy, banned words).

**Commit:** `feat(web): devsim Impact Brief panel`

#### C12. Residents button, list and detail (lane fe) — AC-W7

**Files:** `W/features/devsim/residents/ResidentsButton.tsx`, `ResidentsPanel.tsx`, `ResidentDetail.tsx`, tests.

**Steps:**
1. Port the prototype `#resBtn`, `#resPanel` and `#detail`.
2. The button appears at 33 s. The scripted "tap" opens the panel at 39 s and Mei Ling at 41 s; this only happens while playing, and is skipped if the user already opened it.
3. Accessibility: a dialog role with a labelled heading; Escape closes; focus returns to the button; list items are buttons; Back returns to the list.

**Tests:** a jsdom test covering AC-W7.

**Commit:** `feat(web): simulated residents button, list and detail`

#### C13. Building e2e beats (lane fe) — AC-W2…W8

**Files:** `apps/web/e2e/demo-beats.spec.ts` (building section); update `apps/web/e2e/devsim.spec.ts` for the 45 s timeline.

**Steps:**
1. Using the regenerated `devsim-plan.json`, seek to the §6.3 midpoints and assert the overlays.
2. Assert the HUD at 8, 21 and 30 s.
3. Assert the hook values at 12 and 21 s (crane yaw delta, rain).
4. Assert move-in counts at 32.9 s; brief and tower bbox at 34 s; residents at 39, 41 and 45 s.
5. Bubble windows to ±0.05 s.

**Commit:** `test(web): building demo beats e2e`

### Verification

#### V1. Full checklist and performance (coordinator)

1. On `feat/demo-polish`, after all merges, run the seven CI steps with `set -o pipefail` and record each as PASS/FAIL/BLOCKED/NOT RUN.
2. Run vitest with the map keys blanked.
3. Run the acceptance specs `uturns.accept.ts` and the AC-P1/P2 measurements, and log the numbers.

#### V2. Comparison sheet and recordings (coordinator) — AC-X2, X3

1. Prototype timestamps: navigation at 2, 6, 11, 14.5, 17, 19, 25 and 35 s; building at 2, 7, 10, 12, 21, 30, 36 and 42 s. Capture the prototype with `window.__demo.seek(t)` and the app with `window.__tl.demo.seek(t)`, both at 1440×860.
2. Add rows L-1/L-2 (A3, FX on/off) and L-3 (A4 traffic with riders).
3. Build one HTML page: a table with prototype, app and verdict (matches / differs as expected + reason / missing). Publish it as a private artifact for the owner; read the `artifact-design` skill first.
4. Record two 45 s videos with the Playwright video option or the GIF tool (mock LLM, Stylised view, corridor question; building with the default brief).
5. Fix every "missing" row before the gate.

#### V3. Owner gate report

Report:
- the checklist table;
- mock-backed vs live (everything is mock-backed by design);
- implemented, merged on `feat/demo-polish`, not pushed to `main` until the owner passes the gate;
- the estimate sources table (C3);
- the rulings list;
- links to the sheet and recordings.

After the owner passes, merge to `main` with `--no-ff` and push, reporting any harness block.

---

## 3. Ruling log template

Add rulings to `.superpowers/sdd/demo-polish/ledger.md` and copy notable ones into the overnight log:

```
Ruling R<n> (<date time>): <what> — <why> — <cost if wrong>
```

Expected early rulings:
- B5 corridor pair
- B7 store shape
- B8 post-processing in split mode
- A3 skip-list vs depth material
- C6 neighbour population source
- C9 night during construction

## 4. Risks (see spec §11) and stop rules

- If AC-L1 cannot reach 0 on the Elmina extract because of data topology (unsnapped T-junctions), add mid-edge snapping of endpoints to nearby edges (≤ 1.5 m) in `roadGraph`. Do not relax the AC.
- If C3 cannot source a cost figure, show the duration and holidays, mark cost "Estimate unavailable — no published benchmark found", and tell the owner.
- If split-screen perf misses AC-P1 after dropping AO/DoF in split mode, lower DPR to 1 in split mode and log it. If it still fails, report to the owner and do not hide it.
