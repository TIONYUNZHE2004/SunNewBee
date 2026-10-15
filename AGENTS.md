# AGENTS.md

Instructions for AI coding agents working in this repository (Claude Code, Codex, Cursor, Gemini CLI and others). People should start with [README.md](README.md) and [docs/](docs/README.md).

TownshipLens is a hackathon project (Sime Darby Property University Hackathon 2026, People track). It is a 3D "township world model" of City of Elmina:
- residents ask an AI assistant about step-free routes and indicative river-rise flood scenarios;
- staff verify facts by resolving Tickets (verification requests) on a second screen.

The product's core promise is **honesty**: answers come only from checked data, and every gap is shown as a gap.

## Setup and commands

Node 24 + pnpm 11, Python 3.13 + uv. Run everything from the repo root.

```bash
pnpm install && uv sync --all-packages --all-groups   # --all-packages is required: plain `uv sync --all-groups` uninstalls the workspace packages
pnpm dev            # API :8000 (uvicorn --reload) + web :5173 (Vite, /api proxied); ports via API_PORT / WEB_PORT
pnpm lint           # ruff check + ruff format --check + biome check
pnpm test           # pytest (all Python) + vitest
pnpm gen            # FastAPI OpenAPI -> packages/api-client/{openapi.json,schema.d.ts}; commit the result
pnpm golden         # golden questions, mock LLM (GOLDEN_REAL=1 uses OpenRouter and costs money)
pnpm -r --if-present typecheck
pnpm --filter @tl/web build   # tsc + vite build + Cesium asset check
pnpm --filter @tl/web e2e     # Playwright (first time: pnpm --filter @tl/web exec playwright install chromium)
pnpm data:build     # rebuild data/seed/elmina from OSM + Copernicus DEM (network; see "Data" below)
pnpm db:reset       # delete local SQLite DBs in .data/ (VRs, audit, sim runs); stop the API first
```

Single tests:

```bash
uv run pytest packages/spatial/tests/test_routing.py::test_name -q   # or: uv run pytest -k "keyword" -q
uv run pytest apps/api -q
pnpm --filter @tl/web exec vitest run src/features/scene/list/listModel.test.ts -t "test name"
pnpm --filter @tl/web exec playwright test -g "flood hero"
LLM_PROVIDER=mock uv run python -m townshiplens_agent.cli --profile stroller "Can I push a stroller from Car Park B to the playground?"
```

**Before you say a change is done**, run the same checks as CI (`.github/workflows/ci.yml`):
1. `pnpm lint`
2. `uv run pytest -q`
3. `pnpm -r --if-present typecheck`
4. `pnpm -r --if-present test`
5. `pnpm gen && git diff --exit-code packages/api-client`
6. `pnpm golden`
7. `pnpm --filter @tl/web e2e`

When piping output (e.g. `| tail`), use `set -o pipefail` so a failing check isn't masked.

## Architecture (the big picture)

```
data/seed/elmina/ (committed GeoJSON + site.json)        config/profiles/*.yaml
        │ load_world()                                            │
        ▼                                                         ▼
packages/spatial  World (graph, places, claims, flood, centres, waste) → evaluate → routing / flood / sim
        │ 10 tools: townshiplens_spatial.tools.TOOLS (deterministic facts + Evidence + verification requests)
        ├──────────────► apps/api (FastAPI REST: /layers, /places, /routes, /scenarios, /briefings, /verification-requests, /evidence, /kpis …)
        ▼
packages/agent  PydanticAI agent → tools → forced `final_answer` → validate.py (ModelRetry) → template fallback
        │ run_turn() streams ChatEvents
        ▼
apps/api POST /chat (SSE) ──► apps/web: parseSse → useChatStream → chatReducer
                                       └─ scene.intent → useScene.applyIntent → Cesium / Mapbox / List renderers
```

- **The LLM never computes facts.** Routes, flood classes, reachability and counts come from `packages/spatial`. The agent only calls tools and phrases results. `validate.py` is the ground-truth gate: it checks the answer against `TurnRecord`, which records everything the tools returned this turn.
- **Evaluation is tri-state:** every edge is PASS, FAIL or UNKNOWN per profile (`evaluate.py`), from claims with status `unknown|reported|verified|stale|contested`. Route status is `confirmed | partly_unverified | blocked | no_data`:
  - `blocked`: the endpoints are connected in the unfiltered graph, but every path is cut by a known FAIL.
  - `no_data`: the endpoints are in different graph components. This is a data gap, never shown as "not reachable".
  - A route crossing UNKNOWN edges is at best `partly_unverified`.
