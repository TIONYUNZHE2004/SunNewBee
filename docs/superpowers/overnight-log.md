# Overnight Log: Platform Walking Skeleton

## Run parameters
- **Run start:** 2026-10-15 01:25 +08 · **Deadline:** 09:25 +08 · **Wind-down starts:** 09:10
- **Scope:** [spec](specs/2026-10-15-platform-walking-skeleton-design.md) · [plan](plans/2026-10-15-platform-walking-skeleton.md) · MVP priorities in [mvp-spec](../03-product/mvp-spec.md)
- **Authorisation:** implement, test, commit and push verified changes to `main`. No paid resources, no secrets in code/docs/logs, no force-push.
- **Live-service limits:**
  - OpenRouter: smoke tests only, ≤ 30 requests and ≤ 150k tokens (team lead's cap is US$3 for the night; mock everywhere else).
  - Google Photoreal tiles: ≤ 30 page loads.
  - Mapbox and Cesium ion: free tiers only.
- **Continuity:** this run lives in one desktop session. The team lead keeps the Mac awake. There's no background scheduler, so if the session stops, resume from the "Resume instructions" section.

## Preflight (01:25–01:40)
| Check | Result |
|---|---|
| git | `main` clean, in sync with `origin` (the GitHub repo was renamed to `SunNewBee`; pushes succeed via redirect). Last commit `d6306c8` |
| gh | logged in (`jqc-lgtm`); no CI runs yet (no workflow existed) |
| Tooling | node 24.15, pnpm 11.25, uv 0.12.5, python 3.14.6 (uv will provision 3.13), docker 29.7 |
| Keys (names only; values never read) | `.env` at the root has `OPENCELLID_TOKEN`, `OPENROUTER_API_KEY`, `MAPBOX_ACCESS_TOKEN` (pk.), `CESIUM_ION_ACCESS_TOKEN`, `GOOGLE_MAPS_API_KEY`; gitignored |
| Capabilities | Subagents ✓ · git worktrees ✓ · superpowers skills ✓ (subagent-driven-development, systematic-debugging, writing-plans) · ui-ux-pro-max skills ✓ · Context7 CLI ✓ · WebSearch/WebFetch ✓ · built-in browser pane ✓ |
| Baseline tests | No product code yet, so no tests: baseline **NOT RUN (nothing to run)** |
| Research | Reusing the existing research ([agent-harness-2026](../02-research/agent-harness-2026.md), [township-3d-engine-and-data](../02-research/township-3d-engine-and-data.md), [flood-disaster-lens](../02-research/flood-disaster-lens.md)) and the 30+ reference repos already cloned. Lane implementers verify library APIs via Context7 / the cloned repos as they go |

## Execution design
- Foundation (Tasks 1–2) runs in worktree `wt-foundation`, then is reviewed and merged to `main`.
- Then four lane worktrees branch from `main`: `lane/data` (Tasks 3, 10), `lane/be` (4→5→6→7), `lane/ai` (8, then 9 after BE Task 7 is merged), `lane/fe` (11→12→13). The coordinator reviews each task and merges it to `main` (rebasing the lane when needed), runs the combined checks, then pushes.
- Lockfiles and shared root config are settled in Task 1 (ruling R2), so lanes don't touch them.

## Preflight rulings (also in the SDD ledger)
- **R1:** the root `pyproject.toml` testpaths and `data/__init__` move to Task 1 (shared file). Cost if wrong: none.
- **R2:** `apps/web/package.json` and the full dependency set are installed in Task 1, so lockfiles are settled once. Cost: Task 1 is slightly larger.
- **R3:** CI uses `uv sync --all-groups` (data tests need `requests`); the API declares `pydantic-settings`.
- **R5:** "island" = a component of the passable (non-FAIL) graph containing no evacuation centre; the test was rewritten to stage +5 m, where `{n-a, n-b}` becomes an island.
- **R11:** fixture `seg-fd.width_m` is set to unknown. Otherwise park-b → kiosk has a confirmed detour and the plan's `partly_unverified` tests would contradict the routing rule.
- **R16:** FE implementers load the ui-ux-pro-max design-system and ui-styling skills before UI work.
- **R17:** no new research agents; existing research + Context7 per task (time box).

## Cycle log
<!-- append entries below: timestamp · elapsed · researched · built · reviewed · verified (cmd → PASS/FAIL/BLOCKED/NOT RUN) · blocked · decisions · commits/push/CI · external usage · next -->

### 01:33 (+0:08)
- **Built:** Task 1 (monorepo foundation): commits `d1b9433`, `1d8fa1f` on `wt/foundation`. Review: spec ✅, quality approved (minors deferred).
- **Verified:** `pnpm install` PASS · `uv sync --all-packages --all-groups` PASS · `pnpm lint` PASS (implementer evidence).
- **Decisions:** Task 1 ruling: CI stays green until later tasks via an api-client tsconfig override, a stub web tsconfig and a guarded golden step (the guard is removed in Task 14).
- **In flight:** Task 2 (contracts, foundation worktree) · Task 3 (OSM import, `lane/data` worktree, parallel).
- **External usage:** OpenRouter 0/30 · Google tiles 0/30 · Overpass: Task 3 capped at ~40 requests.
- **Next:** review Task 2 → merge the foundation to `main` → push → open the BE/AI/FE lanes.

### 01:37 (+0:12)
- **Built and integrated:** Task 2 (shared contracts, fixtures, API stubs, TS client). Review: spec ✅, quality approved. The foundation was fast-forwarded to `main` at `16ca31b` and pushed.
- **Verified (main, local):** `uv run pytest` PASS (5) · `pnpm lint` PASS · `pnpm -r typecheck` PASS · `pnpm gen` then `git diff` shows no drift: PASS.
- **CI:** run 38607947602 **FAIL** at `pnpm -r test`: vitest exits 1 when there are no test files in `apps/web` (only the stub exists). Root cause confirmed from the log. Task 11 (in flight) adds the web tests, so this resolves when the FE lane merges. No config change was made.
- **In flight:** Task 3 (data), Task 4 (BE), Task 8 (AI), Task 11 (FE), each in its own worktree.
- **External usage:** OpenRouter 0 · Google tiles 0.

### 01:43 (+0:18)  (timestamps are now taken from `date`; the two entries above were corrected)
- **Integrated to main and pushed:**
  - Task 4: world loader and VR store (`cb3d388`, review clean).
  - Task 11: web scaffold (merge `8e084ec`; fix round 1 resolved a Critical status-contract miss, the profile persistence gap, view-gating, a11y fixes and `envPrefix` hardening).
  - Task 8: agent core (merge `7800a3a`; 2 fix rounds fixed template validity, mock crash-safety without swallowing bugs, the ZH depth regex and the validator backstop).
- **Verified (main):** `uv run pytest` PASS (60) · web vitest PASS (17) · lint PASS · typecheck PASS · web build PASS.
- **CI:** run 38608890630 (Task 11 merge) **PASS**. The earlier two failures were the known "no web tests" transient, now resolved. Run 38609075301 (Task 8 merge) is queued.
- **In review/fix:** Task 5 (routing): an Opus review found a Critical parallel-edge selection bug plus 4 Important issues; the fix is done and in scoped re-review. Task 12 (Cesium/Mapbox/chat) is implementing. Task 3 (OSM import) is still fetching Overpass tiles (4 cached).
- **Rulings:** Task 8 validator backstop added (answered on blocked/no_data rejected).
- **External usage:** OpenRouter 0 · Google tiles 0 · Overpass about 4–8 requests.

### 01:56 (+0:31)
- **Integrated to main and pushed:**
  - Task 5 (`e19e280`): routing. An Opus review caught a Critical parallel-edge selection bug, and 3 fix rounds also fixed CJK/BM place search, ranking ties and the steps rule.
  - Task 6 (`71e35e4`): flood analytics and the 10-tool registry. Review fixes: no shared-state mutation, flood-induced islands only, fast centre reachability, grouped briefing lists.
  - Task 12: the Cesium hero, Mapbox lite, scenario bar and streaming chat. Fixes: a Critical bug where Cesium init never ran (resium ref timing), requestRender, batched GroundPolylinePrimitives for township scale, a shared status mapper, non-colour cues, a legend, and Mapbox layer order.
  - Task 13 (`957b581`): the management page.
- **Verified (main, combined):** pytest PASS (129) · web vitest PASS (49 / 13 files) · lint PASS · typecheck PASS · web build PASS.
- **CI:** the Task 11 merge PASSED. The later runs were not individually checked yet (to do).
- **In flight:** Task 7 (real API): implemented (146 tests), Opus review running. Task 3 (OSM import): scripts written, Overpass fetch still in progress (7 tiles cached, no seed yet).
- **Rulings:**
  - Canonical `status_for_profile` values.
  - The transient centre-place approach was replaced by `__centre__` target resolution.
  - Small final fix diffs (2–17 lines) were verified directly by the coordinator.
- **External usage:** OpenRouter 0 · Google tiles 0 · Overpass about 7–14 requests.
- **Next:** finish the Task 7 review → integrate → Task 9 (agent + SSE) on the AI lane → Task 3/10 data → Task 14 integration + browser verification.
- **CI FAIL (root cause):** run 38610599711 failed at the OpenAPI drift step. Task 6 extended `AffectedResult` (`isolated_total`, `*_ids`, `*_total`) without running `pnpm gen`, and my integration checklist didn't include the drift check. **Fix:** Task 7 (in review) regenerates the client; it merges next. **Process change:** every integration now runs `pnpm gen && git diff --exit-code packages/api-client` before pushing.

### 02:05 (+0:40)
- **Integrated:** Task 7, the real API (merge `cb64083`; review fixes: VR-store locking, robust ids, copy-on-write claims, constant-time staff token with default-token refusal, layer cache, chat error fallback, CORS from settings). The backend lane (Tasks 4–7) is done.
- **Verified (main, full checklist):** pytest PASS (150) · web vitest PASS (49) · lint PASS · `pnpm gen` no drift PASS · typecheck PASS · web build PASS. Pushed.
- **Browser verification (main, real keys, Google tiles load 1/30):** the page shell, layer toggles, legend, chat suggestions and attribution render, and API calls return 200. **FAIL: the 3D scene is blank.** Root cause: vite-plugin-static-copy v4 preserves the source directory structure, so Cesium's Workers and Assets are served as HTML (SPA fallback). Evidence: console JSON parse and MIME errors; `fetch('/cesium/Assets/approximateTerrainHeights.json')` returns `text/html`; `dist/cesium/node_modules/cesium/Build/Cesium/...`. Fix round 4 was dispatched to the Task 12 implementer (`stripBase` plus a post-build asset check).
- **In flight:** Task 9 (agent + SSE, Opus implementer) · Task 10 (flood raster pipeline, Opus implementer) · Task 3 (Overpass 504s, retrying with backoff) · Task 12 round 4.
- **External usage:** OpenRouter 0 · Google tiles 1/30 · Overpass ~14 requests.

### 02:12 (+0:47)
- **Integrated:**
  - Task 12 round 4: the Cesium asset paths, with a build-time asset check (`32b7d6c`).
  - Task 12 round 5: render on tile load, a destroyed-viewer guard and a visible tile-failure notice (`ea43ae0`).
- **Browser verification (real keys, main, mock LLM):**
  - **PASS:** Google Photorealistic 3D of the Elmina area renders with our markers, and the initial view is sharp without interaction after round 5. Screenshots: `docs/superpowers/screenshots/2026-10-15-0206-cesium-google-photoreal-elmina.jpg` and `…0208-cesium-initial-view-sharp.jpg`.
  - **Debugging evidence (systematic):** tileset creation succeeded in the page (`root.json`), the instrumented effect ran and added tiles, and the Google credits appeared, which proved tiles were streaming. The root cause was frames not being requested on tile load in requestRenderMode. The temporary instrumentation was reverted (never committed).
  - **Minor (to Task 14):** the initial camera looks past the site; frame the site bbox instead.
- **Task 9 (agent + SSE):** implemented on `lane/ai`, with `main` merged in (186 tests, golden 6/6 mock). It closed the flooded-endpoint gap: a route endpoint that is likely flooded produces evidence plus a caveat, and the validator enforces it. Opus review in progress.
- **Task 10 (flood pipeline):** Opus implementer running. **Task 3:** Overpass tiles cached (9); the implementer is fixing a parsing error.
- **External usage:** OpenRouter 0/30 · Google tiles ≈8/30 · Overpass ≈18.

### 02:23 (+0:58): the walking-skeleton hero flows are verified end to end
- **Integrated:** Task 9, the PydanticAI agent + `run_turn` SSE + CLI + golden runner (merge `fcb50d3`). Review fixes:
  - the UI scenario is now applied to routing (Critical);
  - caveats are required for flooded route endpoints;
  - `scenario_id` is constrained (blocks prompt injection);
  - VRs filed by the model are sanitised and never store model-written text (PDPA);
  - turn timeout, rendering guard, and tools offloaded to threads.
- **Full checklist (main):** pytest PASS (212) · golden PASS 6/6 (mock) · web vitest PASS (49) · lint PASS · `pnpm gen` no drift PASS · typecheck PASS · web build PASS (Cesium asset check OK). Pushed.
- **Browser E2E (mock LLM, tiny fixture world, real map keys):**
  - **Access hero: PASS.** Tool chips, a partly-unverified route, the unknown incline caveat first, citations with placeholder badges, a VR filed, and the route drawn on Google photoreal 3D. (`screenshots/2026-10-15-0222-access-hero-mock-tiny-fixture.jpg`)
  - **Flood hero: PASS.** The scenario bar shows +3 m. Water renders over the photoreal tiles, with red likely-flooded and orange dashed possibly-flooded segments and "Community hall (candidate): Reachable". The disclaimer shows in both the banner and the chat, with source-labelled citations. (`…0223-flood-hero-mock-tiny-fixture.jpg`)
  - **Management: PASS.** The VR queue shows the gap with its demand. The flood briefing shows counts, centres with a source column, and the advisory draft with no send button.
  - **Resolve:** not exercised. The root `.env` has no `STAFF_TOKEN`, so the API refuses with 503 by design. The team lead needs to add `STAFF_TOKEN` to use it.
- **Live LLM smoke (OpenRouter `anthropic/claude-haiku-5.5`, tiny fixture world):**
  - **Access: PASS.** Correct tools, a VR, partial status and validated citations.
  - **Flood-resident: PASS.** Indicative wording, honest partly-unverified and blocked results, no "safe", disclaimer present.
  - **Management briefing: PASS.** Honest about missing reachability data.
  - **Usage:** about 16 model requests, **US$0.0062** (OpenRouter daily counter 0.0000 → 0.0062). Limits: ≤ 30 requests / US$3. These results are for the **tiny fixture world**; live on the real Elmina seed is NOT RUN until Task 3 merges.
- **Task 10 (flood):** ruling made: switch to REM (height above mapped OSM drainage), because ASF HAND's dense drainage flooded 39% of segments at +1 m, contradicting the verified local facts. ADR 0010 amended (`main`). Rework in progress.
- **External usage:** OpenRouter about 16 req / US$0.0062 · Google tiles about 12/30 · Overpass about 18.

### 02:34 (+1:09)
- **Integrated:** Task 14A (`8fa36e8`):
  - Playwright hero smoke tests (6: access, flood with no "safe" after the stream completes, manage VR, flood briefing sources, accessible names on `/` and `/manage`).
  - A CI Playwright step with artifacts.
  - READMEs (root and web refreshed; api, spatial and agent checked).
  - Docs synced (dev-setup commands, stack-decision deviations, the spec's "Deviations (implemented)" section; spec status "implemented, walking skeleton, tiny-fixture verified; real-data verification pending").
- **Full checklist (main):** pytest PASS (212) · golden 6/6 PASS (mock) · web vitest PASS (49) · e2e 6/6 PASS (implementer evidence, mock + tiny fixture) · lint PASS · gen no drift PASS · typecheck PASS.
- **CI:** run for `8fa36e8` **PASS** (first CI run including Playwright).
- **Walking-skeleton status:** Tasks 1, 2, 4–9, 11–13 and 14A are done and reviewed. **Remaining:** Task 3 (OSM import; Overpass mirrors keep timing out, implementer still iterating) → Task 10 vector stage (flood REM rework in progress) → Task 14B (real-data verification).
- **External usage:** OpenRouter about 16 req / US$0.0062 · Google tiles about 12/30.

### 02:40 (+1:15)
- **Integrated (increment 1, plan `plans/2026-10-15-mvp-p0-increment-1.md`):**
  - Task 17: place cards (P-04) (`a179bc9`; web 54, e2e 7/7).
  - Task 16: DEMO_MODE cache (C-10) (merge `75c6ba2`; replay keeps the VR queue consistent; world-tagged mock recordings; the `--record` guard refuses live models unless `--allow-live` is passed).
- **Task 3 (OSM import): done** after a roughly 66-minute run against the overloaded Overpass mirrors. It made about 53 requests against my ~40 cap (retries on 504s/timeouts; logged as an overrun). It produced 15,252 segments, 227 places and 204 hydrology features.
  - **Coordinator integration check:** the seed loads with the real world loader (0.2 s), and the stroller route park-b → playground is confirmed (440.6 m).
  - **Found:** `find_place("playground")` resolves to unnamed OSM playgrounds instead of the demo place. This is in review.
- **Task 15 (sim runner):** the Opus review found the I7 filter hiding real rest-gap violations. Ruling: I7 applies to every offered route. A fix round is in progress (perf pruning, storage slimming).
- **Task 10 (flood REM rework):** in progress.
- **External usage:** OpenRouter about 16 req / US$0.0062 · Google tiles about 12/30 · **Overpass about 55 (cap ~40 exceeded by the data lane's retries)**.

### 02:44
- **Integrated:**
  - Task 15: resident-agent batch runner + gap ranking + `/simulations` (merge `1233e9c`; Opus review → I7 ruling, perf budget, storage slimming).
  - **Task 3: Elmina OSM seed** (merge `1a498b3`). The review fixes removed duplicate hero places, gave unnamed OSM places non-generic names, dropped the invented `seat_count`, made the steps-default provenance honest, and merge claims instead of overwriting them. Coordinator check: "playground", "car park b" and "lakeside mall" each resolve to the hero place first; stroller park-b → playground is confirmed at 440.6 m. One `biome.json` merge conflict was resolved (union of ignore lists).
- **Verified (main):** pytest PASS (240) · golden 6/6 PASS (mock) · web vitest PASS (54) · e2e 7/7 PASS · lint PASS · gen no drift PASS · typecheck PASS. Pushed.
- **The API now defaults to the real Elmina seed.** No flood data on main yet; Task 10 is in review, then a rebase onto the seed and the vector-stage run.
- **In flight:** Task 18 (attribute editor + audit, in review) · Task 19 (journey-tests UI) · Task 10 review (Opus).
