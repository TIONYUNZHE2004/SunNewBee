# Developer lens Development Simulation: implementation plan (parallel, overnight)

- Spec: [2026-10-21-developer-lens-development-simulation-design.md](../specs/2026-10-21-developer-lens-development-simulation-design.md). This plan breaks the spec's §12 into tasks. **The spec wins on any conflict.**
- Baseline: [prototype](../../03-product/prototypes/developer-lens/README.md)
- Log: [overnight-log-devsim.md](../overnight-log-devsim.md). Rulings go to the ledger `.superpowers/sdd/devsim/ledger.md` (gitignored).
- Mode: overnight and unattended, up to 20 h. **Never stop to ask the owner.** Decide, log a ruling, continue.

---

## 1. Shape of the run

```
T0 Contract (coordinator, sequential, ~45 min)
   │  schema + fixture + TS types + intent shape + StateAt interface + file ownership
   ▼
Wave 1 (parallel worktrees)
 ├─ BE      devsim.py, API, gen, pytest                 ~3 h
 ├─ AI      tool, mock, intent, validator, golden       ~2.5 h (recording waits for BE)
 ├─ FE      timeline, store, driver, overlays, list     ~5 h
 ├─ 3D      scene module, tower, kit, flow, camera      ~6 h (stubs StateAt until FE lands)
 ├─ ASSETS  Blender worker variant + fallback           ~1.5 h
 └─ QA      (coordinator) prototype probe, acceptance specs, contact sheet, recorder  ~2 h
   ▼
M1 merge BE → AI re-record → M2 merge FE + AI → GATE 1 → M3 merge ASSETS + 3D → GATE 2 → Finish
```

Estimated wall clock is about 12–13 h, which leaves 7 h of buffer inside the 20 h.

### 1.1 Why the parallel run is safe

- **Contract first.** T0 fixes every shape that crosses a lane: the plan schema, the intent payload, the `StateAt` type and the `probe()` shape. Lanes build against the T0 fixture and never wait on each other's code.
- **One owner per file.** The table in §3 gives every shared file a single owner. A lane that needs a change in another lane's file writes a request into the ledger. The coordinator applies it at merge time.
- **Generated files have one writer.** Only BE runs `pnpm gen` and commits `packages/api-client`. Other lanes never commit it.

### 1.2 Resource rules (8 GB RAM)

- At most **3 implementing subagents at once**: BE + FE + 3D, with AI and ASSETS starting as BE or FE frees up. The coordinator does QA itself.
- **Heavy work runs one at a time:** e2e, acceptance, Blender export, full `pytest -q`, `pnpm golden` and `vite build`. Lanes run only scoped tests (`pytest packages/spatial/tests/test_devsim.py`, `vitest run src/features/devsim`). The coordinator runs the full suite after each merge.
- Never run two dev servers on 5173. The visual gates use `townshiplens-dev-demo` (`.claude/launch.json`), which is mock + `DEMO_MODE`, in the **Stylised** view only.

---

## 2. Worktrees and branches

| Lane | Worktree | Branch | Base |
|---|---|---|---|
| coordinator | main repo dir, checkout `feat/devsim` | `feat/devsim` | `origin/main` at T0 |
| BE | `../SunNiuBi-wt/dv-be` | `devsim/be` | `feat/devsim` after T0 |
| AI | `../SunNiuBi-wt/dv-ai` | `devsim/ai` | same |
| FE | `../SunNiuBi-wt/dv-fe` | `devsim/fe` | same |
| 3D | `../SunNiuBi-wt/dv-3d` | `devsim/3d` | same |
| ASSETS | `../SunNiuBi-wt/dv-assets` | `devsim/assets` | same |

The old `j-*` worktrees belong to the journey work. Leave them alone.

**Each new worktree needs its own setup:**

```bash
pnpm install --frozen-lockfile && uv sync --all-packages --all-groups
```

`--all-packages` is required (see CLAUDE.md gotchas).

**Merging:** the coordinator merges into `feat/devsim` with `git merge --no-ff devsim/<lane>`, runs the checks for that merge point, and pushes `feat/devsim` to `origin`. **Never push to `main`, and never open a PR.**

---

## 3. File ownership

