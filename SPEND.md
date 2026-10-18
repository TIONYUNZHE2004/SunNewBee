# OpenRouter spend ledger

> Shared by every agent. Append one row after **every** live round, then push. Never edit old rows.
> Get the cost from OpenRouter's reported usage (or `evals/spend.py`); never guess.

**Total budget: US$4.00** (Yunzhe, 18 Oct 2026). Set as the key's credit limit on openrouter.ai.

| Agent | Daily cap | Total cap |
|---|---|---|
| Local AI engineer | US$1.00 | US$2.50 |
| Local backend engineer | US$0.25 | US$0.50 |
| Control (T-007 final live test) | — | US$0.50 (reserved) |
| Cloud Codex worker (already spent 18 Oct) | — | US$0.01 |

**Hard stop:** when the running total reaches **US$3.50**, nobody makes live calls except control's reserved T-007 run. Mock and engine checks stay free.

| Time (UTC) | Agent | Task | Model | Live questions | Cost (US$) | Running total (US$) |
|---|---|---|---|---|---|---|
| 2026-10-18 09:51 | Cloud Codex worker | T-012 diagnostic | anthropic/claude-haiku-5.5 | 2 | 0.0084 | 0.0084 |
