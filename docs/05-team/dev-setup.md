# Dev setup and team workflow

Companion to [stack-decision.md](../04-architecture/stack-decision.md). Versions there are authoritative; this file is the how-to. Written 2026-10-14, **updated 2026-10-15** for the Township World Model platform (Cesium hero, PydanticAI over OpenRouter, SQLite + files, flood pipeline). Canonical names: [../04-architecture/README.md](../04-architecture/README.md).

## 1. Monorepo layout

```
.
├── apps/
│   ├── web/                  # Vite + React 19 SPA (frontend owner)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── features/
│   │   │   │   ├── scene/{cesium,mapbox,list}/   # hero 3D (Cesium+Resium), Mapbox lite, text/list; one scene-intent adapter each
│   │   │   │   ├── flood/    # scenario bar, water polygon, legend, "why this edge?"
│   │   │   │   ├── chat/     # SSE hook, evidence cards, disclaimer/uncertainty rendering
│   │   │   │   └── manage/   # management console: VR queue, attribute editor, flood briefing, gap map
│   │   │   ├── lib/
│   │   │   └── components/ui/
│   │   └── e2e/              # Playwright
│   └── api/                  # FastAPI (backend owner)
│       ├── src/townshiplens_api/{routes,auth,db,sse}.py
│       ├── alembic/          # optional while SQLite + seed rebuild is enough
│       └── tests/
├── packages/
│   ├── spatial/              # Python (backend): graph loader, geo utils, tools.py (10 tools), routing
│   │   ├── flood/            # scenario loader, edge/place classification, evacuation analytics
│   │   └── ...
│   ├── agent/                # Python (AI owner): PydanticAI agent, run_turn(), validate.py, prompts, personas
│   ├── api-client/           # generated TS client + SSE event / scene-intent types (CI-checked)
│   └── fixtures/             # JSON fixtures for stub endpoints and tests
├── config/
│   └── profiles/             # YAML: default, stroller, wheelchair, older_adult_rest, drive (+ flood depth thresholds, versioned)
├── data/
│   ├── seed/elmina/          # committed data: site.json, base/*.geojson (buildings, network, places, hydrology; GeoJSON/GeoParquet),
│   │                         #   access/overlay.geojson, flood/ (scenarios stage_p1m.geojson ..., evac_centres), waste/points.geojson (+ provenance)
│   ├── raw/                  # downloaded DEM, OSM, Overture extracts (gitignored)
│   ├── scripts/              # import_osm.py, import_overture.py, build_roads.py (OSMnx),
│   │                         # build_hand.py (GLO-30 → HAND), build_scenarios.py (HAND → scenarios + edge status)
│   └── README.md             # sources, licences, capture dates
├── evals/                    # resident-agent runner, persona configs, journey sets, golden set, reports/
├── docs/                     # knowledge base (existing)
├── reference/                # external notes/repos (existing)
├── .github/workflows/        # ci.yml, deploy-web.yml, deploy-api.yml
├── pnpm-workspace.yaml
├── package.json              # root scripts
├── pyproject.toml            # uv workspace root
├── uv.lock
├── biome.json
├── .pre-commit-config.yaml
├── .env.example
├── .nvmrc
└── justfile                  # optional: one-line commands (just dev, just test, just gen)
```

Ownership: `apps/web` frontend; `apps/api`, `packages/spatial`, `data/scripts`, `config/profiles` backend; `packages/agent`, `evals/` AI; `data/` shared (backend merges). Cross-boundary changes go via PR with the other owner as reviewer. Large generated files (DEM tiles, HAND rasters) live in `data/raw/` and are **not** committed (the pre-commit hook rejects files over 5 MB); only the small derived GeoJSON/GeoParquet outputs (in `data/seed/elmina/`) are committed, so a teammate can run the app without re-running the pipeline.

## 2. Tooling

| Purpose | Tool | Notes |
|---|---|---|
| Node | Node LTS via `.nvmrc` (22 or 24; check `node -v`) | |
| JS packages | pnpm 12.x workspaces | `corepack enable` then `pnpm i` |
| Python packages | uv 0.12.x, Python 3.13 | `uv sync` creates `.venv`; pipeline deps (rasterio, pysheds, osmnx) are a `pipelines` group: `uv sync --group pipelines` |
| JS lint/format | Biome 2.5 | one config, no ESLint/Prettier |
| Py lint/format | ruff 0.17 | `ruff check` + `ruff format` |
| Types | `tsc --noEmit`, `pyright` or `mypy` (optional) | Pydantic gives most Python safety |
| Unit tests | vitest 5 (+ Testing Library), pytest 9 (+ Hypothesis for flood monotonicity) | |
| E2E / a11y | Playwright 1.64 + `@axe-core/playwright` | smoke: load, ask question, route shown, flood slider, staff edit |
| Hooks | pre-commit (or lefthook) | biome, ruff, gitleaks, trailing whitespace, large-file check (reject >5 MB, so 3D assets are not committed by accident) |
| Contract | `@hey-api/openapi-ts` | `pnpm gen:api` |

