# Dev setup and team workflow

Companion to [stack-decision.md](../04-architecture/stack-decision.md). Versions there are authoritative; this file is the how-to. Written 2026-10-14, **updated 2026-10-15; commands in sections 2, 5, 6 and 7 are the ones that exist in the repo after the walking skeleton** (anything marked *planned* is not built yet) for the Township World Model platform (Cesium hero, PydanticAI over OpenRouter, SQLite + files, flood pipeline). Canonical names: [../04-architecture/README.md](../04-architecture/README.md).

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
│       ├── src/townshiplens_api/  # routes/{core,flood,manage,evidence,sim,chat}.py, auth, settings, state, store, evidence, imagestrip
│       └── tests/
├── packages/
│   ├── spatial/              # Python (backend): world loader, tools.py (22 tools), routing, flood.py (scenarios, evacuation), sim.py
│   ├── agent/                # Python (AI owner): PydanticAI agent, run_turn(), validate.py, mock, prompts
│   └── api-client/           # generated TS client + SSE event / scene-intent types (CI-checked)
├── config/
│   └── profiles/             # YAML: default, stroller, wheelchair, older_adult_rest, drive (+ flood depth thresholds, versioned)
├── data/
│   ├── seed/elmina/          # committed data: site.json, base/*.geojson (buildings, network, places, hydrology; GeoJSON/GeoParquet),
│   │                         #   access/overlay.geojson, flood/ (scenarios stage_p1m.geojson ..., evac_centres), waste/points.geojson (+ provenance)
│   ├── cache/                # Overpass responses and the GLO-30 DEM (gitignored)
│   ├── demo/                 # recorded chat turns for DEMO_MODE (*.jsonl)
│   ├── scripts/              # import_osm.py, build_overlay.py, build_flood.py (GLO-30 → REM scenarios + edge status),
│   │                         # build_waste.py, overpass.py (cached Overpass client)
│   └── README.md             # sources, licences, capture dates
├── evals/                    # run_golden.py + golden/hero.yaml
├── docs/                     # knowledge base (existing)
├── reference/                # external notes/repos (existing)
├── .github/workflows/        # ci.yml (deploy workflows are planned)
├── pnpm-workspace.yaml
├── package.json              # root scripts
├── pyproject.toml            # uv workspace root
├── uv.lock
├── biome.json
├── .pre-commit-config.yaml
├── .env.example
└── .nvmrc
```

Ownership: `apps/web` frontend; `apps/api`, `packages/spatial`, `data/scripts`, `config/profiles` backend; `packages/agent`, `evals/` AI; `data/` shared (backend merges). Cross-boundary changes go via PR with the other owner as reviewer. Large generated files (DEM tiles, HAND rasters) live in `data/cache/` and are **not** committed (keep them out of git; a large-file pre-commit check is planned, not configured); only the small derived GeoJSON/GeoParquet outputs (in `data/seed/elmina/`) are committed, so a teammate can run the app without re-running the pipeline.

## 2. Tooling

| Purpose | Tool | Notes |
|---|---|---|
| Node | Node 24 (`engines`) | |
| JS packages | pnpm 11 workspaces (`packageManager` in `package.json`) | `corepack enable` then `pnpm install` |
| Python packages | uv 0.12.x, Python 3.13 | `uv sync --all-packages --all-groups` creates `.venv` |
| JS lint/format | Biome 2.5 | one config, no ESLint/Prettier |
| Py lint/format | ruff 0.17 | `ruff check` + `ruff format` |
| Types | `tsc --noEmit`, `pyright` or `mypy` (optional) | Pydantic gives most Python safety |
| Unit tests | vitest 5 (node environment by default; DOM tests opt in per file with `// @vitest-environment jsdom` and use Testing Library), pytest 9 (+ Hypothesis for flood monotonicity) | |
| E2E / a11y | Playwright 1.64 (list view, mock LLM, tiny fixture; web :5273, API :8100) | hero smoke plus an accessible-name check. `@axe-core/playwright` is *planned*, not installed |
| Hooks | pre-commit (`.pre-commit-config.yaml`) | ruff, ruff-format, gitleaks. Biome and a large-file check are *planned*, not configured |
| Contract | `openapi-typescript` + `openapi-fetch` (instead of hey-api) | `pnpm gen` |

