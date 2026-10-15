# MVP P0 Increment 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the next unblocked P0 items from [mvp-spec](../../03-product/mvp-spec.md) on top of the walking skeleton:
- **G-03/G-04:** the resident-agent batch runner and gap ranking.
- **C-10:** a `DEMO_MODE` cache.
- **P-04:** place cards.
- **M-03 (+ the M-02 audit):** the attribute editor with an audit log.

**Architecture:** This reuses the skeleton's seams. Deterministic engines live in `packages/spatial`, REST in `apps/api`, the agent in `packages/agent` and the UI in `apps/web`. No new dependencies.

**Tech Stack:** as the walking-skeleton plan (Python 3.13, FastAPI, NetworkX, PydanticAI, React 19, Cesium/Resium, Mapbox).

**Spec:** [platform walking-skeleton spec](../specs/2026-10-15-platform-walking-skeleton-design.md) §9 lists these as stubs. The behaviour comes from [resident-agents-design](../../04-architecture/resident-agents-design.md), [mvp-spec](../../03-product/mvp-spec.md) (G-03, G-04, C-10, P-04, M-03, M-02 audit) and [api-contract](../../04-architecture/api-contract.md) (`POST /simulations`, `GET /simulations/{id}`, `PATCH /elements/{id}/attributes/{key}`, `GET /audit`).

## Global Constraints
- The walking-skeleton plan's Global Constraints apply unchanged (canonical names, statuses, env vars, flood copy rules, no secrets, no model names in code, commit + push only after checks).
- The full integration checklist runs before every push: pytest, `pnpm golden`, web vitest, lint, `pnpm gen && git diff --exit-code packages/api-client`, typecheck, web build, e2e.
- No dependency or lockfile changes.

## Review Focus
1. **A simulation run on an empty or stub profile** (`drive`) → its journeys come back as `no_data`, with no crash. Pinned in T15.
2. **The same gap found by many journeys** → one ranked gap with impact N, not N gaps. Pinned in T15.
3. **A demo cache miss** (question not in the cache) → falls through to the live/mock agent; `DEMO_MODE` never fabricates an answer. Pinned in T16.
4. **An attribute edit with a wrong type, or without a staff token** → 422 / 401 / 503 as in resolve, with no partial write and no audit row. Pinned in T18.
5. **A place card for a place with no claims** → shows "No facts recorded yet" and does not crash. Pinned in T17.

---

### Task 15 (BE): Resident-agent batch runner and gap ranking (G-03, G-04)

**Files:** Create `packages/spatial/src/townshiplens_spatial/sim.py`, `packages/spatial/tests/test_sim.py`. Modify `apps/api/src/townshiplens_api/store.py` (or the module holding the SQLite helpers) to add a `sim_runs` table, plus `apps/api/src/townshiplens_api/routes/sim.py` and `apps/api/tests/test_sim_api.py`. Regenerate `packages/api-client`.

**Interfaces (produces):**
- `sim.default_tasks(world) -> list[Task]`, where `Task = {id, profile, from_id, to_id, scenario_id|None}`. The tasks are every pair in (places of type parking|drop_off|bus_stop) × (facility places + toilets), for each of the profiles stroller, wheelchair and older_adult_rest. The list is capped at 300, ordered deterministically.
- `sim.run_suite(world, tasks, scenario_id=None) -> SimReport`, where `SimReport = {run_id, created_at, scenario_id, counts: {profile: {outcome: n}}, results: [{task_id, outcome, route_id?, unknowns: [...]}], gaps: [{element_id, attribute, impact, affected_profiles, example_task_ids}], invariant_violations: [{invariant, task_id, detail}]}`.
- `outcome` mapping: confirmed → `success`, partly_unverified → `success_with_unknowns`, blocked → `blocked`, no_data → `no_data`.
- **Gap impact** = the number of tasks whose status would improve to `confirmed` if that (element, attribute) were PASS. Compute it by flipping one unknown claim at a time to a verified passing value on a **deep copy** of the affected edge (never mutate `world`), then re-running `plan_route` for only the tasks that listed it. Sort by impact desc, then element_id. Cap at 20.
- **Invariants checked** (record violations, never raise):
  - I1: no FAIL edge in a returned route;
  - I2: every non-PASS segment of a route appears in `unknowns`;
  - I7: for older_adult_rest, `max_gap_between_rest_m` ≤ `max_rest_free_run_m` (otherwise record `rest_gap_exceeds_limit`).
- **API:** `POST /simulations {scenario_id?: str, profiles?: [...]}` → `SimReport` (synchronous; guarded by the staff token like resolve). `GET /simulations/{run_id}` → the stored report (404 if missing). `GET /simulations?limit=5` → summaries.

**Tests (write first):**
```python
def test_default_tasks_deterministic(world):
    a, b = sim.default_tasks(world), sim.default_tasks(world)
    assert a == b and a and {t["profile"] for t in a} <= {"stroller", "wheelchair", "older_adult_rest"}

def test_run_suite_outcomes_and_gap(world):
    tasks = [{"id": "t1", "profile": "stroller", "from_id": "park-b", "to_id": "kiosk", "scenario_id": None},
             {"id": "t2", "profile": "wheelchair", "from_id": "park-b", "to_id": "kiosk", "scenario_id": None}]
    r = sim.run_suite(world, tasks)
    assert {x["outcome"] for x in r["results"]} == {"success_with_unknowns"}
    g = r["gaps"][0]
    assert (g["element_id"], g["attribute"]) == ("seg-cf", "incline_pct") and g["impact"] == 2
    assert world.edges["seg-cf"].claims["incline_pct"].status == "unknown"   # world untouched

def test_stub_profile_no_data(world):
    r = sim.run_suite(world, [{"id": "d", "profile": "drive", "from_id": "park-b", "to_id": "playground", "scenario_id": None}])
    assert r["results"][0]["outcome"] == "no_data"

def test_scenario_counts(world):
    r = sim.run_suite(world, sim.default_tasks(world), scenario_id="stage_p3m")
    assert r["scenario_id"] == "stage_p3m" and not r["invariant_violations"]
```
API tests: POST without a token → 401/503 (the default token behaves as in resolve); with the token → 200 and a `run_id`; GET it back; GET with an unknown id → 404.

- [ ] Write the failing tests → implement `sim.py` → API routes + table → `pnpm gen` → full checklist → commit (no push; the coordinator integrates).

### Task 16 (AI): `DEMO_MODE` cache (C-10)

**Files:** Create `packages/agent/src/townshiplens_agent/demo.py`, `packages/agent/tests/test_demo.py` and `data/demo/README.md`. Modify `packages/agent/src/townshiplens_agent/{settings.py,run.py,cli.py}`.

**Interfaces:**
- `AgentSettings.demo_mode: bool = False` (env `DEMO_MODE`) and `demo_dir: Path = ROOT/"data/demo"`.
- `demo.key(req: ChatRequest) -> str` is the sha256 of the normalised (lower-cased, whitespace-collapsed) `message`, plus `profile` and `scenario_id`, truncated to 16 hex characters.
- `demo.load(key) -> list[ChatEvent] | None` and `demo.save(key, events, meta)`. The file format is JSONL `data/demo/<key>.jsonl`; the first line is `{"meta": {message, profile, scenario_id, model, recorded_at}}` and the remaining lines are one event each (`model_dump`).
- `run_turn`: when `settings.demo_mode` is on and a cache entry exists, it replays the events with a small delay (20 ms between `text.delta` events) and ends with the cached `Done`, with `model` suffixed `+demo-cache`. On a cache miss it runs normally. It never fabricates.
- CLI: `python -m townshiplens_agent.cli --record "<question>" [--profile p] [--scenario s]` runs a turn and saves the cache entry. With the mock provider, the recorded files are deterministic and committed for the three hero questions (mock-recorded; labelled in `meta.model`).

**Tests:** a key that is stable under whitespace and case changes; a replay that yields identical event types in order and ends with `Done` whose model ends `+demo-cache`; a cache miss that falls through (mock provider); a corrupt file that is ignored with a warning, after which the turn runs normally.

- [ ] Tests first → implement → record the 3 hero entries with the mock → full checklist → commit.

### Task 17 (FE): Place cards (P-04)

**Files:** Create `apps/web/src/features/places/{PlaceCard.tsx,placeModel.ts,placeModel.test.ts}`. Modify the Cesium layers (pick handler), MapboxLite (click handler), ListView (button per place) and `sceneStore` (a `selectedPlaceId` and `selectPlace(id|null)`).

**Behaviour:**
- Clicking a marker (Cesium `ScreenSpaceEventHandler` LEFT_CLICK → picked entity id; Mapbox layer click; or the List button) calls `selectPlace(id)`.
- A `PlaceCard` (a dialog on mobile, a side panel on desktop) fetches `GET /places/{id}` and shows:
  - the name and type;
  - each claim as a row: the attribute label, the value (or "unknown"), a status badge (text + icon), `verified_at` and the source type, with a "placeholder" badge for `team_survey_placeholder`;
  - a "No facts recorded yet" empty state;
  - loading and error states;
  - an "Ask about this place" button that pre-fills the chat input with "Tell me about <name>".
- Keyboard: Esc closes; focus moves to the card on open and returns to the trigger on close.
- `placeModel.ts` turns `/places/{id}` into display rows (pure function). Unit-test it, including the empty claims, unknown values and placeholder cases.

- [ ] Tests first for `placeModel` → components → web test / typecheck / build / lint / e2e (add one e2e: in the List view, click a place → the card shows its name) → commit.

### Task 18 (BE): Attribute editor endpoint + audit log (M-03, M-02 audit)

