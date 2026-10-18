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
