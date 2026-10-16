# AI world-model log (`ai/world-model`)

Run log for the "Township World Model" AI work: research, implement, validate, fix, research. Timestamps are Malaysia time (real `date`). Live spend is measured with `uv run python evals/spend.py --mark <label>` (OpenRouter `/api/v1/key`; the key is never printed; rows in `.data/spend.jsonl`).

**Budget:** US$3 for this mission.
- The key's lifetime usage at the start was US$26.79302 (other work).
- Mission spend = current usage − 26.79302.

**Kickoff decisions (user, 16 Oct):**
- Target the 11 Nov final.
- Screen placement is the AI owner's call.
- The AI owner builds the UI too.
- "Be ambitious; research decides learned vs explicit."

---

## Cycle 0: research sprint and a solid live-model path (16 Oct, about 20:30–21:16; commit `258c14a`)

### Research

**Sources.** Four parallel research subagents produced:
- 30 PDFs in `reference/papers/world-models/`;
- 4 repos in `reference/repos/world-models/` (mesa, mesa-geo, llm-reasoners, fastmcp);
- four notes files, `reference/notes/world-models-{ml,llm,urban,repos}.md`.

Each claim in the notes is tagged as read, abstract-only or from memory. Both scripts list everything (`download-papers.sh`, `clone-repos.sh world-models`).

**Brief:** [docs/02-research/world-models-2026.md](../02-research/world-models-2026.md).

**Conclusions:**
- **An explicit model is a real world model.** It has state, a transition, rollouts and a planner, like AlphaZero's rules or DeepMind's Code World Models (2510.04542).
- **The LLM must not be the simulator.** ByteSized32 puts it at about 59% state accuracy. Agents skip a world-model tool they are allowed to skip (2601.03905).
- **The Township World Model design:**
  - closed-vocabulary actions;
  - a copy-on-write `step`;
  - journey and population rollouts;
  - a belief over UNKNOWN facts, the only learned part: OSM + DEM calibration plus ticket updates, used for planning only;
  - planners: what-if, verify-next (value of information), fix-it (beam search) and tipping point.
- **Ranked shortlist:**
  1. What-if Lab;
  2. Verify-next planner;
  3. Rising-river population rollout;
  4. Fix-it planner;
  5. Learned belief;
  6. Streamed answers with a validator trace (done this cycle);
  7. Multi-turn memory;
  8. MCP;
  9. Tipping point;
  10. BM / 中文.

### Live baseline (Haiku 5.5 `anthropic/claude-haiku-5.5`, tiny fixture, 13 golden turns)

`evals/results/2026-10-16-live-baseline.json`:

- **Golden:** 11/13 PASS. Both FAILs were mock-specific expectations:
  - `waste-unknown` wanted the exact phrase "not confirmed yet";
  - `flood-scenario-label` expected a route that the live model rightly did not plan.
- **Template fallbacks:** 0.
- **Validator rejections: 7 of 13 turns needed a rewrite.** The causes, in order:
  - route ids (`rt-…`) and request ids (`vr-…`) cited as evidence;
  - "verified" wording next to demo values;
  - claims without evidence (meta claims such as "No closures were returned");
  - echoing the user's word "safe".
- **Latency:** median first text 12.0 s (route turns 12–18 s).
- **Input tokens:** about 27k per route turn, no caching.
- **Answers read like logs.**
  - "Route status" appeared three times.
  - A "⚠ a; b; c" caveat dump came before the answer.
  - It included meta notes such as "No staff-reported closures were returned".

### What was built

1. **Prompt caching (OpenRouter → Anthropic)** for the system prompt, tool schemas and the last message (`agent.model_for`).
2. **`validate.repair_answer`:** fact-free fixes applied before validation, so a live model is not sent back for them:
   - it drops route and request ids cited as evidence;
   - it drops claims left without evidence. Claims are never rendered as text, only as citations.

   Invented ids are never removed, and they still fail validation.
3. **Answer-first rendering (`run.answer_text`):**
   - the `Route status:` label;
   - a direct-answer summary;
   - numbered steps;
   - a `Worth knowing:` list with one bullet per caveat.

   A repeated status sentence is dropped, caveats are de-duplicated, and every required caveat is still printed.
