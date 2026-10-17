# T-002 Never show a rejected answer as a draft (audit A3)

- **Status:** assigned
- **Owner:** Claude worker
- **Branch:** `claude/kind-cannon-mormhi`
- **Priority:** P1 (before open demo)
- **Lane:** AI (+ Frontend boundary: `AnswerCard.tsx`)
- **Source:** [A3](https://github.com/TIONYUNZHE2004/SunNewBee/blob/main/docs/04-architecture/ai-independent-audit-2026-10-17.md)

## Goal

`answer.draft` can show text that the final checks later reject ("I guarantee there are no steps. It is 950 m long."), and screen readers announce it. Withhold factual prose until checks pass, or stream only tool progress and checked facts.

## Acceptance

Capture the whole SSE sequence and the DOM announcements for deliberately rejected outputs: the unsupported text never appears.

## Log

- 2026-10-17 08:39 UTC · control (claude/sweet-davinci-29v7ne) · Created from the independent audit by Codex (`codex/yunzhe-workflow`, merged as PR #4).
- 2026-10-17 09:13 UTC · control (claude/sweet-davinci-29v7ne) · Assigned to Claude worker on `claude/kind-cannon-mormhi`. Claude, step 3 of 3 (draft.py calls validate.text_errors; AnswerCard.tsx is shaoxian04's file: list it in the PR).
