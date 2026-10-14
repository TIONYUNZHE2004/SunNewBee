# 0005. Tech stack

- Status: **proposed** (confirm at the kick-off sync)
- Date: 2026-10-14
- Deciders: whole team

## Context
Three students (BE, FE, AI), about 4 weeks, a near-zero budget, and a need for a deployed demo. Full comparison with versions: [stack-decision](../../04-architecture/stack-decision.md).

## Decision
| Layer | Choice |
|---|---|
| Frontend | Vite + React 19 SPA, React Three Fiber 9 + drei, `3d-tiles-renderer` (Google Photorealistic 3D Tiles), MapLibre 2D fallback, Tailwind 4 + shadcn/ui, Zustand, TanStack Query, custom typed SSE hook |
| Backend | FastAPI + Pydantic 2 (uv), NetworkX routing, SQLAlchemy 2 + Alembic, SQLite locally / Postgres (Supabase Singapore) deployed, shapely + pyproj, GeoJSON interchange |
| AI | Hand-written tool loop with the Anthropic Python SDK behind an `LLMClient` interface; Claude Haiku 5.5 default, Sonnet 5.5 escalation; one tool registry shared by chat, the simulator and MCP (stretch) |
| Contract | FastAPI OpenAPI → `@hey-api/openapi-ts` client (committed; CI fails on drift) |
| Evals | Promptfoo (or a pytest harness) + deterministic checks |
| Hosting | Cloudflare Pages (FE), Google Cloud Run asia-southeast1 (API), Supabase Singapore (DB) |
| Repo | pnpm + uv monorepo; Biome, ruff, vitest, pytest, Playwright + axe; GitHub Actions |

## Options considered
- Next.js instead of a Vite SPA: rejected because there's no SSR need, and it adds a server alongside FastAPI.
- CesiumJS instead of R3F + 3d-tiles-renderer: an equal alternative, to be decided by the Day-1 spike (ADR-0007).
- LangGraph / LlamaIndex / GraphRAG: rejected as overkill for 6 tools over a curated graph.
- Vercel AI SDK (all-TypeScript): good, but it splits the AI logic away from the Python graph code.
- PostGIS / pgRouting: unnecessary for about 500 edges; it's the scale-up path.

## Consequences
- AI and BE share Python, so tool functions live next to the graph.
- The SSE event union is the one FE↔AI contract to guard.
- Google tiles bring a licence and quota dependency; the 2D fallback is mandatory.
