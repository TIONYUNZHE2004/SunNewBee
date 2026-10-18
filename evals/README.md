# Scope-B answer key

`answer_key/deep_spot.json` contains 32 provisional EN, BM and 中文 questions about
Elmina Urban Park and Elmina Lakeside Mall frontage. Every entry has `reviewed: false`:
Yunzhe must inspect the engine call, recorded result, expected facts and wording constraints
before marking it reviewed. These are engine-derived expectations, not surveyed street facts.
The toilet/bench demo-label requirement deliberately exposes T-008 even where the old tool
omits place-existence provenance.

Capture the real seed without an LLM:

```bash
LLM_PROVIDER=mock uv run python evals/build_answer_key.py
```

This overwrites the generated key. Review is kept only for cases whose question, profile,
scenario, expected outcome and expected facts are unchanged; any change resets that case to
unreviewed (T-015). The key records the seed fingerprint,
capture command and commit. Each engine call has arguments and its result beside the expected
facts. `affected_places` records a declared projection of deep-spot classes and scenario
evidence, plus the full result's SHA-256; township-wide path geometry/counts are excluded.
An unmapped destination case uses an intentionally absent id against the real seed, without
adding synthetic streets or places.

Run through the actual assistant pipeline, with fresh memory and in-memory tickets per case:

```bash
uv run python evals/run_answer_key.py --output /tmp/answer-key-mock.json
```

The default is always mock, even when an OpenRouter key is available. Exit 1 means at least one
case missed its expectations. Keep failures in the report; do not soften the key to match the
mock. The initial committed baseline is `results/2026-10-17-answer-key-mock.json`; the current
one, on the 18 Oct seed with the T-015 scorer, is `results/2026-10-18-answer-key-mock.json`.

The answer-key runner takes `ASSISTANT_SCOPE` from the key's `scope` (`access_flood`), so an
environment configured for legacy tests cannot silently widen the accuracy target. The
general golden suite tags removed-feature cases with `assistant_scope: all`; in-scope golden
cases run with the default restricted registry.

`correct`, `honestly_unverified`, `refused_correctly` and `wrong` partition the tested turns.
`unsupported_claims` counts turns with a detected unsupported assertion and overlaps `wrong`.
All metrics show numerator/denominator; expected-outcome strata have separate denominators.
Reports state how many entries are human-reviewed and remain provisional until review.

Scoring is independent of `validate.py`, with one shared piece: numbers are found by the
scorer's own patterns and values read by its own walker, but a stated number is judged with the
validator's rounding rule (`facts._matches`: exact, decimal or whole-number rounding, a coarser
round number only with "about" / "kira-kira" / "约", "exactly" allows none). Values come from the
key's captured engine calls and from the routes and evidence the tools returned in the scored
turn, so a centre route the assistant really planned ("about 17 minutes" for 16.8 min) is not a
false positive (T-015). It checks expected tools, route endpoints/profile,
status and distance, named amenities/centres/affected places, required/forbidden phrases,
typed measurements and selected count/assurance assertions. It is a constraint checker,
not complete semantic entailment; a zero detected-unsupported count does not prove that every
sentence is supported. Review paraphrases, language quality and unsupported categorical claims
by hand. After a seed change the runner refuses stale expectations.

Live checks require an explicit subset, at most ten turns per task, and board logging:

```bash
uv run python evals/run_answer_key.py --provider openrouter --only route-01,place-mall --output /tmp/answer-key-live.json
```

Model selection still comes from environment settings. Never record the demo cache live.
No live turns were used to produce the initial baseline.
