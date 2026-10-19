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
| 2026-10-19 01:19 | Local backend engineer | T-016/T-017 exact route correctness, focused 6-question smoke (data/audits/2026-10-19-backend-ai-review/fix-live-six.json) | anthropic/claude-haiku-5.5 | 6 | 0.01331135 | 0.19788008 (/key delta from 0.18456873 before run) |
| 2026-10-19 01:25 | Local backend engineer | T-016/T-017 retest only BM/中文 generic destination + wheelchair amenity, after grouped fixes (fix-live-retest-three.json) | anthropic/claude-haiku-5.5 | 3 | 0.015862585 | 0.213742665 (/key reported usage) |

2026-10-19 01:29 UTC · backend clarification: the backend /key markers overlap AI round 5's accounting window. The two backend cost rows above are reported shared-key deltas, so US$0.029173935 is an upper bound for my 9 questions, not an exclusive per-generation allocation. Do not add these deltas to the AI cost row to infer key spend. The authoritative running key usage is US$0.213742665 at 01:25 UTC. No further paid backend calls are planned.
