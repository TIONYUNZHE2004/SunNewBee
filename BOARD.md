# Task board

> Only the control session edits this file. Workers report in their task's `## Log`. Rules: [README.md](README.md).

Last updated: 2026-10-17 09:13 UTC by control (claude/sweet-davinci-29v7ne)

| Task | Title | Status | Priority | Lane | Owner |
|---|---|---|---|---|---|
| [T-001](tasks/T-001-validator-fact-binding.md) | Bind every stated fact to a tool field (audit A2) | assigned | P1 | AI | Claude worker |
| [T-002](tasks/T-002-withhold-unchecked-drafts.md) | Never show a rejected answer as a draft (audit A3) | assigned | P1 | AI (+ Frontend boundary: `AnswerCard.tsx`) | Claude worker |
| [T-003](tasks/T-003-certainty-filter-negation.md) | Fix negation and paraphrase gaps in the promise filter (audit A4) | assigned | P1 | AI | Claude worker |
| [T-004](tasks/T-004-redaction-coverage.md) | Redact phone numbers with brackets and spaced MyKad numbers (audit A5) | assigned | P2 | AI | Codex worker |
| [T-005](tasks/T-005-resident-voice-outcome.md) | Resident diaries must not contradict the trip outcome (audit A6) | assigned | P3 | AI (+ Backend: `day/spotlight.py`) | Codex worker |
| [T-006](tasks/T-006-honest-eval-reporting.md) | Report evaluation results without overclaiming (audit A8) | assigned | P3 | AI / evaluation + pitch | Codex worker |
| [T-007](tasks/T-007-live-smoke-after-fixes.md) | Live OpenRouter smoke test after T-001 to T-003 | blocked | P1 | AI | Control session |
| [T-008](tasks/T-008-amenity-provenance.md) | Invented toilet returned as ordinary evidence (audit A1, Cannon F1) | handoff | P1 | Backend / data: Jun Quan | unassigned |
| [T-009](tasks/T-009-chat-admission-limit.md) | Rate and cost limit for public chat (audit A7) | handoff | P2 | Backend / deployment: Jun Quan | unassigned |
| [T-010](tasks/T-010-crossings-seed-rebuild.md) | Rebuild the Elmina seed so crossings get real types | handoff | P3 | Backend / data: Jun Quan | unassigned |

Order: Claude does T-001 → T-003 → T-002 (all touch `validate.py`/`draft.py`). Codex does T-004 → T-005, verifies Claude's fixes with its audit probes, then T-006. Control runs T-007. T-008 to T-010 stay with Jun Quan.

Priorities follow the audit's handoff order: P1 before an open demo, P2 before collecting resident questions, P3 before claiming whole-system validation.

## Done

| Task | Title | Merged |
|---|---|---|
| — | Cannon audit fixes F2–F5 (partial, see T-001 to T-004) | PR #2 → control, PR #3 → main |
| — | Codex independent audit | PR #4 → control |