Root scripts (`package.json` or `justfile`):

```
dev:web      pnpm --filter web dev
dev:api      uv run --package townshiplens-api fastapi dev apps/api/src/townshiplens_api/main.py
openapi      uv run python -m townshiplens_api.export_openapi > apps/api/openapi.json
gen:api      pnpm openapi && pnpm --filter api-client generate
seed         uv run python -m townshiplens_api.seed data/seed        # loads seed + overlays into SQLite
data:base    uv run python data/scripts/import_osm.py && uv run python data/scripts/import_overture.py && uv run python data/scripts/build_roads.py
data:flood   uv run python data/scripts/build_hand.py && uv run python data/scripts/build_scenarios.py
test         pnpm -r test && uv run pytest
lint         pnpm biome check . && uv run ruff check . && uv run ruff format --check .
sim          uv run python -m evals.run --personas all --scenarios all --out evals/reports/latest
```

## 3. Conventions

- **Coordinates:** API and data files use WGS84 `[lon, lat]`. Local metric projection only inside `packages/spatial` (pyproj) and the FE scene adapters (Cesium datum offset and clamping live only there). Never mix.
- **Hydrology:** heights and water extents come only from the DEM pipeline, never from Google tiles (licence and honesty). Flood wording: always "indicative scenario", never "safe".
- **IDs:** stable slugs with the canonical prefixes from `docs/04-architecture/README.md` (`ent-mall-north`, `seg-0017`, `playground`, `vr-0003`); never reuse.
- **Attribute provenance:** every claim has `status` (`unknown|reported|verified|stale|contested`), `source`, `verified_by`, `verified_at`. The UI and the LLM must render status; "unknown" is a first-class answer.
- **Tools:** the 10 tool functions are defined only in `packages/spatial/tools.py` as Pydantic-typed functions. `packages/agent` wraps them thinly; do not define tools in route handlers.
- **Naming:** Python snake_case, TS camelCase; API JSON is snake_case (generated client keeps it, do not remap).
- **Commits:** Conventional Commits: `feat(web): ...`, `fix(api): ...`, `chore(data): ...`, `docs: ...`, `test(evals): ...`. Scopes: `web`, `api`, `spatial`, `flood`, `agent`, `data`, `evals`, `ci`, `docs`.
- **Docs:** decisions go to `docs/` as short ADR-style notes; update `stack-decision.md` when a choice changes.

## 4. Git workflow (3 people, frequent pushes)

Trunk-based:

1. Branch from `main`: `web/route-overlay`, `api/verification-queue`, `ai/persona-runner`. Keep branches under 1 to 2 days.
2. Open a PR early (draft is fine); under ~300 changed lines; CI must pass; one teammate approval (self-merge allowed on docs-only or when the reviewer is unavailable for over 4 hours, with a note).
3. **Squash merge**, title in Conventional Commit form. Delete branch.
4. `git pull --rebase` before pushing; never force-push `main`. Protect `main` (require PR + CI; allow admins to bypass during the final 24 hours only).
5. Unfinished UI/features hide behind env flags (`VITE_FEATURE_*`) instead of long-lived branches.
6. Generated files (`apps/api/openapi.json`, `packages/api-client/src`) are committed; CI fails if regeneration produces a diff. If you change an endpoint, run `pnpm gen:api` in the same PR.
7. Daily 10-minute sync; a tagged `demo-YYYYMMDD` release on every deploy that is shown to anyone.

## 5. Environment variables and key safety

`.env.example` (committed, no real values):