**Files:** Modify `apps/api/src/townshiplens_api/routes/manage.py` and the store module to add an `audit_log` table, and the `townshiplens_spatial.world` claim refresh if needed. Tests go in `apps/api/tests/test_attributes.py`.

**Interfaces:**
- `PATCH /elements/{element_id}/attributes/{key}` with body `{value, status: "verified"|"unknown"|"reported", source_type: str, note?: str}`, header `X-Staff-Token`.
  - Validation: 404 for an unknown element; `key` must match `^[a-z_]{1,40}$` (422); a type mismatch with the existing claim gives 422 (int↔float allowed, the same rule as resolve); `status: "unknown"` forces `value=None`.
  - Writes a verified/reported/unknown claim under `world_lock` (copy-on-write).
- An `audit_log` row is written on every successful edit and every VR resolve: `{id, at, actor: "staff", element_id, attribute, old: {...claim}, new: {...claim}, reason: "edit"|"resolve:<vr_id>", note}`.
- `GET /audit?element_id=` → rows, newest first.

**Tests:**
- 401/503 token behaviour.
- 404 for an unknown element; 422 for a bad key; 422 for a wrong type.
- A successful edit changes `GET /places/{id}` (or the layer status) and writes one audit row with the old and new values.
- Setting "unknown" nulls the value.
- Resolve also writes an audit row.

- [ ] Tests first → implement → `pnpm gen` → full checklist → commit.

### Integration order
T15 and T18 touch `apps/api`, so they run in **one BE worktree, sequentially** (T15 then T18). T16 (AI) and T17 (FE) are independent worktrees. Integrate in this order: T16, T17, T15, T18. Each one is reviewed (spec + quality) before it merges.

### Task 19 (FE): Journey-tests report in the management console (G-03/G-04 UI)

**Files:** Create `apps/web/src/features/manage/{JourneyTests.tsx,simModel.ts,simModel.test.ts}` and modify `ManagePage.tsx` (add a third tab, "Journey tests").

**Interfaces (consumes, Task 15 API on main):**
- `POST /api/simulations {scenario_id?, profiles?}` with the `X-Staff-Token` header (staff token from `sessionStorage` `tl.staffToken`, same as the VR queue) → `SimReport {run_id, created_at, scenario_id, world_version, counts: {profile: {outcome: n}}, results[], gaps: [{element_id, attribute, impact, affected_profiles, example_task_ids}], gaps_truncated, invariant_violations: [{invariant, task_id, detail}]}`.
- `GET /api/simulations?limit=5` → summaries.
- `GET /api/simulations/{run_id}` → the report.
- Use the generated client types where available.

**Behaviour:**
- **Run controls:** a scenario select (baseline + stages from `/scenarios`), profile checkboxes (stroller, wheelchair, older_adult_rest) and a "Run journey tests" button. The button is disabled while running and shows a progress label. Errors: 401/503 → "Staff token required or not configured"; others → a generic message with retry.
- **Outcome matrix:** a table with profiles as rows and outcomes as columns (`success`, `success_with_unknowns`, `blocked`, `no_data`), using text labels: "Confirmed", "Possible (unverified)", "Blocked", "No data".
- **Top gaps:** element, attribute, impact ("unblocks N journeys") and profiles. Show a "Results truncated by time budget" note when `gaps_truncated`.
- **Invariant violations:** a list with plain-language labels: I1 "Route used a non-passable segment" (critical), I2 "Unverified segment not disclosed" (critical), I7 "Rest stops too far apart for older residents".
- **Recent runs:** a list; clicking one loads its report.
- **`simModel.ts`** (pure, unit-tested): `summariseCounts(report) -> {confirmedPct, possiblePct, blockedPct, noDataPct}` per profile and overall; `violationLabel(invariant)`; `outcomeLabel(outcome)`.
- **Accessibility:** the table has a caption and `th` scope; the button has a label; errors use `role=alert`; the result summary sits in a live region; mobile-first stacked layout.

**Tests:** `simModel` unit tests (percentages sum to 100 within rounding; empty report → zeros; unknown invariant → generic label). Add one Playwright e2e: on `/manage` → Journey tests, enter the staff token (`e2e-token` from the Playwright config), run → the outcome matrix shows the stroller row.

- [ ] Tests first → components → web test / typecheck / build / lint / e2e → commit.

### Task 20 (FE): Staff attribute editor + audit history (M-03 UI)

**Files:** Create `apps/web/src/features/manage/{AttributeEditor.tsx,attributeForm.ts,attributeForm.test.ts,AuditHistory.tsx}`. Modify `apps/web/src/features/places/PlaceCard.tsx` (a staff "Edit facts" action when a staff token is present) and `ManagePage.tsx` if needed.

**Interfaces (consumes, Task 18 API on main):**
- `PATCH /api/elements/{element_id}/attributes/{key}` with body `{value, status: "verified"|"reported"|"unknown", source_type, note?}` and the `X-Staff-Token` header. Responses:
  - 200: the updated claim
  - 401 / 503: token missing or not configured
  - 404: unknown element
  - 422: bad key, type mismatch, or a null value with a non-unknown status
- `GET /api/audit?element_id=` (staff) → rows `{id, at, actor, element_id, attribute, old, new, reason, note}`, newest first.

