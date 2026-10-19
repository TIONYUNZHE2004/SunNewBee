# OpenRouter spend ledger

> Shared by every agent. Append one row after **every** live round, then push. Never edit old rows.
> Get the cost from OpenRouter's reported usage (or `evals/spend.py`); never guess.

**Total budget: US\$15.00 for about 4 days** (Yunzhe, 18 Oct 2026, replaces the US\$4 plan). Set as the key's credit limit on openrouter.ai.

| Agent | Daily cap | Total cap |
|---|---|---|
| Local AI engineer | US\$3.00 | US\$10.00 |
| Local backend engineer | US\$0.50 | US\$1.50 |
| Control (T-007 final live test, comparisons) | — | US\$1.50 (reserved) |
| Buffer (Yunzhe's own testing on the site) | — | US\$2.00 |

**Hard stop:** when the running total reaches **US\$13.00**, nobody makes live calls except control's reserved run. Yunzhe's own site testing also spends from this key: control adds a row for it when Yunzhe reports it.

| Time (UTC) | Agent | Task | Model | Live questions | Cost (US$) | Running total (US$) |
|---|---|---|---|---|---|---|
| 2026-10-18 09:51 | Cloud Codex worker | T-012 diagnostic | anthropic/claude-haiku-5.5 | 2 | 0.0084 | 0.0084 |
| 2026-10-18 10:58 | Local AI engineer | T-017 round 1 (audit, 10 EN/BM/中文 questions; logs evals/audits/2026-10-18-t017/round1-openrouter.json) | anthropic/claude-haiku-5.5 | 10 | 0.0331 | 0.0704 (key usage per OpenRouter /key; ledger rows above sum to 0.0084, the other 0.0289 was unlogged usage before 10:54) |
| 2026-10-18 13:49 | Control | spot check after PR #12 | anthropic/claude-haiku-5.5 | 3 | not measured | not updated |
| 2026-10-18 15:48 | Local AI engineer | T-019 round 2 (10 route questions; evals/audits/2026-10-18-t017/round2-t019-openrouter.json) | anthropic/claude-haiku-5.5 | 10 | 0.0381 | 0.1276 (key usage per OpenRouter /key) |
| 2026-10-18 16:02 | Local AI engineer | T-019 re-test rounds 3-4 (7 + 2 route questions; round3/round4-t019-openrouter.json) | anthropic/claude-haiku-5.5 | 9 | 0.0351 | 0.1627 (key usage per OpenRouter /key) |
| 2026-10-19 01:16 | Local AI engineer | T-020 round 5 (7 likely_ok + bait questions; round5-t020-openrouter.json) | anthropic/claude-haiku-5.5 | 7 | 0.0266 | 0.1893 (key usage per OpenRouter /key) |