```
# apps/api + packages/agent
DATABASE_URL=sqlite:///./data/townshiplens.db   # MVP: SQLite + files. Postgres (e.g. Supabase) only as a later option
OPENROUTER_API_KEY=                        # empty + LLM_PROVIDER=mock = deterministic mock agent (CI, offline dev)
LLM_PROVIDER=openrouter                    # openrouter | mock
LLM_MODEL_DEFAULT=                         # OpenRouter model ID, set per environment, never hard-coded
LLM_MODEL_ESCALATE=                        # used only when the output validator retries
LLM_OUTPUT_RETRIES=2                       # validator retries before the template fallback
STAFF_TOKEN=change-me                      # MVP staff auth: shared token in the Authorization header (named accounts later)
CORS_ORIGINS=http://localhost:5173
RATE_LIMIT_CHAT=20/minute

# apps/web (public: everything here ships to the browser)
VITE_API_BASE_URL=http://localhost:8000
VITE_GOOGLE_MAPS_API_KEY=                  # Map Tiles API for Photorealistic 3D Tiles; referrer-restricted
VITE_CESIUM_ION_TOKEN=                     # Cesium ion Community plan (OSM Buildings / World Terrain fallback)
VITE_MAPBOX_TOKEN=                         # Mapbox lite view; URL-restricted public token
VITE_FEATURE_3D=true
```

Rules:
- Only `VITE_*` values reach the browser; assume they are public. Restrict the Google key by HTTP referrer and to the Map Tiles API, the Mapbox token by URL, and set quota caps and budget alerts (Google: 1,000 free events/month then USD 6 per 1,000; Mapbox: 50,000 free loads/month).
- `OPENROUTER_API_KEY` exists only in the API environment (Cloud Run env / Secret Manager, GitHub Actions secrets). Each dev uses a personal key with a spend cap; do not share keys in chat. Choose models in env only (`LLM_MODEL_DEFAULT`, `LLM_MODEL_ESCALATE`).
- `STAFF_TOKEN` is an MVP shortcut: rotate it before any public demo and never commit a real value.
- `.env` is gitignored; gitleaks runs in pre-commit and CI. If a key leaks, rotate immediately; removing it from git history is not enough.
- Never log prompts that contain staff or personal data; the chat log stores sessions without IP addresses.

## 6. CI (GitHub Actions)

`ci.yml` on every PR and push to `main`:

1. `pnpm i --frozen-lockfile`, `uv sync --frozen`, with caching (setup-node/pnpm cache, `astral-sh/setup-uv`).
2. Lint: biome, ruff check, ruff format check, gitleaks.
3. Types: `tsc --noEmit`.
4. Unit: vitest, pytest.
5. Contract: export OpenAPI, regenerate client, `git diff --exit-code`.
6. E2E (on `main` and PRs touching `apps/`): Playwright against the dev server with the stub/LLM-mock (`LLM_PROVIDER=mock`; no real keys in PR CI), including axe checks.
7. Sim smoke: run `evals` on 3 profiles with the deterministic engine only (no LLM), including `baseline` and `stage_p3m`; fail if a previously passing journey regresses or a flood invariant breaks (monotonicity, no route through `likely_flooded`).

`deploy-web.yml`: on `main`, build `apps/web`, deploy to Cloudflare Pages (`wrangler pages deploy` or Pages Git integration). `deploy-api.yml`: on `main`, build the Docker image (with the committed `data/seed/elmina` files and a freshly seeded SQLite), push, `gcloud run deploy --region asia-southeast1` (Workload Identity Federation preferred over JSON keys). There is no keep-alive workflow while we use SQLite + files; add one only if we later move to a hosted Postgres that pauses when idle. Cloud Run disk is ephemeral: staff edits made on the deployed demo are lost on a new revision unless exported back to `data/seed` (or the DB moves to Postgres).

## 7. Day-1 setup per role

### Everyone (first 30 minutes)

```bash
git clone <repo> && cd SunNiuBi
brew install node pnpm uv just gitleaks pre-commit   # or your OS equivalents
corepack enable
cp .env.example .env
pre-commit install
pnpm i && uv sync
# agree on: Node/Python versions, PR template, Conventional Commits, CI green on empty repo
# agree on: the Elmina envelope bbox (S,W,N,E) 3.150,101.460,3.240,101.530 and the flood analysis bbox (fixed in week 1)
```

### Frontend