| File / area | Owner |
|---|---|
| `packages/spatial/src/townshiplens_spatial/devsim.py` (+ tests) | BE |
| `apps/api/src/townshiplens_api/routes/devsim.py`, router registration in the app factory, `apps/api/tests/test_devsim_api.py` | BE |
| `packages/api-client/**` (generated) | BE only |
| `packages/agent/src/townshiplens_agent/{mock,validate,template,events,agent,run,record}.py`, any new `tools` entry, `packages/agent/tests/test_devsim_*.py`, golden cases | AI |
| `data/demo/*.jsonl` (new recording) | AI (committed separately as `data:`) |
| `apps/web/src/features/devsim/**` except `three/` | FE |
| `apps/web/src/features/chat/chatReducer.ts`, `apps/web/src/features/scene/sceneStore.ts` (intent → store) | FE |
| `apps/web/src/features/assistant/{AssistantPanel.tsx,starters.ts}` + the paperclip component | FE |
| `apps/web/src/features/scene/list/**` (text version) | FE |
| `apps/web/e2e/devsim.spec.ts`, `apps/web/e2e/fixtures/devsim-plan.json` | FE (fixture content comes from BE output) |
| `apps/web/src/features/scene/three/devsim/**` (new), `apps/web/src/features/scene/three/intents.ts`, the mount hook in `ThreeScene.tsx` / `engine.ts` | 3D |
| `apps/web/src/features/scene/three/motion/**` changes (flow speed and density) | 3D |
| `assets/blender/tl_assets/**`, `apps/web/public/city/characters/crowd_worker*.glb`, manifest entries | ASSETS |
| `docs/03-product/prototypes/developer-lens/index.html` (adding `probe()` only), `apps/web/acceptance/ac-dv-*.accept.ts`, `scripts/devsim/*` (contact sheet, recorder) | coordinator (QA) |
| `docs/03-product/demo-script.md`, `apps/web/README.md`, `packages/spatial/README.md`, `docs/03-product/mvp-spec.md` | coordinator (Finish) |

---

## 4. Tasks

Each task gives the files, the steps, the tests, the AC it serves, and a **done-when** condition. Commit after each task with the conventional scope shown.

### T0 — Contract (coordinator, sequential, ~45 min)

**T0.1 Branch and ledger** (5 min)
- `git fetch && git switch -c feat/devsim origin/main`.
- Create `.superpowers/sdd/devsim/ledger.md` with the headings: RESUME POINT, Rulings, Lane requests, Gate results.
- Append the start entry to `docs/superpowers/overnight-log-devsim.md` with `date`.
- Done when: the branch exists and the log has its start entry.

**T0.2 Plan schema** (20 min). File: `packages/spatial/src/townshiplens_spatial/devsim_models.py`.
- Write the Pydantic models only, with no logic:
  - `DevelopmentBrief`
  - `DevelopmentSite` (parcel_id, footprint, storeys, homes, entrance {door, facing_deg, path}, kanopi_clearance_m)
  - `DevsimFacts` (detour {home_id, edge_id, before_m, after_m, detour_min, before_path, after_path}, park {m, min, path}, mall {m, min, path}, profile, provenance)
  - `SpotlightCast` (id, name, role, persona, home: "tower" | "existing", colour)
  - `Bubble` (n, who, t0, t1, tone: "pos" | "neg", text, tag | None)
  - `Act` (name, t0, t1)
  - `EndCardItem` (text, badges)
  - `DevelopmentPlan` (world, site, facts, cast, households, acts, bubbles, anchors {halim_path, farid, junction, park, mall}, end_card, labels, total_s = 66)
- Coordinates are lon/lat.
- Done when: `uv run python -c "import townshiplens_spatial.devsim_models"` works and ruff is clean.

**T0.3 Provisional fixture** (10 min). File: `apps/web/src/features/devsim/fixtures/plan.provisional.json`.
- Fill it from the prototype's `scene.js` facts and `index.html` `ACTS`/`BUBBLES`, in the T0.2 shape. Put `"provisional": true` at the top level.
- BE replaces it later with the real Elmina output (`plan.elmina.json`).
- Done when: it validates against `DevelopmentPlan`. Use a one-off check with `DevelopmentPlan.model_validate_json`.

**T0.4 TS mirror and intent** (10 min). File: `apps/web/src/features/devsim/types.ts`.
- Mirror the plan type by hand, matching the generated names that `pnpm gen` will produce (so FE/3D can swap to `components["schemas"]["DevelopmentPlan"]` later).
- Intent payload: `{ kind: "development.play", plan?: DevelopmentPlan, brief_text: string }`.
- `StateAt`, the output of `stateAt(t, plan)`:
  - `act`, `simClock {label, month?, week?, day?, hhmm?}`, `sun {phase01, elevation, isNight}`, `occupancy`, `floorsBuilt`, `workersActive`, `windowsLitFraction`, `hoarding`, `crane {slewRad, beaconOn}`, `lorries`, `movers {queueProgress}`, `bubbles: {n, who, text, tag}[]`, `feedbackCount`, `envelope {progress} | null`, `camera {target: [lon, lat, h], offset: [e, n, u]}`, `flow {timeScale, peopleDensity, vehicleDensity}`, `endCard: boolean`.
