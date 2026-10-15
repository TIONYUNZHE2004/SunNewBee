# Demo cache (DEMO_MODE)

Recorded assistant turns replayed offline when `DEMO_MODE=true`. One file per question, keyed by
`demo.key()` (sha256 of the lower-cased, whitespace-collapsed message + profile + scenario_id, 16 hex).
Line 1 is `{"meta": {...}}`; the rest are one ChatEvent per line.

The committed entries were recorded with `LLM_PROVIDER=mock` (see `meta.model`), on the tiny test
fixture or on the Elmina seed (`meta.world`); they are not live-model answers. Replay only uses an
entry whose `meta.world` matches the loaded world. The Elmina entries cover every in-app prompt
with the profile and scenario the app sends: the persona and flood chips, the waste chip, "Where can I go?"
(default and wheelchair at +3 m) and the `/?demo=hero` script steps. `packages/agent/tests/test_inapp_prompts.py`
lists them and checks they stay in sync with `apps/web/src/features/chat/suggestions.ts`. Replay ends with `done` whose model is suffixed
`+demo-cache`. A cache miss or corrupt file runs the turn normally.

Re-record (mock only unless you mean it):

    LLM_PROVIDER=mock uv run python -m townshiplens_agent.cli --record "<question>" --profile <p> [--scenario <s>]