4. **Streamed drafts and a visible validator trace.** These are new SSE events, regenerated in `packages/api-client`.
   - **`answer.draft`** streams the summary while the model is still writing `final_answer` (`draft.DraftStreamer` on PydanticAI's `event_stream_handler`).
     - It is guarded: it stops before any forbidden word, depth or raw id, and never ends on a half word.
     - The mock streams too, so tests and e2e exercise it keylessly.
   - **`answer.check`** carries the validator's verdict for each attempt, with readable reasons (`validate.issue_labels`).
   - The web shows the draft muted ("Draft · checking against the township data…"), then "↺ Sent back for a rewrite: …" or "✓ Answer checked against the township data". The validated text then replaces the draft.
5. **Prompt rules 11–12:**
   - answer first;
   - no meta caveats;
   - the `ev-` id format;
   - no "verified" wording with demo values;
   - never echo "safe";
   - no guessing or reassurance;
   - call `find_place` for both ends in one step.
6. **New honesty rule.** The validator rejects guesses and reassurance ("probably", "should be fine", "no problem"), because the engine computes no likelihood. "Likely flooded" stays allowed, since it is a flood class. Found live: "Probably, but not confirmed yet."
7. **Evals:**
   - `evals/run_golden.py` reports per case: fallbacks, rejected attempts, validator errors, repairs, checks, first-draft and first-text latency, requests, tokens and cache tokens (`GOLDEN_REPORT=path.json`).
   - It adds the `mock_only`, `text_includes_any` and `first_line_excludes` expectations.
   - `evals/spend.py` reports spend.
8. **Licence rule.** The team lead ruled any licence acceptable for the hackathon. AGENTS.md is updated, and [CREDITS.md](../../CREDITS.md) is started (no code copied yet).

### Live after the fixes (same 13 turns)

`evals/results/2026-10-16-live-cycle0.json`:

| Metric | Baseline | Cycle 0 |
|---|---|---|
| Golden (live) | 11/13 | **13/13** |
| Turns needing a validator rewrite | 7 | **1** (one "verified" next to demo values) |
| Template fallbacks | 0 | 0 |
| Median first visible text | 12.0 s | **5.7 s** (draft) |
| Median checked answer | 12.0 s | **8.3 s** |
| Output tokens | 26.7k | 18.9k |
| Input tokens served from cache | 0% | **87%** (243k of 279k) |
| Spend for the 13 turns | US$0.0348 | **US$0.0059** |

Sample live answer (stroller to the playground):

> Route status: confirmed (on demo values, not yet surveyed)
> Yes, the mapped stroller route from Car Park B to the Urban Park playground has no steps recorded, about 222 m (around 3 minutes). …
> Worth knowing:
> • Demo values, not yet surveyed: …

### Verification

Run with `set -o pipefail`. Mock-backed unless marked live.

| Check | Result |
|---|---|
| `pnpm lint` | PASS (after `ruff --fix` import order) |
| `uv run pytest -q` | PASS (888, after review fixes) |
| `pnpm -r --if-present typecheck` | PASS |
| `pnpm -r --if-present test` | PASS (vitest 446, after review fixes) |
| `pnpm gen && git diff --exit-code packages/api-client` | PASS after commit: the client was regenerated for the two new events and is committed with them |
| `pnpm golden` (mock) | PASS 13/13 |
| `GOLDEN_REAL=1 pnpm golden` (**live**, Haiku 5.5) | PASS 13/13 |
| `pnpm --filter @tl/web e2e` | PASS 9/9 |
| Browser check (Stylised map, `townshiplens-dev-mock`) | PASS. The wheelchair starter draws the route, then shows "✓ Answer checked against the township data", the status, the summary and "Worth knowing". Screenshot: `docs/06-pitch/screenshots/ai-cycle0-checked-answer-stylised.jpg` |
| Independent review (Opus subagent) | 4 Important + 7 Minor findings; all Important and 6 Minor fixed, 1 deferred (see below) |
| Live re-run after the fixes (**live**) | PASS 13/13; 0 fallbacks; 2 rewrites caught live ("probably", and a "safe" attempt) + 1 schema retry, each shown in the trace; median first draft 5.9 s, checked text 8.0 s (`evals/results/2026-10-16-live-cycle0-fixed.json`) |
| Browser re-check (Stylised) | PASS: evacuation starter shows the flood banner, route, "✓ Answer checked", status, answer, Worth knowing |

**Spend so far:** US$0.0546 of US$3 (usage 26.84758; three 13-turn live runs).

### Pitch line (judge-facing)

> Ask TownshipLens a question and watch it think honestly. Its first sentence appears within about six seconds as a draft. A validator then checks every claim against the township world model before the answer is final. If the AI cites something no check returned, or guesses, or says "safe", you see it sent back and rewritten live. Nothing reaches a resident unchecked, and every gap stays visible.

### Integration notes for shaoxian04 (`apps/web`)

- Two new SSE events are in the generated client:
  - `answer.draft {attempt, delta}`;
  - `answer.check {attempt, ok, issues[], repairs}`.
- `chatReducer` keeps three new fields, `draft`, `draftAttempt` and `checks`. A new attempt restarts the draft, and a rejected check clears it.
- `AnswerCard`:
  - shows an "Answer checks" list under the tool list (✓ / ↺ with reasons);
  - shows the draft muted until the first `text.delta` arrives.
- **The answer text format changed:**
  - before: `Route status`, then the `⚠` caveat line, then the summary;
  - now: `Route status`, then the summary and steps, then `Worth knowing:` with `•` bullets.
- Nothing else in the layout changed. Feel free to restyle.
- Open UI follow-up: the "Not verified" box repeats the "Worth knowing" items. One of them could be collapsed.

### Rulings (Cycle 0)

Each ruling gives what was decided, why, and the cost if it is wrong.

- **W1: licences.**
  - **What:** any licence is acceptable for dependencies and copied code during the hackathon. Each copy is recorded in `CREDITS.md`, and MIT, Apache-2.0 or BSD is still preferred. This supersedes R25.
  - **Why:** the team lead's instruction for this mission.
  - **Cost if wrong:** a pilot would need a licence review and would have to replace any GPL or AGPL code. CREDITS.md makes that a lookup.
- **W2: fact-free repair before validation.**
  - **What:** strip route and request ids cited as evidence, and drop uncited claims only while another claim still cites evidence.
  - **Why:** 4 of the 7 live rejections were this harmless confusion, each costing a retry (about 4 s plus tokens).
  - **Cost if wrong:** an ungrounded claim could be hidden. It cannot be shown, because claims are never rendered as text. An answer whose claims are all uncited is still sent back.
- **W3: streamed drafts.**
  - **What:** stream the unvalidated summary as `answer.draft`, labelled as a draft, guarded by the validator's own wording rules (`validate.text_errors`), and replaced by the checked text.
  - **Why:** first visible text arrives in about 6 s instead of 12 s, and the honesty gate becomes visible.
  - **Cost if wrong:** a resident could briefly read a draft that is later rejected. It is labelled as a draft and is cleared on rejection, and forbidden wording never streams.
- **W4: answer-first layout.**
  - **What:** the layout is the status label, then urgent caveats pinned as "⚠" lines (staff closures, a flooded start or destination), then the summary and steps, then "Worth knowing" bullets.
  - **Why:** the old caveat dump came before the answer and repeated itself.
  - **Cost if wrong:** a resident might skim past a caveat. The ones that change whether to go at all stay on top.

### Review (independent reviewer subagent, Opus) and fixes

The reviewer reproduced 4 Important findings with probe scripts. All are fixed and covered by regression tests.

1. **The status stripper deleted required caveats.**
   - It deleted closure lines and the demo-values phrase, and cut "1.2 km" in half.
   - **Fix:** remove only an exact copy of the label. Closure and flooded-endpoint caveats are pinned above the summary.
   - **Tests:** `test_rendering_keeps_every_caveat_word` and `test_closure_and_flooded_endpoint_caveats_are_pinned_above_the_summary`.
2. **The draft guard was weaker than the validator.**
   - "0.5 m of" could stream before the depth check fired.
   - Reassurance, "staff were asked" and demo "verified" wording streamed unchecked.
   - **Fix:** a shared `validate.text_errors`, plus numbers with units held back until 3 more words follow.
   - **Tests:** `test_draft_uses_every_validator_wording_rule`.
3. **Repair could ship an answer with zero citations.**
   - **Fix:** uncited claims are dropped only while a cited one remains.
   - **Test:** `test_repair_never_leaves_an_answer_without_evidence`.
4. **The prompt rules contradicted each other.**
   - Rule 11's example used "step-free" for an unverified route, and rules 5, 5g and 6 conflicted with 11.
   - **Fix:** the rules are reconciled with the new layout.

Minor findings:

| # | Finding | Status |
|---|---|---|
| 5 | Attempt numbers drifted after a schema failure, and a second `final_answer` in one response was drafted | Fixed: shared attempt counter, a synthesized "did not fill in the answer form correctly" check, and only the first `final_answer` per response is drafted (tests added) |
| 6 | Chinese drafts only appeared at the end | Fixed: CJK punctuation counts as a boundary |
| 7 | An issue label contained the word "safe" | Reworded |
| 8 | A template fallback left the trace ending on "sent back" | Fixed: a row says "Answer built from the checked data without AI wording" |
| 9 | "and N more" could merge into an unrelated caveat | Fixed: it only merges after a "Not checked yet" line |
| 10 | `REASSURE` is English-only | Deferred to the BM/中文 cycle |
| 11 | The licence change had no ruling | W1 above |

---

## Cycle 1: Township World Model core, What-if Lab and multi-turn memory (16 Oct, about 21:16–21:45)

**Spec:** [2026-10-16-township-world-model-whatif-design.md](specs/2026-10-16-township-world-model-whatif-design.md). Research basis: brief §4 and §6 (#1 What-if Lab and #7 multi-turn memory).

### What was built and why it is impressive

**1. A real world model (`packages/spatial/.../twm.py`).**
- **State:** the `World`.
- **Actions:** a closed vocabulary (`SetRiverStage`, `ClosePath`, `BuildRamp`, `AssumeFact`, `VerifyFact`), gated by `legal()`.
- **Transition:** a pure copy-on-write `apply()`.
- **Rollouts:** `rollout()` over resident journeys or over an evacuation sample.
- **Diff:** `compare()`.

This is the Code World Models / LLM+P pattern from the research brief: the language model proposes from the engine's own "legal moves" (`suggest_interventions`), the engine disposes (`simulate_what_if`), and the validator checks every spoken number against the simulation.

**2. The `eval_memo` batch memo** makes rollouts 3–6× faster on the real seed, so a what-if fits inside a chat turn (numbers in the Evidence table).

**3. Agent what-ifs.**
- New validator rules: the answer must say "what-if", quote only simulated numbers, keep imagined outcomes conditional, and never call a what-if a real plan.
- A shared `template.whatif_answer` gives the mock and the template the same wording.
- A `whatif.diff` scene intent, a what-if disclaimer and an uncertainty note.

**4. A river-rise-plus-change decomposition** (`reach_stage_only`). The answer separates what the flood does from what the ramp adds.

**5. Multi-turn memory.** The in-process `SessionMemory` is keyed by a per-tab `session_id` and never written to disk. Follow-ups such as "and if it rises another metre?" now work.

**6. Web.**
- What-if diff on the Stylised 3D map: grey today, lilac imagined, magenta changed paths. The camera frames it and a "What-if · not real" legend sits on top.
- What-if Lab panel (Management mode): engine-suggested changes, a river stage and a journey set, then Run, with before/after bars and no LLM involved.
- `POST /what-if` and `GET /what-if/suggestions`.

### Evidence

**Engine timings on the Elmina seed:**

| Operation | Before | After `eval_memo` |
|---|---|---|
| 50-origin evacuation what-if | 7.2 s | 2.7 s |
| Engine suggestions | 29.5 s | 5.0 s |
| 200-journey suite | 44 s | 20 s (chat uses 60) |

**On the real seed:**
- At +3 m: 47 of 50 sampled wheelchair origins reach a centre today, and 45 of 50 at +3 m.
- The suggested street closure on top changes nothing further. Every reachable route is partly unverified, which is honest given the 16k unchecked paths.

**Live (Haiku 5.5), tiny world:**
- The 2 what-if golden cases pass. The validator caught "will be built" and an imagined outcome stated as fact in the first attempt, and the model rewrote both.
- **Two-turn follow-up** (`evals/run_followups.py`):
  - Turn 1, +3 m plus a ramp: 4 of 5 reach a centre, and the ramp changes nothing.
  - Turn 2, "another 2 metres": the model re-ran at +5 m keeping the ramp. 4 of 5 with the ramp versus 2 of 5 without it. **The ramp only matters in the bigger flood.**
  - Both turns were accepted first time (`evals/results/2026-10-16-live-followups.json.txt`).

**Screenshot:** `docs/06-pitch/screenshots/ai-cycle1-whatif-lab-stylised.jpg`.

**Tests:**
- spatial `test_twm.py`: 21 tests, covering purity, each action, illegal actions, stage monotonicity, the evacuation scope and the tools;
- agent `test_whatif_agent.py`: 4 tests;
- agent `test_memory.py`: 4 tests;
- what-if validator tests: 4;
- API `test_whatif_api.py`: 4 tests;
- vitest: `whatifModel`, plus the scene store `whatif.diff` test;
- e2e: what-if assistant hero and What-if Lab run.

**Golden (mock):** 15/15, including 2 new what-if cases.

### Rulings (Cycle 1)

Each ruling gives what was decided, why, and the cost if it is wrong.

- **W5: v1 actions never change graph topology.**
  - **What:** no new footbridges.
  - **Why:** the component cache relies on fixed topology, and claim, closure and stage changes cover the hero questions.
  - **Cost if wrong:** "what if we build a new link?" is not answerable yet. That is the next action to add, together with a cache rewrite.
- **W6: imagined claims use status `verified` inside the copy, with `evidence_type="whatif"`.**
  - **Why:** the evaluator treats them as facts, but only in the imagined world. Every after-state is `whatif=True`, so the validator forces "would be".
  - **Cost if wrong:** if an imagined world leaked, its claims would look verified. `apply()` purity tests guard this.
- **W7: memory is in-process only.**
  - **What:** 6 turns, 200 sessions, 30 min idle.
  - **Why:** PDPA, since user words are never persisted.
  - **Cost if wrong:** follow-ups are lost on restart or on another worker. Acceptable for the demo; a multi-worker deployment would need a shared TTL store.
- **W8: the What-if Lab sits in Management mode, at the top of the assistant column, not over the map.**
  - **Why:** it keeps the map clear for the diff, and staff plan changes while residents ask questions.
  - **Cost if wrong:** less discoverable. The Management starter also offers a what-if question.

### Pitch line (judge-facing)

> TownshipLens doesn't just answer questions about the township: it imagines. Ask "what if the river rises 3 m and we build a ramp at those steps?" and it runs your change on a copy of the township's world model. It compares every sampled journey before and after, draws the difference on the 3D map, and tells you what the flood does and what the ramp adds. Ask "and another two metres?" and it remembers the conversation and finds that the ramp only matters in the bigger flood. Every number comes from the simulation, never from the AI, and every imagined change is labelled not real.

### Integration notes for shaoxian04

- **New scene intent `whatif.diff`.** It carries a FeatureCollection; every feature has `whatif: true` and `side: before|after|touched`.
  - `sceneStore.whatIf` holds it, and `clearWhatIf()` clears it. It is also cleared on a persona change.
  - The Cesium `WhatIfLayer` draws it and the camera frames it.
  - **Mapbox lite and the List view do not draw it yet.** Please add it if you touch them; `whatifModel.diffLines` gives the three line sets.
- **New overlay `map-ui/WhatIfTag`.** It shows the legend and a clear button at `top-16`, below `RouteTag`.
- **New panel `features/whatif/WhatIfLab`.** It is rendered by `AssistantPanel` in Management mode only, collapsed by default, and capped at 48vh with its own scroll. Restyle freely.
- **`chatRequestBody` now sends `session_id`.** It is one per page load, used for follow-up memory.
- **Management starters:** "Which areas are isolated if the water rises 5 m?" was replaced by the what-if starter, because the test requires four starters per mode.

---

## Cycle 2: verify-next planner (value of information) and the belief over unchecked facts (16 Oct, about 21:45–21:55)

**Spec:** [2026-10-16-verify-next-planner-design.md](specs/2026-10-16-verify-next-planner-design.md). Research basis:
- feature #2 (verify-next) and #5 (learned belief) in the brief;
- the value-of-information formulation in `reference/notes/world-models-urban.md` §5.

### What was built and why it is impressive

1. **`planner.plan_verifications`: budgeted route-bundle coverage.**
   - On the real seed one fact almost never changes a journey, because one evacuation route crossed 66 unchecked items. Myopic value of information is therefore useless, and the objective is an AND (not submodular).
   - The planner greedily picks whole route bundles: the most journeys newly covered per new fact.
   - It then **verifies the plan on the world model**: `twm.compare` with the facts passing. The reported number is the simulated one, phrased "would be confirmed if they pass".
   - Each fact carries a readable label, a place, how many sample journeys rely on it, and the open ticket if there is one.
2. **`belief.py`: the one learned part, kept honest.**
   - An empirical-Bayes Beta-Bernoulli model per (path type, attribute).
   - The prior is regional OSM tag counts (`data/scripts/build_belief_prior.py`); without them it is Beta(1, 1).
   - It is updated only by real staff verifications: demo values, what-if claims and OSM imports never count.
   - It is used only for the staff-side expected value (`expected_confirmed`), never for resident answers.
3. **Assistant support.**
   - A `plan_verifications` tool.
   - Validator `plan_errors`: the answer must be conditional ("if … pass"), use only the plan's numbers (checks, places, journeys), and never say "will be confirmed".
   - A shared `template.plan_answer` for the mock and the template.
   - Prompt rule 14, and a Management starter.
4. **API and web.**
   - `GET /verify-next` and `GET /belief`.
   - A "Verify next · survey plan" board on `/tickets`: who, journeys, a budget of checks, one line per place to visit, and "Open ticket" links.

### Evidence

- **Real seed, wheelchair, evacuation sample, budget 15 checks:** "If these 15 checks at 5 places pass, 4 of 50 sampled wheelchair journeys would have a confirmed route to an evacuation centre (today: 0)." It takes 5 s.
- **Greedy against brute force:** equal on the tiny fixture for budgets 1–3 (`test_greedy_matches_brute_force_on_the_tiny_world`). The engine-verified count equals an independent `compare`.
- **Live (Haiku 5.5):** the verify-next golden case passes first time with no rewrites (`evals/results/2026-10-16-live-plan-1.json`).
- **Screenshot:** `docs/06-pitch/screenshots/ai-cycle2-verify-next-board.jpg`.
- **Data finding (an honest negative result):**
  - The seed's 516 OSM `wheelchair` tags are all "yes", concrete footways from one mapping campaign. No classifier is trained on a single-class label.
  - The regional Overpass prior query is **BLOCKED**: both mirrors returned 502/500 ("at capacity"). Two requests were made and the run stopped. It will be retried once later; until then the belief is Beta(1, 1) and `GET /belief` reports `osm_prior_obs: 0`.

### Rulings (Cycle 2)

Each ruling gives what was decided, why, and the cost if it is wrong.

- **W9: plan over route bundles, verified by simulation.**
  - **Why:** single-fact value of information is zero almost everywhere on the seed.
  - **Cost if wrong:** greedy can miss a better set (no guarantee, PSPACE-complete in general). Brute force matches on small worlds.
- **W10: belief = Beta-Bernoulli, not a classifier.**
  - **Why:** the only local labels are single-class, and a classifier would be fake.
  - **Cost if wrong:** weaker ranking than a good classifier. When real staff verifications accumulate, the belief improves on its own.
- **W11: older-adult journeys whose route needs unverified rest points are left out of plans in v1.**
  - **Why:** rest points are place facts, not path facts.
  - **Cost if wrong:** plans under-serve that profile. Rest-point facts are the next addition.

### Pitch line (judge-facing)

> TownshipLens turns its honesty into a work plan. Every gap is visible, so the world model can tell staff exactly where to look next: "check these 15 things at 5 places and 4 more wheelchair users would have a confirmed route to an evacuation centre; today none do." The plan is checked by simulating the township, not guessed by the AI. Every ticket staff resolve updates the model's belief about what the next survey will find.

### Integration notes for shaoxian04

- **New board `features/whatif/VerifyNextBoard`,** rendered at the top of the `/tickets` list column. It is collapsed by default and opens with "Plan a survey". "Open ticket" selects that ticket.
- **New model helpers:**
  - `whatifModel.groupBySite` groups the plan's checks into one line per place;
  - `whatifModel.plural`.
- **New endpoints:** `GET /verify-next` and `GET /belief`, both in the generated client.


---

## Cycle 1–2 review (independent Opus reviewer) and fixes (16 Oct, about 21:55–22:11; commits `c66cf59`, `3ac3bd7`)

**1 Critical + 8 Important findings, all reproduced by the reviewer and fixed with regression tests.**

| # | Finding | Fix |
|---|---|---|
| C1 | Public `POST /what-if` could run for 148 s (a drive profile with 7 actions rebuilt road components per call) | Walking profiles only; at most 2 world-model runs at once; a 32-entry result cache by world version. Worst case on the seed is now about 4 s, and a repeat takes 0 s (`test_tool_rejects_drive…`, `test_repeated_requests_are_served_from_the_cache`, API `test_what_if_rejects_drive_and_bogus_stage`) |
| I1 | Memory let a follow-up repeat simulated numbers with no check | Memory records whether a turn simulated; a later turn quoting what-if numbers must re-simulate, and plan wording ("will be built") is banned after any simulation (`test_follow_up_cannot_repeat_whatif_numbers_without_resimulating`) |
| I2 | "Would be confirmed" hid demo values | `RouteState.demo_evidence` and `summary.confirmed_on_demo_after`; the validator requires "demo values, not yet surveyed", and the template and mock add it (`test_whatif_on_demo_values_needs_the_caveat`) |
| I3 | A stage on screen was called "today" | `base_scenario_id`: the before state reads "before, at River +N m", and flood guidance is kept when either state has a stage. The web says "Before" |
| I4 | Validator false positives: "become reachable", "today … is confirmed", "has been closed by staff", "a 400 m route", Bahasa/中文 labels | Scoped regexes: measurement numbers are excluded, "today/currently" sentences are skipped, `WHATIF_AS_PLAN` covers only future builds, and BM/中文 labels are accepted (`test_whatif_correct_answers_are_not_rejected`) |
| I5 | False negatives: a reach number spoken as "confirmed", percentages, "can now reach", "plans to build", the label only in a caveat, claims not checked | Numbers are bound to the status next to them (`STATUS_NUM`); percentages are rejected; claims are checked; the label must be in the summary (`test_whatif_lies_are_rejected`) |
| I6 | The `default` profile gave "0 of 0" | `suite_journeys` uses the sim's origin→destination pairs for every walking profile |
| I7 | Memory replayed full tool results (10–30 KB per turn) | Compact turns only (question plus shown answer, at most 1200 chars each), capped at 6000 chars per session |
| I8 | More than 8 actions crashed the turn; `stage_p9m` was accepted | Both rejected inside the tool with `ok=False` |

**Minor findings fixed:**
- `build_ramp` is only allowed on steps.
- Raw attribute keys no longer reach `describe`.
- Duplicate React keys are gone.
- `eval_memo` keeps a strong reference to the edge table.
- The evidence id includes the before stage.
- `whatIf` is cleared on a new route or a scenario change.
- The Lab clears stale results when its inputs change and shows a suggestions error state.
- The legend moved to `top-20` and wraps, and it says the diff is only drawn on the 3D map in the lite and list views.
- The session id uses `getRandomValues`.

**Deferred (Minor):**
- Lab focus management.
- The evidence card for what-if citations.
- Multi-worker memory, which needs a shared TTL store (W7).
- Drawing the diff in Mapbox lite and the List view.

**Seed numbers after the fix:** at +5 m with the suggested changes, the walking profile's confirmed evacuation journeys fall from 41 to 33 of 50 (4.2 s).

**Live after the review fixes (Haiku 5.5, tiny world):**
- Golden: 15/16 on the first run. The miss was a +3 m what-if answer without "not a forecast". The validator now requires that phrase for staged what-ifs. After the fix, both what-if cases pass live (`evals/results/2026-10-16-live-whatif-2.json`).
- Template fallbacks: 0.
- The trace caught and rewrote six attempts (demo "confirmed", "probably", a wrong what-if number, an imagined outcome stated as fact, and two schema slips).
- The two-turn follow-up passes.

**Overpass prior: unblocked at about 22:08.**
- One request on the hourly retry succeeded, returning 2,832 Klang Valley paths with accessibility tags.
- `data/seed/elmina/belief_prior.json` holds 2,984 observations, for example footway width 139 pass / 5 fail, path incline 28/11, pedestrian incline 6/8.
- The belief is now informed for footway, path, pedestrian and steps types. Streets and major roads stay Beta(1, 1), which `GET /belief` shows openly.

**Spend so far:** US$0.086 of US$3 (usage 26.87891).


---

## Cycle 3: rising-river population rollout and tipping points (16 Oct, about 22:11–22:30)

**Spec:** [2026-10-17-rising-river-rollout-design.md](specs/2026-10-17-rising-river-rollout-design.md). Research basis: brief #3 and #9, the urban notes §4 (evacuation simplifications) and the repo notes §7 (Cesium agent animation).

### What was built and why it is impressive

1. **`rollout.river_rollout`: the world model's time axis.**
   - Synthetic residents per persona, the same seeded origins as the journey tests, head for their nearest reachable centre at every precomputed river stage.
   - It returns per-stage counts, per-resident statuses, the **tipping stage** and deduplicated routes.
   - Reach is monotone across stages (tested).
2. **`rollout.tipping_point`: the resident question, "At which river level does my route break?"**
   - It covers one journey across all stages.
   - A likely-flooded start or destination breaks the trip even when a path to it still exists. The plain route status would hide that.
3. **Assistant support.**
   - Tools `river_tipping_point` and `rising_river_rollout`.
   - `validate.rollout_errors`: the answer must say "not a forecast", name only modelled stages, name the breaking stage, and use only rollout counts.
   - Shared `tipping_answer` / `rollout_answer` for the mock and the template.
   - The repair step fills the stage for disclaimers.
   - A `river.rollout` scene intent plays the animation.
   - Prompt rule 15.
4. **Web.**
   - **Rising river panel** (Management mode): stage buttons, play/pause, and per-persona "N of M still reach a centre" bars. The flood layer follows the playback stage.
   - **Cesium `RolloutLayer`:** one `PointPrimitiveCollection` with one `clock.onTick`. Yellow residents walk their engine route; red ones are cut off and stand still; grey ones have no mapped connection.
   - **Legend:** "Synthetic residents · simulation, not a forecast · no crowding or departure times".
   - **API:** `GET /river-rollout`, cached by world version.

### Evidence

- **Elmina seed, 3 personas × 30 sampled residents × 6 stages, 13 s:** "still reach a centre" goes 29 at normal level → 28 at +1 m → 27 from +2 m to +5 m, for every persona.
  - **Honest finding:** Elmina's routes mostly hold. The model names the two places whose residents are cut off first, at +1 m and +2 m. That is a resilience result the developer can use.
- **Tipping point on the seed:** the playground's trip to the nearest centre breaks at **River +4 m**, because the playground itself is likely flooded there. The path is still "confirmed" at that stage, which is why the endpoint check matters.
- **Live (Haiku 5.5):** both river golden cases pass with no template fallbacks (`evals/results/2026-10-17-live-river-1.json`). The rewrites were "set scenario_id" plus one count the rollout had not produced. The scenario_id fill is now a fact-free repair.
- **e2e:** 13/13, including the Rising-river panel and the assistant tipping point.
- **Golden (mock):** 18/18.
- **Screenshot:** `docs/06-pitch/screenshots/ai-cycle3-rising-river-stylised.jpg`.

### Rulings (Cycle 3)

Each ruling gives what was decided, why, and the cost if it is wrong.

- **W12: residents are drawn only on engine routes.**
  - **What:** a cut-off resident stands still at the start of their last route, and the animation speed is display-only. No minutes are ever stated.
  - **Why:** honesty. Travel times per profile are unsourced (urban notes §4).
  - **Cost if wrong:** less "realistic" motion, but nothing implies a time to safety.
- **W13: the tipping point counts a likely-flooded start or destination as a break.**
  - **Why:** "the path exists but the playground is under water" must not read as reachable.
  - **Cost if wrong:** a stricter break stage than the route status alone. That is the safe direction.
- **W14: 30 residents per persona by default.**
  - **Why:** each profile × stage is one rollout, about 13 s on the seed, and the result is cached.
  - **Cost if wrong:** small samples. Every count is labelled "sampled".

### Pitch line (judge-facing)

> Press play and the river rises: +1 m, +2 m, up to +5 m. Synthetic residents of each persona walk the township model's own routes to their nearest evacuation centre. The moment a route breaks, that resident stops and turns red, and the panel counts who still gets through. It shows that Elmina's network largely holds and exactly where it doesn't. A resident can ask "at which river level does my route break?" and get the stage, and the reason. A simulation, not a forecast, and it says so on screen the whole time.

### Integration notes for shaoxian04

- **New scene intent `river.rollout`** maps to `sceneStore.rollout = {on, stage, playing}` through `setRollout`.
- **New layer and legend:** the Cesium `RolloutLayer` (in `layers.tsx`) and `map-ui/RolloutTag` (top right).
- **New panel:** `whatif/RisingRiverPanel`, rendered by `AssistantPanel` in Management mode under the Lab.
- **New hook:** `lib/api.useRiverRollout`.
- **Management starters:** "Tell me about Elmina Lakeside Mall" was replaced by "What happens to residents as the river rises?".

**Spend so far:** US$0.0875 of US$3.

### Cycle 3 review (independent Opus reviewer) and fixes

The reviewer found 4 Critical and 6 Important issues, all reproduced. Each is fixed with a regression test.

| # | Finding | Fix |
|---|---|---|
| C1 | A trip with no route even at normal level was described as "keeps a mapped route" | `reached_at_normal`, plus its own wording ("no working route at any modelled river level: a data gap / cut off already") and a validator rule (`test_a_trip_that_never_works_…`, `test_tipping_answer_for_a_trip_that_never_works`) |
| C2 | Tipping steps called demo-value routes "confirmed" | Per-stage `demo_evidence`; steps say "confirmed (on demo values, not yet surveyed)"; the validator requires the caveat (`test_tipping_hero_labels_demo_values`) |
| C3 | The validator let invented counts, percentages, spelled-out numbers, stages written without "+", forecast words and wrong break stages through | Counts are bound to the stage named in the same sentence, by metric. Percentages and number words are rejected. Stage detection is broader ("rises 2 metres", "a 4 m rise"). "Stranded / will be cut off" is rejected. A break must be stated at `breaks_at` (`test_rollout_lies_are_rejected`, `test_rollout_truth_passes`, `test_tipping_wrong_break_stage_is_rejected`) |
| C4 | `/river-rollout` accepted unbounded, repeated profiles: hours of work in one request, and cache busting | Profiles are deduplicated, ordered and capped at 4 (`rollout.normalise_profiles`) before the cache key; the endpoint returns 503 when busy (`test_river_rollout_repeats_and_permutations_hit_one_cache_entry`) |
| I1 | Route dedupe never merged (route ids hash profile and stage) | Geometry is keyed by a coordinate hash |
| I2 | The rollout animated residents walking from a likely-flooded start, while the tipping point said the trip broke | One rule: a `start_flooded` status that counts as cut off. Cross-check test |
| I3 | A nearest centre that changes by stage was hidden | Per-stage `target_name`, `centre_changes`, and the change counts as a degrade |
| I4 | Playback stuck at normal level in Resident mode | `useRolloutPlayback` is mounted with the map. Browser-checked: a Resident-mode question plays to +3 m |
| I5 | Playback cleared a what-if diff and left the flood layer up | The stage syncs without clearing; the previous scenario is restored on stop |
| I6 | The mock tipping trigger was too broad | A river, flood or water word is required (test) |

**Minor findings fixed:**
- The legend now says "warnings" and "animation speed is illustrative".
- Stages are sorted by `stage_m`; repair sorts numerically; tipping `scenario_id` is the top stage.
- The previous `shouldAnimate` value is restored.
- Residents with no route stand grey at their start.
- The current stage is announced through `aria-live`.
- The legend moved below the tiles status.
- The Resident starter "At which river level does my route … break?" was added (it replaces recycling).

---

## Cycle 4: fix-it planner and the MCP server (16 Oct, about 22:35–22:55)

**Spec:** [2026-10-17-fix-it-planner-mcp-design.md](specs/2026-10-17-fix-it-planner-mcp-design.md). Research basis: brief #4 and #8, LLM notes P1–P3, repo notes §2 (llm-reasoners beam search) and §3 (FastMCP).

### What was built

1. **`fixit.find_fixes`: "the LLM proposes, the world model disposes", literally.**
   - Candidates are the engine's legal fixes (ramps, verifications) plus any legal proposals from the assistant. Invented ids and closures are rejected and listed.
   - Beam search (width 2) runs over sets of up to 3 fixes. Each set is scored by one rollout of its imagined world against a "before" computed once.
   - It has a 20 s time budget and a `stopped_early` flag.
   - It equals exhaustive search on the tiny world, with and without a flood (tested).
2. **`eval_memo` keyed by the edge object and re-entrant.**
   - Untouched edges are the same object in every imagined world, so one memo serves a whole search.
   - Fix-it on the seed: about 55 s → 10–15 s, combined with computing "before" once.
3. **Assistant `find_fixes`.**
   - The best set is recorded as a what-if, so every what-if validator rule applies.
   - A new rule: when the search found no helpful change, the answer may not claim one.
   - Shared `template.fixit_answer`, mock flow, prompt rule 16.
4. **MCP server (`townshiplens_agent.mcp_server`, FastMCP 4.0.9, Apache-2.0).**
   - Serves the township world model's tools to any MCP client over stdio (Claude Desktop config is in `packages/agent/README.md`).
   - Verification requests from clients stay in memory, and `create_verification_request` is hidden unless `MCP_ALLOW_VR=true`.
   - Staff closure notes are stripped, as for the assistant.
   - No banner on stdout.

### Evidence

- **Elmina seed (honest null result):** for every persona, at normal level and at +5 m, no candidate pair changes a single sampled evacuation journey. The answer says so and points to "which facts should staff verify first?", the plan that does move the numbers (Cycle 2: 4 of 50 confirmed after 15 checks). This is decision-useful: the gap is data, not concrete.
- **Tiny world:** the best single fix is "staff verify the incline of the unnamed ramp", which takes confirmed routes from 1 to 3 of 5 trips. The search also reports that a second change adds nothing. A live Haiku 5.5 answer passed first time (`evals/results/2026-10-17-live-fixit-1.json`).
- **MCP over real stdio:** 15 tools listed (ticket creation hidden). `river_tipping_point` returns `breaks_at=stage_p3m` with its disclaimer.
- **Checklist:** all 7 steps PASS (pytest, vitest, e2e 13/13, golden 19/19 mock), mock-backed.

### Rulings (Cycle 4)

Each ruling gives what was decided, why, and the cost if it is wrong.

- **W15: no Lab UI for fix-it.**
  - **Why:** on the real seed it always shows "no change helps", so the What-if Lab and Verify next carry the visual story. Fix-it lives in the assistant and over MCP.
  - **Cost if wrong:** less visible. It is a one-component addition if the field survey turns up blocking steps.
- **W16: the edge-object memo is scoped to one batch only** (one `compare`, one search or one rollout).
  - **Why:** `World.refresh_claim` replaces an edge's claims on the same object, so a long-lived memo could go stale.
  - **Cost if wrong:** a ticket resolved mid-batch shows up in the next batch, not the current one.

### Pitch line (judge-facing)

> Ask TownshipLens "which two changes would help wheelchair users reach a centre at +3 m?" and it searches every combination the world model allows, scoring each one by simulation. In Elmina the answer is honest and surprising: no ramp or single fix in reach changes anyone's route. The missing piece is checked data, and it tells you exactly which 15 checks would. Any AI tool can ask the same questions through our MCP server and get the same validated answers.

### Integration notes for shaoxian04

- No web changes this cycle.
- The MCP server is a separate process (`uv run python -m townshiplens_agent.mcp_server`).

### Cycle 4 review (independent Opus reviewer) and fixes

1 Critical and 6 Important findings, all fixed with regression tests.

| # | Finding | Fix |
|---|---|---|
| C1 | On Elmina the search could hit its time limit, still answer "none helps", and cache it | The clock covers candidate generation too, and a timeout with no helpful set is `conclusive=False`. The answer says "inconclusive" (the validator requires it), and stopped results are never cached (`test_a_search_that_runs_out_of_time_is_inconclusive`, `test_fixit_stopped_early_must_say_inconclusive`) |
| I2 | Candidates came from other journeys or stages, and one fact per path never helps strict profiles | Candidates are generated from the scored journeys under the scored stage. They include "Staff check <path>: incline, steps, width" bundles and ramps at steps that block the unconstrained route (`test_path_bundles_are_candidates`) |
| I3 | The beam-equals-exhaustive test was trivially true | It now compares a full-width beam with exhaustive search and checks that the default beam never claims more than exhaustive search finds |
| I4 | Proposals were silently dropped; a failing check was accepted as a "fix" | Proposals get 3 reserved slots, anything over the cap is listed in `rejected`, and only ramps and passing checks are fixes |
| I5 | Fix-it lies passed: "could help", "would let 12 more" when nothing changed, costs, "easiest / most feasible" | `FIX_HELPS` is broader; no derived numbers are allowed for empty results; `COST_WORDS` is new; the rule is scoped to fix-it-only turns (`test_fixit_empty_result_cannot_be_spun`, `test_fixit_never_invents_costs_or_feasibility`) |
| I6 | MCP could store raw client text in the staff queue | `plan_route` hides `question_summary` (built from place names), and `create_verification_request` goes through `safe_vr_args(source="mcp")` (`test_mcp_clients_cannot_store_free_text`) |
| I7 | The MCP world had no staff closures | Closures are loaded read-only from the site DB at start; the instructions say outcomes are "as of the server's start" |

**Minor findings fixed:**
- The cache key is normalised (budget clamped, baseline treated as none, proposals sorted and capped).
- Runners-up must beat doing nothing.
- The evidence id includes the stop flag.
- The mock reads the number of changes asked for, and its trigger is stricter.
- The template picks the last simulation of the turn.
- The memo's assumptions are commented, and a memo test on imagined worlds was added.

**Seed after the fix:** for wheelchair evacuation at +3 m, wheelchair everyday trips and stroller evacuation, the search is conclusive (16 rollouts, 7–17 s). No pair of whole-path checks or ramps confirms or reconnects a sampled journey.


---

## Cycle 5: live evaluation and the bulk-payload fix (16 Oct, about 23:12–23:32; commits `655554f`, `e8604a8`)

**What was built:**
- `evals/run_eval.py` and `evals/suite/elmina.yaml`: 30 questions in 11 categories on the real seed.
- The scorers: independent number faithfulness (rounded engine values classified separately), honesty-rule re-check, PII echo, grounded-answer rate, and a bare-LLM comparison (the same model, no tools).
- Report: [docs/03-product/ai-eval-report-2026-10.md](../03-product/ai-eval-report-2026-10.md).

**Results (live, Haiku 5.5, final run `evals/results/2026-10-17-eval-live-2.json`):**

| Measure | Result |
|---|---|
| Answers with honesty violations | **0/30** |
| Invented numbers | **0** (3 rounded engine values) |
| PII echoed | **0** |
| Template fallbacks | **0** |
| Grounded answers | 23/30 (the rest are correct refusals and safety redirects) |
| Accepted on the first attempt | 21/30 |
| Median first text / checked answer | 6.5 s / 9.5 s |

**Bare LLM, same model and no tools:**
- It says it has no Elmina data in 23/30 answers.
- 4/30 break the honesty wording rules.
- 3/30 give unsupported distances.
- 8/30 make "step-free" or "accessible" claims with nothing checked.

**Bug found and fixed (it existed before this mission):**
- "Which places are cut off at +5 m?" timed out live, because `affected_places` on the seed returns 3,080 evidence rows and 2,468 path ids (825 KB), and all of it was sent to the model.
- `agent._for_model` now drops the per-edge id lists and caps the model's evidence at 60 rows, scenario first. The validator still sees every row.
- After the fix it answers on the first attempt in 10.8 s.
- The demo cache was re-recorded because the mock's citation order changed.

**Ruling W17:** the bare-LLM comparison is reported as "the model cannot answer with facts and sometimes guesses", **not** "the model lies".
- **Why:** the measured bare model is mostly cautious, and over-claiming would itself be dishonest.
- **Cost if wrong:** a weaker slogan. The stronger, true one is "23 of 30 grounded answers versus 0".

**Spend so far:** US$0.1326 of US$3 by OpenRouter's key counter (corrected later: the counter lags; see "Spend, corrected" below).

**Pitch line:** see the report §7.

---

## Cycle 6: Bahasa Melayu and 中文 answers, and the pitch segment (16 Oct, about 23:32–23:42; commit `2d5ae80`)

**Problem (measured live).** Correct BM and 中文 answers were pushed into English:
- The validator required exact English phrases: "demo values, not yet surveyed", "not a forecast", "if … pass", and the "entrance is not mapped" note word for word.
- The status line and the "Worth knowing" heading were rendered in English.
- One Chinese answer was rewritten twice and came out entirely in English.

**What was built:**
- Required phrases are accepted in English, BM and 中文 (`validate.DEMO_PHRASES`, `NOT_FORECAST`, `PLAN_CONDITION`). The entrance note is accepted translated, as long as it names the place and its entrance.
- BM and 中文 reassurance bans ("jangan risau", "tiada masalah", "应该没问题", "不用担心"). "mungkin" and "可能" stay allowed, because they translate the "possibly flooded" class.
- `labels.detect_language` picks the language from the question. The status line and headings are localized ("Status laluan: sebahagian belum disahkan", "路线状态: 部分未核实", "Perlu diketahui:", "注意事项："). Template fallbacks stay English.
- Prompt rule 8 covers the whole answer, caveats included, in the user's language, with the accepted phrase forms and canonical flood-class translations. "Likely flooded" had been weakened to "kemungkinan / 可能"; the canonical forms are now "besar kemungkinan dinaiki air" and "很可能被淹".
- Six BM and 中文 questions were added to the eval suite.
- The pitch: a new 3-minute world-model segment in `docs/03-product/demo-script.md` for the current two-screen UI, with cache-warming notes.

**Evidence (live, Haiku 5.5, the same 8 BM / 中文 questions):**

| Measure | Before (`evals/results/2026-10-17-eval-lang-before.json`) | After (`…-lang-after.json`) |
|---|---|---|
| Accepted on the first attempt | 4/8 | **6/8** |
| Rewrites | 6 | **2** |
| Answers mixing English required phrases or frame | 8/8 | **1/8** |
| Honesty violations | 0 | 0 |
| Invented numbers | 0 | 0 |

**Ruling W18:** the validator stays English-first for numbers; BM and 中文 count words are not bound to statuses.
- **Why:** a full multilingual number grammar is out of scope.
- **Cost if wrong:** a BM or 中文 answer could misstate a count unchecked. Mitigation: the eval's number-faithfulness check is language-independent and found 0 invented numbers.

**Spend so far:** US$0.1326 of US$3 by OpenRouter's key counter (corrected later: the counter lags; see "Spend, corrected" below).

---

## Cycle 7: ticket impact, value of information on every ticket (16 Oct, about 23:42–23:48; commit `f24e821`)

**Spec:** [2026-10-17-ticket-impact-design.md](specs/2026-10-17-ticket-impact-design.md). This makes the timeline's "close the loop live" visible on `/tickets`.

**What was built:**
- **`twm.ForgetFact`:** an internal action, not offered to the language model.
- **`impact.fact_impact`:** the ticket's own journey (parsed from "<profile> route <A> -> <B>") plus 20 everyday trips for that profile.
  - **Open ticket:** imagine the fact passing, or failing, and count the journeys that would become confirmed or lose their route. It also gives the own journey's statuses and the unchecked facts still left on that route.
  - **Resolved ticket:** compare now with "never checked". It gives the journeys the check changed and the belief before and after.
- **`GET /verification-requests/{id}/impact`:** cached per world version, through the world-model slots. It is staff-only and not an assistant or MCP tool.
- **Web `tickets/ImpactCard`,** shown on every open or resolved ticket.

**Evidence:**
- **Tiny world:** the stroller ticket "Car Park B → Park kiosk" (ramp incline). If it passes, the resident's own trip goes from partly unverified to confirmed, with 0 other checks left on that route. Once resolved, the card reads "before partly unverified, now confirmed", and the model's estimate for that kind of fact rises (tests).
- **Elmina seed:** about 2.8 s per ticket. A typical honest result is "if it passes, 0 of 21 sampled journeys would become confirmed". One fact rarely completes a route, which is why the survey plan (Cycle 2) bundles them.
- **Browser check:** the card renders on `/tickets`, seed, Stylised.
- **e2e:** a new "ticket impact" hero passes. The checklist passes except gen, which shows only the uncommitted client diff.

**Pitch line:**

> Every ticket now tells staff what checking it would change: "if this ramp's incline passes, this resident's own question gets a confirmed answer." After they check, it shows what it did change, and how the model's belief moved. The verification loop, visible.

**Integration notes for shaoxian04:**
- New `tickets/ImpactCard`, inside `TicketDetail` under the facts list.
- It uses the new `GET /verification-requests/{id}/impact`.

### Cycle 7 review (independent Opus reviewer) and fixes (16 Oct, 23:56)

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Important | The public endpoint, cached per ticket id in the shared 32-entry cache, could be thrashed by cycling ids. Each miss costs about 2.8 s and holds one of 2 solver slots for up to 20 s. | Impact has its own 512-entry cache keyed by the **fact** (element, attribute, ticket state, summary). It waits at most 2 s for a slot and then answers "busy". Chat what-ifs are never evicted. |
| 2 | Important | Tickets that did not name a profile silently got wheelchair numbers, and the card never said which profile. | The first walking profile whose rules use the fact; `profile_assumed` is returned. The card says "Sampled N everyday stroller journeys" and "(profile assumed: …)". |
| 3 | Important | The own journey used the first name hit (the seed has 18 duplicated names, e.g. "Surau"), ignored centre names, and split on the first " -> ". | No guessing: a name must match exactly one place or centre, and exactly one split must resolve. Otherwise no own journey is shown. |
| 4 | Important | A just-resolved ticket kept its "would" card for up to 30 s. | The ticket state is in the query key, and resolving invalidates `ticket-impact`. |
| 5 | Important | The mode followed the claim, not the ticket. A resolved ticket with a contested, stale or placeholder claim read "would". `did` never counted routes cut. | The ticket state is passed in. A resolved ticket without a counted verification gets `none` and says why. `did` counts `lost_route`, and the card says "N lost their route". |
| 6 | Minor | The own journey was inside the sample, which made the test assertion near-tautological. | It is reported separately; `sampled` and the counts cover the everyday sample only. |
| 7 | Minor | "Confirmed" could rest on demo values with no caveat. | "Includes demo values, not yet surveyed." whenever the own route carries placeholder evidence. |
| 8 | Minor | Busy or error looked like "no impact", and loading had no live region. | `role="status"`, and a "busy, try again" message. |
| 9 | Minor | Weak tests. | Exact modes and profile; tests for ambiguous names, centres, a verified fail, resolved-but-unverified tickets and the cache. The wording moved to a pure `impactModel.ts` with vitest. |

Ruling W19: impact stays public and read-only (counts and place names, like `/verify-next`). Making it staff-only would need the staff token on every ticket view. The fact-keyed cache and the 2 s wait bound the cost instead. Cost if wrong: a scraper could still spend one slot about 2.8 s per distinct fact, at most once per world version.

## Cycles 5–6 review (independent Opus reviewer) and fixes

The reviewer reproduced each gap against the validator, the eval scorer or the committed live results. Each is now a regression test (`packages/agent/tests/test_validate_multilingual.py`, `evals/tests/test_run_eval.py`).

| # | Severity | Finding (reproduced) | Fix |
|---|---|---|---|
| A1 | High | A likely-flooded place could be weakened to "possibly" in any language. It happened live: zh-safe said 可能受淹 and bm-flood-safe "kemungkinan dilanda air" for a *likely* flooded Urban Park. | A caveat naming a likely-flooded endpoint must say "likely flooded" / "besar kemungkinan" / "很可能". |
| A2 | Medium-High | BM and 中文 could call demo values verified ("telah disahkan oleh kakitangan", "已由工作人员核实"). | `VERIFIED_ML`, with negation (belum, 未, 没有…). The app's own demo status line stays allowed. |
| A3 | Medium-High | Guesses passed in BM and 中文 ("mungkin boleh dilalui", "应该可以通行", "barangkali"). Two false positives ("Tiada masalah yang dilaporkan", "这并不代表没问题"). | Positive guesses are banned in all three languages, including English "might be fine". "mungkin" / "可能" alone stay allowed, since they translate "possibly flooded" and honest "may have steps". The two false positives are fixed. |
| A4 | Medium | Any caveat naming the place plus "entrance" satisfied the "entrance is not mapped" rule, even "use the entrance by the lake". | The translated note must carry a negation (not mapped / belum dipetakan / 未标注). |
| A5 | Medium | "Status laluan: disahkan" or "路线状态：已确认" contradicting a partly-unverified route passed. So did a plain "laluan disahkan" on demo values. | BM and 中文 status words are mapped to English before the status checks. |
| A6 | Medium | What-if, plan and rollout counts went unchecked in BM and 中文 ("46 daripada 50"). | For a non-English simulation answer, every count must be a number the simulation returned. |
| A7 | Low-Medium | Depths in BM and 中文 passed (kedalaman, 水深, 齐膝). | DEPTH covers them. |
| A9 | Medium | A flooded endpoint named in BM or 中文 was not pinned above the summary. | `FLOOD_WORDS` in `_urgent`. |
| A10 | Low | Place names made English questions "Malay". Short BM questions read as English. The mock's English answer got a BM frame. "。." appeared at sentence ends. | Names are stripped before detection, and more BM words are known. **The frame now follows the answer's language.** CJK sentence ends are handled. |
| B1 | High | Live "2,503 places likely cut off": 35 places plus 2,468 path segments. | `affected_places` returns `likely_place_count` / `likely_path_count` (and the possible pair). The tool docstring says which to use. A validator rule keeps a "N places" count to place counts. The mock now says "23 places and 1353 path segments". |
| B2 | Low-Medium | The 60-row evidence cap could drop every placeholder row from the model's view. | Ranked before the cap: scenario, then placeholder, then unknown/place rows, then the rest. |
| B3 | Low | `evidence_truncated` was never explained to the model. | Prompt rule 9. |
| C1 | High | The number-faithfulness scorer was a substring test over the whole payload: "47" matched inside an id, and "2,503" was read as 2 and 503. | Numbers come from JSON values only (no ids, keys or geometry) and are compared as numbers. List lengths count ("all 6 unchecked items"), as does a list's remainder ("and 61 more"). |
| C2 | High | Live zh-flood leaked `</summary><parameter name="claims">…ev-scn-…` to the resident, and the gate passed it. | RAW_ID covers ev-/rt-/vr- ids, `evidence_ids` and tool-call markup. |
| C3 | Medium | The report claimed more than its JSON showed. "0/30 step-free claims" was never measured for the world model. "Grounded" and "says no data" were not in the committed JSON. Rewrites were 10, not 9. "English-mixed 8 → 1" was wrong. | The report is rewritten from a fresh live run (below), with every number from its JSON. The certainty count is now measured for both sides. |
| C4 | Medium | The scoring is not independent of the validator. The percentage regex never matched. Place names were not stripped. | The report says so plainly. `SPECIFIC` matches %. Names are stripped. |

Ruling W20: the language-specific rules are phrase lists, not a translation model. They catch what the review reproduced and close variants, but not every paraphrase. The prompt carries the same translations, and the eval re-reads the shown text. Cost if wrong: an unusual BM or 中文 phrasing of a banned idea could pass. Mitigation: wrong numbers in BM and 中文 are still caught by the count check, which needs no phrase list.

Ruling W21: the answer frame follows the answer's language, not the question's. A model that answers a BM question in English (the mock always does) gets an English frame, never a mixed one.

## Cycle 8: what-if in every view (17 Oct, about 00:00–00:22)

**Spec:** [2026-10-17-whatif-every-view-design.md](specs/2026-10-17-whatif-every-view-design.md).

**Why:** the list view is the accessible fallback (no WebGL, no keys, screen readers) and the view e2e runs in, yet a what-if only said "the diff is drawn on the 3D map". The world model's main result was missing exactly where accessibility matters most.

**What was built:**
- **Engine.** `diff_geojson` carries a `meta` member: the engine summary, action labels, profile, scope and stages. Its `changed` rows hold both statuses even when a cut route has no line. Features also carry readable names.
- **List view.** `WhatIfListSection` (region "What-if · not real") shows the imagined changes, today vs what-if counts, the imagined paths and the journeys that change ("confirmed → would be blocked"), with a Clear button.
- **Lite map.** It draws the same before/after/touched layers; the filter requires `whatif == true`.
- **Tag.** It shows the legend on both maps and says "Listed below" in the list view.

**Evidence:**
- pytest: two new tests, the diff meta and a cut route listing both statuses.
- vitest: three new cases for `diffMeta`, `diffJourneys` and `touchedLabels`.
- e2e: the what-if hero now also checks the list-view section and Clear (14/14).
- **The e2e found a real bug.** A closure that cuts a route left the row "confirmed → would be" with nothing after it, because the cut side has no line. Fixed at the source with `meta.changed`.
- Browser (seed, mock, Stylised 3D): the what-if tag and legend still draw.
- **Not browser-checked:** the lite map. It has no user toggle, so the renderer could not be forced. The layer is typechecked only.

**Pitch line:**

> The world model's answer reaches everyone: on the 3D map, on the lite map, and as plain text for screen readers and phones without 3D. The same numbers each time, always labelled imagined.

**Integration notes for shaoxian04:**
- New `scene/list/WhatIfListSection.tsx`, mounted in `ListView` after Route.
- A `whatif` source in `MapboxLite`.
- `WhatIfTag` wording changed.

## Second review (fixes and Cycle 8) and the fresh live evaluation (17 Oct, 00:34)

**Fresh live evaluation.** All 36 suite questions, with the bare-model comparison, on the fixed validator: `evals/results/2026-10-17-eval-live-3.json`. The [report](../03-product/ai-eval-report-2026-10.md) is rewritten from it.
- **World model:**
  - 0/36 honesty-wording violations;
  - 0 invented numbers (the 1 flagged was a street name, and the scorer is fixed);
  - 0 fallbacks;
  - 25/36 accepted on the first attempt;
  - 30 grounded answers;
  - 7/8 BM and 中文 questions answered in the user's language.
- **Bare model:** says it has no data in 24/36, and gives made-up measurements in 6/36.
- **Re-run of the 11 rewritten questions** with reasons recorded (`…-eval-rewrites.json`). The reasons were legitimate: the demo caveat, "is confirmed" for an imagined outcome, unproduced numbers, the plan condition, and "safe". One BM/中文 count rejection can no longer be judged, because the rejected text is not stored; that rule has since been narrowed (below).

**Spend, corrected.** OpenRouter's key counter stopped moving at 15:42 UTC while live calls continued, so it lags. Estimated from the recorded tokens at list price, with no cache discount (an upper bound): about **US$0.87** for all live runs of the mission, plus a few cents for bare calls. The counter shows US$0.13. From now on the cap is tracked by the token estimate.

**Second review findings (independent Opus reviewer), mostly false positives in the new BM/中文 rules.** A false positive sends a correct answer to a rewrite or to the English template.

| Severity | Finding | Fix |
|---|---|---|
| Important | "工作人员…检查/核实/确认" fired on requests and negations ("需要工作人员实地确认", "已请工作人员核实"). | Only perfective forms count ("工作人员已检查", "已由工作人员核实", "…检查过"); more negation words are handled. |
| Important | The BM/中文 count rule rejected any digit: dates, "Jalan 2/3", "Seksyen U16", "2 anak tangga", "3-5 minit". | Only counts next to a count noun ("daripada", perjalanan, tempat …) or a Chinese measure word (次/条/个/项/处/人) are checked. |
| Important | `detect_language` read English with Malay place names ("Pusat Komuniti Sungai Buloh") as Malay. | Place-like nouns are dropped from the word list; only function words count. |
| Important | The place-count rule flagged any "N places" (sums, list sizes). | It flags only a combined places-plus-paths total said as places. That was the live bug. |
| Important | The List what-if section said "imagined" for a stage-only simulation and never said "not a forecast". | It branches on `meta.imagined` and adds "River levels are indicative scenarios, not a forecast". |
| Minor | "may be accessible" (honest hedge), "不放心", "没问题吗", "ev-charging", "Level-ev-3" were false positives. | Fixed. |
| Minor | Missed: "没有问题", "tak ada masalah", "tiada sebarang masalah", "sebahagian disahkan", sentence-form status contradictions in BM/中文. | Caught. |
| Minor | "No sampled journey changes" was asserted without `meta`, and an agent `flood.set_level` left a diff simulated at another level on screen. | The line now needs `changed === 0`; the diff is cleared when the level no longer matches. |
| Minor | The scorer treated nearby numbers as roundings. | A rounding must be the engine value at a coarser unit. |
| Lint | The Cycle 8 commit had a Biome error (array index as a React key); my partial lint run missed it. | Stable journey ids. |

**Demo-day fix.** The demo script's recovery line said "click Lite map or List", but the current UI had no such control. The settings popover now has **Map view: 3D / Lite map / List (text)**, with reasons for views the device cannot show. A browser check on the seed with the mock: the lite map draws the what-if, with the legend.

Ruling W22: the view switch lives in the existing settings popover (shaoxian04's map-ui), not a new toolbar. It is one radiogroup, uses the store's `setView`, and makes the documented recovery step real. Cost if wrong: the UI owner may want it elsewhere; it is a self-contained block.

## Cycle 9: the world model warms itself (demo hardening) (17 Oct, 00:44)

**Why:** cold on the seed, the rising-river rollout takes 14.6 s, the What-if suggestions 9.5 s, and the survey plan 4.7 s *on every load* (the endpoint bypassed the cache). The demo script asked the presenter to open each screen 10 minutes before going on stage, and any ticket resolved on stage made those screens cold again.

**What was built:**
- `apps/api/warm.py`: one daemon thread, started from the lifespan and on by default. It computes the screens' default requests through the same cached tool functions, so the cache keys match. It warms again within 10 s of any world-version change.
- `/healthz` reports `world_model`: state, timings and version.
- `/verify-next` now goes through the cached `tools.plan_verifications` (503 when busy, 422 for a non-walking profile).
- A lock on the shared world-model caches, which request threads and the warm thread now share.

**Evidence:**
- 5 new API tests: the endpoints hit the warmed entries with no new cache entries, health, a failing job, a re-warm on version change, and the profile check.
- Seed, dev server, through the proxy: warm-up took 14.6 s + 9.5 s + 4.7 s in the background. After that, rollout answered in 21 ms, survey plan in 7 ms and suggestions in 3 ms.
- Full checklist PASS. gen showed only the uncommitted client diff for the new 422/503 responses.

**Ruling W23:** warm the defaults only. These are the requests the screens make on open. The What-if Lab's own runs depend on what staff tick, so they are not guessed. Cost if wrong: a presenter who changes persona or budget first waits once.

### Cycle 9 review (independent Opus reviewer) and fixes (17 Oct, 00:48)

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Important | Filing a ticket changes the survey plan's cache key (it links open tickets) without bumping the world version, so `/verify-next` went cold again. | The loop's change signal is the world version plus the open-ticket keys. Test: filing a ticket changes it. |
| 2 | Important | `warm.stop()` joined for 30 s inside the async lifespan, so `--reload` could stall. | Join for at most 2 s (the thread is a daemon). Test: stop returns in under 3 s. |
| 3 | Important | Warm jobs took one of the two solver slots, so a third user request could wait 20 s and get 503. | A job starts only when both slots are free (`tools.wm_idle`), or after 120 s. It yields to residents and staff. Test included. |
| 4 | Minor | The custom 422 entry dropped the validation schema from the client. | Removed; the default 422 schema is back. |
| 5 | Minor | Public `/healthz` exposed a world-change counter and timings. | It shows only `{state, done}`. |
| 6 | Minor | The loop test's first wait could pass before any warm-up, because status was global. | `warm.reset()` in conftest. |

Checklist after the fixes: lint, pytest, typecheck, vitest, golden (mock) and e2e (mock) PASS; gen PASS after the commit.

---

# Elmina Day (overnight build, started 17 Oct)

The user asked for the world model to do "real world model jobs" for the People track, MiroFish-style, and approved the Elmina Day plan ([design](specs/2026-10-17-elmina-day-design.md)). Constraints: the US$3 cap stays, using a cheap model; frontend changes add controls only.

## Research (17 Oct, 02:24)

Three reference repos were cloned into `reference/repos/simulation/` (added to `clone-repos.sh`), each analysed by a subagent.

- **MiroFish** (AGPL; built on OASIS). One persona per knowledge-graph entity, not thousands.
  - **Worth copying:** activity-gated agent sampling, the hot-score feed, interviews, batch surveys, and an action log that the report reads as its only source of numbers.
  - **Not copying:**
    - random follower counts;
    - persona prompts that force invented memories;
    - simulated chatter written into the factual graph;
    - a report prompt that plants a made-up statistic;
    - "real interview" wording for an LLM call.
- **AgentSociety** (Tsinghua).
  - **Worth copying:**
    - whole-day plans as segments (the v2 daily-guidance "story");
    - the gravity destination model (walk under 1 km);
    - the MobilitySpace move-and-interpolate loop;
    - compact memory episodes with importance;
    - Zipf workplace sizes.
  - **Not copying:**
    - random durations;
    - moves reported successful before arrival;
    - every trip forced to finish within 30 minutes;
    - benchmark rhythm guards;
    - uniform demographics.
- **OASIS** (CAMEL).
  - **Worth copying:** actions as tools, the platform schema, the Reddit hot score, `ManualAction` event injection, a per-hour `active_threshold` gate, and cascade metrics.
- **Literature:**
  - a 2026 validation study found LLM city simulators "plausible, not realistic" against Paris and Shanghai travel data;
  - CityBehavEx replaces per-action LLM calls with mobility models.

  Our design follows both: a deterministic engine for the crowd, and an LLM only for about 40 spotlight residents.
- **Statistics:**
  - DOSM 2026 ages 21.2 / 70.4 / 8.4%;
  - Census 2020: 3.8 people per household;
  - DOSM 2024: 92.3% of households own a car;
  - 2.4% registered OKU, 35.6% of them physical.

## Cycle 10: the day engine (02:24)

**What was built:** `packages/spatial/.../day/` (router, population, schedule, engine, scenarios, summary), `tools.day_rehearsal`, `GET /day/scenarios`, `GET /day/{id}`, and warm-up for the four days.

**Router speed:** about 40 ms to build a cost array per persona and stage, then about 1.5 ms per destination field. On the seed, a day of 5,000 residents takes about 5–6 s.

| Day | Trips | Results |
|---|---|---|
| Weekday | 9,493 | 9,300 on time; 193 data gaps (no mapped connection even on a normal day) |
| Storm at the school run | 8,202 | 1,275 cancelled, 189 late (waited for the water), 71 rerouted on the way |
| Event | 10,591 | 647 reach Elmina Valley Central Park; peak 609 there at once |

In the storm, 216 pupils miss school, and households without a car are hit hardest.

**Bug found in testing:** when every way into a destination was cut, the first draft snapped the destination to a nearby usable node, so the trip "arrived" elsewhere. Now only drivers are snapped, to the nearest road on the normal network; a walker who is cut off stays cut off.

**Tests:**
- 13 new tests, including:
  - the router agrees with `routing._search` (lenient) on every node pair, persona and stage;
  - a trip with no way open waits for the water, then arrives;
  - a resident caught on the way waits at the junction they reached;
  - population shares match DOSM within a tolerance;
  - every storm segment is legal in the river state at its minute and never spans a change;
  - counts add up;
  - runs are deterministic.
- API test for `/day`.
- Full pytest PASS (1,144), lint PASS.

**Ruling W24:** lenient routing for residents (unchecked paths allowed, as people do), with every trip counting the unchecked stretches it used. Strict (verified-only) routing would show a township where nobody can go anywhere, since most paths are unchecked. Cost if wrong: residents look more mobile than verified data supports; the count of unchecked stretches says so.

**Ruling W25:** delays are measured against the same trip on a normal day in the real township, so an imagined change and a storm are both compared with today.

### Cycle 10 review (independent Opus reviewer) and fixes (17 Oct, 03:10)

No Critical findings. The router agreed with `routing._search` on 200 random seed pairs across 4 personas and 2 river stages. 8 Important findings, all fixed:

| Finding | Fix |
|---|---|
| Delay was measured from departure, which hid queueing behind an earlier trip. | Delay is now measured from the planned time. The planner also keeps a resident's plans apart, using a travel estimate per plan. Commuting parents drive to work straight from the school gate (a chained plan). A normal weekday now has 14 late trips out of 9,380 (one plan running into the next), down from a hidden count. |
| Children were counted on legs they were not on. | Drop-offs carry the children out only; pick-ups carry them home only. |
| A failed return trip was labelled "cancelled", and the next plan silently vanished. | A resident who cannot get home waits; still stuck at 23:00 means stranded. Any later plan is counted as cancelled ("still stuck from an earlier trip"). |
| "Stranded" almost never applied, and "late" hid six-hour waits. | Residents caught on the way out now turn back home if they can (spotlight residents choose). The report adds "waited over an hour", the median and p90 delay, and splits "caught on the way" from "waited before setting off". |
| "Everyone" counted only residents who went out. | Every group's denominator is the whole group, plus a "stayed home" count. Children travelling as companions count as out. |
| The Friday scenario said "men", but residents had no sex. | Residents get a sex attribute (half each, an assumption). Jumaat is for Muslim men aged 15 to 74. |
| The stated commute and school end times were not implemented. | Plans have absolute end times: children are collected at 13:30, teenagers leave at 14:15, commuters set off home between 17:30 and 19:00. No trip home is made after 23:00. |
| Closures were evaluated on the wall clock. | Closures are evaluated at noon on the rehearsal day, the date is in the cache key, and closed places are left out of plans. |
| A cold day used about 720 MB of path fields. | A shared LRU of 400 fields per day, stored as float32 and int32 (about 38 MB). |

The minor findings are fixed too:
- Homes are weighted by footprint only, since building heights are display-only.
- Commuters without a car take a ride-hail or a lift (the driving profile, stated as an assumption).
- Commutes and data gaps are left out of walking minutes.
- "Visits" replaces "visitors", and school stays don't count as neighbours met.
- A cancelled essential trip records its 90-minute wait.
- Data gaps never wait.
- New tests cover each of these.

**Found while recording:** a resident whose trip was underway at a river change paused at a junction even when their path was still clear, and "caught on the way" was inflated (1,323 trips). Now the path ahead is checked edge by edge at each change, and the resident stops only when it is cut (63 trips). The test checks every edge against the river state at the minute the resident starts it.

## Cycle 11: spotlight residents, voices and the feed (03:10)

**What was built:**
- **`day/spotlight.py`:**
  - a deterministic cast of 40 with unique synthetic Malaysian names: all wheelchair users (up to 3), parents with strollers, older residents, school-run parents, commuters, teens and households without a car;
  - per-resident facts, with an engine-written "what_happened" sentence for each trip;
  - `check_text`: any time or number not in the resident's own day, "safe", depths, forecasts and "verified" are rejected;
  - template voice and feed;
  - the OASIS hot score;
  - township notices written by the engine.
- **Engine decision hook.** At "no way at departure" and "caught on the way", a spotlight resident chooses among options the engine checked as feasible: wait, stay home, another reachable school or clinic, a lift from a neighbour, or turn back. An invalid or stale choice falls back to the rule.
- **`townshiplens_agent/day_voice.py`:**
  - runs up to 3 passes (run the day, collect decisions, ask the model, run again);
  - then diaries, then five feed rounds of residents acting in batches, so later residents reply to earlier posts;
  - interviews;
  - a recording CLI.
- **`day/voices.py`:** the API re-runs the day with the recorded decisions on the current world. It keeps a recorded line only while its trip still happened with the same outcome and the line passes the check. Otherwise it uses the template, and it counts the stale lines it dropped.

**Model benchmark** (`evals/bench_sim_models.py`, the same storm tasks for all four; full table in `evals/results/2026-10-17-sim-model-bench.json`): openai/gpt-6-luna had no failed calls, the fewest output tokens and the fastest run (32 s), and was the cheapest (about $0.003). DeepSeek V4.1 Flash, MiMo-V2.6-Flash and Claude Haiku 5.5 each had 1 to 3 failed calls, more rejected lines, and more tokens. Ruling W26: GPT-6 Luna at low reasoning for the spotlight voices (`LLM_MODEL_SIM` / `LLM_SIM_REASONING`).

**Quality iterations, from reading the recordings:**
- Posts described outcomes before they had happened. Feed rounds now use only trips that are over, and decision reasons must be written before the outcome is known.
- The feed was a flat list of "on time" posts. Now only trips that went wrong, changed, or reached the event may post; others like, reply or stay quiet.
- Names were duplicated; they are now unique.
- Return trips said "reached the Community Centre"; they now go home.
- Cancelled trips said "left at"; they no longer do.
- Teens went to a kindergarten. Schools are now split by level from their names (SK / SJK / sekolah rendah, SMK / menengah), and tadika and tuition centres are excluded.

**Recordings** (`data/sim/elmina/day-*.json`, GPT-6 Luna): storm 86 calls, weekday 62, event 66, friday 63, with no failed calls. 0 to 5 lines per day were rejected by the check and replaced by templates.

**Spend, corrected again:** OpenRouter's counter caught up at 19:07 UTC and shows **US$1.39 used** this mission (26.79 → 28.18). That is more than the token estimate, which undercounted. **About US$1.61 of the US$3 cap remains.** From now on the counter is the authority, a margin is kept, and only essential live calls are made.

### Cycle 11 review (independent Opus reviewer) and fixes (17 Oct, 03:26)

The reviewer read 390 AI diary lines, 30 feed posts and 15 decision reasons from the recordings, and found **no honesty failures in them**: no wrong times, numbers, places or modes, no wrong on-time or late claims, no invented children. The gaps were in the checks that keep future lines honest:

| Finding | Fix |
|---|---|
| A recorded diary line survived when its trip's outcome had changed (only the trip id was matched). | Each recorded line carries the trip's status and is kept only on an exact match. Test included. |
| Feed posts were checked only when written by the AI; recorded names, roles and cast voice lines were trusted. | Every resident post is checked. Name and role always come from the cast. Voice lines go through the check. |
| `check_text` missed "1 metre of water", number words, am/pm times, "unsafe", "'ll / going to flood", "next week" and "aman"; the resident's age licensed any matching number; every check was against the whole day. | All of these are now caught. Each line is checked against its own trip's times and numbers. Decimals are flagged too. |
| OSM place names reached prompts unfiltered (prompt injection), and the interview pasted the question raw. | Place names are sanitised (`clean_name`) and the interview question is delimited. The interview endpoint will be staff-only (Cycle 14). |
| Trip ids were a global counter, so one changed outcome renumbered every later trip. | Stable ids (`resident-plan-direction`). |
| Decision keys collided across plans with the same purpose. | Keys are per plan. |
| A lift was written as "I drove". "Another place" could swap a child's school. Trips home offered pointless choices. | A lift flag, written as "get a lift". Another place only for the clinic, shops, park or worship. No decision on trips home. |
| The template "took N minutes longer" was false when leaving late, and "stuck" appeared without any wait. | "Got to X N minutes later than planned"; "stuck" only after a wait. |
| Minor: home trips said they came from "a main road out of Elmina"; likes were not de-duplicated; pending decisions after the third pass were never re-run. | Home trips come "from work"; one like per resident; a final re-run of the day. |

**Found in the re-run check:** a place name with digits ("Dewan Serbaguna U16/1") failed the number check. The resident's own place names are now removed before numbers are checked.

**Re-recorded** all four days with the stable ids. When the day is re-run live, 0 to 1 lines per day are dropped (the U16/1 case, now fixed).

## Cycle 12: Simulate-a-day panel and map playback (03:26)

**What was built** (controls only, no visual redesign):
- **`features/day/DayPanel`,** in Management mode above the What-if Lab:
  - choice of day, and a clock with play/pause and a time slider from 05:00 to 23:00;
  - live counts at the clock (walking, driving, waiting for the water) and the river stage and rain;
  - Overview: outcomes by group, school, walking, busiest places;
  - Residents: the spotlight cards; picking one flies the camera to them, and their diary is marked "AI voice, checked" or "template", with their decisions and reasons;
  - Feed: only posts that exist at the clock time, newest first, notices dashed;
  - How it was made: DOSM sources, assumptions, the voice model and recording date.
- **`DayLayer` (Cesium):** up to 1,500 residents moving along their real paths (yellow walking, blue driving, red waiting); the followed resident is drawn larger with a white ring. **The flood layer follows the river stage at the clock**, so the water rises and falls as the day plays, and the scenario on screen is restored when the panel closes.
- **The lite map and the List view** show the same day: circle dots, and a text section.
- **`DayTag`:** the clock plus a "Rehearsal · synthetic residents · not a forecast" legend.
- **`dayModel.ts`** (pure, with vitest): residents interpolated along each segment by length, waiting dots held still, the stage at a minute, the feed up to a minute.

**Browser check** (seed, mock, Stylised 3D, nothing billable): on the storm day at 07:26, the river is at +3 m with heavy rain. Red waiting dots cluster in the flooded neighbourhoods. The panel reads "399 walking, 133 driving, 837 waiting for the water". The feed at 11:31 shows the river notices and the "no way through … waited at home until 08:37, then gave up" posts with a "Same here" reply thread.

**e2e:** a new Elmina Day test (weekday on the tiny world: slider to 08:00, counts, the List heading, the groups table, DOSM sources, Close). 16 of 16 pass.

**Checklist:** lint, pytest, typecheck, vitest, gen, golden (mock) and e2e (mock) all PASS.

**Spend:** US$1.48 of US$3 (OpenRouter counter, 19:22 UTC).

**Integration notes for shaoxian04:**
- New: `features/day/*`, `map-ui/DayTag`, `scene/cesium/DayLayer`, `scene/list/DayListSection`, and a `day` source in MapboxLite.
- Store: `day`, `setDay`, `setDayStage`. `setDayStage` changes the river level without clearing routes.

### Cycle 12 review (independent Opus reviewer) and fixes (17 Oct, 03:32)

| # | Severity | Finding | Fix |
|---|---|---|---|
| C1 | Critical | The day's clock, river sync and restore lived in the panel. Switching to Resident mode left a frozen day on the map, with the river stuck and no Close button. | `useDayPlayback` is mounted with the map (like the rollout hook). Leaving Management mode, or starting the river rollout, ends the day. |
| C2 | Critical | The prior scenario was re-captured on every Play and never captured on a slider move, so Close could restore the day's own stage or wipe the user's scenario. The flood lens was never restored. | The scenario and flood lens are captured once, when the day turns on, and restored when it turns off. Tested in jsdom, including pause and resume. |
| I1 | Important | The map showed 1,500 of 5,000 residents without saying so. | "The map shows 1,500 of 5,000 residents" in the panel, and "showing … of …" in the map legend. |
| I2 | Important | A river level the user picked during playback was snapped back at the next stage change, conflicting with the rollout. | A river level the user picks ends the day and stays. The day and the rollout end each other. Tested. |
| I3 | Important | Switching the scenario mid-play kept the clock ticking with no data. | Switching scenario pauses; the clock ticks only once the day has loaded. |
| I4 | Important | A live region fired 10 times a second. | Removed from the per-tick text. The List view announces only when the clock is stopped. |
| I5 | Important | Every day component re-rendered on every tick, and the lite map rebuilt its source at 10 Hz. | Per-field selectors; the lite map updates at most about 5 times a second. |
| m | Minor | Tab semantics; slider value text; focus lost on Close; follow flew to home, not the dot; "waiting for the water" also counted waits at home; reply keys could collide. | Tabpanel with aria-controls, `aria-valuetext` on the slider, focus back to the opener, fly to the dot's position at the clock, "waiting for a way through", stable keys. `Button` takes a `ref` (React 19 `ComponentProps`). |

Checklist: lint PASS, vitest PASS (471), e2e PASS (16), typecheck PASS.

## Cycle 13: test a change before building it, raise a flooded stretch, town hall (17 Oct, 03:46)

**What was built:**
- **`twm.RaisePaths`,** a new imagined capital work in the world model's action set. A set of path segments is raised above the indicative flood levels, and they no longer flood in any scenario on the imagined copy. It is legal only for paths that flood somewhere, the real flood data is untouched, and its description is "Raise … above the indicative flood levels".
- **`day/compare.py`:**
  - **suggestions from the day's own trips:**
    - on a river-rise day, the flooded stretches the most residents relied on. For every trip the water cancelled or cut, its normal-day route is checked for segments flooded at the day's top level; the most-used segment then grows into a connected stretch of up to 40 segments or about 900 m;
    - otherwise, the most-walked footways (closed for works) and busy steps (rebuilt as a ramp);
  - **the comparison itself:** the same day with and without the change, matched trip by trip with the stable ids. It reports trips better or worse, residents better or worse off by group, the biggest changes, and the changed paths drawn in the what-if style;
  - **town hall:** spotlight residents whose day changed react in a line the engine writes from their own before/after.
- **API:** `GET /day/{id}/changes` and `POST /day/{id}/compare` (1 to 4 actions, no river-stage actions). Rule-based days are cached and shared. The warm-up includes the storm's top comparison, so the hero is instant.
- **Web:** a "Test a change" tab in the Day panel: pick a change, compare, see the before/after by group and the town hall, with the change drawn on the map ("What-if · not real").
- **AI town hall** for the hero (`day_voice record_compare`, GPT-6 Luna, 4 calls). Each line is checked against that resident's own before/after.

**Result on the seed (mock engine; the town-hall voices are live):**

> Storm at the school run, with the flooded stretch on Jalan Sungai Buloh (about 972 m) raised: **389 residents' day would change, 389 trips better, 0 worse.**

Commuters, a wheelchair user and 35 people in households without a car could get to work. The town hall says, for example: "In this imagined change, I could get to work instead of having my trip stopped by the water. It would take me 9 minutes."

A second stretch, about 1.1 km of Persiaran Eserina, helps **96 children and 65 teenagers** get to school.

**Found while building:**
- Town-hall lines were wrong for trips that existed on only one side ("my trip to home would be 0 minutes quicker"). Now only trips present in both days speak, outward first, and only a real change is stated.
- AI lines with "9.2 minutes" or a stretch length in metres were rightly rejected by the check. Rows now use whole minutes, and the change is named without its length.

**Tests:**
- Spatial: raising is imagined and refused for paths that never flood; the storm comparison helps, and every town-hall line passes the check.
- API: changes, compare, and rejection of a river-stage action or an empty list.
- e2e: Test a change on the tiny world (17 of 17 pass).
- Checklist: lint, pytest, typecheck, vitest, golden and e2e PASS; gen PASS after the commit.

**Ruling W27:** the planner's lever against floods is "raise these paths above the indicative flood levels". It is imagined, and the result is phrased as "would", never as a plan or a promise. A real raised walkway needs engineering and hydrology this model does not have. Cost if wrong: a judge reads it as a design. The disclaimer is shown on every comparison.

**Spend:** see the ledger (`.data/spend.jsonl`). This cycle's live calls were 3 town-hall recordings of 4 calls each.

## Cycle 14: the assistant speaks from a rehearsal (17 Oct, 03:54)

**What was built:**
- **`tools.day_rehearsal`** (assistant tool `day_rehearsal(day=…)`, also on the MCP server) returns a slim summary of a rehearsal:
  - trips by outcome;
  - residents by group, including an engine-counted "could not make a trip";
  - school and the busiest places;
  - the river stages, and evidence `ev-day-<day>`.
- **A river-rise day sets the flood scenario,** so the disclaimer and scenario rules apply.
- **Validator `day_errors`:**
  - the answer must call it a rehearsal (or simulation) of synthetic residents, in English, BM or 中文;
  - it must say "not a forecast";
  - forecast wording ("will be stranded") is refused;
  - every count must be one the rehearsal produced. Times, measurements, and place names and group labels with digits ("(65+)") are not counts.
- **The mock and the template change together,** sharing `day_answer`. The template also falls back to it.
- **Prompt rule 17.**
- **A Management "Try asking" chip,** "What happens to residents in the storm rehearsal?" (the design keeps 4 per mode, so it replaces the rising-river chip; the rising-river panel stays). Its demo replay is recorded with the mock.

**Found while building:**
- The template added three outcome counts together, which the validator rejected. The tool now returns the count itself.
- The generic tool plumbing reads any `scenario_id` argument as a flood scenario, so the parameter is named `day`.
- "65" in "Older residents (65+)" was read as a count; group labels are now stripped.

**Tests:** `test_day_agent.py` checks that the template passes and that four dishonest answers are each refused, plus a full mock turn on the tiny world. Full checklist PASS (pytest 1,176, vitest 471, golden mock, e2e 17).

### Cycle 13 review (independent Opus reviewer) and fixes (17 Oct, 04:01)

| Finding | Fix |
|---|---|
| The suggestion overstated the benefit: it counted person-trips on the seed edge, including trips cut elsewhere or at another time. 1,082 people were claimed, but only 389 were better off. | Distinct residents, crediting a segment only when it was flooded at the trip's own planned time. The stretch grows only along segments people relied on. Now 1,129 residents are relied-on and **823 are better off** (931 m of Jalan Sungai Buloh). |
| Trips made possible were neither better nor worse, so the headline mixed units. | A per-trip verdict: made possible counts as better, no longer made as worse, never both. |
| "Residents changed" and the "everyone" group disagreed. | One per-resident rule (children through their trips) for the headline and every group: "N residents would be better off and M worse off". Tested. |
| A public POST could burn CPU, and the label was client text in the cache key. | Labels are server-built from street names (`stretch_label`), and a forged label is ignored (tested). At most 40 raised segments. Fact actions (assume/verify) are refused. |
| "Raise … above the indicative flood levels" overclaimed. | "Imagine … raised so it never floods in any scenario (best case)". |
| Stale state when switching day; the change stayed on the map. | The tab is keyed by day, and the what-if diff is cleared when it unmounts. |
| The baseline was rule-based, not the day with spotlight choices. | It is stated in the result: "Compared with the same day with residents following the rules". |
| Minor: near-duplicate closures; person-trips called "people"; "stopped by the water" on any cut; place classes. | Closures de-duplicated by corridor; "on N trips walked this day"; "which was cut before"; place classes are documented as unchanged. |
| (Found in testing) FastAPI's response model would have dropped the new fields. | Declared, and the API test now asserts them. |

**Re-recorded the AI town hall:** 5 lines, all passing the check. Checklist: all PASS.

### Cycle 14 review and Cycle 15: live smoke test, credits, demo script (17 Oct, 04:12)

**Live smoke test** (the default chat model, Claude Haiku 5.5 via OpenRouter, 3 turns, about US$0.13; results in `evals/results/2026-10-17-live-day-assistant.json`):
- The Bahasa Melayu storm question passed the checks first time.
- The English "What happens to residents in the storm rehearsal?" failed all three attempts and fell back to the template. Two reasons, both ours:
  - the validator rejected "stranded" even in "no one was stranded", though `stranded` is one of the rehearsal's own outcomes;
  - it asked the model to set `scenario_id`, but the model never sets one for a rehearsal.
- After the fixes below, the same English question passed first time. It showed `flood.set_level stage_p3m`, named the 163 data-gap trips and said "No residents were stranded".

**Cycle 14 reviewer findings (Sonnet; 4 Important, 5 Minor), all fixed:**

| Finding | Fix |
|---|---|
| Data-gap trips were dropped from the answer: weekday 9,380 trips, but only 9,217 accounted for. | The template and mock now say "N had no mapped connection (data gap)" in the summary and the school line. The validator requires a data-gap mention whenever the rehearsal has one, in EN, BM or ZH. |
| Honest numbers were rejected: "8:00am", "aged 65", "65+", "2 hours", "17 October", "464 - 400 = 64". | 12-hour times, ages, durations and dates are not read as counts. Sums and differences of two rehearsal counts are allowed. |
| The map got no scene intent for a storm rehearsal. | `run.py` adds `flood.set_level` for the rehearsal's peak stage (recorded in `rec.day_stages`). That stage comes from the tool, so the `scenario_id` rule no longer applies to it. |
| The new management chip had no mirror test. | Mirror test, plus a full mock turn of that chip on the seed (the map stage, data gap and validator). |
| Minor: "fourteen out of", "14%" and "5.000" slipped through. | Rejected ("give counts as digits"). |
| Minor: "real people will be affected tomorrow" slipped through. | Rejected (`DAY_FORECAST`). |
| Minor: "stranded" was over-blocked. | Only "will be stranded" is refused. |
| Minor: mock `_DAY` matched "normal weekday" route questions. | Rehearsal wording is required. |
| Minor: "Storm" or " STORM " failed as the day argument. | A `Literal` type plus normalisation. |
| Minor: memory ignored rehearsals. | `simulated` now includes `rec.days`. |

**Also in this cycle:**
- Prompt rule 17: past tense, a data-gap count, and "do not set scenario_id".
- The storm chip's demo replay is re-recorded with the mock.
- CREDITS.md now records the OASIS, AgentSociety and MiroFish ideas.
- The demo script's world-model segment is rewritten around Elmina Day.

**Checklist** (mock-backed except the smoke test): lint PASS, pytest 1,194 PASS, typecheck PASS, vitest PASS, gen PASS, golden 19/19 PASS (mock), e2e 17 PASS. OpenRouter spend is about US$1.7 of the US$3 cap; the counter lags, so this is an estimate.
