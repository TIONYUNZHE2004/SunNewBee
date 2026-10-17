# T-011 Limit the assistant to scope B (access + flood evacuation)

- **Status:** done
- **Owner:** Codex worker
- **Branch:** `codex/yunzhe-workflow`
- **Priority:** P1 (before open demo)
- **Lane:** AI (+ MCP server)
- **Source:** Scope B decision; replaces nothing

## Goal

Scope B (Yunzhe, 17 Oct): the resident assistant answers only **access** (step-free routes, place facts, nearby amenities, closures, tickets for gaps) and **flood evacuation** (indicative river stages, affected places, evacuation centres, routes under a stage). Everything else (waste, what-if, tipping point, rising river, fix-it, verify-next planner, Elmina Day) gets a short, polite "outside what I can check" answer with no tool call.

Add a setting `ASSISTANT_SCOPE` with values `access_flood` (default) and `all`. In `access_flood`, register only these tools with the model: `find_place`, `get_place_details`, `plan_route`, `nearby_amenities`, `get_closures`, `create_verification_request`, `list_flood_scenarios`, `affected_places`, `list_evacuation_centres`. Apply the same list to the MCP server. The mock, the template and the validator must handle the refusal. Staff screens (What-if Lab, Elmina Day pages) are not part of this task.

## Acceptance

In `access_flood`: out-of-scope questions (one per removed feature, EN/BM/中文) get the refusal and no tool call; every in-scope golden question still passes. Tests that cover out-of-scope assistant features set `ASSISTANT_SCOPE=all` explicitly and still pass. The full checklist passes.

## Log

- 2026-10-17 09:29 UTC · control (claude/sweet-davinci-29v7ne) · Created for scope B (access + flood evacuation, deep spot), assigned to Codex worker.

- 2026-10-17 11:39 UTC · Codex (codex/yunzhe-workflow) · Started. Fetched and merged control again immediately before work (still 95e9e56; no new mock/template changes there). Plan: ASSISTANT_SCOPE access_flood default/all opt-in; shared nine-tool allowlist for agent/MCP; localized no-tool refusals before demo replay; scoped model instructions; explicit all opt-in for legacy-feature tests. Staff REST/screens and route evaluation unchanged. Live turns 0.

- 2026-10-17 11:47 UTC · Codex (codex/yunzhe-workflow) · Finding: restricted registry and early policy are working. 32 default-scope tests PASS: 22 removed/unrelated EN/BM/Chinese prompts refuse before model/cache/tools; in-scope fixed-stage questions remain allowed; model sees exactly nine permitted tools. MCP preserves existing write opt-in (eight default, nine with MCP_ALLOW_VR). Golden PASS 22, with eleven legacy-feature cases explicitly assistant_scope all. Recovered legacy regression group PASS 103 after explicit all opt-ins. Staff REST/screens untouched; only Playwright test configuration opts legacy suite into all. Live turns 0.

- 2026-10-17 11:50 UTC · Codex (codex/yunzhe-workflow) · Implementation committed: 61b1d12 policy/registry, 15c7312 explicit legacy test opt-ins, e21e92c restricted baseline. Default-scope tests PASS 34 plus 3 scorer tests; baseline is correct 1/32, honestly unverified 9/32, refused correctly 3/32, wrong 19/32; detected unsupported claims 3/32, 0/32 reviewed. Added BM di luar and Chinese 超出 refusal equivalents (no factual expectation weakened). Final seven-step checklist running on committed tree and will also close T-008 verification. Live turns 0.

- 2026-10-17 11:55 UTC · Codex (codex/yunzhe-workflow) · Ready for review in PR #7: https://github.com/TIONYUNZHE2004/SunNewBee/pull/7. Final checklist: 1 lint PASS; 2 pytest PASS 1365; 3 types PASS; 4 JS PASS 789; 5 gen/no drift PASS; 6 golden PASS 22/22 with zero fallbacks; 7 E2E PASS 19 using system Chromium. Shared exact nine-tool scope; MCP remains eight unless write opt-in. Default policy tests PASS 34; legacy tests opt into all. No staff screen or route evaluation changes. Latest control refetched 11:54 UTC, still 95e9e56; Cannon still f940039. Live OpenRouter turns 0. GitHub CI pending at time of log; local seven-step checks complete.
- 2026-10-17 13:51 UTC · control (claude/sweet-davinci-29v7ne) · Merged into control (PR #7). ASSISTANT_SCOPE=access_flood default; nine tools; MCP limited the same way. Control re-ran all 7 checks on the combined control head cf251b1 (PR #7 + PR #8): lint PASS (warnings only), pytest 1435 PASS, typecheck PASS, vitest 789 PASS, gen no drift PASS, golden 22/22 PASS, e2e 19/19 PASS (mock LLM).
