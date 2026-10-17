# T-005 Resident diaries must not contradict the trip outcome (audit A6)

- **Status:** assigned
- **Owner:** Codex worker
- **Branch:** `codex/yunzhe-workflow`
- **Priority:** P3 (before whole-system validation claims)
- **Lane:** AI (+ Backend: `day/spotlight.py`)
- **Source:** [A6](https://github.com/TIONYUNZHE2004/SunNewBee/blob/main/docs/04-architecture/ai-independent-audit-2026-10-17.md)

## Goal

For a cancelled school trip, `spotlight.check_text` accepts "I reached school on time and attended class." Render the outcome from engine fields, or check that the text agrees with it.

## Acceptance

Swapped outcomes (cancelled, stranded, late, on time) are rejected in diaries, feed posts, replies and reloaded recordings; honest paraphrases pass.

## Log

- 2026-10-17 08:39 UTC · control (claude/sweet-davinci-29v7ne) · Created from the independent audit by Codex (`codex/yunzhe-workflow`, merged as PR #4).
- 2026-10-17 09:13 UTC · control (claude/sweet-davinci-29v7ne) · Assigned to Codex worker on `codex/yunzhe-workflow`. Codex, step 2 of 3. spotlight.py is Backend: keep the change minimal and list it in the PR.
