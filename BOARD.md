# Task board

> Only the control session edits this file. Workers report in their task's `## Log`. Rules: [README.md](README.md).

Last updated: 2026-10-17 13:51 UTC by control (claude/sweet-davinci-29v7ne)

## Scope B (Yunzhe, 17 Oct 2026)

Small field, highest accuracy. The resident assistant covers **access** (step-free routes, place facts, amenities, closures, tickets for gaps) and **flood evacuation** (indicative river stages, affected places, evacuation centres) in the **deep spot: Elmina Urban Park + Elmina Lakeside Mall frontage**. Everything else is refused politely (T-011). Accuracy is measured on a human-checked answer key (T-012). Our agents may change Backend files when a task needs it; they list them in the PR for Jun Quan.

| Task | Title | Status | Priority | Lane | Owner |
|---|---|---|---|---|---|
| [T-001](tasks/T-001-validator-fact-binding.md) | Bind every stated fact to a tool field (audit A2) | in-progress | P1 | AI | Claude worker |
| [T-002](tasks/T-002-withhold-unchecked-drafts.md) | Never show a rejected answer as a draft (audit A3) | done | P1 | AI (+ Frontend boundary: `AnswerCard.tsx`) | Claude worker |
| [T-003](tasks/T-003-certainty-filter-negation.md) | Fix negation and paraphrase gaps in the promise filter (audit A4) | done | P1 | AI | Claude worker |
| [T-004](tasks/T-004-redaction-coverage.md) | Redact phone numbers with brackets and spaced MyKad numbers (audit A5) | parked | P2 | AI | unassigned |
| [T-005](tasks/T-005-resident-voice-outcome.md) | Resident diaries must not contradict the trip outcome (audit A6) | parked | P3 | AI (+ Backend: `day/spotlight.py`) | unassigned |
| [T-006](tasks/T-006-honest-eval-reporting.md) | Report evaluation results without overclaiming (audit A8) | parked | P3 | AI / evaluation + pitch | unassigned |
| [T-007](tasks/T-007-live-smoke-after-fixes.md) | Live OpenRouter smoke test after T-001 to T-003 | blocked | P1 | AI | Control session |
| [T-008](tasks/T-008-amenity-provenance.md) | Invented toilet returned as ordinary evidence (audit A1, Cannon F1) | done | P1 | Backend / data: Jun Quan | Codex worker |
| [T-009](tasks/T-009-chat-admission-limit.md) | Rate and cost limit for public chat (audit A7) | parked | P2 | Backend / deployment: Jun Quan | unassigned |
| [T-010](tasks/T-010-crossings-seed-rebuild.md) | Rebuild the Elmina seed so crossings get real types | blocked | P3 | Backend / data: Jun Quan | Control session |
| [T-011](tasks/T-011-assistant-scope-b.md) | Limit the assistant to scope B (access + flood evacuation) | done | P1 | AI (+ MCP server) | Codex worker |
| [T-012](tasks/T-012-answer-key-deep-spot.md) | Human-checked answer key for scope B (about 30 questions) | review | P1 | AI / evaluation | Codex worker |

## Order

- **Claude worker** (`claude/kind-cannon-mormhi`): T-001 → T-003 → T-002. Owns `validate.py` and `draft.py`.
- **Codex worker** (`codex/yunzhe-workflow`): T-012 → T-008 → T-011, and checks Claude's fixes with the audit probes whenever Claude logs a PR.
- **Control**: T-010 after T-008 is merged; T-007 on Yunzhe's instruction after T-001 to T-003 and T-011 are merged.
- **People**: field survey of the hero routes and amenities (`docs/03-product/field-verification-guide.md`).

Priorities: P1 before an open demo or the 23 Oct proposal, P2 before collecting resident questions, P3 before claiming whole-system validation.

## Done

| Task | Title | Merged |
|---|---|---|
| T-002, T-003 | Drafts checked; promise filter clause-scoped | PR #8 → control |
| T-008, T-011 | Demo place provenance; assistant limited to scope B | PR #7 → control |
| — | Cannon audit fixes F2–F5 (partial, see T-001 to T-004) | PR #2 → control, PR #3 → main |
| — | Codex independent audit | PR #4 → control, PR #5 → main |
