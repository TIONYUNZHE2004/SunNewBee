# Agent harness choice for TownshipLens (as of 2026-10-14)

Scope: which agent framework (or none) should run the resident assistant described in [ai-assistant-design](../04-architecture/ai-assistant-design.md) and [stack-decision](../04-architecture/stack-decision.md). Versions were checked on 2026-10-14 with `npm view`, PyPI JSON and `pip index versions`. API names for PydanticAI, OpenAI Agents SDK and Pi were checked with `ctx7` docs. Anything not verified is marked "(unverified)".

## TL;DR / Recommendation

**Use PydanticAI (Python, `pydantic-ai-slim[openrouter]`, currently 2.56.0, MIT) as the harness inside `packages/agent`.** Runner-up: **the hand-written loop on the `openai` SDK pointed at OpenRouter**, which is what the design doc already assumes (about 100 lines).

Why PydanticAI wins for this product:

1. It maps 1:1 onto the spec. `output_type=FinalAnswer` forces the structured final answer. `@agent.output_validator` plus `raise ModelRetry(...)` is exactly "reject if evidence_id not seen this turn, retry". The retry budget is per run (`retries={'tools': n, 'output': 2}`), and exceeding it raises `UnexpectedModelBehavior`, which is where our deterministic template fallback hooks in.
2. OpenRouter is a first-class provider (`OpenRouterModel`, `OpenRouterProvider`, `openrouter:` model-string prefix, `OpenRouterModelSettings`), not just "OpenAI-compatible".
3. It ships the test story we need: `TestModel` and `FunctionModel`, swapped in with `agent.override(model=...)`, so CI and teammates run with no key.
4. It emits fine-grained stream events (`PartStartEvent`, `PartDeltaEvent` with `TextPartDelta`/`ToolCallPartDelta`, `FunctionToolCallEvent`, `FunctionToolResultEvent`, `FinalResultEvent`, final `AgentRunResultEvent`) through `agent.run_stream_events()`. Our SSE mapper is a small `match` over these.
5. Same language, same Pydantic v2 models as FastAPI and the tool schemas. Tools in `packages/spatial` stay plain functions; the agent adapter wraps them. It also has an MCP client (`MCPToolset`) and Temporal/DBOS durable execution that we do not need.
6. Maintainer health is strong: 340 releases, latest on 2026-10-13. Churn risk is the main negative (see Risks): 1.0 was 2025-09-05 and 2.0 was 2026-06-23, so pin an exact version and read the changelog before bumping.

The design doc's "hand-written loop" is a defensible fallback, but the output-retry loop, streaming event normalisation, mock model and multi-provider quirks (OpenRouter reasoning fields, tool-call argument streaming) are exactly the code a student would otherwise write and debug. PydanticAI removes that code at the cost of one dependency to pin.

**Pi as product runtime?** No; it is a good team coding agent instead. Pi (`@earendil-works/pi-*`, TypeScript, MIT) is a terminal coding agent and SDK whose abstractions (sessions, file tools, extensions, compaction, `agent_settled`) target autonomous coding. Our product is a Python request/response assistant with six deterministic tools and a server-side validator, so adopting Pi would force a second language and process in the backend, give no Pydantic validator hook, and no mock model for CI. Its churn is also high: `pi-ai` went 0.87.1 (2026-09-22) to 1.0.0 (2026-10-01) to 1.2.0 (2026-10-12), the packages moved from `@mariozechner/*` to `@earendil-works/*`, and 1.1.0 carried a breaking stream-function change, which is the opposite of "low churn for a student owner". It is, however, reasonable for the team to use as a coding agent against an OpenRouter key (it has an OpenRouter provider and a personalised catalog helper in `pi-ai` 1.2.0), and `pi-ai` alone could be a useful reference for provider quirks. Keep it out of `apps/api`.

## Requirements used for scoring

From the design docs: (R1) six Python tools next to NetworkX; (R2) forced `final_answer` with server validator and max 2 retries, then template fallback; (R3) SSE stream of text deltas, tool start/end and custom events to React; (R4) OpenRouter, any model by env; (R5) deterministic mock model for CI; (R6) reuse by batch persona simulation and golden evals (pytest or Promptfoo); (R7) optional MCP for the same tools; (R8) simple enough for one student in about 4 weeks, low churn.

