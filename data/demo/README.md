# Demo cache (DEMO_MODE)

Recorded assistant turns replayed offline when `DEMO_MODE=true`. One file per question, keyed by
`demo.key()` (sha256 of the lower-cased, whitespace-collapsed message + profile + scenario_id, 16 hex).
Line 1 is `{"meta": {...}}`; the rest are one ChatEvent per line.

The committed entries were recorded with `LLM_PROVIDER=mock` on the tiny test fixture (see
`meta.model`); they are not live-model answers. Replay ends with `done` whose model is suffixed
`+demo-cache`. A cache miss or corrupt file runs the turn normally.

Re-record (mock only unless you mean it):

    LLM_PROVIDER=mock uv run python -m townshiplens_agent.cli --record "<question>" --profile <p> [--scenario <s>]
