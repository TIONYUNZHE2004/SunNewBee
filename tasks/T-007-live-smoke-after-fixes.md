# T-007 Live OpenRouter smoke test after T-001 to T-003

- **Status:** blocked
- **Owner:** Control session
- **Branch:** `claude/sweet-davinci-29v7ne`
- **Priority:** P1 (before open demo)
- **Lane:** AI
- **Source:** [Blocked by T-001, T-002, T-003](https://github.com/TIONYUNZHE2004/SunNewBee/blob/main/docs/04-architecture/ai-independent-audit-2026-10-17.md)

## Goal

All post-audit checks are mock-only. The strict number check may cause more rewrites or fallbacks with a real model. The control session can reach OpenRouter (key check returned HTTP 200); Cannon and Codex sessions could not.

## Acceptance

A few live turns on the hero questions with rewrite/fallback counts and cost, run by the control session only when Yunzhe asks (CLAUDE.md cost rules).

## Log

- 2026-10-17 08:39 UTC · control (claude/sweet-davinci-29v7ne) · Created from the independent audit by Codex (`codex/yunzhe-workflow`, merged as PR #4).
- 2026-10-17 09:13 UTC · control (claude/sweet-davinci-29v7ne) · Assigned to Control session on `claude/sweet-davinci-29v7ne`. Control runs it on Yunzhe's instruction after T-001 to T-003 are merged.
- 2026-10-17 09:29 UTC · control (claude/sweet-davinci-29v7ne) · Scope B: run on the T-012 answer key only, after T-001 to T-003 and T-011 are merged.
- 2026-10-17 13:51 UTC · control (claude/sweet-davinci-29v7ne) · Still blocked by T-001. Run on the T-012 key once T-001 is done. Note: the Claude worker logged 'no key; openrouter.ai blocked' in its environment; the control session can reach OpenRouter.
- 2026-10-18 10:00 UTC · control (claude/sweet-davinci-29v7ne) · Still blocked. After T-001, T-013 and T-015: run on the refreshed key by control, on Yunzhe's instruction.