## Comparison table

Versions and dates from npm/PyPI on 2026-10-14. "Date" is the latest release.

| Candidate | Lang | Latest (date) | Licence | OpenRouter | Tools + structured output | Validation retry | Stream granularity | Mock/test model | MCP | Churn 2025-26 | Fit |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **PydanticAI** | Py | 2.56.0 (2026-10-13) | MIT | Native: `OpenRouterModel`/`OpenRouterProvider`, `openrouter:` prefix | `@agent.tool`, `output_type=<BaseModel>` via output tool | `@agent.output_validator` + `ModelRetry`; per-run `retries={'output': n}`; `UnexpectedModelBehavior` when exhausted | Part start/delta, tool call/result, final-result events | `TestModel`, `FunctionModel`, `agent.override` | `MCPToolset` client; FastMCP separate | 1.0 (2025-09-05), 2.0 (2026-06-23); frequent minors | **Best** |
| Hand-written loop + `openai` SDK -> OpenRouter | Py | openai 3.31.0 | Apache-2.0 | Via OpenAI-compatible `base_url` | You write it (JSON schema from Pydantic) | You write it | Chat-completions chunks only; you assemble | You write a fake client | None | openai SDK is at a new major (3.x) but stable surface | **Runner-up** |
| OpenAI Agents SDK | Py | 0.23.1 (2026-10-02) | MIT | Via `OpenAIChatCompletionsModel(openai_client=AsyncOpenAI(base_url=...))` or `LitellmModel("openrouter/...")` | `@tool`, `output_type` | Output guardrails (tripwire, not "retry with message"); no direct ModelRetry equivalent (unverified) | `run_streamed` events | No official fake model (unverified); custom `Model` subclass | MCP supported | Still 0.x (0.1.0 2025-06-27, 0.23 now) | Good, but OpenRouter is second-class and 0.x |
| Claude Agent SDK | Py | 0.2.166 (2026-10-14); TS 0.3.299 | MIT (Py); TS "see README" | Documented via env (`ANTHROPIC_BASE_URL` to OpenRouter, empty `ANTHROPIC_API_KEY`), community guide | Custom tools via in-process MCP | Hooks, not output-validator retry | Rich, but built around Claude Code runtime | None | Native | 0.x, daily releases | Poor: wraps the Claude Code CLI runtime, coding-agent shaped |
| Google ADK | Py (also TS) | 2.12.0 (2026-10-13); TS 2.3.0 | Apache-2.0 (unverified for PyPI field) | Via LiteLLM wrapper (unverified) | Tools, `output_schema` | Callbacks (unverified) | Event stream | Some test utilities (unverified) | Supported | Major 2.x in 2026 | Over-scoped, Gemini-centric |
| LangGraph | Py/TS | 1.2.15 (2026-10-12); TS 1.5.0 | MIT | Via `langchain-openrouter`/OpenAI-compatible (unverified) | Via LangChain | Hand-built graph cycle | `astream` modes | Fake chat models exist in LangChain | Via adapters | 1.0 in 2025; LangChain layer churns | Heavy for one loop |
| smolagents | Py | 1.26.0 (2026-05-29) | Apache-2.0 (unverified) | Via LiteLLM/OpenAI model class | Code-agent first; tool-calling agent exists | No | Limited | Custom | Supported | Slow cadence: no release in 4.5 months | Wrong paradigm (code actions) |
| Agno | Py | 3.1.3 (2026-10-12) | Apache-2.0 | OpenRouter model class (unverified) | Tools, `output_schema` | Limited (unverified) | Events | Limited (unverified) | Supported | Majors 2025-26 (now 3.x) | Platform-shaped (AgentOS), more than needed |
| Mastra | TS | 1.77.0 (2026-10-14) | Apache-2.0 | Via AI SDK provider | Tools, structured output | Processors/guardrails | Rich | Mock models | Strong | 1.0 in 2026, very fast cadence | Good TS option; wrong language here |
| Vercel AI SDK | TS | `ai` 7.0.140 (2026-10-14); `@openrouter/ai-sdk-provider` 3.1.0 | Apache-2.0 | First-party community provider | `generateObject`/tools | Manual | Excellent UI stream protocol | `MockLanguageModel` | Supported | v5, v6, v7 in about 12 months | Best TS option; wrong language, protocol churn |
| Pi (`pi-agent-core`, `pi-ai`) | TS | 1.2.0 (2026-10-12) | MIT | `pi-ai` has OpenRouter provider and catalog helper | `AgentTool` with TypeBox | None built-in for output validation | Rich agent events | Not documented for mocking (unverified) | Via extensions (unverified) | 59 releases since May; 0.x to 1.0 on 2026-10-01; scope rename | Coding agent, not product runtime |
| LiteLLM (gateway lib) | Py | 1.105.1 (2026-10-14) | MIT | `openrouter/<model>` prefix | Normalises tool calls | None | Normalised chunks | `mock_response` | Proxy/MCP gateway | 931 releases; very high cadence | Not a harness; redundant with OpenRouter |
| `openrouter` Python SDK | Py | 1.3.52 (2026-10-14) | Apache-2.0 | Native | Responses API; typed models | None | Streaming | None | Via Responses API | 1.x, frequent patch releases | Thin client; fine as a transport |
| `openrouter-agent-sdk` (OpenRouter's Python agent lib) | Py | 0.8.0 (2026-08-03) | (unverified) | Native | `call_model` with Pydantic tool schemas, stop conditions | Stop conditions, no output validator | Streaming | None | No | 0.x | Interesting, too young |

Additional 2026 leaders considered: none that change the picture. The "agent harness" space is split into coding agents (Claude Code/Agent SDK, Pi, Codex) and application frameworks (PydanticAI, OpenAI Agents SDK, Mastra, AI SDK); only the second group fits.

## Scoring

Weights reflect the product: the validator-retry loop and mock model are what make this a grounded, testable assistant; low churn and student ownership decide the tie-breaks. Scores are 1 to 5 (5 best), my judgement from the evidence above.

| Criterion | Weight | PydanticAI | Hand-written (`openai` SDK) | OpenAI Agents SDK | Mastra / AI SDK (TS) | Pi | LangGraph | Claude Agent SDK |
|---|---|---|---|---|---|---|---|---|
| Output validator + retry then fallback (R2) | 20 | 5 | 4 | 3 | 3 | 2 | 3 | 2 |
| Python-native, tools beside NetworkX (R1) | 15 | 5 | 5 | 5 | 1 | 1 | 5 | 4 |
| OpenRouter, model from env (R4) | 10 | 5 | 4 | 3 | 4 | 4 | 3 | 2 |
| Streaming events to SSE (R3) | 10 | 5 | 3 | 4 | 5 | 4 | 4 | 3 |
| Mock model for CI and sims (R5, R6) | 15 | 5 | 4 | 3 | 4 | 2 | 3 | 1 |
| Low churn / student-ownable (R8) | 15 | 3 | 5 | 3 | 3 | 1 | 2 | 2 |
| MCP optional (R7) | 5 | 4 | 2 | 4 | 4 | 3 | 3 | 5 |
| Docs and community | 10 | 5 | 4 | 4 | 4 | 3 | 4 | 3 |
| **Weighted (of 5)** | 100 | **4.65** | **4.10** | **3.55** | **3.30** | **2.25** | **3.35** | **2.50** |

Arithmetic check: PydanticAI = (100+75+50+50+75+45+20+50)/100 = 4.65; hand-written = (80+75+40+30+60+75+10+40)/100 = 4.10. The gap is about 0.5; the ordering is the finding, not the decimals.

Sensitivity: if churn risk is weighted 30 instead of 15 (and the rest scaled down), the hand-written loop closes to within about 0.1 of PydanticAI. That is why it is the runner-up and a legitimate fallback.

## Code sketch (PydanticAI, ctx7-verified API names)

Verified from ctx7 docs for `/pydantic/pydantic-ai`: `OpenRouterModel`, `OpenRouterProvider(api_key=...)`, `@agent.tool` with `RunContext`, `output_type`, `@agent.output_validator`, `ModelRetry`, per-run `retries={'tools':..,'output':..}`, `run_stream_events`, `AgentRunResultEvent`, `FunctionToolCallEvent`, `FunctionToolResultEvent`, `PartDeltaEvent`/`TextPartDelta`, `TestModel`, `FunctionModel`, `agent.override(model=...)`. The `deps` pattern and exact field names inside `FinalAnswer` are ours.

```python
# packages/agent/agent.py
import os
from dataclasses import dataclass, field
from pydantic import BaseModel
from pydantic_ai import (Agent, RunContext, ModelRetry, AgentRunResultEvent,
                         FunctionToolCallEvent, FunctionToolResultEvent,
                         PartDeltaEvent, TextPartDelta)
from pydantic_ai.models.openrouter import OpenRouterModel
from pydantic_ai.providers.openrouter import OpenRouterProvider
from pydantic_ai.models.test import TestModel
from pydantic_ai.models.function import FunctionModel
from spatial import tools as sp            # plain functions next to NetworkX

@dataclass
class Deps:                                # per-turn state
    seen_evidence: set[str] = field(default_factory=set)

class Claim(BaseModel):
    text: str
    evidence_ids: list[str]

class FinalAnswer(BaseModel):              # the forced final_answer schema
    answer_status: str
    summary: str
    claims: list[Claim]

def make_model():
    if os.getenv("LLM_PROVIDER") == "mock":           # CI / teammates: no key
        return TestModel()
    return OpenRouterModel(os.environ["LLM_MODEL_DEFAULT"],
                           provider=OpenRouterProvider(api_key=os.environ["OPENROUTER_API_KEY"]))

agent = Agent(make_model(), deps_type=Deps, output_type=FinalAnswer,
              instructions=open("prompts/system.md").read())

@agent.tool
def find_place(ctx: RunContext[Deps], query: str) -> dict:
    """Resolve a place name (EN/BM/ZH) to candidate place ids."""
    res = sp.find_place(query)                       # {ok, data, evidence[], warnings[]}
    ctx.deps.seen_evidence |= {e["id"] for e in res["evidence"]}
    return res

@agent.tool
def plan_route(ctx: RunContext[Deps], from_id: str, to_id: str, profile: str) -> dict:
    """The only routing authority. profile: default|stroller|wheelchair|older_adult_rest."""
    res = sp.plan_route(from_id, to_id, profile)
    ctx.deps.seen_evidence |= {e["id"] for e in res["evidence"]}
    return res

@agent.output_validator
def check_citations(ctx: RunContext[Deps], out: FinalAnswer) -> FinalAnswer:
    bad = [i for c in out.claims for i in c.evidence_ids if i not in ctx.deps.seen_evidence]
    if bad:
        raise ModelRetry(f"Unknown evidence ids {bad}. Use only ids returned by tools this turn.")
    return out

async def chat_events(question: str):
    """Yield SSE-ready dicts; FastAPI wraps this in EventSourceResponse."""
    deps = Deps()
    async with agent.run_stream_events(question, deps=deps,
                                       retries={"tools": 2, "output": 2}) as events:
        async for ev in events:
            if isinstance(ev, PartDeltaEvent) and isinstance(ev.delta, TextPartDelta):
                yield {"event": "text.delta", "delta": ev.delta.content_delta}
            elif isinstance(ev, FunctionToolCallEvent):
                yield {"event": "tool.call", "name": ev.part.tool_name, "args": ev.part.args}
            elif isinstance(ev, FunctionToolResultEvent):
                yield {"event": "tool.result", "id": ev.tool_call_id}
            elif isinstance(ev, AgentRunResultEvent):
                yield {"event": "final", "answer": ev.result.output.model_dump()}
# UnexpectedModelBehavior (retries exhausted) -> caught by the caller -> template_answer(deps) fallback.

# tests/conftest.py: scripted, deterministic model for golden sets
async def scripted(messages, info):            # FunctionModel: return ModelResponse(parts=[ToolCallPart(...)])
    ...                                         # step 1: call find_place; step 2: call the final-answer tool
with agent.override(model=FunctionModel(scripted)):
    result = await agent.run("Can I reach the hall without stairs?", deps=Deps())
```

Notes on the sketch:

- Text deltas only appear if the model streams prose. In our design the final answer is a structured output tool call, so prose streaming comes from the **server** turning `summary` and `steps` into `text.delta` after validation (as in design doc section 5). If you want live typing, validate partial output with `ctx.partial_output` (documented: validators run on partials when streaming, so skip them while `ctx.partial_output` is true). Verify behaviour with your chosen OpenRouter model (unverified).
- `TestModel` generates schema-valid output and calls every tool, which is enough for plumbing tests but will fail the citation validator on fake ids. Use `FunctionModel` (or `TestModel(custom_output_args=...)`, documented) for scripted golden journeys. Whether `FunctionModel` needs a `stream_function` for `run_stream_events` is unverified; check on day 1.
- The simulation runner and Promptfoo/pytest evals call the same `agent` with `Deps()`; Promptfoo can hit the HTTP `/chat` endpoint or a Python provider script.
- MCP: expose the tools via FastMCP from the same registry (`packages/spatial`), independent of the agent library. PydanticAI can also consume MCP servers through `MCPToolset`.
- Escalation (Haiku to Sonnet) is a second `agent.override(model=...)` or a second `make_model(name)` call on retry exhaustion.

## Risks and mitigations

1. **PydanticAI churn.** Two majors in 9 months and a minor about every few days. Pin exact versions in `uv.lock`, upgrade deliberately, and keep our code behind a 60-line adapter (`packages/agent/runtime.py`) so the rest of the repo sees only `chat_events()` and `run_turn()`.
2. **Structured output on arbitrary OpenRouter models.** Some models handle tool-based output poorly. Mitigation: golden set runs per model, and the validator-retry plus template fallback already bounds the damage. Choose the default model by eval, not by price alone.
3. **OpenRouter provider routing and privacy.** Pin allowed providers and zero-data-retention settings in OpenRouter (project privacy requirements in design doc section 9). OpenRouter-specific request options go through `OpenRouterModelSettings` (unverified for provider-routing fields).
4. **Escape hatch.** Because tools and the validator are pure Python and the SSE event vocabulary is ours, falling back to the hand-written loop is about 1 to 2 days of work. Keep `validate.py` independent of PydanticAI (called from the `output_validator`), as in the design doc.
5. **Fallback template.** Catch `UnexpectedModelBehavior` and provider errors; never let a validator failure reach the user.
6. **Version facts drift.** Re-run `npm view` and `pip index versions` before locking the stack.

## Sources

- ctx7 `/pydantic/pydantic-ai`: https://github.com/pydantic/pydantic-ai/blob/main/docs/models/openrouter.md, https://github.com/pydantic/pydantic-ai/blob/main/docs/output.md, https://github.com/pydantic/pydantic-ai/blob/main/docs/agent.md, https://github.com/pydantic/pydantic-ai/blob/main/docs/api/models/test.md, https://github.com/pydantic/pydantic-ai/blob/main/docs/api/models/function.md, https://github.com/pydantic/pydantic-ai/blob/main/docs/mcp/client.md
- ctx7 `/openai/openai-agents-python`: https://github.com/openai/openai-agents-python/blob/main/docs/models/index.md, https://github.com/openai/openai-agents-python/blob/main/examples/model_providers/litellm_provider.py, https://github.com/openai/openai-agents-python/blob/main/docs/guardrails.md
- ctx7 `/earendil-works/pi`: https://github.com/earendil-works/pi/blob/main/packages/agent/README.md, https://github.com/earendil-works/pi/blob/main/packages/ai/CHANGELOG.md, https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/README.md
- OpenRouter Claude Agent SDK guide: https://openrouter.ai/docs/guides/community/anthropic-agent-sdk
- OpenRouter Agent SDK overview: https://openrouter.ai/docs/agent-sdk/overview
- Package metadata: `npm view` and https://pypi.org/pypi/<package>/json, queried 2026-10-14 (pydantic-ai-slim 2.56.0, openai-agents 0.23.1, claude-agent-sdk 0.2.166, google-adk 2.12.0, langgraph 1.2.15, smolagents 1.26.0, agno 3.1.3, litellm 1.105.1, openrouter 1.3.52, openrouter-agent-sdk 0.8.0, `ai` 7.0.140, `@mastra/core` 1.77.0, `@earendil-works/pi-ai` 1.2.0).
