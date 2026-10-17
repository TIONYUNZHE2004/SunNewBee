# T-009 Rate and cost limit for public chat (audit A7)

- **Status:** parked
- **Owner:** unassigned
- **Branch:** —
- **Priority:** P2 (before collecting resident questions)
- **Lane:** Backend / deployment: Jun Quan
- **Source:** [A7; extends Cannon F5 (partial)](https://github.com/TIONYUNZHE2004/SunNewBee/blob/main/docs/04-architecture/ai-independent-audit-2026-10-17.md)

## Goal

`/chat` has no admission or concurrency limit; the per-turn cap of 12 requests does not bound total cost.

## Acceptance

A concurrency test shows bounded provider calls and graceful 429/503 responses.

## Log

- 2026-10-17 08:39 UTC · control (claude/sweet-davinci-29v7ne) · Created from the independent audit by Codex (`codex/yunzhe-workflow`, merged as PR #4).
- 2026-10-17 09:29 UTC · control (claude/sweet-davinci-29v7ne) · Parked: needed before a public deployment, not for the proposal.
