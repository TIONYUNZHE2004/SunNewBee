# T-013 Stop keyword blocking; answer routes and places anywhere in Elmina

- **Status:** assigned
- **Owner:** Local AI engineer
- **Branch:** `local/ai-engineer`
- **Priority:** P1
- **Lane:** AI (`scope.py`, prompts, mock, template)
- **Source:** Yunzhe 18 Oct; control's gate tests

## Goal

Yunzhe, 18 Oct (scope B+): the topics stay access and flood evacuation, but the assistant must not refuse a route or place question because of how it is worded. Today `scope.outside_scope` refuses any first question without a listed keyword: "I am in Surau Al Mahdi, how can I go to Surau At Taqwa", "Can my grandmother get to the clinic?", "Saya di Surau Al Mahdi, macam mana nak pergi Surau At Taqwa?" and "怎么去" are refused although both surau exist with walk nodes.

1. Drop the "no access keyword" rule. Refuse before the model only for clearly removed topics; let the model decline other off-topic questions (its instructions already say so).
2. Narrow removed phrases that catch real questions: "town hall" (a place), "what happens to residents … if the river rises" (an evacuation question).
3. Routes and places anywhere in Elmina are answered. Outside the deep spot (Elmina Urban Park + Lakeside Mall frontage) the answer adds one caveat, e.g. "Outside the surveyed area: based on OpenStreetMap data only." Inside it, no extra caveat.
4. A greeting ("Hi") gets a short hello and what the assistant can do, not a refusal.

## Acceptance

Tests in EN/BM/中文 for every phrasing above plus at least 10 new route/place phrasings: allowed. Every removed-topic test still refused. The outside-deep-spot caveat appears for the surau route and not for the hero route. Validator, mock and template stay passing (AGENTS.md).

## Log

- 2026-10-18 10:00 UTC · control (claude/sweet-davinci-29v7ne) · Created and assigned to Local AI engineer (Yunzhe, 18 Oct: scope B+, two local engineers).
- 2026-10-18 10:14 UTC · Local AI engineer (local/ai-engineer) · Started. Branch local/ai-engineer = control 9621d6e, upstream unset. Board worktree /tmp/agent-board-ai (local branch ai-board → pushes to yunzhe/agent-board; /tmp/agent-board is the backend engineer's). Plan: read scope.py + tests, reproduce the refused phrasings with the mock (free), then drop the keyword rule, narrow removed phrases, add the outside-deep-spot caveat and a greeting reply.
- 2026-10-18 10:33 UTC · Local AI engineer (local/ai-engineer) · Ready for review on local/ai-engineer: 54eeb38 feat(agent) + 0aaa515 data. (1) scope.REMOVED is now the only pre-model refusal (no keyword rule); narrowed 'town hall', 'what happens to residents … if the river rises', 'what if <closed path>' (now needs a subject: we/you/the council…), 'at what river level <X>' (now needs break/cut/lose), Chinese 如果…封闭 (needs a subject). Still refused: waste, what-if changes, tipping, stage-by-stage rollouts (EN 'stage by stage', BM 'setiap paras', 中文 每个水位), fix-it, verify-next, Elmina Day, recipes. (2) Greeting/thanks → fixed EN/BM/中文 hello + what I can do, no model/tool/ticket (access_flood scope only; legacy 'all' unchanged). (3) Outside the access deep spot the server adds, after the validator: 'Outside the detailed study area (Elmina Urban Park + Lakeside Mall frontage), path and place facts come from OpenStreetMap only' (BM/中文 too). Wording ruling: 'detailed study area', not the task's 'surveyed area', because deep-spot facts are demo values, not yet surveyed (AGENTS.md). Triggered by answered-route geometry or a cited place outside the bbox; appears on the surau route, not on Car Park B→playground/mall; also on the evacuation routes to centres outside (true: those paths are OSM-only). Tests: test_scope.py 76 pass (31 allowed phrasings EN/BM/中文 incl. all 4 from the task, 24 removed, 10 greetings, caveat on the real seed incl. a model answer that passes the validator). Local checks (mock): lint PASS, pytest packages/agent+evals/tests+apps/api PASS 1069 (before the demo re-record: 6 demo-cache currency fails, fixed by 0aaa515), golden PASS 23/23. e2e NOT RUN (CI). NEEDS YUNZHE: 0aaa515 touches data/demo (outside my lane): six Elmina evacuation entries re-recorded with the MOCK (fresh VR store; only the caveat lines changed); without it test_demo_cache_current fails. Drop it if not approved and I'll find another way. BLOCKER: no gh CLI / GitHub API on this machine, so I cannot open the PR or read CI. Please open: https://github.com/TIONYUNZHE2004/SunNewBee/compare/claude/sweet-davinci-29v7ne...local/ai-engineer?expand=1 . Spend: US$0 (no live calls).
- 2026-10-18 10:49 UTC · control (claude/sweet-davinci-29v7ne) · Opened PR for local/ai-engineer (54eeb38, 0aaa515). Control merges only when GitHub CI is green.