- `Probe` (the `window.__devsim.probe()` return): `{ t, rects: {tower?, speaker?, bubble?, hypotheticalLabel?, simBadge?}, people: [x, y][], vehicles: [x, y][], cameraInsideBuilding: boolean, windowsLitFraction, fps? }`. Rects are in CSS px relative to the stage.
- Done when: `pnpm -r --if-present typecheck` passes.

**T0.5 Commit, push, worktrees** (5 min)
- Commit with `feat(devsim): contract — plan schema, provisional fixture, TS types` and push `feat/devsim`.
- Create the 5 worktrees (§2) and run setup in each.
- Write RESUME POINT = "Wave 1 started".
- Done when: all worktrees build their typecheck.

### Lane BE (`devsim/be`, ~3 h)

**BE1 Port site placement** (45 min). File: `devsim.py`, function `place_tower(world) -> DevelopmentSite`.
- Port from the prototype's `build_scene.py`: the parcel `way/1564861412` from the seed landcover, the north-east corner nearest the mall `way/1308938137`, a ~30 × 30 m footprint (match the prototype), the door facing the nearest walk node, and the entrance path polyline.
- Assert that the footprint is inside the parcel and that `kanopi_clearance_m ≥ 200` against `way/1314193194`.
- Raise `DevsimUnavailable` if the parcel is missing.
- Tests (`packages/spatial/tests/test_devsim.py`): placement inside the parcel, the clearance check (AC-H5), and that the tiny fixture raises (AC-H6).
- Done when: the tests pass on the Elmina seed and the tiny fixture.

**BE2 Facts** (60 min). Function: `compute_facts(world, site) -> DevsimFacts`.
- **Detour:** search homes (residential buildings within 600 m, snapped to the walk network) whose `default`-profile route to `park-b` uses a frontage edge of the parcel. For each candidate edge (start with `seg-910300105-0`), compute the route before and after `twm.ClosePath`.
  - Pick the pair with the largest real detour of at least 2 min. Tie-break on the home nearest the site, then the lowest id, so the result is deterministic.
  - Record `before_m`, `after_m`, `detour_min = round((after_s - before_s) / 60)` and both paths.
  - Detect whether the detour switches sidewalk side. Expose `detour_side_switch: bool` so bubble 1's copy can be checked.
- **Walks:** compute park and mall walks from the entrance's snapped node with `routing.plan_route`, using the existing Urban Park and Lakeside Mall place ids. Look them up by name in `world.places`; do not hard-code ids that the place-scoping change (`b1b47d77`) may have renamed.
- **If no detour ≥ 2 min exists:** set `detour=None` and log that a ruling is needed (spec §13).
- Tests: AC-H1 (the facts equal a direct `plan_route` recomputation; `detour_min ≥ 2` or `None`); a determinism test (two runs give identical output).
- Done when: the tests pass. Print the facts in the test output so the log can quote them.

**BE3 Cast and households** (30 min). Function: `build_cast(world, site, seed=21) -> (households_count, cast)`.
- Use `day/population.py` to generate the tower's households (about 500, seeded). Use the `day/spotlight.py` naming helpers for roles.
- **Baseline names are fixed:** Halim (existing, home = the detour home), Mei Ling (+ child), Zainab, Arjun, Farid (passer-by, not a resident). If the generator can't produce these names, override them and note it in the ledger.
- Tests: the count is between 450 and 550; the cast names equal the baseline; the output is deterministic.
- Done when: the tests pass.

**BE4 Beats, copy and check** (40 min). Functions: `build_beats(...)`, `check_plan(plan)`, `build_development_plan(world, brief)`.
- Acts come from spec §4.2.
- Bubbles come from spec §4.3, with facts substituted. Bubble 1 takes the side-switch copy only if `detour_side_switch`; otherwise it uses the truthful alternative from the ledger ruling.
- Bubble 7 follows the copy rule (`mall_min ≤ 5`, 6–12, or >12).
- The end card comes from §4.5. Anchors are lon/lat points along the computed paths, or prototype-equivalent spots: Halim's walk is the detour path near the site; Farid is by the hoarding; the junction is where the entrance path meets the street; the park spot is where the park route arrives; the mall spot is where the mall route meets the mall footprint.
- `check_plan` rejects:
  - any digit run in bubble, tag or end-card text that isn't in the set of fact values;
  - any digit in bubbles 2–5;
  - the banned words (safe, selamat, 安全, depth, flood) — case-insensitive, whole-word for the English ones.