Root scripts (`package.json`; there is no `justfile` and no worktree setup is needed):

```
pnpm dev           # API (uvicorn --reload, :8000) + web (vite, :5173, /api proxied) via concurrently; ports via API_PORT / WEB_PORT
pnpm dev:api       # API only
pnpm test          # uv run pytest && pnpm -r --if-present test (vitest)
pnpm lint          # ruff check + ruff format --check + biome check
pnpm gen           # export OpenAPI -> packages/api-client/openapi.json -> schema.d.ts (commit the result; CI fails on drift)
pnpm golden        # evals/run_golden.py: golden questions against the tiny fixture with the mock LLM
pnpm data:build    # import_osm.py, build_overlay.py, build_flood.py, build_waste.py under data/scripts
                   # (the pipeline scripts arrive with the data and flood lanes; check `ls data/scripts`)
pnpm db:reset      # delete the local SQLite files in .data/ (VRs, audit, sim runs); stop the API first
pnpm --filter @tl/web e2e   # Playwright smoke on its own ports (web :5273, API :8100, DB .data/e2e.db); needs `pnpm --filter @tl/web exec playwright install chromium` once
uv run python -m townshiplens_agent.cli "Can I push a stroller from Car Park B to the kiosk?"
```

*Planned, not built:* `data:roads` (OSMnx drive graph; the `drive` profile currently uses the walk extract's street/track/major_road edges), deploy workflows. The resident-agent runner is built as `packages/spatial` `sim`, the staff `/simulations` endpoints and the Journey tests UI was removed with the two-screen redesign (the API stays); `config/profiles/*.yaml` exists.

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
6. Generated files (`packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts`) are committed; CI fails if regeneration produces a diff. If you change an endpoint, run `pnpm gen` in the same PR.
7. Daily 10-minute sync; a tagged `demo-YYYYMMDD` release on every deploy that is shown to anyone.

## 5. Environment variables and key safety

`.env.example` (committed, no real values; copy to `.env` at the **repo root**):

```
# Server only (apps/api + packages/agent)
OPENROUTER_API_KEY=
LLM_PROVIDER=            # openrouter | mock (mock when the key is empty)
LLM_MODEL_DEFAULT=anthropic/claude-haiku-5.5
LLM_MODEL_ESCALATE=anthropic/claude-sonnet-5.5
LLM_OUTPUT_RETRIES=2
STAFF_TOKEN=change-me    # the API refuses to resolve verification requests until this is changed
DATABASE_URL=            # optional; default .data/<site id>.db, one file per world
OPENCELLID_TOKEN=        # reserved
# Optional server overrides: TL_DATA_DIR (default data/seed/elmina, else the tiny fixture), EVIDENCE_DIR (default .data/evidence), TURN_TIMEOUT_S
# Demo cache (replays recorded answers offline): DEMO_MODE=true, DEMO_DIR=data/demo
# Browser (public; restrict by referrer). vite.config.ts maps ONLY these three.
GOOGLE_MAPS_API_KEY=
CESIUM_ION_ACCESS_TOKEN=
MAPBOX_ACCESS_TOKEN=     # public pk. token
```

Rules:
- Only the three browser keys above reach the browser (explicit `define` mapping in `apps/web/vite.config.ts`, no `VITE_*` prefix); assume they are public. Restrict the Google key by HTTP referrer and to the Map Tiles API, the Mapbox token by URL, and set quota caps and budget alerts (Google: 1,000 free events/month then USD 6 per 1,000; Mapbox: 50,000 free loads/month).
- `OPENROUTER_API_KEY` exists only in the API environment (Cloud Run env / Secret Manager, GitHub Actions secrets). Each dev uses a personal key with a spend cap; do not share keys in chat. Choose models in env only (`LLM_MODEL_DEFAULT`, `LLM_MODEL_ESCALATE`).
- `STAFF_TOKEN` is an MVP shortcut (a shared token in the `X-Staff-Token` header): rotate it before any public demo and never commit a real value.
- `.env` is gitignored; gitleaks runs in pre-commit. If a key leaks, rotate immediately; removing it from git history is not enough.
- Never log prompts that contain staff or personal data; the chat log stores sessions without IP addresses.

## 6. CI (GitHub Actions)

`ci.yml` (single `check` job, `LLM_PROVIDER=mock`) on every PR and push to `main`:

1. `pnpm install --frozen-lockfile`, `uv sync --all-packages --all-groups`.
2. `pnpm lint` (ruff, ruff format, biome).
3. `uv run pytest -q`.
4. `pnpm -r --if-present typecheck` and `pnpm -r --if-present test` (vitest).
5. OpenAPI drift: `pnpm gen && git diff --exit-code packages/api-client`.
6. `pnpm golden` (golden questions, mock LLM).
7. Playwright hero smoke: `playwright install --with-deps chromium`, then `pnpm --filter @tl/web e2e`; the HTML report is uploaded on failure.

*Planned:* gitleaks in CI (it runs only as a pre-commit hook today), axe checks, the evals simulation smoke.

*Planned (not built):* `deploy-web.yml`: on `main`, build `apps/web`, deploy to Cloudflare Pages (`wrangler pages deploy` or Pages Git integration). `deploy-api.yml`: on `main`, build the Docker image (with the committed `data/seed/elmina` files and a freshly seeded SQLite), push, `gcloud run deploy --region asia-southeast1` (Workload Identity Federation preferred over JSON keys). There is no keep-alive workflow while we use SQLite + files; add one only if we later move to a hosted Postgres that pauses when idle. Cloud Run disk is ephemeral: staff edits made on the deployed demo are lost on a new revision unless exported back to `data/seed` (or the DB moves to Postgres).

## 7. Setup per role

### Everyone

```bash
git clone <repo> && cd SunNiuBi
corepack enable                     # pnpm; Node 24 and uv (https://docs.astral.sh/uv/) installed
cp .env.example .env                # keys optional; set STAFF_TOKEN to resolve tickets on /tickets
pnpm install && uv sync --all-packages --all-groups
pnpm dev                            # http://localhost:5173 (web), http://localhost:8000/docs (API)
```

Without `data/seed/elmina` the API serves the tiny fixture world (`packages/spatial/tests/fixtures/tiny`). Everything works with no keys: list view plus the mock assistant.

### Frontend (`apps/web`, see [its README](../../apps/web/README.md))

```bash
pnpm --filter @tl/web dev | test | typecheck | build | e2e
pnpm gen                            # after any API change; commit packages/api-client
```

Keys for 3D: `GOOGLE_MAPS_API_KEY` (photoreal tiles) or `CESIUM_ION_ACCESS_TOKEN` (OSM Buildings); `MAPBOX_ACCESS_TOKEN` for the lite map. Lazy-load Cesium; use `requestRenderMode`. For current library APIs run `npx ctx7@latest library Cesium "<question>"`.

### Backend (`apps/api`, `packages/spatial`, `data/`)

```bash
uv run pytest apps/api packages/spatial -q
uv run uvicorn townshiplens_api.main:app --reload --port 8000 --app-dir apps/api/src
pnpm data:build                     # rebuild seed data (needs network; see data/README.md)
pnpm db:reset                       # clear local SQLite state before a demo (stop the API first)
```

`packages/spatial` is a uv workspace member used by `apps/api` and `packages/agent`. The 22 tools live only in `packages/spatial/src/townshiplens_spatial/tools.py`. Data sources and licences: [../02-research/flood-disaster-lens.md](../02-research/flood-disaster-lens.md), [../02-research/township-3d-engine-and-data.md](../02-research/township-3d-engine-and-data.md).

### AI (`packages/agent`, `evals/`, see [its README](../../packages/agent/README.md))

```bash
uv run pytest packages/agent
LLM_PROVIDER=mock uv run python -m townshiplens_agent.cli "Where can I drop off recycling nearby?"
pnpm golden                         # mock, CI; GOLDEN_REAL=1 pnpm golden uses OpenRouter (costs money)
```

Pin `pydantic-ai-slim` exactly and read the changelog before bumping ([ADR 0008](../00-overview/decisions/0008-agent-harness-pydantic-ai.md)). MCP is a stretch goal.

## 8. Definition of done for a PR

- Lint, types, tests green; screenshot or short clip for UI changes.
- Any new user-visible claim path shows verification status and has a text alternative (a11y).
- New env vars added to `.env.example` and this document.
- OpenAPI/client regenerated if the API changed.
