# T-015 Refresh the answer key for the new seed and fix scorer false positives

- **Status:** assigned
- **Owner:** Local AI engineer
- **Branch:** `local/ai-engineer`
- **Priority:** P1
- **Lane:** AI / evaluation (`evals/` only)
- **Source:** Codex PR #10 / board T-012 log

## Goal

The committed key refuses to run on d469ca3 because the seed changed. Codex's 2-turn live diagnostic found two scorer false positives: "about 440 m" for 440.6 m, and "about 17 minutes" for a 16.8 min `plan_route` result missing from the centre-list measurement buckets.

## Acceptance

Key regenerated for the current seed (reviewed flags kept where the facts did not change), approximation handled with the validator's rounding rule, centre-route times included, and a fresh mock baseline. After T-013 and T-014 change answers, re-run only the affected cases.

## Log

- 2026-10-18 10:00 UTC · control (claude/sweet-davinci-29v7ne) · Created and assigned to Codex worker (cloud) (Yunzhe, 18 Oct: scope B+, two local engineers).
- 2026-10-18 10:12 UTC · control (claude/sweet-davinci-29v7ne) · Reassigned by Yunzhe (18 Oct): the cloud Codex worker stops; the local AI engineer owns evals/ and takes T-015.
- 2026-10-18 10:48 UTC · Local AI engineer (local/ai-engineer) · Started on branch local/ai-engineer-t015 (off control 9621d6e; evals/ only). Plan: regenerate the key for the current seed keeping reviewed flags where facts are unchanged; scorer uses the validator's rounding rule (facts._matches) and checks numbers against every tool result of the turn (incl. centre plan_route times); fresh mock baseline.
- 2026-10-18 10:51 UTC · Local AI engineer (local/ai-engineer) · Ready for review on branch local/ai-engineer-t015 (off control 9621d6e; evals/ only): c1f8b84 scorer + build, 7680dca key + baseline, 8d70b9e biome format. (1) Scorer keeps its own number patterns and value walker but judges rounding with the validator's rule (facts._matches), and reads the routes and evidence the tools returned in the scored turn as well as the key's engine calls. Both of Codex's false positives (route-01 'about 440 m' for 440.6 m; centre-en 'about 17 minutes' for the 16.8 min centre route) are now regression tests, replayed with engine-recomputed tool results (no model); without the turn's route, '17 minutes' is still flagged. (2) build_answer_key keeps 'reviewed' when question, profile, scenario, expected outcome and expected facts are unchanged. (3) Key regenerated: seed e6ea9e32 → 2e2e83cd; all 32 expected facts unchanged (route-10 differs only in ticket timestamps); reviewed 0/32 (nothing was reviewed yet). (4) Fresh mock baseline evals/results/2026-10-18-answer-key-mock.json: correct 1/32, honestly unverified 9/32, refused correctly 3/32, wrong 19/32, unsupported claims 0/32 (was 3/32: 146.5 m, 445.9 m and 350.3 m were real route lengths the mock planned that turn but the key had not captured; those cases stay wrong for their route choice). Mock numbers measure the mock's keyword router, not a real model. Local: lint PASS, evals/tests PASS 58. e2e NOT RUN (CI). After T-013 (scope) and T-014 (sidewalks) merge I re-run only the affected cases. BLOCKER: no gh/GitHub API here; please open https://github.com/TIONYUNZHE2004/SunNewBee/compare/claude/sweet-davinci-29v7ne...local/ai-engineer-t015?expand=1 . Spend US$0.
