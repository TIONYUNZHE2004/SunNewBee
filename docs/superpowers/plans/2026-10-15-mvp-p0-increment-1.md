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
