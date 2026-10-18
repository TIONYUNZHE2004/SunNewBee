# T-015 Refresh the answer key for the new seed and fix scorer false positives

- **Status:** assigned
- **Owner:** Codex worker (cloud)
- **Branch:** `codex/yunzhe-workflow`
- **Priority:** P1
- **Lane:** AI / evaluation (`evals/` only)
- **Source:** Codex PR #10 / board T-012 log

## Goal

The committed key refuses to run on d469ca3 because the seed changed. Codex's 2-turn live diagnostic found two scorer false positives: "about 440 m" for 440.6 m, and "about 17 minutes" for a 16.8 min `plan_route` result missing from the centre-list measurement buckets.

## Acceptance

Key regenerated for the current seed (reviewed flags kept where the facts did not change), approximation handled with the validator's rounding rule, centre-route times included, and a fresh mock baseline. After T-013 and T-014 change answers, re-run only the affected cases.

## Log

- 2026-10-18 10:00 UTC · control (claude/sweet-davinci-29v7ne) · Created and assigned to Codex worker (cloud) (Yunzhe, 18 Oct: scope B+, two local engineers).