```bash
pnpm create vite@latest apps/web --template react-ts
cd apps/web
pnpm add react@19 react-dom@19 cesium@1.146.0 resium@1.27.0 mapbox-gl@3.33.0 react-map-gl \
  zustand @tanstack/react-query react-router
pnpm add -D tailwindcss @tailwindcss/vite vitest @testing-library/react @playwright/test \
  @axe-core/playwright @hey-api/openapi-ts
pnpm dlx shadcn@latest init
pnpm dev
# milestone 1 (Day-1 spike, answers "do Google tiles look good over Elmina?"): Resium <Viewer> + createGooglePhotorealistic3DTileset,
#   credits visible, camera on Elmina, Cesium static assets served (CESIUM_BASE_URL). Test on a mid-range Android phone.
#   If tiles look poor or billing is blocked: switch to Cesium OSM Buildings + World Terrain (VITE_CESIUM_ION_TOKEN).
# milestone 2: water polygon at height h (translucent, depth-tested) + slider; datum offset against the Elmina lake.
# milestone 3: scene-intent adapter for Cesium (camera.fly_to, route.highlight, flood.set_level, layer.toggle) driven by fixtures
#   from packages/fixtures; then the Mapbox lite and list adapters on the same intents.
```

Lazy-load the Cesium chunk and use `requestRenderMode`. Run `npx ctx7@latest docs /reearth/resium "<question>"` and `npx ctx7@latest library Cesium "<question>"` for current APIs (older Resium examples still use the removed `createWorldTerrain()`; use `createWorldTerrainAsync`).

### Backend

```bash
uv init --package apps/api && cd apps/api
uv add fastapi "uvicorn[standard]" pydantic pydantic-settings sqlalchemy alembic \
  networkx shapely pyproj sse-starlette slowapi httpx
uv add --dev pytest pytest-asyncio hypothesis ruff
uv sync --group pipelines   # rasterio, pysheds, osmnx, geopandas, pyarrow, overturemaps (pipeline scripts only)
uv run fastapi dev src/townshiplens_api/main.py     # http://localhost:8000/docs
# milestone 1 (by end of day 2): /healthz, GET /places, GET /route?from&to&profile returning FIXTURE data,
#   GET /scenarios, openapi.json exported, committed, client generated. Unblocks both other roles.
# milestone 2 (week 1): data/scripts/import_osm.py for the Elmina envelope, build_roads.py (OSMnx walk + drive graphs),
#   fetch Copernicus GLO-30 tile N03 E101 and the ASF HAND raster, clip, stage_p3m GeoJSON, edge flood_class.
# then: SQLite schema + seed, packages/spatial routing (profiles from config/profiles), scenario-aware plan_route,
#   evacuation reachability/islands/isochrones, VR workflow, STAFF_TOKEN auth.
# deploy skeleton to Cloud Run (asia-southeast1) in week 1, not week 4.
```

Create `packages/spatial` as a separate uv workspace member (`uv init --lib packages/spatial`) and depend on it from `apps/api` and `packages/agent`. Data sources and licences (Copernicus attribution, ODbL for OSM/Overture) are listed in [../02-research/flood-disaster-lens.md](../02-research/flood-disaster-lens.md) and [../02-research/township-3d-engine-and-data.md](../02-research/township-3d-engine-and-data.md); put them in `data/README.md` as you go.

### AI

```bash
uv init --lib packages/agent && cd packages/agent
uv add "pydantic-ai-slim[openrouter]==2.56.0" pydantic
uv add --dev pytest
# milestone 1: LLM_PROVIDER=mock works first (FunctionModel/TestModel via agent.override), then OpenRouter with
#   LLM_MODEL_DEFAULT from env. Agent with output_type=FinalAnswer, @agent.output_validator -> ModelRetry,
#   retries={'output': LLM_OUTPUT_RETRIES}, UnexpectedModelBehavior -> template fallback.
# milestone 2: thin tool wrappers over packages/spatial/tools.py (start: find_place, plan_route; then all 10), plus
#   run_turn(question, context) -> AsyncIterator[Event] matching the SSE schema in api-contract.md; hand to backend to mount at POST /chat.
# milestone 3: flood guardrails (disclaimer from tool result, no "safe", official links) and golden questions for access + flood;
#   evals/: profile configs + deterministic journey runner (incl. scenarios) -> report (JSON + Markdown).
npx ctx7@latest library PydanticAI "output validator ModelRetry run_stream_events OpenRouter"   # confirm current API
```

Pin `pydantic-ai-slim` exactly and read the changelog before bumping ([ADR 0008](../00-overview/decisions/0008-agent-harness-pydantic-ai.md)). MCP (`fastmcp`) is a stretch goal, not a Day-1 dependency.

## 8. Definition of done for a PR

- Lint, types, tests green; screenshot or short clip for UI changes.
- Any new user-visible claim path shows verification status and has a text alternative (a11y).
- New env vars added to `.env.example` and this document.
- OpenAPI/client regenerated if the API changed.