- Tests: AC-H2 (a hypothesis property test mutates numbers and must fail the check; the valid plan passes) and AC-H4.
- Done when: `uv run pytest packages/spatial/tests/test_devsim.py -q` is green.

**BE5 API and generated client** (30 min). Files: `apps/api/src/townshiplens_api/routes/devsim.py` (`POST /developments/simulate`, body `{brief_text?: str}`, response `DevelopmentPlan`, 404 on `DevsimUnavailable`), registered next to `routes/day.py`.
- Cache per world (the plan is deterministic).
- Tests in `apps/api/tests/test_devsim_api.py`: 200 on Elmina with the shape asserted, 404 on the tiny fixture with the message from spec §5.1.
- Run `pnpm gen`, check the `schema.d.ts` diff, and commit the generated client in the same commit.
- Write `plan.elmina.json`: run `uv run python -m townshiplens_spatial.devsim --dump apps/web/src/features/devsim/fixtures/plan.elmina.json` (add a small `__main__`).
- Also copy it to `apps/web/e2e/fixtures/devsim-plan.json`. This one path is coordinated: BE writes it, FE owns the spec that uses it.
- Done when: the API tests pass, `pnpm gen && git diff --exit-code packages/api-client` is clean after the commit, and both fixtures are written. Log the final facts in the ledger.

### Lane AI (`devsim/ai`, ~2.5 h; the recording waits for M1)

**AI1 Intent event** (30 min)
- Add `development.play` to the scene-intent types in `events.py`, mirroring how `journey.play` is declared and serialised.
- Tests: serialisation round-trip (`packages/agent/tests/test_devsim_intent.py`).
- Done when: the tests pass.

**AI2 Tool** (30 min)
- Add `simulate_development` as a tool wrapping `devsim.build_development_plan(world, brief)`. Register it where the agent's tools are registered (find where journey tools are wired in `agent.py` / `run.py`).
- It records the plan's facts in `TurnRecord` so the validator can check the answer's numbers.
- Done when: a unit test calls the tool on Elmina and gets a plan, using the BE fixture if BE hasn't merged yet. Mark the test `@pytest.mark.skipif` if the seed is missing.

**AI3 Mock branch, validator and template** (60 min)
- **Mock (`mock.py`):** a message equal to (or containing, case-insensitive) the fixed brief, "Simulate a 30-storey, 500-home tower near Lakeside Mall, from construction to daily life", calls `simulate_development`. It then answers with:
  - the restated brief line, "Brief: 30 storeys · ~500 homes · parcel near Lakeside Mall";
  - one sentence: "This is an illustrative simulation of a hypothetical development, not a forecast and not an SDP project; walking times come from the mapped routes.";
  - an emitted `development.play` intent carrying the plan.
- **Validator (`validate.py`):** answers that call this tool must contain "illustrative" and "not an SDP project", and must not contain banned words. Any numbers must be in `TurnRecord`.
- **Template (`template.py`):** a fallback with the same content.
- Tests: `test_devsim_answer.py`. The mock answer passes the validator, the template passes the validator, and a tampered answer (a number changed) fails.
- Done when: `uv run pytest packages/agent -q -k devsim` is green.

**AI4 Golden** (20 min)
- Add a golden case with `world: elmina`, the question equal to the brief, expecting the tool call, the `development.play` intent and "illustrative".
- Done when: `pnpm golden` is green. It is a heavy run, so ask the coordinator for a slot, or run only this case if the runner supports filtering.

**AI5 Record replay** (20 min, **after M1**)
- In `feat/devsim` after the BE merge (the coordinator rebases `devsim/ai` onto it), run:

  ```bash
  LLM_PROVIDER=mock uv run python -m townshiplens_agent.cli --record "Simulate a 30-storey, 500-home tower near Lakeside Mall, from construction to daily life" --profile default
  ```

- Check that `meta.world == "elmina"` in the new jsonl.
- Commit it separately: `data: record the developer-lens brief replay (mock)`.
- Done when: with `DEMO_MODE=true`, the same text replays and emits `development.play`, checked with a test or a curl to `/chat`.

### Lane FE (`devsim/fe`, ~5 h)

