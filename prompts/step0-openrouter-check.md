STEP 0 (before any other work): prove the OpenRouter key works. Never print the key or any header.
1. Make the key available to the app. If `OPENROUTER_API_KEY` is empty in your environment but outbound requests to openrouter.ai are authenticated by a proxy, set `export OPENROUTER_API_KEY=proxy-injected` (any non-empty value) so the app chooses OpenRouter. Also `export LLM_MODEL_DEFAULT=anthropic/claude-haiku-5.5`.
2. Key check (prints the HTTP status and the spend numbers only):
   curl -sS -o /tmp/orkey.json -w "HTTP %{http_code}\n" -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/key && python3 -c "import json;d=json.load(open('/tmp/orkey.json')).get('data',{});print({k:d.get(k) for k in ('usage','limit','limit_remaining')})"; rm -f /tmp/orkey.json
   Expected: `HTTP 200` and a limit of 15.
3. One live app question (about US$0.004):
   LLM_PROVIDER=openrouter uv run python -m townshiplens_agent.cli --profile stroller "Can I push a stroller from Car Park B to the playground?"
   Expected: the `done` event's model is an OpenRouter model id, NOT `mock-scripted`.
4. Report to Yunzhe: the HTTP status, `usage`/`limit_remaining`, and the model name from step 3.
5. If step 2 is not 200 or step 3 says mock: STOP. Report the exact error line (no secrets) and wait. Do not continue on the mock and call the work tested.

When live and mock are used:
- Unit tests, `pnpm golden` and CI stay on the mock by design (deterministic, free). That is not a fallback.
- Every task ends with ONE live round of at most 10 questions on OpenRouter, on the features you changed. A task without its live round is "implemented", not "tested".
- Write the live round's questions, answer status, model and cost into your PR description. Note `usage` before and after.
