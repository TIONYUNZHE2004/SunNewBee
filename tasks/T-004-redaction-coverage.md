# T-004 Redact phone numbers with brackets and spaced MyKad numbers (audit A5)

- **Status:** open
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