**FE1 Timeline** (75 min). File: `apps/web/src/features/devsim/timeline.ts` (+ `timeline.test.ts`).
- Write `stateAt(t, plan): StateAt` as a pure function. Follow `features/journey/timeline.ts`.
- **Constants from the prototype:**
  - Construction cycle period 2.8 s × 10, months 1→24.
  - Handover is ~1.85 cycles ending at dawn.
  - Daily Life is 07:00 → ~19:40 over 44–63 s.
  - Floors rise only while `sun.isNight` is false, reaching 30 by t = 32.
  - `windowsLitFraction` is 0 before 32 (Q4) and climbs floor by floor in Handover.
  - Occupancy climbs 0 → households over Handover, and about +2% per Daily Life to 488/500 at the end (the prototype's display values).
  - `feedbackCount` steps 0 → 1 when the envelope lands, about 1.2 s after bubble 5 starts.
- **Flow curve (spec §7):** `timeScale` is about 8× during the Construction and Handover cycles and 1× in Daily Life. `peopleDensity` and `vehicleDensity` follow the sun (day ≥ 2× night), with a morning peak in Daily Life.
- **Camera:** port the prototype `CAM` keyframes as `{t, targetAnchor, offset}`, with targets resolved from `plan.anchors` and `plan.site`, and eased interpolation.
- Tests:
  - AC-F1: acts and bubble times equal spec §4.2/§4.3 ±0.5 s, and bubble texts equal the plan's;
  - AC-F2: cycles, months, dawn at the end of Handover, the Daily Life clock;
  - Q4: `windowsLitFraction` is 0 before 32;
  - the flow curve: day ≥ 2× night;
  - determinism: same t, same state.
- Done when: `pnpm --filter @tl/web exec vitest run src/features/devsim/timeline.test.ts` is green.

**FE2 Store and driver** (45 min). Files: `devsimStore.ts` (zustand: plan, t, playing, status) and `useDevsimDriver.ts`. Follow `journeyStore.ts` and `useJourneyDriver.ts`.
- Play, pause, seek, restart and end at the total.
- Expose `window.__devsim = {seek, play, pause, total, acts, facts, probe}` in dev and test builds. FE's `probe` returns the DOM rects (bubbles, labels, badge). 3D registers a hook that fills the tower, speaker, people, vehicles, `cameraInsideBuilding` and fps.
- **Intent wiring:** `chatReducer.ts` handles `development.play` the way `journey.play` is handled, and `sceneStore` gets a `devsim` slice. If the intent has no plan, fetch `POST /api/developments/simulate`.
- Tests: store transitions; a reducer test for the intent (follow `chatReducer.test.ts`); AC-F6 (seeking backwards gives the same state).
- Done when: the scoped vitest is green.

**FE3 Overlays** (90 min). Files: `DevsimOverlay.tsx`, `DevsimHud.tsx`, `SimBadge.tsx`, `HypotheticalLabel.tsx`, `Bubble.tsx`, `RouteTag.tsx`, `FeedbackBadge.tsx` + envelope, `EndCard.tsx`, `PlaybackBar.tsx`, `DevsimMount.tsx`. Follow `JourneyOverlay.tsx`, `JourneyHud.tsx`, `SimulationLabel.tsx` and `JourneyMount.tsx`.
- Bubbles and the hypothetical label are positioned from screen points that the 3D lane provides through a `useDevsimAnchors()` store, fed by 3D's projection each frame. Without 3D (list or tests), bubbles render in a fixed stack.
- **Copy:** exact copy from the plan. The HUD shows Act · simulated time · homes occupied. The labels are "Simulation · illustrative", "Hypothetical development · not an SDP project · 30 storeys · ~500 homes", and the existing "Decorative details are illustrative.".
- Use the app's design tokens and work in light and dark themes. The layout must not overlap the HUD, the playback bar or the assistant panel (AC-C2). Use `useMapInsets` like the journey overlays.
- **Tests (`*.dom.test.tsx`, jsdom):**
  - the end card copy (§4.5);
  - badge and label presence;
  - the RouteTag text;
  - the envelope counter going 0 → 1 (AC-F5);
  - contrast tokens ≥ 4.5:1 for bubble and label text (Q3 DOM part; a computed-style test or a token-pair table test).
- Done when: the tests are green.

**FE4 Composer paperclip and starter** (40 min). Files: `AssistantPanel.tsx` (Management only), new `AttachBrief.tsx`, `starters.ts`.
- A paperclip button opens a hidden file input. The chosen file's name shows as a chip with a PDF badge, removable. On submit with a chip, it sends the fixed brief text (and still shows the user bubble with the chip). Nothing is uploaded.
- Add the Management starter with the brief text.
- Tests: a DOM test (choosing a file shows the chip; send calls `send(fixedBrief)`; no `fetch` with the file body); the starter is present in management mode.
- Done when: the tests are green.

**FE5 List and no-WebGL text version** (30 min). Location: `features/scene/list/`.
- When devsim is active, show the act list, the bubbles as quotes with speaker and tag, and the end card.
- On 404 from the API, show "Development simulation is not available for this map." (AC-H6 UI).
- Tests: `listModel` tests or a DOM test.
- Done when: the tests are green.

**FE6 e2e** (45 min). File: `apps/web/e2e/devsim.spec.ts`.
- List view. Stub `POST /api/developments/simulate` with `e2e/fixtures/devsim-plan.json`. Use the tiny fixture with the mock: the mock branch still emits the intent, the plan comes from the stub.
- Steps: switch to Management → click the starter → the assistant reply contains "illustrative" → `__devsim.seek(66)` → the end card is visible with the 3 items. A second test uses the paperclip (`setInputFiles`) → send → playback starts (AC-F4).
- A 404 test without the stub shows the "not available" message.
- Done when: `pnpm --filter @tl/web exec playwright test devsim` is green. Get a heavy slot from the coordinator first.

### Lane 3D (`devsim/3d`, ~6 h)

Until FE merges, use `fixtures/plan.provisional.json` and a local stub `stateAt` (a copy of the prototype logic, deleted at M2). After M2, rebase and switch to FE's `timeline.ts`.

**3D1 Mount and projection** (45 min). Files: `scene/three/devsim/devsimLayer.ts` (create/update/dispose) and the hook into `engine.ts` / `ThreeScene.tsx`, following how `scene/three/journey/` is mounted (`engine.journey.test.ts`).
- Each frame: read `StateAt`, update the objects, and project the anchors (tower top, speaker heads, label point) to screen into `useDevsimAnchors`.
- Fill `probe()`: the tower rect (projected bbox), the speaker rect, people and vehicle screen samples, `cameraInsideBuilding` (test the camera position against building footprints and heights from the city plan plus the tower), and fps (a rolling average from `frameStats.ts`).
- Tests: `engine.devsim.test.ts` (mount and dispose without leaks, using the journey pattern).
- Done when: the tests are green.

**3D2 Tower and entrance** (75 min). File: `devsim/tower.ts`.
- Instanced floor slabs up to 30, from the site footprint. Use the facade and window material from `scene/three/facade/` so it matches neighbouring buildings.
- Add a scaffold band (`scaffold_bay` from the kit) on the top floors while building.
- `windowsLitFraction` drives the window emissive per floor. It must be exactly 0 before Handover, and floodlight light must not tint the windows (use a separate light layer, or exclude the tower from the floodlight `SpotLight` / point lights) — this fixes the prototype issue.
- The entrance gets glass doors, a canopy on posts, and a paved path mesh along `site.entrance.path`.
- Tests: the floor count follows `floorsBuilt`; the window emissive is 0 when the fraction is 0.
- Done when: the tests are green, plus a screenshot at t = 30 and t = 40 in the dev demo, looked at.

**3D3 Construction kit and site** (60 min). File: `devsim/site.ts`.
- From `kits/construction.glb`: tower_crane (slew by `crane.slewRad`, blinking beacon), hoarding_6m along the closed edge and the parcel frontage, material_stack ×4–6 in the yard, cement_mixer (drum spins by day), site_cabin, and floodlights (on at night, aimed at the yard).
- Draw the closed edge as a red strip and the detour as a dashed line, using the existing route-strip style (`overlays/`), with `polygonOffset` against z-fighting (Q6).
- At Handover the hoarding, crane and kit are removed (a quick fade). Lorries ×3 use existing vehicle models and park at `anchors.junction`.
- Done when: a dev-demo screenshot at t = 10 (day) and t = 11.5 (night) has been looked at.

**3D4 Characters** (75 min). File: `devsim/cast.ts`.
- **Spotlight cast:** GLB crowd/hero models (`public/city/characters/`, `crowd_*.glb` via `crowdBake.ts`). Halim is `older_man`, Mei Ling `adult_woman` plus a child, Zainab `older_woman` (tudung outfit if available), Arjun `adult_man`, Farid `adult_man`. Name tags use the `detailBubble.ts` style or a DOM tag fed through the anchors. Colours come from the plan.
- **Scripted movement:** Halim walks `anchors.halim_path` from 17.2 to 21.6 s; Farid stands near the hoarding; movers queue along the entrance path and enter the door one by one (32–44 s); Halim and Mei Ling face each other at the door (40.2–43.2 s); residents exit the door at 44–47 s; the school-run car queue sits at the junction (47–51.6 s); Zainab at the park spot; Arjun at the mall spot. Use the walk and idle clips.
- **Workers:** the ASSETS lane's `crowd_worker.glb` (or its fallback). 6–10 workers walk between the stacks and the tower foot by day and are hidden at night.
- Done when: dev-demo screenshots at 19, 24, 37, 41, 48, 54 and 60 s have been looked at.

**3D5 Fast-forward flow** (60 min). Files: `motion/` (`agents.ts`, `crowdRenderer`, traffic).
- Add a `flow` input: `timeScale` multiplies agent speed, and density scales the active count.
- While devsim is active, the normal decorative motion yields to it (the way Elmina Day fades it in `useMotion.ts`).
- People avoid the closed edge (remove it from their walkable set). Vehicles stream on the roads near the site.
- Tests: a unit test where `timeScale` 8 moves agents 8× per second; density day ≥ 2× night.
- Done when: AC-F3 passes in the acceptance run (QA2), or the coordinator confirms it with the probe in the dev demo.

**3D6 Lighting and camera** (45 min)
- Drive `mood.ts`, `sky.ts` and `lighting.ts` from `StateAt.sun` while devsim is active (the same override path Elmina Day uses; ADR 0011). Street lights and window glow come on at dusk and night.
- Camera: apply `StateAt.camera`. Clamp it with `clearance.ts` / `cameraFit.ts` so `cameraInsideBuilding` stays false (Q2). If a beat can't frame its subject because of occluders, raise the camera height and log a ruling.
- Done when: the Q2 probe sweep shows no inside-building frames. Run it in QA2.

### Lane ASSETS (`devsim/assets`, ~1.5 h, time-boxed at 90 min)

**AS1 Worker variant**
- In `assets/blender/tl_assets/`, add a `worker` outfit to the adult-man crowd model: a yellow hard hat and an orange hi-vis vest with reflective stripes. Export it as `apps/web/public/city/characters/crowd_worker.glb` with the same rig and the walk/idle clips, and add the manifest entry to `crowd.json`.
- Follow the existing pipeline's commands; read `assets/blender/README` or the `props.py` header.
- Done when: the GLB loads in a vitest that loads the manifest (or a Node GLTF parse), and the file size is under 400 KB.

**AS2 Fallback, if AS1 isn't done at 90 min**
- Write a runtime `workerDress.ts` in `scene/three/devsim/` that attaches a hat (a cylinder plus brim) and a vest (a tapered box with emissive stripes) to the `adult_man` skeleton's head and spine bones.
- Log the ruling. The 3D lane may take this over.

### Lane QA (coordinator, parallel with Wave 1, ~2 h)

**QA1 Prototype probe** (30 min)
- Add `window.__devsim.probe()` to `docs/03-product/prototypes/developer-lens/index.html` with the same `Probe` shape: the tower rect, the speaker rect (the current bubble's speaker) and the bubble rect.
- Done when: a Playwright call returns rects at all 12 baseline times. Save them as `apps/web/acceptance/fixtures/devsim-prototype-probe.json`.

**QA2 Acceptance specs** (60 min). File: `apps/web/acceptance/ac-dv.accept.ts`, run with `pnpm --filter @tl/web acceptance` against the running `townshiplens-dev-demo`, in the Stylised view. Check the config's base URL and port. It covers:
- **AC-H3:** a sweep from 0 to 66 in 0.25 s steps; whenever the tower rect intersects the stage, the hypothetical label rect is present.
- **AC-C1:** at the 12 times, the subject centre is within 10% of the stage width of the prototype fixture.
- **AC-C2:** the bubble rects are inside the stage and don't overlap the HUD, the playback bar or the panel.
- **AC-F3:** flow, measured per spec §7.
- **Q1:** fps.
- **Q2:** no `cameraInsideBuilding`.
- **Q3:** the luminance ring check at the dusk and night beats (t = 11, 41, 60, 65), from screenshots.
- **Q4:** the lit-window fraction is 0 before 32.
- **Q5:** console errors and warnings during the sweep.

Write the results to `.superpowers/sdd/devsim/acceptance-<gate>.json`.

**QA3 Contact sheet and recorder** (30 min). Files: `scripts/devsim/contact_sheet.mjs` and `scripts/devsim/record.mjs`.
- Seek both pages (the prototype on 5191, the product on 5173) to the 12 times, screenshot them, and compose a 2-column grid PNG with time labels (sharp or a canvas, whichever is already a dependency; else plain HTML plus a Playwright screenshot of it).
- The recorder writes a Playwright video of the full 66 s at 1440×860 for each page.
- The output goes to the session scratchpad. Never commit it.
- Done when: both scripts run against the prototype alone.

---

## 5. Merge points and gates (coordinator)

**M1 — BE merged** (target about T0 + 3.5 h)
1. `git merge --no-ff devsim/be` into `feat/devsim`.
2. `uv run pytest -q`, then `pnpm gen && git diff --exit-code packages/api-client`.
3. Push.
4. Rebase AI, FE and 3D onto `feat/devsim` (each lane rebases itself when told; record this in the ledger).
5. Replace the provisional fixture use with `plan.elmina.json` in FE and 3D.
6. Unblock AI5 (the recording).

**M2 — AI + FE merged, then GATE 1** (target about T0 + 6 h)
1. Merge `devsim/ai`, then `devsim/fe`. Resolve any intent-type overlap in favour of the T0 contract.
2. Run the full CI checklist (§6).
3. **GATE 1** (List + early 3D):
   - e2e devsim green (AC-F4, H6);
   - the timeline tests (F1, F2, F6);
   - the DOM tests (F5, C2 DOM part);
   - a dev-demo run on the Elmina seed: send the starter → playback → end card. Whatever 3D has merged so far is fine.
   - Record the results in the log.

   A FAIL becomes a fix task for the owning lane before M3.

**M3 — ASSETS + 3D merged, then GATE 2** (target about T0 + 9.5 h)
1. Merge `devsim/assets`, then `devsim/3d` (rebased on M2).
2. Run the full checklist.
3. **GATE 2:** QA2 acceptance in full, plus the QA3 contact sheet, plus a look at every one of the 12 frames. Any frame that looks wrong is a FAIL even if the numbers pass.
4. Loop: fix → re-run, at most 3 loops per failing item. After that, log it as FAIL with the reason and move on.

**Finish** (about 2.5 h)
- **F1 Docs:** add a developer-lens section with a presenter note to `demo-script.md` ("Upload is front-end only; the sample brief plays. Say so if asked."); update `apps/web/README.md` (devsim feature) and `packages/spatial/README.md` (`devsim.py`); add a status line to `mvp-spec.md`.
- **F2:** the full CI checklist with `set -o pipefail`. Also run vitest with the map keys blanked: `GOOGLE_MAPS_API_KEY= CESIUM_ION_ACCESS_TOKEN= MAPBOX_ACCESS_TOKEN= pnpm -r --if-present test`.
- **F3 Evaluator:** spawn the `evaluator` agent with this spec, this plan, the acceptance JSON and the contact sheet. It scores every AC and Q. Fix anything below PASS, or report it as FAIL.
- **F4:** record both videos (QA3) and make the final contact sheet.
- **F5:** push `feat/devsim`, write the final report (spec §12.5) into the log and the final message, and set RESUME POINT = "Done".

---

## 6. CI checklist (run after every merge point)

```bash
set -o pipefail
pnpm lint
uv run pytest -q
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm gen && git diff --exit-code packages/api-client
pnpm golden
pnpm --filter @tl/web e2e
```

Report each step as PASS / FAIL / BLOCKED / NOT RUN, with the tail of any failure, in `overnight-log-devsim.md`.

---

## 7. AC → task map

| AC / Q | Tasks |
|---|---|
| H1 | BE2 |
| H2 | BE4, AI3 |
| H3 | FE3, 3D1, QA2 |
| H4 | BE4, AI3 |
| H5 | BE1 |
| H6 | BE1, BE5, FE5, FE6 |
| F1 | FE1 (+ BE4 copy) |
| F2 | FE1 |
| F3 | FE1, 3D5, QA2 |
| F4 | AI3, AI5, FE2, FE4, FE6 |
| F5 | FE1, FE3 |
| F6 | FE2 |
| C1 | 3D6, QA1, QA2 |
| C2 | FE3, QA2 |
| C3 | QA3 |
| Q1 | 3D1, QA2 |
| Q2 | 3D6, QA2 |
| Q3 | FE3, 3D6, QA2 |
| Q4 | FE1, 3D2, QA2 |
| Q5 | QA2 |
| Q6 | 3D2, 3D3, GATE 2 |

## 8. Resume protocol (after a context reset)

1. Read the ledger's RESUME POINT, then `git log --oneline feat/devsim -30` and `git worktree list`.
2. Trust the ledger plus `git log` over memory (CLAUDE.md).
3. Check which lanes have unmerged commits: `git log feat/devsim..devsim/<lane>`.
4. Continue from the first incomplete merge point or gate.
