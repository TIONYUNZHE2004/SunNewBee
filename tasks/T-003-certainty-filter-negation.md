# T-003 Fix negation and paraphrase gaps in the promise filter (audit A4)

- **Status:** done
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
- 2026-10-17 11:12 UTC · Claude worker (claude/kind-cannon-mormhi) · Ready for review: commit 2ed7b88, added to PR https://github.com/TIONYUNZHE2004/SunNewBee/pull/8. Negation now counts only in the same clause (punctuation or so/and/jadi/所以 ends it) and only with filler words before the promise. Added zero/nil risk, risk is zero, without any risk, nothing to worry about, jamin, sifar risiko, tidak berisiko, 零风险, 不会有任何风险. Both A4 examples rejected; "not a guarantee", "cannot guarantee", "tidak dapat menjamin", "无法保证" pass. Finding: a second `_NEGATES` later in validate.py (what-if ranking) would shadow a same-named regex; mine is named `_GOVERNS`. mock.py / template.py: NOT changed. Checks (mock): lint PASS, pytest PASS 1374, typecheck PASS, vitest PASS 789, gen PASS, golden PASS 22/22, e2e PASS 19, mock eval 36/36, 0 fallbacks. Live: NOT RUN (no key).

- 2026-10-17 11:28 UTC · Codex (codex/yunzhe-workflow) · Independent verification of PR #8 at Cannon 2ed7b88: both original A4 cases now REJECTED (No steps, so I guarantee this route is accessible; There is zero risk on this route). Honest That is not a guarantee and I cannot guarantee this route still ACCEPTED; 9 honest control assertions pass. Original draft still emits guarantee/950m before checking, expected pending T-002; this does not invalidate the final-answer promise fix. Evidence /workspace/audits/claude-2ed7b88/. Live turns 0; Cannon worktree clean.

- 2026-10-17 11:55 UTC · Codex (codex/yunzhe-workflow) · Durable independent verification report and captured original promise/negation probes now available in Codex 92c156e: https://github.com/TIONYUNZHE2004/SunNewBee/blob/codex/yunzhe-workflow/docs/04-architecture/ai-worker-fix-verification-2026-10-17.md. Latest Cannon remains f940039; original dishonest promise cases rejected and honest negated-guarantee controls pass. This is deterministic probe coverage, not live-model reliability. No Claude files edited; live turns 0.
- 2026-10-17 13:51 UTC · control (claude/sweet-davinci-29v7ne) · Merged into control (PR #8: 2ed7b88). Codex verified both A4 cases rejected, honest negations accepted. Control re-ran all 7 checks on the combined control head cf251b1 (PR #7 + PR #8): lint PASS (warnings only), pytest 1435 PASS, typecheck PASS, vitest 789 PASS, gen no drift PASS, golden 22/22 PASS, e2e 19/19 PASS (mock LLM).

- 2026-10-18 09:51 UTC · Codex (codex/yunzhe-workflow) · 18 Oct recheck: original promise/negation probe expectations on Davinci d469ca3 all match; honest negated-guarantee controls pass on both Davinci and Cannon a460d4c. Cannon targeted draft plus independent-audit assertions PASS 58. Full repository verification report PR #10: https://github.com/TIONYUNZHE2004/SunNewBee/pull/10. No Claude files edited.
