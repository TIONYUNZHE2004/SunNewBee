# Walking Skeleton: Scaffold Design

- Status: **draft for review**
- Date: 2026-10-14
- Scope: scaffold the TownshipLens monorepo with a thin, running, end-to-end slice that each lane (BE / FE / AI) then deepens.
- Builds on: [stack-decision](../../04-architecture/stack-decision.md), [api-contract](../../04-architecture/api-contract.md), [world-model-schema](../../04-architecture/world-model-schema.md), [ai-assistant-design](../../04-architecture/ai-assistant-design.md), [dev-setup](../../05-team/dev-setup.md).

## 1. Intent

**Outcome:** after `pnpm install && uv sync && pnpm dev`, a teammate sees the Elmina Urban Park site on a map with the seed path graph coloured by status for the chosen profile. They can ask "Can I push a stroller from Car Park B to the playground without stairs?" and get a streamed, cited answer with the route highlighted, plus an amber "not checked yet" segment and a verification request in the staff queue. It runs **with zero API keys** (mock LLM; list view if there's no map token), and it uses the real map and real LLM when keys are set.

**What the user decided:**
- Walking-skeleton depth.
- Real OSM import for the Elmina bbox.
- OpenRouter as the LLM gateway, with the model set in config/env (any model).
- Agent harness: **PydanticAI**, chosen by 2026 research (§ 6).
- The map/3D approach is my call.
- Commit and push to `main` often.

**Assumptions:**
- The skeleton proves the seams (contract, events, tools, data flow), not the depth. Auth, migrations, evidence upload, the persona simulator and deployment pipelines are left as clearly marked stubs.
- Python 3.13 (uv-managed) and Node 24. TypeScript is pinned to 5.9.x, because TS 7's native compiler may break tools that import the TS JS API.

**Success criteria:**
1. `pnpm dev` starts web and API. `pnpm test` and `pnpm lint` pass. CI is green.
2. The hero question works end to end with `LLM_PROVIDER=mock`, deterministically.
3. With `OPENROUTER_API_KEY` set, the same flow works with a real model chosen via `LLM_MODEL_DEFAULT`.
4. The OpenAPI → TS client is generated and committed; CI fails on drift.
5. `docs/` is updated where the scaffold changes a decision (ADR-0007 map approach, ADR-0008 harness), with superseded notes in `3d-pipeline.md`, `stack-decision.md` and `ai-assistant-design.md`.

## 2. Map / 3D decision (ADR-0007)

| View | Tech | When |
|---|---|---|
| **Main map (2D ↔ tilted 3D)** | **Mapbox GL JS 3.33, Standard style** via `react-map-gl/mapbox` 8.1. The overlay is native GeoJSON layers in Standard **slots** (paths in `middle`, route + markers in `top`) | `VITE_MAPBOX_TOKEN` set |
| Photoreal view (optional toggle) | `3d-tiles-renderer` 0.5 + R3F 9 + Google Photorealistic 3D Tiles; route as a polyline in a local ENU frame | `VITE_GOOGLE_MAPS_API_KEY` set |
| **List / text view** (always available; screen-reader path) | Plain React | Always; the default view when there's no map token |

**Why:** Mapbox Standard gives a recognisable 3D-buildings view, lighting presets and a `model` layer for a future glTF of the facility. Our overlay becomes ordinary GeoJSON styling (no ENU maths on the critical path), and one component covers 2D and 3D. Google photoreal stays as the "wow" toggle without being a dependency. This supersedes the "R3F primary" plan in [3d-pipeline](../../04-architecture/3d-pipeline.md) (the doc gets a superseded note plus ADR-0007).
**Costs and licence (verify):** Mapbox has a free tier of web map loads per month (the exact quota must be checked on the Mapbox pricing page). Use a URL-restricted public `pk.` token. Paths still come from OSM or our survey (Mapbox ToS forbids deriving data from its tiles, as Google's does).

## 3. Repository layout

```
.
├── apps/
│   ├── web/                     Vite 8 + React 19 + TS 5.9 + Tailwind 4
│   │   ├── src/
│   │   │   ├── app/             App shell, router (/, /staff), providers
│   │   │   ├── features/
│   │   │   │   ├── map/         MapView (Mapbox Standard), overlay layers, legend
│   │   │   │   ├── photoreal/   PhotorealView (Google tiles), lazy-loaded
│   │   │   │   ├── list/        ListView (route steps + places as text)
│   │   │   │   ├── chat/        ChatPanel, useChatStream (typed SSE), EvidenceCard, UncertaintyBanner
│   │   │   │   └── staff/       VerificationQueue page
│   │   │   ├── lib/             api client wrapper, store (zustand), geo helpers
│   │   │   └── main.tsx
│   │   ├── e2e/                 Playwright smoke (list view, chat with mock)
│   │   └── vite.config.ts       dev proxy /api → :8000
│   └── api/                     FastAPI (uv workspace member)
│       ├── src/townshiplens_api/
│       │   ├── main.py          app factory, CORS, routers
│       │   ├── settings.py      pydantic-settings (env + .env)
│       │   ├── routes/          site.py, graph.py, places.py, routes.py, chat.py, verification.py, health.py
│       │   ├── store.py         SQLite (SQLAlchemy 2) for VRs + question log; seed graph in memory
│       │   └── sse.py           event serialisation
│       ├── tests/
│       └── Dockerfile           (Cloud Run-ready; no deploy pipeline yet)
├── packages/
│   ├── spatial/                 Python: schema models, graph loader, profiles, evaluate, plan_route, tools registry
│   ├── agent/                   Python: harness adapter, OpenRouter + mock providers, prompts, validator, event mapping, CLI
│   └── api-client/              generated TS client (@hey-api/openapi-ts) + SSE event types
├── data/
│   ├── scripts/import_osm.py    Overpass → data/seed/elmina/osm.geojson (claims = reported/osm_import)
│   ├── seed/elmina/
│   │   ├── site.json            anchor, bbox, calibration, attribution
│   │   ├── osm.geojson          imported footways/steps/buildings (ODbL)
│   │   └── overlay.geojson      hand-authored places, entrances, demo claims (verified/unknown) for the hero journeys
│   └── README.md                sources, licences (ODbL), capture dates
├── evals/
│   ├── golden/hero.yaml         5 golden questions (deterministic expectations)
│   ├── run_golden.py            pytest-style runner against the mock + optional real model
│   └── personas/*.yaml          stroller, wheelchair, older_adult_rest (used by spatial profiles)
├── config/
│   └── profiles/*.yaml          canonical profile definitions (shared by router, sim, docs)
├── .github/workflows/ci.yml     lint + typecheck + test (py & ts) + openapi drift
├── package.json · pnpm-workspace.yaml · biome.json · tsconfig.base.json
├── pyproject.toml (uv workspace) · .python-version · ruff config
├── .env.example · .nvmrc · .pre-commit-config.yaml
└── README.md (quick start)
```

## 4. Backend slice (BE lane owns afterwards)

- **Spatial package:** Pydantic models per the schema (Node, Edge, Place, Claim, Closure). The loader merges `osm.geojson` + `overlay.geojson` → NetworkX `MultiDiGraph`. `evaluate(element, profile, at) → PASS|FAIL|UNKNOWN`. `plan_route` does multi-source/multi-target Dijkstra, a strict pass, then a lenient pass (UNKNOWN × 5), and classifies `confirmed | partly_unverified | blocked | no_data`. It also returns `unknowns`, `rest_points` and `max_gap_between_rest_m`. *The resource-constrained rest search is a stub*: the skeleton computes the max rest-free gap and flags a violation, and the BE lane implements the constrained search.
- **Tools registry:** 6 tools as plain functions with Pydantic input/output models, returning `{ok, data, evidence[], warnings[]}`. `create_verification_request` dedupes on `(element, attribute, reason)` and increments demand (SQLite).
- **API:** `/healthz`, `GET /site`, `GET /graph?profile=`, `GET /places?q=`, `GET /places/{id}`, `POST /routes`, `POST /chat` (SSE), `GET /verification-requests`, `POST /verification-requests/{id}/resolve` (staff, guarded by `STAFF_TOKEN` header; real auth later).
- **Tests:** a tiny fixture graph covering every route status, evaluation rules, VR dedupe, and API smoke tests.

## 5. Frontend slice (FE lane owns afterwards)

- Resident page: profile selector, **MapView** (Standard style, centred on the site, pitch toggle, overlay coloured by `status_for_profile` with dashed amber for unknown and a legend with text), **ChatPanel** (streaming, tool chips, evidence cards, uncertainty banner; `scene.highlight` → fit bounds + route layer), **ListView** fallback.
- Staff page: VR queue table (demand, element, attribute, reason) with a resolve form (verify / correct / reject).
- `useChatStream`: fetch + ReadableStream SSE parser typed with the event union from `packages/api-client`.
- Tests: vitest (SSE parser, status → style mapping) and one Playwright smoke test (list view + mock chat).

## 6. AI slice (AI lane owns afterwards): PydanticAI over OpenRouter (ADR-0008)

**Harness: PydanticAI** (`pydantic-ai-slim[openrouter]`, pinned exactly, 2.56.x). Research and scoring: [agent-harness-2026](../../02-research/agent-harness-2026.md). The runner-up is the hand-written `openai`-SDK loop. Pi is rejected as the product runtime (it's TypeScript, has no validator hook and churns heavily) but is fine as the team's coding agent.

- **Provider:** `OpenRouterModel` / `OpenRouterProvider`. Settings come from env/config, with **no model names in code**:
  `LLM_PROVIDER=openrouter|mock` · `OPENROUTER_API_KEY` · `LLM_MODEL_DEFAULT` · `LLM_MODEL_ESCALATE` · `LLM_MAX_TOOL_CALLS=5` · `LLM_OUTPUT_RETRIES=2`. `.env.example` ships a commented example model ID; any OpenRouter model works.
- **Agent:** `Agent(model, deps_type=TurnDeps, output_type=FinalAnswer, instructions=system.md)`. The 6 tools are registered as thin wrappers over `packages/spatial` functions. Each wrapper records the returned evidence IDs in `TurnDeps`, and the deterministic VR triggers fire inside the tool layer.
- **Validator:** `@agent.output_validator` calls the framework-independent `validate.py` (evidence IDs ⊆ this turn's tool evidence; route caveats present; no "accessible/step-free/safe" wording unless the route is `confirmed`; numbers appear in tool results) → `raise ModelRetry(...)`. `UnexpectedModelBehavior` after 2 retries → a **template answer** built from the tool results.
- **Streaming:** `agent.run_stream_events()` → a small `match` mapper → SSE events `text.delta`, `tool.call`, `tool.result`, then (from the validated `FinalAnswer`, server-side) `scene.highlight`, `citation`, `uncertainty`, `verification.requested`, `done`.
- **Mock:** a deterministic `FunctionModel` script used when `LLM_PROVIDER=mock` (the default when no key is set) and in tests via `agent.override(model=...)`. It maps the hero questions to the right tool calls and then a valid `FinalAnswer`. Day-1 check: whether `run_stream_events` needs a `stream_function` for `FunctionModel`.
- **Adapter boundary:** `townshiplens_agent.run_turn(question, profile) -> AsyncIterator[Event]` is the only API the server calls. If PydanticAI ever has to go, swapping to the hand-written loop stays local to `packages/agent` (about 1–2 days).
- **CLI:** `uv run python -m townshiplens_agent.cli "…"`. **Golden runner:** 5 hero questions scored on tool sequence, route status and evidence-ID validity.

## 7. Data slice

- `import_osm.py` runs an Overpass query over the bbox `3.1775,101.5055,3.1835,101.5135` for `highway=footway|path|pedestrian|steps|crossing`, `footway=*`, `building=*`, `amenity=toilets|bench|parking|shelter`, `entrance=*`, and `barrier=kerb`. It noded-splits ways into edges and writes GeoJSON with `claims` from OSM tags, all `status=reported, evidence_type=osm_import`. Re-runnable, and a snapshot is committed.
- `overlay.geojson` is hand-authored for the demo: Car Park B, the playground, 2 mall exits, a toilet, 3 benches, and one ramp with `incline_pct: unknown`. **Demo facts are labelled `evidence_type=team_survey_placeholder`** until the field visit replaces them, so they are never mistaken for real verification.
- Attribution: "© OpenStreetMap contributors (ODbL)" in the UI and `data/README.md`.

## 8. Tooling and CI

- Root scripts: `pnpm dev` (web + api concurrently), `pnpm test` (vitest + pytest via `uv run`), `pnpm lint` (biome + ruff), `pnpm gen` (export OpenAPI → generate client), `pnpm import:osm`.
- CI (GitHub Actions): setup pnpm + uv → install → lint → typecheck → pytest → vitest → OpenAPI drift check. Playwright runs in CI with `LLM_PROVIDER=mock`, no map token, using list view.
- pre-commit: ruff, biome, gitleaks. `.env` is gitignored; only `.env.example` is committed.

## 9. Out of scope for the skeleton (explicit stubs)

Alembic migrations · real staff auth · evidence photo upload · closures UI · persona simulation runner beyond deterministic profile checks · Promptfoo · deploy workflows (Cloud Run / Cloudflare) · multilingual aliases beyond a few BM/中文 seeds · PhotorealView calibration UI.

## 10. Verification plan

1. `uv run pytest` and `pnpm -r test`: green.
2. `curl -N localhost:8000/chat` with the hero question and `LLM_PROVIDER=mock`: the event sequence includes `tool.call(plan_route)`, `scene.highlight`, `citation`, `uncertainty`, `verification.requested`, `done`.
3. Browser pane: the resident page renders (list view with no token; map with a token), the hero question streams, and the route highlights. The staff page shows the VR with demand 1, which becomes 2 after re-asking.
4. `pnpm gen` produces no diff.
