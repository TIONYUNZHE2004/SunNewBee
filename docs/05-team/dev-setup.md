# Dev setup and team workflow

Companion to [stack-decision.md](../04-architecture/stack-decision.md). Versions there are authoritative; this file is the how-to. Written 2026-10-14.

## 1. Monorepo layout

```
.
├── apps/
│   ├── web/                  # Vite + React 19 SPA (frontend owner)
│   │   ├── src/{app,features/{scene,map,chat,list,staff},lib,components/ui}
│   │   └── e2e/              # Playwright
│   └── api/                  # FastAPI (backend owner)
│       ├── src/townshiplens_api/{routes,auth,db,sse,mcp_mount}.py
│       ├── alembic/
│       └── tests/
├── packages/
│   ├── spatial/              # Python: graph loader, geo utils, tool registry (backend + AI)
│   ├── agent/                # Python: tool-use loop, prompts, personas, grounding checks (AI owner)
│   ├── api-client/           # generated TS client + SSE event types (CI-checked)
│   └── fixtures/             # JSON fixtures for stub endpoints and tests
├── data/
│   ├── seed/                 # GeoJSON: places, entrances, edges, attributes (+ provenance)
│   └── README.md             # sources, licences, capture dates
├── evals/                    # simulation runner, persona configs, journey sets, reports/
├── docs/                     # knowledge base (existing)
├── reference/                # external notes/repos (existing)
├── .github/workflows/        # ci.yml, deploy-web.yml, deploy-api.yml, keepalive.yml
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

Ownership: `apps/web` frontend; `apps/api` and `packages/spatial` backend; `packages/agent`, `evals/` AI; `data/` shared (backend merges). Cross-boundary changes go via PR with the other owner as reviewer.

## 2. Tooling

| Purpose | Tool | Notes |
|---|---|---|
| Node | Node LTS via `.nvmrc` (22 or 24; check `node -v`) | |
| JS packages | pnpm 12.x workspaces | `corepack enable` then `pnpm i` |
| Python packages | uv 0.12.x, Python 3.13 | `uv sync` creates `.venv` |
| JS lint/format | Biome 2.5 | one config, no ESLint/Prettier |
| Py lint/format | ruff 0.17 | `ruff check` + `ruff format` |
| Types | `tsc --noEmit`, `pyright` or `mypy` (optional) | Pydantic gives most Python safety |
| Unit tests | vitest 5 (+ Testing Library), pytest 9 | |
| E2E / a11y | Playwright 1.64 + `@axe-core/playwright` | smoke: load, ask question, route shown, staff edit |
| Hooks | pre-commit (or lefthook) | biome, ruff, gitleaks, trailing whitespace, large-file check (reject >5 MB, so 3D assets are not committed by accident) |
| Contract | `@hey-api/openapi-ts` | `pnpm gen:api` |

Root scripts (`package.json` or `justfile`):

```
dev:web      pnpm --filter web dev
dev:api      uv run --package townshiplens-api fastapi dev apps/api/src/townshiplens_api/main.py
openapi      uv run python -m townshiplens_api.export_openapi > apps/api/openapi.json
gen:api      pnpm openapi && pnpm --filter api-client generate
seed         uv run python -m townshiplens_api.seed data/seed
test         pnpm -r test && uv run pytest
lint         pnpm biome check . && uv run ruff check . && uv run ruff format --check .
sim          uv run python -m evals.run --personas all --out evals/reports/latest
```

## 3. Conventions

- **Coordinates:** API and data files use WGS84 `[lon, lat]`. Local metric projection only inside `packages/spatial` (pyproj) and the frontend scene helper. Never mix.
- **IDs:** stable slugs with the canonical prefixes from `docs/04-architecture/README.md` (`ent-mall-north`, `seg-0017`, `playground`, `vr-0003`); never reuse.
- **Attribute provenance:** every attribute has `status` (`verified|unverified|disputed|stale`), `source`, `verified_by`, `verified_at`. The UI and the LLM must render status; "unknown" is a first-class answer.
- **Tools:** defined only in `packages/spatial/tools.py` as Pydantic-typed functions. Do not define tools in the agent or the route handlers.
- **Naming:** Python snake_case, TS camelCase; API JSON is snake_case (generated client keeps it, do not remap).
- **Commits:** Conventional Commits: `feat(web): ...`, `fix(api): ...`, `chore(data): ...`, `docs: ...`, `test(evals): ...`. Scopes: `web`, `api`, `spatial`, `agent`, `data`, `evals`, `ci`, `docs`.
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
# apps/api
DATABASE_URL=sqlite:///./dev.db            # prod: postgresql+psycopg://...supabase pooler...
LLM_PROVIDER=anthropic                     # anthropic | openai | google
LLM_MODEL=                                 # set per environment, not hard-coded
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=
JWT_SECRET=change-me
STAFF_SEED_USERS=                          # e.g. name:bcrypt-hash,...
CORS_ORIGINS=http://localhost:5173
RATE_LIMIT_CHAT=20/minute

# apps/web (public: everything here ships to the browser)
VITE_API_BASE_URL=http://localhost:8000
VITE_GOOGLE_MAPTILES_KEY=                  # referrer-restricted, Map Tiles API only
VITE_FEATURE_3D=true
```