- **Flood scenarios** (`baseline`, `stage_p1m` … `stage_p5m`) are precomputed by `data/scripts/build_flood.py`. The method is REM, relative elevation above mapped OSM drainage, on Copernicus GLO-30 (ADR 0010 + amendment). Classes are `likely_flooded` (FAIL) and `possible` (UNKNOWN). A scenario can only add FAIL/UNKNOWN; it never upgrades anything to PASS.
- **Agent ↔ UI contract:**
  - SSE event types: `text.delta`, `tool.call`, `tool.result`, `scene.intent`, `citation`, `uncertainty`, `disclaimer`, `verification.requested`, `error`, `done`.
  - Scene intents: `camera.fly_to`, `place.focus`, `route.highlight`, `flood.set_level`, `layer.toggle`.
  - The agent never touches the scene directly. Each renderer adapts intents from the zustand `sceneStore`.
- **Model choice is `.env` only:**
  - `LLM_PROVIDER=mock|openrouter`; an empty value means mock without a key.
  - `LLM_MODEL_DEFAULT` / `LLM_MODEL_ESCALATE` are OpenRouter ids.
  - No model names live in code.
  - The deterministic mock (`packages/agent/.../mock.py`) is the default for tests, CI and keyless development.
- **Web renderers** degrade in order: Cesium 3D (Google Photorealistic tiles, else Cesium OSM Buildings), then Mapbox lite, then the List view. The choice is made in `features/scene/selectView.ts` behind an error boundary. Only three public browser keys reach the bundle (mapped via `define` in `vite.config.ts`; `envPrefix` is `TL_PUBLIC_`).
- **Web screens:** two routes, `/` (map plus assistant) and `/tickets` (verification queue; staff enter a token in the outcome form, kept in `sessionStorage`). Day/night is owned by the `useTheme` store in `apps/web/src/ui/theme.ts` (not the scene store); `useScene().mapStyle` (`realistic|stylised`) selects the map style. See `apps/web/README.md`.
- **State:**
  - Verification requests, the audit log and sim runs live in SQLite at `.data/<site id>.db`, one file per world unless `DATABASE_URL` is set.
  - Evidence photos live in `.data/evidence/`.
  - `DEMO_MODE=true` replays recorded turns from `data/demo/*.jsonl`. A replay only matches when `meta.world` equals the loaded world.
- **World data contract:** see `packages/spatial/README.md` (`site.json`, `base/walk.geojson`, `base/places.geojson`, `access/overlay.geojson`, `flood/*`, `waste/points.geojson`). Tests use the tiny fixture in `packages/spatial/tests/fixtures/tiny`. The API falls back to it when the seed is missing; e2e and golden always use it.

## Honesty invariants (enforced in code; keep them true)

| Never | Instead |
|---|---|
| Say "safe" / "selamat" / "安全", or state a water depth on a path | Say "indicative scenario, not a forecast" and point to official MBSA / JPS / NADMA guidance (`validate.py`, banners) |
| Present `team_survey_placeholder` evidence as verified | Show "Demo value · not surveyed" in the UI (`apps/web/src/lib/evidence.ts`); the agent answer must contain "demo values, not yet surveyed" |
| Answer without tool evidence (unless `cannot_answer`) | Cite `evidence_ids` returned this turn; abstain and file a verification request (VR) for gaps |
| Call missing data "blocked" / "not reachable" | `no_data` → "No mapped connection (data gap)" |
| Label OSM-derived passability "Checked" / "Verified" | "No known barrier"; "Verified" only for verified claims |
| Label an OSM evacuation candidate as official | `osm_candidate` vs `official_pps` (`official_pps` needs an exact name match with evidence) |
| Store user words or model-written text in a VR | `safe_vr_args()` sanitises target, attribute and reason; summaries are built from place and centre names (PDPA) |

When changing the agent, the mock answers and `template.py` must still pass the validator. The validator, mock and template change together.

## Conventions

