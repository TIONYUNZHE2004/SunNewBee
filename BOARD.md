# Task board

> Only the control session edits this file. Workers report in their task's `## Log`. Rules: [README.md](README.md).

Last updated: 2026-10-19 16:19 UTC by control (claude/sweet-davinci-29v7ne)

## Scope B+ (Yunzhe, 17-18 Oct 2026)

The resident assistant covers **access** (routes, places, amenities, closures, tickets for gaps) and **flood evacuation**. It does not refuse a question for its wording: routes and places anywhere in Elmina are answered, with a caveat outside the **deep spot (Elmina Urban Park + Lakeside Mall frontage)**, which stays the accuracy target. Only clearly removed topics (waste, what-if, tipping point, rollout, fix-it, verify-next, Elmina Day) are refused. Our agents may change Backend files when a task needs it and list them in the PR for Jun Quan.

| Task | Title | Status | Priority | Owner |
|---|---|---|---|---|
| [T-001](tasks/T-001-validator-fact-binding.md) | Bind every stated fact to a tool field (audit A2) | in-progress | P1 | Local AI engineer |
| [T-002](tasks/T-002-withhold-unchecked-drafts.md) | Never show a rejected answer as a draft (audit A3) | done | P1 | Claude worker |
| [T-003](tasks/T-003-certainty-filter-negation.md) | Fix negation and paraphrase gaps in the promise filter (audit A4) | done | P1 | Claude worker |
| [T-004](tasks/T-004-redaction-coverage.md) | Redact phone numbers with brackets and spaced MyKad numbers (audit A5) | parked | P2 | unassigned |
| [T-005](tasks/T-005-resident-voice-outcome.md) | Resident diaries must not contradict the trip outcome (audit A6) | parked | P3 | unassigned |
| [T-006](tasks/T-006-honest-eval-reporting.md) | Report evaluation results without overclaiming (audit A8) | parked | P3 | unassigned |
| [T-007](tasks/T-007-live-smoke-after-fixes.md) | Live OpenRouter smoke test after T-001 to T-003 | blocked | P1 | Control session |
| [T-008](tasks/T-008-amenity-provenance.md) | Invented toilet returned as ordinary evidence (audit A1, Cannon F1) | done | P1 | Codex worker |
| [T-009](tasks/T-009-chat-admission-limit.md) | Rate and cost limit for public chat (audit A7) | parked | P2 | unassigned |
| [T-010](tasks/T-010-crossings-seed-rebuild.md) | Rebuild the Elmina seed so crossings get real types | assigned | P3 | Local backend engineer |
| [T-011](tasks/T-011-assistant-scope-b.md) | Limit the assistant to scope B (access + flood evacuation) | done | P1 | Codex worker |
| [T-012](tasks/T-012-answer-key-deep-spot.md) | Human-checked answer key for scope B (about 30 questions) | review | P1 | Codex worker |
| [T-013](tasks/T-013-scope-gate-routes-places.md) | Stop keyword blocking; answer routes and places anywhere in Elmina | assigned | P1 | Local AI engineer |
| [T-014](tasks/T-014-sidewalk-vs-road.md) | Tell sidewalks from roads in data, routing and answers | assigned | P1 | Local backend engineer |
| [T-015](tasks/T-015-answer-key-refresh.md) | Refresh the answer key for the new seed and fix scorer false positives | assigned | P1 | Local AI engineer |
| [T-016](tasks/T-016-backend-audit.md) | Backend engineer: ranked audit of routing, places, flood and data | assigned | P1 | Local backend engineer |
| [T-017](tasks/T-017-ai-audit.md) | AI engineer: ranked audit of answers with a small live budget | assigned | P1 | Local AI engineer |
| [T-018](tasks/T-018-path-map-audit.md) | Audit paths and roads on the map: missing paths, wrong types, misleading colours | assigned | P1 | Local backend engineer |
| [T-019](tasks/T-019-answer-path-wording.md) | Audit route answers against the path data; fix overclaiming wording | assigned | P1 | Local AI engineer |
| [T-020](tasks/T-020-estimated-tier.md) | Replace "all yellow" with an honest "Likely OK (estimated)" level | assigned | P1 | Both local engineers |
| [T-021](tasks/T-021-turn-by-turn-navigation.md) | Turn-by-turn route steps, like Waze (after the six P1 audit fixes) | assigned | P1 | Both local engineers |
| [T-022](tasks/T-022-place-data-cleanup.md) | Clean place data: township scope, types, duplicates, prison surau as evacuation candidate | assigned | P1 | Local backend engineer |
| [T-023](tasks/T-023-management-panel-scope.md) | Management panel answers like the resident panel | assigned | P1 | Cloud AI worker |
| [T-024](tasks/T-024-flood-impact-markers.md) | River rise +1/+2/+3 m with flooded and cut-off markers | assigned | P1 | Cloud backend worker + shaoxian04 |
| [T-025](tasks/T-025-event-closure-simulation.md) | Event simulation (marathon): affected routes, detours, suggestions | assigned | P1 | Cloud workers + shaoxian04 |
| [T-026](tasks/T-026-traffic-closure-system.md) | General traffic and closure simulation (any closure, detour pressure, keep traffic moving) | done (PR #25 + #27 → davinci; main via #28, 21 Oct) | P1 | Cloud Codex (backend) + cloud Claude (re-wire) |
| [T-027](tasks/T-027-ui-flood-and-closures.md) | UI: flood markers and closure screen in shaoxian04's style | done (PR #26 + #27; main via #28, 21 Oct) | P1 | Cloud Claude |
| [T-028](tasks/T-028-marathon-engine.md) | Marathon engine: AI proposes a course, manager edits; road names on map; playback | assigned | P1 | Cloud Codex (backend) + cloud Claude (agent, web) |
| [T-029](tasks/T-029-flood-low-lying.md) | Flood: river rise + low-lying areas, judge loop | assigned | P1 | Cloud Codex (builds) + cloud Claude (judge) |
| [T-030](tasks/T-030-demo-qa.md) | Demo QA: golden cases, demo_check.py, e2e for the 3 demo stories | assigned | P1 | Cloud Codex #2 |


## Audit P1 fixes (control, 19 Oct 16:30 UTC)

The backend engineer already fixed all six P1 findings, both lanes, at `26d90b4` on `local/backend-engineer` (01:42 UTC). That branch also contains the AI engineer's T-019 and T-020 work. So nobody redoes them. Next:

| Engineer | Next, in order |
|---|---|
| AI (Claude) | 1. Merge `origin/local/backend-engineer` into your branch. Cross-check its `packages/agent` changes (`route_binding.py`, `validate.py`, `run.py`, mock, template): run `uv run pytest -q`, try to break the route binding, log findings. 2. T-021 AI part, after the backend contract note. |
| Backend (Codex) | 1. T-021 contract note, then the `maneuvers` step list. 2. The remaining list in `data/audits/2026-10-19-backend-ai-review/fix-results.json`. Do not edit `packages/agent` while the AI engineer cross-checks it. |

Control opens one PR from `local/backend-engineer` in the morning, not overnight (each push would re-run CI).

## PR #15 to main (control, 2026-10-19 23:21 UTC)

https://github.com/TIONYUNZHE2004/SunNewBee/pull/15 holds `main` + both engineer branches. **Hold merge** until this is fixed:

- **Backend (Codex), next item:** for rest profiles (`older_adult_rest`), when no route meets the rest limit, the fallback must prefer the route with the smallest longest-stretch-without-rest, not only the lowest weight. Repro: Harmoni 1 (`osm-way-909868201`) → `park-b`, older_adult_rest: main gives 966 m via bench-urban-3/2/1 (gap 640 m); with T-020 weights it gives 1,503 m (gap 1,312 m). Tests: `packages/spatial/tests/test_journey.py::test_demo_route_yields_the_spec_table` and golden `journey-demo-walker`. Work on `claude/sweet-davinci-29v7ne` merged into your branch.
- **Full local run on `2d7e534`: 69 tests fail** (list: `tasks/pr15-failing-tests.txt`). Most are `packages/agent` journey tests from `main` (shaoxian's journey simulation) that meet the new rules: no silent demo origin, exact endpoints, canonical route text, and the changed rest route. Order: (1) Codex lands the rest-gap fallback above on its branch; (2) the **AI engineer** merges `origin/claude/sweet-davinci-29v7ne` and Codex's fix into `local/ai-engineer` and makes every listed test pass, keeping both sets of rules: journey play stays, and a question with no stated origin is never answered with a demo origin (change the test question to name the origin instead). Never skip or delete a test. (3) Both log "ready for PR"; control merges into davinci and PR #15 re-runs CI.
- **Backend ready for PR: `b1b47d7`** (rest-gap fallback + T-022 data). AI engineer: merge it now.
- **Ruling (Yunzhe, 20 Oct): closed destination (AUD-012) = option A.** Show the route, but the first line says "Closed now" (with the closure label) and the route is never `confirmed`. Backend sets the status cap and warning; AI keeps the line first.

## Workers from 20 Oct (Yunzhe)

Local agents are retired; their branches are merged into davinci. New work goes to **cloud workers** (Claude Code on the web, ChatGPT Codex cloud), one branch per task, deleted after merge. Decisions 20 Oct: mosque test follows the cleaned place list (A); river scenarios +1/+2/+3 m (A); shaoxian04 builds the map markers and manager screens against our APIs (A).

## Who does what

| Agent | Where | Tasks |
|---|---|---|
| Local AI engineer (Claude, Yunzhe's computer) | `local/ai-engineer` worktree | T-013 → T-001 → T-015 → T-017 |
| Local backend engineer (Codex, Yunzhe's computer) | `local/backend-engineer` worktree | T-016 → T-014 (with T-010); cross-checks the AI engineer's PRs |
| Control | `claude/sweet-davinci-29v7ne` | Merge green PRs, keep this board, run Codex's audit probes on AI PRs before merging, T-007 on Yunzhe's instruction |

Cloud Claude and cloud Codex workers: stopped by Yunzhe on 18 Oct; their open tasks moved to the local AI engineer.

Priorities: P1 before the 23 Oct proposal, P2 before collecting resident questions, P3 before claiming whole-system validation.

## Done


| Task | Title | Merged |
|---|---|---|
| T-002, T-003 | Drafts checked; promise filter clause-scoped | PR #8 → control |
| T-008, T-011 | Demo place provenance; assistant limited to scope B | PR #7 → control |
| — | Cannon audit fixes F2–F5 (partial, see T-001 to T-004) | PR #2 → control, PR #3 → main |
| — | Codex independent audit | PR #4 → control, PR #5 → main |
