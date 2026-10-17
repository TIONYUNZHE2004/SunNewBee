# T-012 Human-checked answer key for scope B (about 30 questions)

- **Status:** assigned
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
