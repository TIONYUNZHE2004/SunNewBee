# TownshipLens

**A 3D world model of the township that residents and managers can ask anything, and trust the answer.**

Team SunNiuBi · [Sime Darby Property University Hackathon 2026](https://www.simedarbyproperty.com/universityhackathon) ("Township of Tomorrow") · **People** track

TownshipLens turns **City of Elmina** (Shah Alam) into a living 3D model with "lenses" on top. Residents ask how to reach a place ("Can I push a stroller from the mall car park to the playground without stairs?") and get a **verified** step-free route. Managers rehearse "what if the river rises?" and see which paths, facilities and residents get cut off, and where people can evacuate (indicative scenarios, never a forecast). An AI assistant answers only from checked data, says honestly what hasn't been verified, and turns every gap into a ranked task for the township team.

Lenses: **accessibility** (deep), **flood what-if** (deep), **recycling/waste** (thin); data-centre siting is roadmap only. Hero view: CesiumJS + Google photoreal 3D tiles, with a Mapbox lite view and a text/list view.

Site: **whole City of Elmina** in 3D, with deep verified detail at **Elmina Urban Park + Elmina Lakeside Mall frontage**.

| Date | Milestone |
|---|---|
| 23 Oct 2026 | Proposal submission |
| 28 Oct 2026 | Top 10 announced |
| 11 Nov 2026 | Final submission |
| 14 Nov 2026 | Top 10 pitch day |
| 3 Dec 2026 | Final presentation & awards |

## Repository

| Path | What |
|---|---|
| [`docs/`](docs/README.md) | **Knowledge base: start here.** Brief, research, product spec, architecture, team plan, pitch |
| [`reference/`](reference/README.md) | Source notes (tracked); papers and cloned repos are local only: `bash reference/download-papers.sh`, `bash reference/clone-repos.sh` |
| [`apps/web`](apps/web/README.md) | Vite + React SPA: two screens: the map with the assistant (3D / lite map / list) and Tickets, with a day/night theme |
| [`apps/api`](apps/api/README.md) | FastAPI: world-model endpoints, SSE `/chat`, verification requests |
| [`packages/spatial`](packages/spatial/README.md) | World model, routing, flood analytics, the 22 tools |
| [`packages/agent`](packages/agent/README.md) | PydanticAI assistant, answer validator, mock LLM |
| [`packages/api-client`](packages/api-client) | Generated TypeScript client (`pnpm gen`; CI fails on drift) |
| `data/`, `evals/` | Data pipelines (`pnpm data:build`) and the golden questions (`pnpm golden`) |

## Quick start

```bash
cp .env.example .env          # keys are optional; everything works without them
pnpm install && uv sync --all-packages --all-groups
pnpm dev                      # web http://localhost:5173 · API http://localhost:8000/docs
```

With no keys you get the list view and a deterministic mock assistant. To resolve verification
tickets on `/tickets`, set `STAFF_TOKEN` in `.env` to something other than `change-me` (the API
refuses the default with a 503) and paste the same value into the "Staff access" field.

Other commands: `pnpm test` (pytest + vitest), `pnpm lint`, `pnpm gen` (OpenAPI to TS client),
`pnpm golden` (golden questions, mock LLM), `pnpm db:reset` (clear local verification requests and runs before a demo), `pnpm data:build` (rebuild the seed data from OSM and Copernicus; needs network, and the committed seed is already in `data/seed/elmina`),
`pnpm --filter @tl/web e2e` (Playwright; first run `pnpm --filter @tl/web exec playwright install chromium`).
More in [docs/05-team/dev-setup.md](docs/05-team/dev-setup.md).

## The three hero questions

1. **Access:** "Can I push a stroller from Car Park B to the playground without stairs?" A streamed, cited answer; the route is highlighted; unchecked segments are amber and become verification requests for the township team.
2. **Flood (resident):** "Priya uses a wheelchair at Lakeside Mall. If the river rises 3 m, where can she go?" Evacuation centres with their source, honest unknowns, and an "indicative, not a forecast" disclaimer. The assistant never calls anywhere "safe".
3. **Flood (manager):** pick **River +3 m (indicative)** in the map settings and ask where people can go: reachable centres by source, honest unknowns, and an "indicative, not a forecast" note. Staff then check the gaps under **Tickets**.

## Keys (names only; never commit `.env`)

| Variable | Where it is used | Without it |
|---|---|---|
| `OPENROUTER_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL_DEFAULT`, `LLM_MODEL_ESCALATE` | API / agent (server only) | mock assistant |
| `STAFF_TOKEN` | API (server only); resolving verification requests | resolve returns 503 until changed from `change-me` |
| `DATABASE_URL`, `TL_DATA_DIR` | API (server only) | local SQLite; seed data, else the tiny fixture |
| `GOOGLE_MAPS_API_KEY` | browser (public, referrer-restricted): photoreal 3D tiles | 3D uses Cesium OSM, or falls back |
| `CESIUM_ION_ACCESS_TOKEN` | browser (public, referrer-restricted): OSM Buildings, terrain | as above |
| `MAPBOX_ACCESS_TOKEN` | browser (public `pk.` token, URL-restricted): lite map | list view |

See [`.env.example`](.env.example) and [apps/web/README.md](apps/web/README.md#environment-keys).
