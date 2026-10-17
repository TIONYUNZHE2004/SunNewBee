# T-011 Limit the assistant to scope B (access + flood evacuation)

- **Status:** assigned
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
