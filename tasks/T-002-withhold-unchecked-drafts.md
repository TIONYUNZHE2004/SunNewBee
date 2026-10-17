# T-002 Never show a rejected answer as a draft (audit A3)

- **Status:** done
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
- 2026-10-17 11:34 UTC · Claude worker (claude/kind-cannon-mormhi) · Started (logged late: work began right after T-003). Finding: the client already clears a rejected draft (chatReducer), but the draft sits in an aria-live region, so it is announced before the verdict. Fix belongs on the server.
- 2026-10-17 11:34 UTC · Claude worker (claude/kind-cannon-mormhi) · Ready for review: commits e0df615 (code), d35ebcf (data: Elmina demo cache re-recorded with the MOCK, 18 entries; only draft deltas, recorded_at and null intent fields changed), f940039 (agent README). Added to PR https://github.com/TIONYUNZHE2004/SunNewBee/pull/8. validate.draft_errors runs every content check of validate_answer (wording, promises, fact/number binding, features, status naming, what-if/plan/rollout/day/affected numbers); draft.py emits whole sentences only and stops before the first failing one. AnswerCard.tsx: NOT changed. mock.py / template.py: NOT changed. Trade-off for Yunzhe: drafts are now sentence-sized and often only the first sentence, since the mock states the distance early. Checks (mock): lint PASS, pytest PASS 1389, typecheck PASS, vitest PASS 789, gen PASS, golden PASS 22/22, e2e PASS 19, mock eval 36/36, 0 fallbacks. Live: NOT RUN (no key).

- 2026-10-17 11:38 UTC · Codex (codex/yunzhe-workflow) · Independent verification of PR #8 at Cannon f940039 in clean detached worktree: original guarantee/950m _emit probe now yields ZERO answer.draft events; 99-step run_turn probe rejects and uses honest template. Combined draft + independent assertion suites PASS 58 tests (including honest sentence-sized drafts and original honest controls). Captured seven real SSE events from an adversarial streaming FunctionModel and replayed them through the unchanged AnswerCard UI in system Chromium: browser test PASS; neither the rejected sentence nor 950 entered the answer DOM or captured aria-live/log announcements. Evidence /workspace/audits/claude-f940039/{stream.json,announcements.json,browser.log,independent-probes.json}. The five separately logged T-001 binding bypasses still pass on this tip; this limits overall factual reliability despite the original draft fix passing. No Claude code edited; no live calls.

- 2026-10-17 11:55 UTC · Codex (codex/yunzhe-workflow) · Durable independent report and actual SSE/live-region DOM captures now available in Codex 92c156e: https://github.com/TIONYUNZHE2004/SunNewBee/blob/codex/yunzhe-workflow/docs/04-architecture/ai-worker-fix-verification-2026-10-17.md. Latest Cannon remains f940039. Original rejected guarantee/950m draft withheld; 58 combined assertions and one replay browser test PASS. Honest final appears; rejected text absent from answer/live-region DOM. Not an assistive-technology audio test. Overall factual coverage still limited by five T-001 bypasses. No Claude files edited; live turns 0.
- 2026-10-17 13:51 UTC · control (claude/sweet-davinci-29v7ne) · Merged into control (PR #8: e0df615, d35ebcf, f940039). Codex verified: rejected draft text never reaches the answer DOM or live region. Control re-ran all 7 checks on the combined control head cf251b1 (PR #7 + PR #8): lint PASS (warnings only), pytest 1435 PASS, typecheck PASS, vitest 789 PASS, gen no drift PASS, golden 22/22 PASS, e2e 19/19 PASS (mock LLM).
