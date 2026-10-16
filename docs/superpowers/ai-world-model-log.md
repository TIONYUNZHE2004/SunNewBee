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

## Cycle 0: research sprint and a solid live-model path (16 Oct, 20:00–21:00)

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
