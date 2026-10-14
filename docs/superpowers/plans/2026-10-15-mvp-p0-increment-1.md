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