- **Lint and format:** Python uses ruff (`ruff check --fix`, `ruff format`); TS/JSON uses Biome (`pnpm exec biome check --write`). Imports are sorted by ruff.
- **Generated client:** after any API model or route change, run `pnpm gen` and commit `packages/api-client`. CI fails on drift.
- **Attribute catalogue is mirrored:**
  - `packages/spatial/src/townshiplens_spatial/attributes.py` (enforced in `commit_claim` / VR resolve) must match `apps/web/src/features/tickets/attributeCatalogue.ts`.
  - Enum attributes use the strings from `docs/04-architecture/world-model-schema.md` (e.g. wheelchair `yes|limited|no`, handrail `both|one_side|none`).
- **Tests:**
  - pytest + hypothesis live next to each package. `testpaths` covers spatial, agent, api and `data/scripts/tests`.
  - vitest runs in the `node` environment by default. Interaction tests (clicks, focus, keyboard) opt in per file with `// @vitest-environment jsdom` and use Testing Library (`*.dom.test.tsx`; helpers in `apps/web/src/test/`). Other component tests render with `react-dom/server`, and side effects are extracted into pure, testable functions (see `features/tickets/resolveForm.ts`).
  - Playwright uses dedicated ports 5273/8100, so a running dev server on 5173/8000 is never reused. It runs with the tiny fixture, mock LLM, `STAFF_TOKEN=e2e-token` and no map keys (list view).
- **Commits:** Conventional style with a scope, e.g. `feat(web): …`, `fix(api): …`, `fix(agent): …`, `data: …`, `docs: …`. Data regeneration is committed separately from code.
- **Dependencies:** only MIT, Apache-2.0 or BSD licences. No GPL/AGPL/LGPL, non-commercial, source-available or unknown licences. This rules out Pillow (HPND); images are stripped with the stdlib (`apps/api/.../imagestrip`). Pin exact versions.
- **Docs:**
  - Decisions are ADRs in `docs/00-overview/decisions/`.
  - Specs and plans are in `docs/superpowers/{specs,plans}/`.
  - The run log is `docs/superpowers/overnight-log.md`.
  - Lane READMEs (`apps/*/README.md`, `packages/*/README.md`, `data/README.md`) describe each area. Update the one you touch.

## Data pipeline (`data/`)

- Rebuild order matters: `import_osm.py` → `build_overlay.py` (rewrites `base/places.geojson`) → `build_flood.py` → `build_waste.py` (`pnpm data:build`).
- **Overpass is a shared public service.** Requests go through `data/scripts/overpass.py`: a cache in `data/cache/` (gitignored), tiled sequential requests and backoff. Keep request counts small, and don't loop re-fetches.
- **Major roads** (`primary|secondary|trunk` + links) are imported as `major_road` (Task 31). OSM has no usable sidewalk tags here, so they carry no `sidewalk` claim: strict profiles (stroller, wheelchair, older_adult_rest) need a *verified* sidewalk to pass, so routes over them stay `partly_unverified`. Area places (parks, schools) snap to the nearest main-network walk node inside or within 40 m of their OSM outline, marked `node_inferred` with an "entrance not mapped" caveat (Task 43); 7 seed places still have no node and are listed with reasons in `flood/coverage.json`.
- `build_flood.py` needs the cached DEM in `data/cache/` (`glo30_dem_*.npy`). `--rewrite-disclaimers` edits scenario disclaimers without a rebuild.
- **Licences:**
  - OSM is ODbL, so keep attribution in `site.json`.
  - Copernicus GLO-30 needs its attribution string.
  - **Never derive heights or hydrology from Google 3D tiles.** They are display-only (licence).
- After a seed rebuild, re-record the Elmina demo cache with the mock: `LLM_PROVIDER=mock uv run python -m townshiplens_agent.cli --record "<question>" --profile <p>`. Check that hard-coded segment ids in docs and tests still exist.
- `access/overlay.geojson` facts are demo placeholders (`evidence_type: team_survey_placeholder`) until the field survey replaces them.

## Secrets and external services

- `.env` (repo root, gitignored) holds `OPENROUTER_API_KEY`, `STAFF_TOKEN`, `OPENCELLID_TOKEN` (server-only) and three public browser keys (`GOOGLE_MAPS_API_KEY`, `CESIUM_ION_ACCESS_TOKEN`, `MAPBOX_ACCESS_TOKEN`, `pk.` only). Never print or log `.env` values. Never move a server key into a browser variable.
- Live LLM calls and Google 3D tile loads cost money. Prefer `LLM_PROVIDER=mock` and the list view, and keep live smoke tests small and deliberate.
- `STAFF_TOKEN=change-me` (the default) makes staff endpoints return 503 by design. Set a real value to resolve tickets on `/tickets`.
