# Fix-it planner (LLM proposes, world model disposes) and the MCP server (Cycle 4 design)

Status: design, 16–17 Oct 2026, branch `ai/world-model`.
- Research: [world-models-2026.md](../../02-research/world-models-2026.md) §2 and §6 (#4 Fix-it planner, #8 MCP).
- Patterns: [world-models-llm.md](../../../reference/notes/world-models-llm.md) P1–P3.
- Reusable code: [world-models-repos.md](../../../reference/notes/world-models-repos.md) §2 (llm-reasoners beam search) and §3 (FastMCP).

## Intent

**Fix-it planner.** The developer's question:

> "What are the 3 changes that would let the most wheelchair users still reach a centre at +3 m?"

This is the cleanest demo of "the LLM proposes, the world model disposes", the pattern behind LLM-MCTS, FunSearch and Code World Models:

1. Candidate interventions come from the engine's legal moves (`suggest_actions`), plus any legal actions the LLM adds.
2. **Beam search** over sets of interventions scores each set by rolling it out on the world model.
3. The agent explains the winning set and its margin over the runner-up.

The LLM never scores anything.

**MCP server.** It exposes the township world-model tools (lookups, what-if, plans, rollouts, tipping points) over the Model Context Protocol, so any MCP client (Claude Desktop, an IDE agent, another team's tool) can query the township through the same validated engine.

## Goals

1. **`fixit.find_fixes(world, profile, scope, stage, budget=3, extra_actions=[], beam=3)`** returns:
   - the best set of up to `budget` interventions;
   - the runner-up sets;
   - each set's engine-verified summary (reach and confirmed before and after, under the stage);
   - the candidates that were considered;
   - the number of rollouts used.

   Candidate kinds: `build_ramp` and `verify_fact`, never `close_path`, which is a disruption rather than a fix. Search is beam search by marginal gain. The tiny world gets an exhaustive regret check.
2. **Speed: share edge evaluations across imagined worlds.** The `eval_memo` key moves from the world's edge table to the edge object itself, `(id(edge), profile, scenario)`, holding a strong reference. Untouched edges are the same object in every imagined world, so a rollout re-evaluates only the edges the actions changed. A test asserts that memo results equal non-memo results.
3. **Agent tool `find_fixes`** (proposals: an optional list of legal actions the LLM suggests).
   - Validator: numbers must come from the result; the answer is conditional ("would"); it says "what-if"; and it never claims cost or feasibility, since we have no cost data and the candidates are counted in units of changes.
   - Shared wording for the mock and the template.
4. **MCP:** `apps/mcp` (or `packages/agent/.../mcp_server.py`) built on **FastMCP**.
   - It serves the 15 tools with their docstrings, plus a `township_disclaimer` resource.
   - Tool results are the same `ToolResult` JSON (evidence, warnings with disclaimers).
   - No verification requests are created from MCP clients by default (`create_verification_request` is excluded unless `MCP_ALLOW_VR=true`).
   - Run with `uv run python -m townshiplens_agent.mcp_server` over stdio.
   - Added to the README with a Claude Desktop config snippet.

## Non-goals

Costs in ringgit, construction feasibility, new graph links (W5), and MCTS (beam search is enough for deterministic, small branching; the llm-reasoners notes agree).

## Acceptance

- Spatial tests:
  - beam search equals exhaustive search on the tiny world for budget ≤ 2;
  - memo equals no memo;
  - the best set's summary equals an independent `compare`;
  - proposals are gated by `legal()`.
- Agent tests (mock flow, validator).
- An MCP smoke test: an in-process client lists the tools and calls `find_place`.
- Golden plus live smoke.
- A browser check: the fixes are shown through `whatif.diff` with the best set as `touched`.
