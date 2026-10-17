# T-006 Report evaluation results without overclaiming (audit A8)

- **Status:** parked
- **Owner:** unassigned
- **Branch:** —
- **Priority:** P3 (before whole-system validation claims)
- **Lane:** AI / evaluation + pitch
- **Source:** [A8](https://github.com/TIONYUNZHE2004/SunNewBee/blob/main/docs/04-architecture/ai-independent-audit-2026-10-17.md)

## Goal

Mock evaluation: 36/36 accepted but only 30/36 expected-tool hits and 24/36 grounded. Pitch wording such as "none reached a resident" is not supported.

## Acceptance

Separate metrics (correctness, refusal, tool recall, fallback/rewrite, privacy, latency, cost) with denominators; remove absolute claims; a repeated live run on the final commit.

## Log

- 2026-10-17 08:39 UTC · control (claude/sweet-davinci-29v7ne) · Created from the independent audit by Codex (`codex/yunzhe-workflow`, merged as PR #4).
- 2026-10-17 09:13 UTC · control (claude/sweet-davinci-29v7ne) · Assigned to Codex worker on `codex/yunzhe-workflow`. Codex, step 3 of 3, after Claude's T-001 to T-003 are merged into control.
- 2026-10-17 09:29 UTC · control (claude/sweet-davinci-29v7ne) · Parked: replaced by T-012 (answer key for scope B).
