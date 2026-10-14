# 0008. Agent harness: PydanticAI over OpenRouter

- Status: **accepted**
- Date: 2026-10-15
- Research: [agent-harness-2026](../../02-research/agent-harness-2026.md)

## Context
The assistant must call deterministic Python tools (routing, scenarios, lookups), force a structured `final_answer`, run a server-side citation validator with up to 2 retries and then a template fallback, stream events to the browser over SSE, use **OpenRouter with the model chosen in config/env**, and run without keys in CI. The team lead asked for the best 2026 harness, and floated Pi.

## Decision
**PydanticAI** (`pydantic-ai-slim[openrouter]`, exact version pinned, 2.56.x), inside `packages/agent`:
- `OpenRouterModel` / `OpenRouterProvider`; model IDs come only from env (`LLM_MODEL_DEFAULT`, `LLM_MODEL_ESCALATE`).
- `output_type=FinalAnswer` + `@agent.output_validator` → `ModelRetry`; `retries={'output': 2}`; `UnexpectedModelBehavior` → template fallback.
- `agent.run_stream_events()` → our SSE mapper.
- `FunctionModel`/`TestModel` via `agent.override(...)` as the deterministic mock (`LLM_PROVIDER=mock`).
- `validate.py` stays framework-independent. The server calls only `run_turn(question, context) -> AsyncIterator[Event]`.

## Options considered
| Option | Score (/5) | Note |
|---|---|---|
| **PydanticAI** | 4.65 | Maps 1:1 onto the validator/retry/stream/mock needs; same Pydantic models as FastAPI |
| Hand-written loop (`openai` SDK → OpenRouter) | 4.10 | Runner-up and the fallback if PydanticAI churn bites (about 1–2 days to swap) |
| OpenAI Agents SDK | 3.55 | Still 0.x; OpenRouter via custom client/LiteLLM |
| LangGraph | 3.35 | Overkill for ~10 tools |
| Claude Agent SDK | 2.50 | Wraps the Claude Code runtime; not suited as a product loop |
| **Pi** (`@earendil-works/pi-*`) | 2.25 | TypeScript coding-agent harness; no output-validator hook; heavy churn (0.87 → 1.0 → 1.2 in 3 weeks, scope rename). **Fine as the team's coding agent, not the product runtime** |

## Consequences
- Pin exactly, and read the changelog before bumping.
- The AI lane owns `packages/agent`; tool functions stay in `packages/spatial` (BE) and are wrapped thinly.