**Behaviour:**
- In the place card, staff mode shows an "Edit" button per fact.
- **Inline editor:**
  - Value input: number for numeric claims, a yes/no/unknown select for booleans, text otherwise.
  - Status select: Verified / Reported / Unknown. Choosing Unknown clears and disables the value.
  - A required source type select (`staff_site_visit`, `staff_photo`, `sdp_document`, `resident_report`) and an optional note.
  - "Save" is disabled while invalid or saving. On success it shows a confirmation, refetches the place, and invalidates the layer queries so the map recolours.
  - Errors map to plain messages (422 shows the server's detail text).
- **History:** a "History" disclosure lists the audit rows for the element, newest first, as old → new value/status, with date, reason and note.
- `attributeForm.ts` (pure, unit-tested): `parseValue(kind, raw)`, `validate(form)` (Unknown ⇒ value null; Verified/Reported need a value), `toPayload(form)`.
- **Accessibility:** labels on every control; errors use `role=alert`; focus returns to the Edit button after save or cancel.

**Tests:** `attributeForm` unit tests. One e2e: with the staff token set (`e2e-token`), open the Car Park B card, edit a fact to Unknown, save, and see it shown as unknown, with a history row.

- [ ] Tests first → components → web test / typecheck / build / lint / e2e → commit.

### Task 22: Real-seed hygiene (BE/data): per-world local DB, assessed-area disclaimer, dedupe guard

Found in real-data browser verification (Task 14B, 02:58): a tiny-fixture verification request (`seg-cf`, "stroller route park-b -> kiosk") shows in the Elmina management queue, because every world shares `.data/townshiplens.db`.

**Files:**
- Modify: `apps/api/src/townshiplens_api/settings.py`, `state.py`, `routes/sim.py`, `routes/manage.py` (one helper, three call sites)
- Modify: `data/scripts/build_flood.py` (`DISCLAIMERS["rem"]`, `dedupe_places`)
- Modify: `data/seed/elmina/flood/scenarios.json` (disclaimer text only), `data/README.md`
- Test: `apps/api/tests/…`, `data/tests/test_flood_build.py`

- [ ] **Step 1: Per-world DB path.**
  - `database_url` default becomes `None`.
  - Add `ApiSettings.db_path(site_id: str) -> str`. It returns the explicit `DATABASE_URL` path (minus `sqlite:///`) when set; otherwise `ROOT/.data/<site_id>.db`. `site_id` is the loaded world's `Site.id`, or `"tiny"` for the tiny fixture. Use the existing id field.
  - All three call sites (VR store in `state.py`, sim store, audit store) must use the loaded world's id, so the stores of one process always agree.
  - Tests:
    - (a) Two worlds with different ids and no `DATABASE_URL` get different files.
    - (b) An explicit `DATABASE_URL` is honoured unchanged.
    - (c) The VR, sim and audit stores resolve to the same path for one world.
  - Update `.env.example` to `DATABASE_URL=  # optional; default .data/<site id>.db per world`.
- [ ] **Step 2: Assessed-area clause.** Append one sentence to `DISCLAIMERS["rem"]`, using the actual `AREA` bounds from `build_flood.py` (2 decimals): "Only the area <W>–<E> E, <S>–<N> N is assessed; paths outside it are not." Then:
  - Rewrite the `disclaimer` field of every REM scenario in `data/seed/elmina/flood/scenarios.json` to the new string. Use a small function in `build_flood.py` (e.g. `--rewrite-disclaimers`) that edits only that field and preserves the file's existing formatting, so no DEM rebuild is needed.
  - Also restore `data/seed/elmina/site.json` to 2-space indentation if `update_site` wrote 1-space, and make `update_site` write `indent=2`.
  - Test: the disclaimer in `scenarios.json` equals `DISCLAIMERS["rem"]`.
- [ ] **Step 3: +1 m under-show line.** In `data/README.md`, add one plain sentence near the 33.9% figure: "At +1 m about a third of the wet area is hidden under the 3D surface; the list view and 2D layers are authoritative."
- [ ] **Step 4: Dedupe guard.** In `dedupe_places`, never merge two candidates whose name contains `(unnamed, OSM)`. Test with two unnamed halls 50 m apart: both are kept.
- [ ] **Step 5: Verify.**
  - Commands: `uv run pytest -q`, `pnpm lint`, `pnpm gen && git diff --exit-code packages/api-client`.
  - Start the API with no `DATABASE_URL` on the Elmina seed and confirm `GET /api/manage/verification-requests` (with a staff token from the test env) contains no `seg-cf` row.
  - Commit on `lane/be`.

### Task 23: Real-seed chat and evidence polish (FE)

Found in Task 14B browser verification on the real Elmina seed (mock LLM):
- The stroller answer lists 41 citations: 3 attributes × 13 segments, plus 2 places. They are labelled by raw ids such as `seg-1306543769-3 · step_count` and `evc-osm-way-1063471271 · source`.
- Placeholder demo facts show `✓ verified` next to a `placeholder` chip. `data/README.md` says these must not be presented as verified in the real world.
- The attribution line renders twice: `ResidentPage.tsx:61` and the footer in `routes.tsx:42`.

**Files:**
- Modify: `apps/web/src/features/chat/EvidenceCard.tsx`, `ChatPanel.tsx` (citation list), `apps/web/src/app/ResidentPage.tsx`
- Create: `apps/web/src/features/chat/citationLabel.ts` (+ test)
- Test: vitest beside each file; update `e2e/heroes.spec.ts` only if a selector changes.

- [ ] **Step 1: Placeholder honesty.** When `source_type === "team_survey_placeholder"`:
  - Show the status chip as `Demo value · not surveyed`, with the amber placeholder styling and no ✓ icon, instead of `✓ verified`. The `checked <date>` text is hidden for these.
  - Every other status renders unchanged.
  - Test both cases.
- [ ] **Step 2: Friendly labels.** `citationLabel(c, names: Map<string,string>)` returns `"<element name> · <attribute label>"`:
  - The element name comes from the `names` map. Build the map from data the client already has: the access layer's place features and the flood layer's evacuation features (id → name).
  - Fallbacks by id prefix:
    - `seg-` → `Path segment`
    - `evc-` → `Evacuation candidate`
    - `pl-` / other → the raw id
  - The attribute label is the catalogue key humanised with the existing `optionLabel` from `features/manage/attributeCatalogue.ts` (`step_count` → `Step count`).
  - The raw `element_id` stays available as the `title` attribute.
  - Tests cover each fallback.
- [ ] **Step 3: Collapse long citation lists.**
  - Group citations by `element_id`, keeping first-appearance order. Render one card per element, listing its attributes with each status.
  - Show the first 4 element cards, then a button `Show N more sources` (N = remaining elements) that expands in place. The button is keyboard accessible with `aria-expanded`.
  - The `[ref]` numbers stay visible on each attribute line so answer text can still refer to them.
  - Test: 41 citations over 15 elements render 4 cards plus `Show 11 more sources`, and clicking reveals all 15.
- [ ] **Step 4: Single attribution.** Remove the duplicate attribution `<p>` from `ResidentPage.tsx`; the footer one stays. Adjust any test that relied on it.
- [ ] **Step 5: Verify.**
  - Commands: `pnpm --filter @tl/web test`, `pnpm lint`, `pnpm -r --if-present typecheck`, `pnpm --filter @tl/web build`, `pnpm --filter @tl/web e2e`.
  - Commit on `lane/fe`.

### Task 24: Agent honesty on the real seed: placeholder facts and VR flood (AI)

Found in the live OpenRouter smoke on the real Elmina seed (Task 14B, 03:00, `anthropic/claude-haiku-5.5`):
- (a) The stroller answer said "Each route segment passed the stroller check, and staff verified the segment data on 2026-10-15". Every cited segment fact carries `source_type: "team_survey_placeholder"` (demo values, see `data/README.md` "Placeholder facts"). The model presented placeholders as staff-verified.
- (b) One wheelchair flood turn (`plan_route` lakeside-mall → evacuation candidate, `stage_p3m`) emitted **174** `verification.requested` events: 58 segments × 3 attributes. The queue is flooded by a single question.

**Files:**
- Modify: `packages/agent/src/townshiplens_agent/` (validator / prompt / template fallback, wherever the existing partly_unverified caveat rule lives)
- Modify: `packages/spatial/src/townshiplens_spatial/tools.py` (`plan_route` VR filing)
- Test: `packages/agent/tests/…`, `packages/spatial/tests/…`; keep `pnpm golden` 6/6

- [ ] **Step 1: Placeholder caveat rule.** The rule follows the existing caveat-rule pattern in the output validator, with no new SSE event type and no OpenAPI change. When any evidence cited in the final answer has `source_type == "team_survey_placeholder"`:
  - The answer must contain the caveat phrase "demo values, not yet surveyed". Match case-insensitively, the way existing caveats are matched.
  - The answer must NOT match `(staff|team)[- ]verified|verified by (staff|the team)|\bsurveyed on\b|staff (have |has )?checked`. Otherwise `ModelRetry`, with a message that tells the model exactly what to change.
  - Add one line to the system prompt explaining placeholder evidence.
  - The template fallback answer must satisfy the rule, and so must the mock FunctionModel scripted answers that cite placeholders (so golden stays green).
  - Tests:
    - (i) A placeholder-citing answer without the caveat is rejected.
    - (ii) An answer with "staff verified" plus placeholder citations is rejected.
    - (iii) An answer with no placeholder citations is unaffected.
    - (iv) The template fallback with placeholder evidence passes the validator.
- [ ] **Step 2: Cap auto-filed VRs per route.** `plan_route` files at most `MAX_ROUTE_VRS = 10` verification requests per call:
  - Go in route order, one per (element, attribute), until the cap is reached.
  - Add `verification_requests_truncated: <int remaining>` to the tool result data, 0 when not truncated.
  - Missing-place VRs are not counted against the cap.
  - Existing dedupe/demand behaviour is unchanged for filed VRs.
  - Test: a route with 20 unknown (element, attribute) pairs files exactly 10 and reports 10 truncated. The agent's uncertainty items are unchanged; still report all of them.
- [ ] **Step 3: Verify.**
  - Commands: `uv run pytest -q`, `pnpm golden`, `pnpm lint`, `pnpm gen && git diff --exit-code packages/api-client`.
  - Run the mock CLI on the seed: `LLM_PROVIDER=mock uv run python -m townshiplens_agent.cli --profile wheelchair --scenario stage_p3m "Where is the nearest evacuation centre from Lakeside Mall if the river rises 3 m? I use a wheelchair."` and confirm ≤ 10 `verification.requested` events.
  - Commit on `lane/ai`.

### Task 25: Initial 3D framing and mobile scenario picker (FE)

Found in Task 14B:
- (a) `CesiumScene.tsx` hard-codes `setView` at (101.5099, 3.1813, 4500 m) with pitch −45°. That places the *camera* over the site, so the view centres about 4.5 km north of it. `site.json` already provides `scene.home: {lon, lat, range_m}`.
- (b) At 375 px the six full-length scenario buttons ("River +1 m (indicative)" …) wrap to six rows and push the map below the fold.

**Files:**
- Modify: `apps/web/src/features/scene/cesium/CesiumScene.tsx`, `apps/web/src/features/flood/ScenarioBar.tsx`
- Create: `apps/web/src/features/scene/cesium/home.ts` (+ `home.test.ts`)
- Test: vitest; e2e must stay green

- [ ] **Step 1: Home view.** `homeView(site)` returns `{lon, lat, range_m}`:
  - It reads `site.scene.home`.
  - It falls back to `site.center` with `range_m: 6000`, then to the current constants (101.5099, 3.1813, 6000).
  - In `SceneSetup`, replace the `setView` call with a camera that *looks at* the home point: `camera.lookAt(Cartesian3.fromDegrees(lon, lat, 0), new HeadingPitchRange(0, toRadians(-45), range_m))`, then `camera.lookAtTransform(Matrix4.IDENTITY)` so the user can navigate freely. Keep the `requestRender` call.
  - Read the site through the existing site query hook (the one `ResidentPage` uses). Do not refetch.
  - Do not re-run the camera move when the site query refetches. Move it once per viewer.
  - Tests for `homeView` cover each fallback.
- [ ] **Step 2: Compact scenario labels on narrow screens.**
  - Below the `sm` breakpoint, each scenario button shows a short label: `Normal`, `+1 m`, … `+5 m`. From `sm` up, it shows the existing full label.
  - Use Tailwind responsive classes with two spans, and keep the full label as the button's accessible name (`aria-label`). The group heading already says "(indicative)".
  - Target: all six buttons fit in at most 2 rows at 375 px.
  - Test the accessible names are unchanged.
- [ ] **Step 3: Verify.**
  - Commands: `pnpm --filter @tl/web test`, `pnpm lint`, `pnpm -r --if-present typecheck`, `pnpm --filter @tl/web build`, `pnpm --filter @tl/web e2e`.
  - Commit on the lane branch.


### Task 26: BE: `drive` profile and drivable graph (closes B-04, P-05, F-04; P0 MISSING/PARTIAL; visible honesty gap today)

From the MVP status audit (03:25, `.superpowers/sdd/2026-10-15-mvp-p0-increment-1/mvp-status-audit.md`).

- Files: `config/profiles/drive.yaml` (`stub: false`, `allowed_types`, speed), `packages/spatial/src/townshiplens_spatial/models.py` (`Profile.allowed_types`, `speed_kmh`), `evaluate.py` (non-road edge types FAIL for drive; `possible` flood FAIL for drive; likely FAIL), `routing.py` (drive `est_minutes` from speed), `tools.py` and `flood.py` (remove the stub warnings), `API/geojson.py` (no change expected).
- Scope note: derive roads from existing `street`/`track` edges in the walk extract. Add a standing warning "one-way and turn restrictions not modelled" and set road edges' routing status to partly_unverified (never `confirmed`) until an oneway-aware import exists. Do not run Overpass.
- Acceptance test: `packages/spatial/tests/test_routing.py::test_drive_routes_on_roads_only` (replaces `test_drive_is_stubbed`: a drive route between two parking places uses no `footway`/`steps` edge); `test_flood.py::test_drive_flood_fail_for_possible` (a possibly flooded road is FAIL for drive but UNKNOWN for stroller); `test_tools_flood.py` for `list_evacuation_centres(profile="drive")` returns reachable/not reachable rather than a stub warning.
- Lane: BE.
- Coordinator notes: work in `packages/spatial` and `config/profiles` only; do NOT touch `vr_store.py`, `routes/manage.py`, `routes/core.py` (another lane). Check which edge `type` values exist in `data/seed/elmina/base/walk.geojson` first and list them in the report; if no road-like types exist, report BLOCKED rather than inventing roads. The drive route answer must never be `confirmed` (standing warning). Update `pnpm golden` expectations only if a golden question asserts the stub.
- Verify: run the relevant unit tests, `pnpm lint`, typecheck/gen drift as applicable; commit on your lane branch. Mock LLM only.

### Task 27: FE: resident shortcuts: deep spots, per-lens chips, "Where can I go?" (closes P-09, C-07, P-03 chips, F-12; People-track demo value)

From the MVP status audit (03:25, `.superpowers/sdd/2026-10-15-mvp-p0-increment-1/mvp-status-audit.md`).

- Files: `apps/web/src/app/ResidentPage.tsx`, `apps/web/src/features/chat/ChatPanel.tsx`, new `apps/web/src/features/chat/suggestions.ts`, new `apps/web/src/features/scene/DeepSpots.tsx`, `apps/web/src/features/flood/ScenarioBar.tsx`, `apps/web/src/lib/api.ts` (`useSite` already exists).
- Behaviour: deep-spot buttons built from `site.deep_spots`; each applies `camera.fly_to` (bbox centre, range from bbox size) and turns on the right lens (flood spot also selects `stage_p3m`). Chips depend on the active lens: 4 access (one per persona), 3 flood, 1 waste. "Where can I go?" button appears in the scenario bar when a scenario is active and sends a message using the current profile and scenario.
- Acceptance test: vitest `suggestions.test.ts` (chip counts 4/3/1 per lens); `deepSpots.test.ts` (clicking `subang-corridor` calls `applyIntent` with a `camera.fly_to` and enables the flood lens); `ScenarioBar.test.tsx` (button absent without a scenario, present with one, sends a message containing no profile text injection). Keep e2e 9/9 green (run by the coordinator, not the subagent).
- Lane: FE.
- Coordinator notes: `site.deep_spots` is in `data/seed/elmina/site.json` (inspect its shape; the tiny fixture may lack it, so the component renders nothing without it). Scene intents are applied through the existing scene store / intent adapter (find `applyIntent` or equivalent; do not invent a parallel path). Do not edit `features/chat/EvidenceCard.tsx`, `CitationList.tsx` or `citationLabel.ts`. Chip texts must be plain questions the mock can answer (access: stroller/wheelchair/older adult/default persona; flood: 3; waste: 1).
- Verify: run the relevant unit tests, `pnpm lint`, typecheck/gen drift as applicable; commit on your lane branch. Mock LLM only.

### Task 28: AI: answer-contract hardening, status label, abstain detail, waste goldens (closes C-02, C-03, C-05 P0 PARTIALs; W-04 P1)

From the MVP status audit (03:25, `.superpowers/sdd/2026-10-15-mvp-p0-increment-1/mvp-status-audit.md`).

- Files: `packages/agent/src/townshiplens_agent/validate.py` (claim must cite at least one evidence id unless `cannot_answer`; reject steps/summary naming a route status that contradicts `rec.route_status`), `run.py` (`_answer_events`: first text line always `Route status: <status>` when a route exists; uncertainty `note` uses the edge name via `ctx.world.edges[id].name`), `template.py` (cannot_answer text names the unresolved query or missing attribute), `mock.py` (add a waste route: `find_waste_points`), `evals/golden/hero.yaml` and `evals/run_golden.py` (add 5-6 questions: waste battery, waste unknown, flood islands, status-label present, `unsupported_claims == 0` metric printed).
- Acceptance test: `packages/agent/tests/test_validate.py` (empty-evidence claim rejected; `cannot_answer` exempt); `test_run.py::test_route_status_label_always_first_line` for confirmed, partly_unverified, blocked; `pnpm golden` (mock) passes all questions and prints `unsupported_claims: 0`. Do not call a live LLM.
- Lane: AI.
- Coordinator notes: `find_waste_points` already exists in `packages/spatial/src/townshiplens_spatial/tools.py` (around line 342); the mock currently routes recycling questions to `find_place` and answers "I don't have that place" on the Elmina seed, so add the mock waste route. Keep the placeholder-evidence rule from Task 24 intact. Also do the cheap fix: `run.py` emits the flood disclaimer whenever `ChatRequest.scenario_id` is set even if no scenario tool ran. Golden stays mock-only.
- Verify: run the relevant unit tests, `pnpm lint`, typecheck/gen drift as applicable; commit on your lane branch. Mock LLM only.

### Task 29: BE: management API: VR filters, staff create-VR, KPI endpoint, layer ETag (enables M-01, M-07, G-04 UI; closes B-09)

From the MVP status audit (03:25, `.superpowers/sdd/2026-10-15-mvp-p0-increment-1/mvp-status-audit.md`).

- Files: `packages/spatial/src/townshiplens_spatial/vr_store.py` (`list(status, reason, element_id, attribute)`, `status="all"`; `resolved_at` already stored), `apps/api/src/townshiplens_api/routes/manage.py` (query params; staff `POST /verification-requests` with the same sanitising as `_safe_vr_args`; `GET /kpis` returning open VR count, median hours to resolve from resolved VRs, and % journeys confirmed from the latest sim run), `apps/api/src/townshiplens_api/routes/core.py` (`ETag` from world.version + lens + profile + scenario, 304 on `If-None-Match`, `Cache-Control: private, max-age=0, must-revalidate`), `packages/api-client` regen.
- Acceptance test: `apps/api/tests/test_manage.py` (filters by reason/element/status; create-VR dedupes and increments demand; staff-only 401), `apps/api/tests/test_kpis.py` (median time-to-resolve after resolving two VRs; after a resolve the open count drops), `apps/api/tests/test_core.py::test_layer_etag_304_and_changes_after_resolve` (same ETag twice -> 304; changes after `commit_claim`).
- Lane: BE.
- Coordinator notes: do NOT touch `packages/spatial` files other than `vr_store.py` (another lane edits evaluate/routing/flood/tools/models). Staff auth uses the existing dependency in `apps/api/src/townshiplens_api/auth.py`. The ETag must change after any claim commit (world.version) and for different query params. Run `pnpm gen` and commit the regenerated client.
- Verify: run the relevant unit tests, `pnpm lint`, typecheck/gen drift as applicable; commit on your lane branch. Mock LLM only.

### Task 30: Final-review fix wave, BE+FE: staff resolve, resolve race, honest legend, no-data labels

From the final whole-branch review (`.superpowers/sdd/2026-10-15-mvp-p0-increment-1/final-review.md`: C1, I2, I3). Coordinator rulings are inline.

- [ ] **C1: staff Verify/Correct work end to end.**
  - Verify with no value keeps the claim's current value and marks it verified. The API accepts a missing value for `verify` and uses the current value; it is an error only if there is no current value.
  - Correct sends a value typed by the attribute catalogue (`features/manage/attributeCatalogue.ts` + `attributeForm.ts`):
    - number → number
    - boolean → boolean
    - enum/text → string
  - The server keeps validating with `validate_value`.
  - Tests:
    - (API) verify without value → 200, value unchanged, status verified;
    - (API) correct with a numeric string for a number attribute → 422 stays, while a number succeeds;
    - (web) `resolveForm` builds a numeric value for `incline_pct`;
    - (e2e) extend the existing staff journey to Verify a VR and see it leave the open queue. The coordinator runs e2e; the implementer writes the spec.
- [ ] **I3: the resolve race.** Hold `world_lock` across the whole resolve: read the VR, check its status, commit the claim, write the audit row and update the VR. The loser of two concurrent resolves gets 409 and changes nothing (no claim change, no audit row). Test with two threads.
- [ ] **I2: an honest "ok" label.** Rename the `ok` status label from "Checked" to "No known barrier" everywhere it is shown: legend, list-view steps, place card and route text in the web app. Use "Verified" only where the underlying claims are verified, which needs per-edge evidence status. Out of scope tonight, so no "Verified" label anywhere. Update tests and e2e selectors.
- [ ] **No-data labels (prepares for the C3 routing fix in Task 26 round 2).** Wherever the web shows route or reachability status (list view, flood briefing, evacuation centre rows, journey tests), `no_data` reads "No mapped connection (data gap)", never "Not reachable"/"Blocked". `blocked` keeps "Not passable".
- [ ] **Verify:** pytest, `pnpm lint`, `pnpm gen` (no drift, or commit the regenerated client), typecheck, `pnpm --filter @tl/web test`, build. Do not run e2e or servers. Commit on the lane branch.

### Task 31: Connect the walk network: import major roads with honest sidewalk status (data)

**Measured on the seed (03:30):** the walk graph has 199 components, and the largest holds only 32% of the 11,418 nodes (piece sizes 3653 / 2337 / 1455 / 1165 …). Effects:
- 49 of 72 evacuation centres have no mapped connection from Lakeside Mall;
- journey tests give 194 of 200 trips `no_data`.

**Root cause:** `data/scripts/import_osm.py` `WALK_HIGHWAYS` excludes `primary|secondary|trunk` (and their links). In Elmina those are the roads that join the neighbourhoods. Pedestrians walk along them on sidewalks or verges.

**Ruling R22:** one polite, sequential, tiled Overpass fetch of the major roads.
- ≤ 12 HTTP requests including retries.
- Use the existing `overpass.py` cache and backoff, and print `overpass.REQUESTS_MADE`.
- Motorways stay excluded.

- [ ] **Step 1, import.**
  - Fetch `highway~^(primary|secondary|trunk|primary_link|secondary_link|trunk_link)$` in the existing `ENVELOPE` tiles. Skip ways with `foot=no`.
  - New segment type `major_road`. It is split at shared nodes exactly like other ways, so it joins the existing network.
  - Claim `sidewalk` comes from OSM tags `sidewalk`, `sidewalk:both`, `sidewalk:left` and `sidewalk:right`. Normalise to `both|one_side|none|separate`. When there is no tag, add no claim (so it is unknown).
  - The evidence type is `osm_import`, as for other OSM claims.
- [ ] **Step 2, catalogue + evaluation.**
  - Add `sidewalk` (enum `both|one_side|none|separate`) to the attribute catalogue: `packages/spatial/src/townshiplens_spatial/attributes.py` and the FE mirror `apps/web/src/features/manage/attributeCatalogue.ts`.
  - Evaluation for `major_road` on walking profiles (default, stroller, wheelchair, older_adult_rest):
    - sidewalk `both|one_side|separate` → normal rules for the other attributes;
    - `none` → FAIL for stroller/wheelchair/older_adult_rest, UNKNOWN for default;
    - missing → UNKNOWN for every walking profile.
  - So a route over a major road can never be `confirmed` without sidewalk data.
  - `drive` allows `major_road`.
  - Tests cover each case.
- [ ] **Step 3, rebuild the seed** in this order (see `data/README.md` → Rebuild): `import_osm.py` → `build_overlay.py` → `build_flood.py` → `build_waste.py`.
  - Copy the cached DEM files from `/Users/user/Workspace/Projects/simedarby/SunNiuBi-wt/flood/data/cache/` (`glo30_dem_*`, `asf_hand_*`, .npy + .json) into this worktree's `data/cache/` first, so build_flood downloads nothing. If build_flood still needs a network fetch other than Overpass drainage (counted in the cap), stop and report BLOCKED.
  - Every new edge must get flood classes and coverage like the others.
  - The hero overlay must survive. Check that stroller `park-b` → `playground` still routes `confirmed` at about 440 m, or report the new result honestly.
- [ ] **Step 4, measure before vs after:**
  - component count and largest share;
  - stroller lakeside-mall → 72 centres status counts at baseline and stage_p3m;
  - journey-test summary per profile;
  - flood stage stats (likely/possible edges, water km²) at +1/+3/+5 m.
  
  Put the table in `data/README.md` and the report.
- [ ] **Step 5, verify.**
  - Commands: `uv run pytest -q`, `pnpm golden` (mock), `pnpm lint`, `pnpm gen` (commit the client if the catalogue enum appears in the schema), `pnpm --filter @tl/web test`.
  - Commit on lane/data, with data files in a separate commit from code.

### Task 32: Tappable evacuation and waste markers + list-view sections (FE, small BE shim)

From the audit (P-04, P-06, P-07, W-02).
- **Problem:** only access places open a card. Evacuation centre and waste markers are not tappable, and the list view has no evacuation or waste sections.
- **BE shim:** `get_place_details` and the REST place endpoint (`GET /places/{id}`) resolve evacuation-centre ids (`evc-…`) and waste ids (`wp-…` or the seed's ids) as well as access places. They return:
  - the name, type, source label (`osm_candidate`/`official_pps`, or waste status) and claims with evidence;
  - for a centre, the reachability status for the current profile/scenario when a query param supplies it.
  - **Test:** a known centre id and a known waste id both return 200 with a source label.
- **FE:** clicking a centre or waste marker opens the existing PlaceCard, in both Cesium (entity `placeId`, as for access places) and Mapbox lite.
  - The card shows the source label prominently: "Candidate (OSM), not an official relief centre" or "Official PPS".
  - Waste cards show the status, and "Collection day: unknown, ask MBSA" with the council contact link already used elsewhere in the app (W-03). Never invent a schedule.
- **List view:** add an "Evacuation centres" section when the flood lens is on, and a "Waste points" section when the waste lens is on. Each item is a button opening the card. Text-only, screen-reader friendly.
- **Tests:** vitest for the card's source label and the list sections; pytest for the endpoint.
- **Out of scope:** do NOT touch `features/manage/*`, `apps/api/routes/manage.py`, `attributeCatalogue.ts` or `data/`.

### Task 33: Management UI: KPI tiles, queue filters + resolved tab, "Create VR" on journey gaps (FE)

From the audit (M-01, M-07, G-04 UI). It uses the Task 29 API (merged):
- `GET /kpis`;
- `GET /verification-requests` with `status`, `reason`, `element_id` and `attribute` filters, `status=all`;
- staff `POST /verification-requests`.

- **KPI tiles** at the top of `/manage`:
  - open VRs;
  - median hours to resolve, or "not enough data";
  - % journeys confirmed from the latest run, or "no run yet". It also shows the run's no-data % (data gap) in plain words when present.
  - Tiles refresh after a resolve via query invalidation.
- **Queue:** add filter controls (reason, attribute, free-text element id) and tabs "Open" / "Resolved" / "All". Filter state builds the query params. Keyboard accessible; visible labels.
- **Journey tests:** each gap row gets a "Create verification request" button. It is staff-only and uses the staff token already kept in the session. On success it shows "Request filed (demand N)". On a duplicate it shows "Already requested; demand is now N".
- **Tests:** vitest for the query building, tiles rendering and updating, and the create-VR button states.
- **Constraints:** do NOT touch `features/chat/*`, `features/scene/*`, `attributeCatalogue.ts`, `apps/api` or `data/`.

### Task 34: Evidence photo upload with stdlib metadata stripping (BE)

From the audit (B-07; unblocks C-04, M-02, AX-06). Per ruling R21, Pillow is not allowed: its HPND licence is not on the permitted list.
- **`POST /evidence`**, staff-only, multipart:
  - JPEG or PNG only, by magic bytes, not the filename;
  - capped at 5 MB.
  - **Strip metadata with the stdlib:**
    - JPEG: drop all APPn segments except APP0/JFIF, and drop COM segments. Keep SOI…EOI image data. Reject a malformed stream.
    - PNG: keep only critical chunks plus `tRNS`/`PLTE`. Drop `eXIf`, `tEXt`, `iTXt`, `zTXt`, `tIME` and the rest. Recompute nothing: chunk CRCs stay valid because whole chunks are kept or dropped.
  - Store the result under `.data/evidence/<random hex>.<ext>`, gitignored, keeping no original filename.
  - Return `{evidence_id, photo_url}`.
- **`GET /evidence/{id}`** is public:
  - it serves the stripped file with the correct content-type and `Cache-Control: private, max-age=3600`;
  - the id is validated (hex only, so no path traversal).
- **Resolve:** `ResolveBody.evidence_id` is optional. When given, it must exist; it is appended to the claim's `evidence_ids` and exposed as `photo_url` on that evidence in tool results and `GET /places/{id}`.
- **Dependency:** if `python-multipart` is not already in `uv.lock`, add it to `apps/api/pyproject.toml` (Apache-2.0) and record its licence in the report.
- **Tests:**
  - (1) A JPEG with an APP1 Exif GPS block is uploaded; the downloaded bytes contain no `Exif` APP1 and are still a valid JPEG (SOI…EOI).
  - (2) A PNG with `tEXt` and `eXIf` loses both.
  - (3) Wrong type → 415, oversize → 413, no token → 401, bad id → 404.
  - (4) A resolve with `evidence_id` makes the claim carry it, with a `photo_url`.
  - (5) `pnpm gen` is regenerated and committed.
- **Constraints:** do NOT touch `apps/web`, `data/`, `packages/spatial/src/townshiplens_spatial/attributes.py`, `evaluate.py` or `import`-related files.

### Task 35: Evidence photos in the UI: upload on resolve, photo on evidence and place cards (FE)

Uses the Task 34 API, which is merged: staff `POST /evidence` (multipart, JPEG/PNG ≤ 5 MB, returns `{evidence_id, photo_url}`), public `GET /evidence/{id}`, `ResolveBody.evidence_id`, and `photo_url` on evidence. Closes the UI side of C-04 and M-02.

- **Resolve form:** an optional "Photo evidence" file input (accept `image/jpeg,image/png`).
  - Validate on the client: type, and size ≤ 5 MB with a readable message.
  - On submit, upload first with the staff token, then resolve with the returned `evidence_id`.
  - On upload failure, show the API message in plain words and do not resolve.
  - Tell staff "Location and camera details are removed from the photo before it is stored."
- **EvidenceCard and PlaceCard:** when evidence has a `photo_url`, show a small thumbnail (lazy-loaded, fixed size, meaningful alt text such as "Photo evidence for <element> · <attribute>"). It links to the full-size image in a new tab, with the source and the checked date beside it. Without a `photo_url`, it renders exactly as today. Placeholder evidence keeps "Demo value · not surveyed".
- **Tests (vitest):**
  - the resolve form's file validation (type, size, optional);
  - upload-then-resolve ordering, and no resolve after an upload failure (use the existing testable side-effect pattern from `createVr.ts`);
  - EvidenceCard with and without a photo.
- **Out of scope:** do NOT touch `apps/api`, `data/`, `attributeCatalogue.ts` or `features/scene/*`.

### Task 36: Flood provenance popover and baseline comparison (FE + small BE)

From the audit: F-08 (MISSING), F-09/M-05 (PARTIAL: no baseline comparison), F-16 (thresholds not shown).

- **"Why this path?" (F-08).** Clicking a flood-coloured path in Cesium (likely or possible) opens a small accessible popover or side panel. Also reachable from the list view's affected-path rows. It shows:
  - scenario label, e.g. "River +3 m (indicative)";
  - class ("Likely flooded" / "Possibly flooded");
  - method: "Relative elevation above mapped OSM drainage (REM)" or the HAND label, taken from the scenario's `method`;
  - DEM: "Copernicus GLO-30 (30 m)";
  - margin, as a band, e.g. "within 0.5 m of the modelled water surface"; read it from scenario meta if present, otherwise omit it;
  - the data version / `data_as_of`;
  - the disclaimer line.

  Never show a water depth or any number with two decimals for depth.

  Backend: if the flood layer features don't carry the class and scenario id per edge, add them (properties only). For per-scenario provenance, extend `GET /scenarios/{id}` only if needed. Regenerate the client.
- **Baseline vs scenario (F-09).** The flood briefing shows two columns per row: "Normal river level" vs the selected scenario. Rows:
  - likely-flooded paths;
  - possibly-flooded paths;
  - places affected;
  - centres reachable, partly unverified, no mapped connection (data gap) and not passable, per profile.

  The origin is labelled ("from Elmina Lakeside Mall, demo start point"), using the `DEMO_ORIGIN_ID`/`DEMO_ORIGIN_NAME` constants in `lib/placeQuery.ts`.
- **Thresholds shown (F-16).** In the briefing, a collapsible "Assumptions" section lists the profile thresholds from the versioned profile YAML (e.g. wheelchair max incline, step count, min width), labelled "our engineering default (no published source)". If they are not already exposed, add a read-only `GET /profiles` endpoint returning the profile parameters and regenerate the client.
- **Tests.**
  - pytest: the flood layer properties; `/profiles` if added.
  - vitest: popover content per class with no depth numbers; briefing two-column rendering; assumptions labels.
- **Out of scope:** do NOT touch `data/`, `import_osm.py`, `attributes.py`, `evaluate.py`, `sim.py` or `features/chat/*`.

### Task 37: Pitch demo mode: scripted hero walkthrough with captions (FE)

Priority from the team lead (continuation run): demo & pitch polish. The web README's "build next" list also has "Demo replay: `?replay=` plays a scripted conversation and scene for the pitch".

- **Entry:** `/?demo=hero` starts a walkthrough. A small fixed control bar shows the step caption, Back / Next / Pause, and "Exit demo". Keyboard: → / ← / Space / Esc. Without the param, the app is unchanged.
- **Script:** a pure data file (`features/demo/heroScript.ts`). Each step is one of:
  - `{caption, action}`, where `action` is one of `jump(deepSpotId)`, `setProfile(p)`, `setScenario(id|null)`, `setLens(lens, on)`, `ask(text, profile?)`, `openManage(tab)`, `wait(ms)`.
  - Actions go through the existing paths:
    - `useScene` setters and `applyIntent`;
    - the chat send path, the same as the suggestion chips (`pickSuggestion`);
    - the router for `/manage` tabs.
  - **Never** a parallel implementation.
- **Default script:** the three README hero flows.
  1. **Access:** jump to "Elmina Urban Park + Lakeside Mall frontage", switch to stroller, ask "Can I get to the lakeside mall with a stroller?". Caption explains confirmed vs "Demo value · not surveyed".
  2. **Flood resident:** jump to the Subang corridor (+3 m), wheelchair, ask "Where is the nearest evacuation centre if the water rises 3 m?". Caption: "indicative, not a forecast; candidate vs official centres".
  3. **Manager:** open `/manage`, then the Flood briefing at +3 m, then the Verification queue.

  Use only questions that have DEMO_MODE cache entries for the Elmina world (`data/demo/*.jsonl` meta), or that the mock answers deterministically. List the ones used in the report.
- **Honesty:** captions never say "safe", never give depths, and never claim facts are verified.
- **Tests (vitest, pure functions):**
  - the step reducer: next, back and bounds;
  - URL param parsing;
  - each action maps to the right store or router call. Use injected fakes in the testable side-effect style, as in `features/manage/createVr.ts`.
  - Add one Playwright test: `/?demo=hero` shows step 1's caption and Next advances to step 2. It runs on the tiny fixture: a step whose deep spot doesn't exist must skip gracefully with the caption "(not available in this dataset)".
- **Out of scope:** do NOT touch `apps/api`, `packages/*`, `data/`, `attributeCatalogue.ts` or `features/scene/cesium/*`.

### Task 38: Refresh stale lane READMEs and dev-setup docs (docs only)

Quality & tech debt (continuation run). The READMEs predate Tasks 22–36.

- **`apps/api/README.md`:**
  - Regenerate the endpoint table from the real routes (`apps/api/src/townshiplens_api/routes/*.py`, or `packages/api-client/openapi.json`). That includes `/kpis`, `/profiles`, `/evidence` (POST staff multipart and GET), `/simulations`, staff `POST /verification-requests`, VR filters and `?status=all`, the layer ETag/304, and resolve with `evidence_id`.
  - Record the per-world DB path and `evidence_dir`.
  - Update "Build next" so it lists only what is still open.
- **`packages/agent/README.md`:** bring it up to date with:
  - validator rules: the no-tool rule, placeholder evidence, status-contradiction check, citation requirement;
  - the `Route status:` first line;
  - Elmina mock behaviour: the mall chip and the recycling answer;
  - `safe_vr_args` and `route_summary`;
  - the citation `photo_url`;
  - the golden metric `answered_without_citations`.
- **`packages/spatial/README.md`:**
  - drive profile;
  - `no_data` vs `blocked` semantics;
  - the per-route VR cap of 10;
  - the 10 tools table, if it changed.
  
  Do NOT document Task 31's `major_road`; it isn't merged yet.
- **`apps/web/README.md`:** current routes and features. These include deep spots, persona chips, "Where can I go?", tappable markers, the "Why this path?" popover, KPI tiles, filters, photo evidence, honest labels, and the e2e ports 5273/8100.
- **`docs/05-team/dev-setup.md`:** fix commands that changed:
  - `uv sync --all-packages --all-groups`;
  - `pnpm db:reset`;
  - e2e ports;
  - remove "planned" markers for things now built.
- **Method:** check every statement against the code, and invent nothing. Keep each file's existing structure and tone. Do NOT edit `data/README.md`, `AGENTS.md` or `CLAUDE.md`.
- **Verify:** `pnpm lint`. Commit `docs: …` on the lane branch.

### Task 39: Real component tests with Testing Library (FE quality)

Reviews of Tasks 23, 27, 33, 35, 36 and 37 flagged the same gap. Vitest runs in `node` with `react-dom/server`, so clicks and focus are never exercised.

- **Dependencies (dev only, exact pins; all MIT):** `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`. Record each licence from its package metadata in the report.
- **Config:** keep the default environment `node`. Opt individual files into jsdom with `// @vitest-environment jsdom`, so existing tests and speed are unchanged. Add a small setup that registers the jest-dom matchers only for jsdom files, or import them per file.
- **Convert or add DOM tests** for the interactions reviews said were untested:
  1. `CitationList`: "Show N more sources" expands on click and keyboard; `aria-expanded` flips.
  2. Resolve form (`VerificationQueue`):
     - choosing Reject hides the photo input and clears a chosen file;
     - submit uploads first, then resolves, with fetch mocked;
     - an upload failure shows the readable message and does not resolve;
     - Verify is disabled when there is no current value.
  3. `ChatPanel`: tapping a persona chip sets the profile and sends with it (mock the send path); a `pendingAsk` is consumed once.
  4. `DeepSpots`: renders nothing without `deep_spots`; clicking a spot applies the intent.
  5. Flood "Why this path?" popover: Esc closes it and focus returns.
  6. `KpiTiles`: shows "Data-gap share unavailable" when `/simulations` errors.
- **Rules:** test behaviour through the DOM (roles, labels, text), not implementation details. No snapshot tests. Each test asserts something that would fail if the feature broke; check that by briefly breaking the code locally.
- **Out of scope:** do NOT change production code, except a minimal export or test-id where a test truly needs it; explain any in the report. Do NOT touch `packages/*`, `apps/api` or `data/`.
- **Verify:** `pnpm --filter @tl/web test`, `pnpm lint`, typecheck, build, e2e. Commit on the lane branch.

### Task 40: The mock answers every in-app prompt on the Elmina seed (AI)

Found while recording the demo cache for Task 37 (continuation run). These in-app prompts come back `cannot_answer` from the mock on the Elmina seed:
- the older-adult chip "Can I get to the lakeside mall if I am an older adult who needs to rest?" (`older_adult_rest`);
- the default chip "Is the walk from the urban park to the lakeside mall easy?";
- the scenario-bar button "Where can I go?" (`default` and `wheelchair`, `stage_p3m`).

DEMO_MODE replays these, and keyless demos run the mock, so the pitch shows "I don't know" for the app's own suggestions.

- **Access routing in the mock:**
  - Parse origin and destination from "from X to Y" or "get to Y".
  - Places: Lakeside Mall, Urban Park, playground, Car Park B, kiosk, toilet. Use `find_place` results. Don't hard-code ids beyond the existing defaults.
  - The default origin stays Car Park B when none is given.
  - The profile comes from the request, so the older-adult chip uses `older_adult_rest`, and its answer reports the rest-gap information `plan_route` returns (if it returns it).
- **"Where can I go?" (and similar: "where should I go", "where do I go"):** treat it as the flood-resident flow when a scenario is active.
  - Origin is the demo start point `lakeside-mall` (the same constant the web uses). The answer says "from Elmina Lakeside Mall (demo start point)", because the assistant doesn't know the user's location.
  - With no scenario active, answer `cannot_answer` with one helpful sentence suggesting they pick a river level or ask about a route.
- **Tests:** a pytest that loads `data/seed/elmina` and checks every in-app prompt with its profile/scenario returns a non-`cannot_answer` answer that passes the validator:
  - the 4 access chips, the 3 flood chips and the waste chip, from `apps/web/src/features/chat/suggestions.ts`;
  - "Where can I go?" for default and wheelchair at `stage_p3m`.

  Copy the strings into the test with a comment pointing at `suggestions.ts`, and add a sync test that parses `suggestions.ts` with a regex to catch drift.
- **Re-record:** the affected `data/demo` entries with the mock, for the same 11 (question, profile, scenario) tuples recorded in `ffd4ebc`; read their meta. Commit the data separately.
- **Out of scope:** do NOT touch `apps/web`, `packages/spatial` or `data/seed`.
- **Verify:** pytest, golden (mock), lint, gen (no drift).

### Task 41: Rest-point-aware routing for older adults (AX-08) (BE + small FE)

From the audit: AX-08 is PARTIAL. The max rest gap is computed per route (`routing.py`) and checked in the sim as invariant I7. But `max_rest_free_run_m` (100 m in `config/profiles/older_adult_rest.yaml`) is not enforced (`evaluate.py:104` TODO). On the Task 31 seed, 60 of 60 older-adult journey routes violate I7.

- **Routing:** for profiles with `max_rest_free_run_m`, search for a route whose longest stretch between rest points (`seating`, `shelter` and benches, i.e. the places the existing `rest_gap` logic counts) is ≤ the limit.
  - Use a resource-constrained search: label-setting over (node, distance since last rest), with pruning, bounded in time like the existing routing.
  - If no route satisfies the limit, return the best route by the existing order and set `status` to at most `partly_unverified`. Add a warning: "longest stretch without a rest point is about N m (limit 100 m)". Round N to 10 m.
  - Never `confirmed` when the limit is exceeded.
- **Answers:** `plan_route` returns `max_rest_gap_m` and `rest_limit_m`. The mock and template mention the rest-gap line for `older_adult_rest`. Keep the honesty rules.
- **Sim:**
  - I7 should now hold for every route that the router claims satisfies the limit.
  - Report a separate advisory count, "routes over the rest limit (no alternative)", instead of counting them as invariant violations.
  - `JourneyTests.tsx` must label it in plain words, separating critical invariant violations from advisory notes. This is review M-1 from Task 31.
- **Tests:**
  - a fixture where the shortest route exceeds 100 m without rest but a slightly longer one passes;
  - a fixture where none passes, giving the warning and `partly_unverified`;
  - other profiles unchanged;
  - a performance guard on the Elmina seed: one older-adult route under 2 s.
- **Out of scope:** do NOT touch `data/seed`, `apps/web/src/features/scene/*` or `features/chat/*`. Coordinate with Task 42, which edits the API layers and web scene.

### Task 42: Gap map, where the world model is unknown or stale (AX-09) (API + FE)

From the audit: AX-09 is MISSING.

- **API:** `GET /layers/gaps?profile=` returns the walk edges and places, each with:
  - `unknown_count`: the profile-relevant attributes whose claim is unknown, missing, stale or contested;
  - `stale_count`;
  - `demand`: open VR demand for that element.

  It reuses `evaluate.py`'s per-profile relevant-attribute list and must not duplicate it. Add an ETag like the other layers, then run `pnpm gen`.
- **FE:** a "Gaps" toggle in the Layers group. It is off by default.
  - **Cesium:** colours edges by gap density in 3 bands ("Fully checked", "Some facts missing", "Many facts missing"), each with a pattern as well as a colour, and adds a legend.
  - **List view:** a "Biggest gaps" section, ordered by demand and then unknown_count. Each row is a button that opens the place card or the "Why this path?" equivalent.
  - **Manage:** the Verification queue links to the gap map.
- **Honesty:** this layer shows what isn't known. Copy says "facts not yet checked", never "unsafe" or "inaccessible".
- **Tests:** pytest for counts on the tiny fixture (stale, contested, missing); vitest for band mapping and the list order; DOM tests in the Task 39 Testing Library style.
- **Out of scope:** do NOT touch `routing.py`, `evaluate.py` (import from it only), `sim.py`, `data/` or `features/chat/*`.

### Task 43: Snap area places (parks, schools) to the walk network honestly (data)

**Found while reviewing Task 40.** 17 of 231 seed places have no `node_id`, so nothing can route to them (`no_data`). Most are large areas (11 parks, 3 schools, including the hero "Elmina Urban Park" `osm-way-1309457596`). `assign_nodes` (import_osm.py) snaps the area's **centre** to a node within 60 m, and a big park's centre is far from any path. The Overpass place query uses `out center`, so polygons are not cached.

- **Fetch:** for ways and relations among the place results, fetch geometry once (`out geom`), tiled like the existing place query and cached in `data/cache`. **Budget: ≤ 8 Overpass requests**, part of the 30 the team lead allowed for this run.
- **Snap:** a point place keeps today's rule. An area place snaps to the nearest walk node inside its polygon or within 40 m of its boundary. The place gets:
  - `node_inferred: true`;
  - a claim/evidence `access_point` with `evidence_type: osm_area_boundary_snap`, status `reported`.
  
  Routing to or from it adds the warning: "Route ends at the nearest mapped path to <name>; its entrance is not mapped." Keep `node_inferred` in the place model and the API, and run `pnpm gen`.
  
  A place that is still unsnapped stays `no_data` and appears in `coverage.json` (`places_without_node`).
- **Rebuild** in the usual order: import → overlay → flood → waste, from cache plus the new geometry. Measure before and after:
  - the number of places without a node;
  - default-profile routes from `park-b` to "Elmina Urban Park" and from "Elmina Urban Park" to `lakeside-mall`;
  - check that the hero route is unchanged.
- **Tests:**
  - area-snap unit tests (inside the polygon, within 40 m, beyond 40 m);
  - a seed regression: Elmina Urban Park has a node and a routable route with the warning.
- **Coordinate:** Task 40 (lane/ai) edits `packages/agent` and `data/demo`. Do not touch those; the coordinator re-records the demo cache after both merge. Task 41 (lane/be) edits `routing.py` and `sim.py`, so add the warning in `tools.py`, not `routing.py`. Task 42 (lane/fe) edits `apps/web` scene/list and adds `/layers/gaps`.

### Task 44: Resident-readable, honest answer wording (AI)

Found in the browser walkthrough of `/?demo=hero` on the Elmina seed, and in final review #2 (`.superpowers/…/final-review-2.md`: I1, I2, Minor 4, Minor 5). The answers and uncertainty notes show machine labels to residents:
- "Route status: partly_unverified"
- "Not checked yet: incline_pct on seg-1306543755-2"
- "stroller needs incline_pct ≤ 8.3; not verified"

They also claim "staff have been asked to check them" when only 10 of 56 were filed.

- **Readable labels:**
  - Status line: `Route status: confirmed | partly unverified | blocked | no mapped connection (data gap)`. The validator already accepts "partly unverified" with a space; extend it to every label, and keep the structured `route_status` in events unchanged.
  - Attribute names use catalogue labels: "Incline (%)", "Steps", "Width (m)", "Sidewalk", …. Reuse one mapping. If Python has none, add `ATTRIBUTE_LABELS` beside `attributes.py` and keep it in sync with the web `attributeCatalogue.ts` through a drift test.
  - Elements use their name ("Jalan Hopea U15/17D"), otherwise "an unnamed footway / street / major road". Never a raw `seg-…` id in answer text.
  - Uncertainty `note`s read like: "Stroller: incline not checked yet (limit 8.3%)". Never "≤ 8.3; not verified" or raw keys.
- **Honest counts (final-review I1):** state exactly what happened, e.g. "Asked the township team to check 10 of the 56 unchecked items." The numbers come from the `verification.requested` events this turn and the truncation count. Never say "staff have been asked" for items with no request. This applies to the mock and to `template.py`.
- **Cap the item count (Minor 4):** the "and N more" must count items, not segments.
- **Place-info questions (final-review I2):** "Tell me about <place>" and "What is at <place>" call `get_place_details` and summarise its claims with statuses. A found place must never produce "I don't have that place", and no VR is filed when the place exists.
- **Demo cache:** re-record every Elmina `data/demo` entry with the mock (all 11 tuples plus the default-profile stroller entry `db7c2bc4ca95419d`). Add a pytest that replays every Elmina entry against the current mock and diffs the events, ignoring ids, timestamps and demand (Minor 5).
- **Tests:**
  - wording tests for each label;
  - no `seg-` ids and no `_` keys in any in-app prompt answer;
  - the counts are exact;
  - place-info for Lakeside Mall.
- **Out of scope:** `apps/web` (the UI already renders the text), `packages/spatial` except the label map, and `data/seed`.

### Task 45: Demo-mode and doc fixes from final review #2 (FE + docs)

Final review #2 Minors 1, 2, 3 and 6 (`.superpowers/…/final-review-2.md`):
1. Esc on an open place card also exits the demo. Fix: `preventDefault()` in PlaceCard's Esc handler, and the same for FloodPathPopover. Add a DOM test.
2. The demo bar hides the bottom of the PlaceCard and FloodPathPopover. Fix: expose the bar height as the CSS variable `--demo-bar-h` while the demo is active, and offset those overlays' `bottom`. Add a DOM test.
3. StrictMode sends the question twice when ChatPanel mounts with a pending ask. Fix: read `useChatDraft.getState().pendingAsk` inside the effect and clear it atomically. Add a DOM test under `<StrictMode>` that asserts fetch is called once.
4. Doc drift:
   - `packages/spatial/README.md` and `docs/05-team/dev-setup.md` drive types now include `major_road`.
   - dev-setup still says "no Testing Library".
   - `README.md:47` has the stale "data scripts arrive with the data lane" sentence.
   - `CLAUDE.md` says "Tasks 15–36"; make it say "Tasks 15+".
- **Verify:** vitest, lint, typecheck, build, e2e. Commit on the lane branch.

### Task 46: Time-bounded closures (AX-07 + M-04) (BE + FE)

From the audit: AX-07 is MISSING (`get_closures` is a stub) and M-04 has no UI.

- **Model:** a closure is a claim-like record on an edge or a place: `{id, element_id, reason (works|event|flooding|other), starts_at, ends_at|null, note, created_by: staff, source: staff_report}`. Persist it in the per-world SQLite (the same DB as VRs, with an audit row on create and end). Load active closures into the world on startup and on change, guarded by `world_lock`, with a `world.version` bump so layer ETags change.
- **Evaluation:** an active closure (`now` within `[starts_at, ends_at)`) makes the element FAIL for every profile, with the reason "Closed: <reason> until <date or 'further notice'>". It never upgrades anything. Expired closures have no effect.
- **Tool:** `get_closures(near_place?, active_only=true)` replaces the stub. `plan_route` warnings name closures on the chosen route's alternatives when they forced a detour, if cheaply derivable; otherwise skip that part and say so.
- **API:**
  - staff `POST /closures` and `POST /closures/{id}/end`, both requiring the staff token;
  - public `GET /closures?active=`.
  
  Run `pnpm gen`.
- **FE:**
  - **Manage:** a "Closures" tab with a list, a create form (pick an element by id or from a place search, reason, start/end, note) and an "End now" button.
  - **Resident:** closed segments are drawn as "Not passable", with a "Closed" label in the list view and the place card.
- **Tests:**
  - evaluation inside and outside the window;
  - the tool;
  - the API (auth, 422 on an end before the start);
  - FE DOM tests for the form and list;
  - the ETag changes after a closure.
- **Honesty:** never say "safe". Closure text is staff-reported, so show "Reported closure (staff)" with its date.

### Task 47: Evacuation journeys in the journey simulator (G-07) (BE + small FE)

From the audit: G-07 is MISSING (sim tasks have no centre destinations).

- **Sim:** add evacuation journeys. For each profile in (default, stroller, wheelchair, older_adult_rest) and each scenario in (baseline, stage_p1m, stage_p3m, stage_p5m), and for a deterministic sample of residential origins (seeded RNG, N=50 per profile), find the nearest reachable evacuation centre with `list_evacuation_centres` / `centres_reachability`. Each journey ends in exactly one of these results:
  - `reachable_confirmed`
  - `reachable_partly_unverified`
  - `blocked_by_flood`
  - `no_mapped_connection`
  - `no_centre`
- **Invariants checked:**
  - **Monotonicity:** a journey that becomes blocked at +1 m stays non-confirmed at higher stages.
  - **Baseline:** a baseline journey equals the no-scenario result.
  - Report violations as critical. These are G-08 invariants (c).
- **Runtime:** keep the whole sim under the existing time budget. Final review #2 measured about 75 s synchronously. Cap the evacuation journeys to fit, or move the run to a background task with status polling. Ruling: background task, and `POST /simulations` returns `202` with a run id. The UI polls. Update the JourneyTests UI accordingly.
- **FE:** JourneyTests gains an "Evacuation" section: a table of profile × scenario with counts per result, in plain words.
- **Tests:** a tiny-fixture sim with known results; monotonicity on the seed (a sample); the 202 and polling API test; DOM tests for the table.

### Task 48: Agent wording for closures; uncertainty matches every caveat (AI)

Deferred from Task 46 (review I2: answers never name a closure) and Task 41 (its report: the uncertainty event says level "none" when the only caveat is the rest gap).

- **Closures in answers:** when `plan_route` returns `closures` (`RouteResult.closures`) or a closed start or destination, the mock and `template.py` name each closure in the Task 44 readable style: "Closed (staff report): <element name> until <date in Malaysia time> — <reason>". A route blocked by closures must say so, never just "blocked". `validate.py` rejects an answer about a route with closures that doesn't name them. The system prompt gets the same rule. `get_closures` is used for "is X closed?" questions.
- **Uncertainty event:** the level is "partial" whenever the answer carries any caveat: unverified segments, rest gap, unverified rest point, inferred entrance, closure or demo values. The items list each one in readable form. A test covers the rest-gap-only and the closure-only cases.
- **Tests:**
  - tiny-fixture closures (active, expired, on destination);
  - in-app prompts are unaffected;
  - the demo replay-diff test passes. Re-record Elmina entries only if they change.
- **Out of scope:** `packages/spatial` (read only), `apps/web`, `data/seed`.

### Task 49: Demo script, proposal outline and pitch docs match the built product (docs)

Demo & pitch polish (continuation run). `docs/03-product/demo-script.md`, `docs/06-pitch/pitch-narrative.md`, `proposal-outline.md`, `judge-qa.md` and `risks.md` predate what is built:
- `/?demo=hero`, deep spots, persona chips and "Where can I go?";
- the honest wording ("Route status: partly unverified", "demo values, not yet surveyed", "No mapped connection (data gap)");
- the gap map, closures, photo evidence, KPI tiles, journey tests (rest-gap advisories) and DEMO_MODE replay;
- `pnpm db:reset`.

- **Demo script:** rewrite `docs/03-product/demo-script.md` as the exact click path for the 14 Nov pitch.
  - **Setup checklist:**
    - `pnpm db:reset`, then the `townshiplens-dev-demo` config (`LLM_PROVIDER=mock DEMO_MODE=true pnpm dev`);
    - map keys present;
    - the fallback is the List view if Google tiles fail.
  - **Flows:** the `/?demo=hero` walkthrough, plus a manual path for each hero flow. Include what the screen shows at each step and the line the presenter says. Every claim must be checked against the app and the screenshots in `docs/06-pitch/screenshots/`.
  - **Backup:** a 60–90 s recorded video, and the List view without keys.
- **Pitch and proposal:**
  - Update `pitch-narrative.md` slide 3/4 references and `proposal-outline.md` §3 to cite the real screenshots by file name.
  - Update `judge-qa.md` answers where the product changed: the gap map's "16,131 of 16,148 not yet checked" as the field-survey pitch; closures; rest-gap honesty; major roads with no sidewalk data.
  - Update `risks.md` statuses for R6/R7 (validator, demo cache, replay-diff test, drift tests are now built).
- **Key numbers:** refresh `docs/06-pitch/key-numbers.md` with measured product numbers from `data/README.md`, `docs/superpowers/overnight-log.md` and the screenshots: walk components, connected share, centres connected, flood stage edge counts. Mark each as measured on the seed (date).
- **Method:** verify every statement against code, data, or a screenshot; invent nothing. Keep the existing tone and structure. Do NOT edit code, `AGENTS.md` or `CLAUDE.md`.
- **Verify:** `pnpm lint`. Commit `docs: …` on the lane branch.

### Task 50: Staff console readability and deep links (FE)

Found while capturing the pitch screenshots (continuation run).

- **Readable queue rows:** each verification-request row shows:
  - the attribute's catalogue label ("Incline (%)", from `attributeCatalogue.ts` / `optionLabel`), not `incline_pct`;
  - the element's name, or "unnamed footway / street / major road", using the same naming as the chat (`useElementNames` / `citationLabel`) where the data is available;
  - the raw id in small, muted text for staff lookup;
  - "Reason" values as words ("Unknown", "Stale", "No route: unverified segment", …).

  Filters keep the raw values internally.
- **Deep links:** `/manage?tab=queue|briefing|journeys|closures` opens that tab. Changing tab updates the URL with `replace`, so Back isn't spammed. Unknown values fall back to the queue. The demo-mode script's manage steps use these links if they don't already.
- **Tests:** DOM tests (Task 39 style) for row labels and each tab deep link; update e2e selectors only if needed.
- **Verify:** vitest, lint, typecheck, build, e2e.
- **Out of scope:** `apps/api`, `packages/*`, `data/`.

### Task 51: Frontend Minors sweep (quality)

Parked Minor findings from the web-side task reviews: Tasks 23, 25, 27, 32, 33, 35, 36, 37, 39, 42, 45, 50, and final reviews #1 and #2. The review files are `.superpowers/sdd/2026-10-15-mvp-p0-increment-1/task-*-review.md`, `final-review.md` and `final-review-2.md`.

- For each Minor that concerns `apps/web`:
  1. Check whether it still applies on current main. Many were fixed later.
  2. If it does, fix it with a test where a test makes sense.
  3. Skip anything that needs API or contract changes, and list it.
- **Report** a table: finding id → status (fixed / already fixed / not applicable / deferred-with-reason).
- **Rules:** no behaviour change beyond what each Minor asks. Keep the honesty invariants. DOM tests in the Task 39 style.
- **Verify:** vitest, lint, typecheck, build, e2e.
- **Out of scope:** `apps/api`, `packages/*`, `data/`.
