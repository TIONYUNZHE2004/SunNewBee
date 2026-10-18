# T-012 Human-checked answer key for scope B (about 30 questions)

- **Status:** review
- **Owner:** Codex worker
- **Branch:** `codex/yunzhe-workflow`
- **Priority:** P1 (before open demo)
- **Lane:** AI / evaluation
- **Source:** Scope B decision; replaces T-006

## Goal

The accuracy target for scope B. About 30 questions about the deep spot (Elmina Urban Park + Elmina Lakeside Mall frontage), spread over: step-free routes per profile, place facts, nearby amenities, closures, flood stages, evacuation centres, gaps that must be reported as unverified or no data, and refusal bait (safe, depth, forecast, guarantee, out of scope). EN, BM and 中文.

Each entry: id, language, question, profile, the expected facts taken from the engine on the real Elmina seed (route status, distance, unknowns, centre names and sources, scenario label), must-include and must-not-include phrases, and `reviewed: false` until Yunzhe checks it. Add a scorer (`evals/run_answer_key.py`) that runs the questions through `run_turn` and reports, with denominators: correct, honestly unverified, refused correctly, wrong, and unsupported claims.

## Acceptance

The key and the scorer are committed; a mock baseline is recorded; every number in the key comes from an engine call recorded next to it. This replaces T-006 for scope B.

## Log

- 2026-10-17 09:29 UTC · control (claude/sweet-davinci-29v7ne) · Created for scope B (access + flood evacuation, deep spot), assigned to Codex worker.

- 2026-10-17 09:35 UTC · Codex (codex/yunzhe-workflow) · Started. Synced worker to control 95e9e56; preparing approximately 30 EN/BM/Chinese deep-spot cases with recorded real-seed engine outputs, reviewed false, independent scoring and a mock baseline. Live turns used: 0.

- 2026-10-17 09:40 UTC · Codex (codex/yunzhe-workflow) · Finding: initial provisional mock baseline is 1/31 correct, 8/31 honestly unverified, 2/31 refused correctly, 20/31 wrong; 3/31 turns have detected unsupported claims (overlaps wrong), 0/31 human-reviewed. Misses include multilingual mock routing, wrong-origin centre answers, missing amenity provenance and scope refusals. This is a mock baseline, not a live-model failure rate. Keeping the misses for later tasks and Yunzhe review.

- 2026-10-17 09:42 UTC · Codex (codex/yunzhe-workflow) · Draft PR opened: https://github.com/TIONYUNZHE2004/SunNewBee/pull/7 at 9cff54d. Checklist: lint PASS, Python rerunning after restoring missing locked FastMCP dependency, typecheck PASS, frontend tests PASS (789), generated-client drift PASS, golden PASS (22), browser PASS (19 using system Chromium). New independent scorer tests PASS (3). All 31 human-review flags remain false; live turns 0.

- 2026-10-17 09:46 UTC · Codex (codex/yunzhe-workflow) · Ready for review in PR #7: https://github.com/TIONYUNZHE2004/SunNewBee/pull/7. Final key has 32 cases covering all five configured profiles; 0/32 reviewed, pending Yunzhe. Mock baseline: correct 1/32, honestly unverified 9/32, refused correctly 2/32, wrong 20/32; unsupported claims detected in 3/32 (overlap wrong). Seven-step checklist PASS/PASS/PASS/PASS/PASS/PASS/PASS: lint; 1322 pytest; types; 789 JS tests; gen/no drift; 22 golden; 19 E2E via system Chromium. Baseline intentionally exits 1 for misses. Live model turns 0. PR remains draft while T-008 and T-011 are added.

- 2026-10-17 11:55 UTC · Codex (codex/yunzhe-workflow) · Final combined PR #7 is ready for review: https://github.com/TIONYUNZHE2004/SunNewBee/pull/7. The scope-B mock baseline now matches 13/32 provisional expectations: correct 1/32, honestly unverified 9/32, correctly refused 3/32; wrong 19/32, unsupported claims detected 3/32 (overlap wrong). Human review remains 0/32, all reviewed=false for Yunzhe. Added BM di luar and Chinese 超出 refusal equivalents only. Final integration checklist all seven PASS: lint; 1365 Python; types; 789 JS; gen/no drift; 22 golden; 19 E2E. No live turns.
- 2026-10-17 13:51 UTC · control (claude/sweet-davinci-29v7ne) · Merged into control (PR #7). Control re-ran evals/run_answer_key.py (mock) on cf251b1: correct 1/32, honestly unverified 9/32, refused correctly 3/32, wrong 19/32, unsupported claims 3/32; reviewed 0/32. Most misses are the mock's keyword router (BM/中文 routing, wrong tools), so this measures the mock, not a real model. Waiting for Yunzhe's human review of the 32 entries.

- 2026-10-18 09:38 UTC · Codex (codex/yunzhe-workflow) · Started repository-wide verification requested by Yunzhe on 18 Oct. Explicitly fetched Davinci (initial checkout fetch refspec omitted it), fast-forwarded worker to latest control d469ca3; PR #7 already merged. Will run full seven-step checklist, production build, real Elmina API/UI smoke and answer-key baseline; independent T-001 probes checked separately without editing Claude code. Reports will distinguish regression passes from unresolved accuracy gaps and unavailable optional checks. Main/control pushes prohibited; no data rebuild or live cache recording.

- 2026-10-18 09:40 UTC · Codex (codex/yunzhe-workflow) · Current committed key refuses to run on d469ca3: seed fingerprint has changed since 17 Oct. This correctly blocks a stale accuracy score. Preparing a fresh provisional key OUTSIDE the checkout and preserving the committed key and reviewed flags. No data regeneration or weaker expectations; any new score will identify its new seed fingerprint.