Rules:
- Only `VITE_*` values reach the browser; assume they are public. The Google Map Tiles key must be restricted by HTTP referrer and API, with a quota cap and budget alert.
- LLM keys exist only in the API environment (Cloud Run env / Secret Manager, GitHub Actions secrets). Each dev uses a personal key with a spend cap; do not share keys in chat.
- `.env` is gitignored; gitleaks runs in pre-commit and CI. If a key leaks, rotate immediately; removing it from git history is not enough.
- Never log prompts that contain staff or personal data; the chat log stores sessions without IP addresses.

## 6. CI (GitHub Actions)

`ci.yml` on every PR and push to `main`:

1. `pnpm i --frozen-lockfile`, `uv sync --frozen`, with caching (setup-node/pnpm cache, `astral-sh/setup-uv`).
2. Lint: biome, ruff check, ruff format check, gitleaks.
3. Types: `tsc --noEmit`.
4. Unit: vitest, pytest.
5. Contract: export OpenAPI, regenerate client, `git diff --exit-code`.
6. E2E (on `main` and PRs touching `apps/`): Playwright against the dev server with the stub/LLM-mock (LLM provider replaced by a recorded-response fake; no real keys in PR CI), including axe checks.
7. Sim smoke: run `evals` on 3 personas with the deterministic engine only (no LLM), fail if a previously passing journey regresses.

`deploy-web.yml`: on `main`, build `apps/web`, deploy to Cloudflare Pages (`wrangler pages deploy` or Pages Git integration). `deploy-api.yml`: on `main`, build the Docker image, push, `gcloud run deploy --region asia-southeast1` (Workload Identity Federation preferred over JSON keys). `keepalive.yml`: daily cron that curls `/healthz` (keeps Supabase from pausing; schedule workflows can be disabled after 60 days of repo inactivity, unverified, so check before the demo).

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
```

### Frontend

```bash
pnpm create vite@latest apps/web --template react-ts
cd apps/web
pnpm add react@19 react-dom@19 three @react-three/fiber @react-three/drei 3d-tiles-renderer \
  maplibre-gl react-map-gl zustand @tanstack/react-query react-router
pnpm add -D tailwindcss @tailwindcss/vite vitest @testing-library/react @playwright/test \
  @axe-core/playwright @types/three @hey-api/openapi-ts
pnpm dlx shadcn@latest init
pnpm dev
# milestone 1: <Canvas> with <TilesRenderer> + GoogleCloudAuthPlugin + TilesAttributionOverlay
#   (import from '3d-tiles-renderer/r3f' and '3d-tiles-renderer/plugins'), camera on the site.
# milestone 2: load fixtures from packages/fixtures, draw a fake route in 3D and on MapLibre, list view.
```

Run `npx ctx7@latest docs /nasa-ammos/3dtilesrendererjs "<question>"` for the current API; the library is 0.x and moves.

### Backend

```bash
uv init --package apps/api && cd apps/api
uv add fastapi "uvicorn[standard]" pydantic pydantic-settings sqlalchemy alembic psycopg[binary] \
  networkx shapely pyproj pyjwt sse-starlette slowapi httpx
uv add --dev pytest pytest-asyncio ruff
uv run alembic init alembic
uv run fastapi dev src/townshiplens_api/main.py     # http://localhost:8000/docs
# milestone 1 (by end of day 2): /healthz, GET /places, GET /route?from&to&persona returning FIXTURE data,
#   openapi.json exported, committed, client generated. Unblocks both other roles.
# then: DB schema + seed from data/seed, packages/spatial graph + routing, staff auth, verification queue.
# deploy skeleton to Cloud Run (asia-southeast1) in week 1, not week 4.
```

Create `packages/spatial` as a separate uv workspace member (`uv init --lib packages/spatial`) and depend on it from `apps/api` and `packages/agent`.

### AI

```bash
uv init --lib packages/agent && cd packages/agent
uv add anthropic openai google-genai fastmcp pydantic
uv add --dev pytest
# milestone 1: tool registry stub in packages/spatial/tools.py (find_place, get_place_details, plan_route,
#   nearby_amenities, get_closures, create_verification_request) with fixture-backed implementations, plus a CLI chat loop:
#   uv run python -m agent.cli "Can I reach the hall without stairs?"
# milestone 2: SSE event stream matching the schema in stack-decision.md section 1.4; hand to backend to mount at POST /chat.
# milestone 3: evals/: persona configs + deterministic journey runner -> report (JSON + Markdown).
npx ctx7@latest library FastMCP "expose Python functions as MCP tools"   # confirm current API (v4)
```

## 8. Definition of done for a PR

- Lint, types, tests green; screenshot or short clip for UI changes.
- Any new user-visible claim path shows verification status and has a text alternative (a11y).
- New env vars added to `.env.example` and this document.
- OpenAPI/client regenerated if the API changed.
