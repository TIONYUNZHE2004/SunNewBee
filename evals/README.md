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

This overwrites the generated key and resets review. The key records the seed fingerprint,
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
mock. The initial committed baseline is `results/2026-10-17-answer-key-mock.json`.

`correct`, `honestly_unverified`, `refused_correctly` and `wrong` partition the tested turns.
`unsupported_claims` counts turns with a detected unsupported assertion and overlaps `wrong`.
All metrics show numerator/denominator; expected-outcome strata have separate denominators.
Reports state how many entries are human-reviewed and remain provisional until review.

Scoring is independent of `validate.py`. It checks expected tools, route endpoints/profile,
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
