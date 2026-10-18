# Task board

> Only the control session edits this file. Workers report in their task's `## Log`. Rules: [README.md](README.md).

Last updated: 2026-10-18 14:59 UTC by control (claude/sweet-davinci-29v7ne)

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
