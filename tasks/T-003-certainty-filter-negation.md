# T-003 Fix negation and paraphrase gaps in the promise filter (audit A4)

- **Status:** assigned
- **Owner:** Claude worker
- **Branch:** `claude/kind-cannon-mormhi`
- **Priority:** P1 (before open demo)
- **Lane:** AI
- **Source:** [A4; extends Cannon F3 (partial)](https://github.com/TIONYUNZHE2004/SunNewBee/blob/main/docs/04-architecture/ai-independent-audit-2026-10-17.md)

## Goal

"No steps, so I guarantee this route is accessible" and "There is zero risk on this route" pass, because a nearby "no" counts as negating "guarantee" and "zero risk" is not listed.

## Acceptance

Reject both examples; keep honest "not a guarantee"; test negation across clauses and punctuation in EN, BM and 中文.

## Log

- 2026-10-17 08:39 UTC · control (claude/sweet-davinci-29v7ne) · Created from the independent audit by Codex (`codex/yunzhe-workflow`, merged as PR #4).
- 2026-10-17 09:13 UTC · control (claude/sweet-davinci-29v7ne) · Assigned to Claude worker on `claude/kind-cannon-mormhi`. Claude, step 2 of 3 (same file as T-001).
- 2026-10-17 10:58 UTC · Claude worker (claude/kind-cannon-mormhi) · Started. Plan: negation must sit in the same clause and directly govern the promise word (not a nearby "no steps"); add "zero risk", "no chance of", "nothing to worry", "sifar risiko", "零风险" and paraphrases; tests across clauses and punctuation in EN, BM, 中文.
