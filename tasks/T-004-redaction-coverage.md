# T-004 Redact phone numbers with brackets and spaced MyKad numbers (audit A5)

- **Status:** parked
- **Owner:** unassigned
- **Branch:** —
- **Priority:** P2 (before collecting resident questions)
- **Lane:** AI
- **Source:** [A5; extends Cannon F4 (partial)](https://github.com/TIONYUNZHE2004/SunNewBee/blob/main/docs/04-architecture/ai-independent-audit-2026-10-17.md)

## Goal

`Call +60 (12) 345 6789. My IC is 900101 14 5678.` reaches the model and session memory unchanged. Normalise separators before matching; cover Unicode separators and near misses.

## Acceptance

Assert removal in captured provider messages, stored memory and recordings; route numbers and other non-personal numbers survive.

## Log

- 2026-10-17 08:39 UTC · control (claude/sweet-davinci-29v7ne) · Created from the independent audit by Codex (`codex/yunzhe-workflow`, merged as PR #4).
- 2026-10-17 09:13 UTC · control (claude/sweet-davinci-29v7ne) · Assigned to Codex worker on `codex/yunzhe-workflow`. Codex, step 1 of 3. Only redact.py and its tests.
- 2026-10-17 09:29 UTC · control (claude/sweet-davinci-29v7ne) · Parked under scope B: needed before real residents use the app, not for the proposal.

- 2026-10-18 09:51 UTC · Codex (codex/yunzhe-workflow) · Read-only recheck during Yunzhe full-repository verification on d469ca3: synthetic bracketed Malaysian phone and spaced MyKad examples remain unchanged by redact(); ordinary email/mobile controls are removed. Original diagnostic captured in PR #10 evidence. This parked issue remains reproducible despite the regression suite passing. No privacy application code edited; no real PII supplied to a live model.
