# Platform Walking Skeleton: Scaffold Design (v2)

- Status: **draft for review**
- Date: 2026-10-15
- Replaces: [2026-10-14 walking-skeleton (v1)](2026-10-14-walking-skeleton-design.md), superseded by the platform pivot.
- Decisions it builds on: ADR [0007 Cesium](../../00-overview/decisions/0007-3d-engine-cesium.md) · [0008 PydanticAI/OpenRouter](../../00-overview/decisions/0008-agent-harness-pydantic-ai.md) · [0009 platform + lenses](../../00-overview/decisions/0009-township-world-model-platform.md) · [0010 flood HAND scenarios](../../00-overview/decisions/0010-flood-lens-hand-scenarios.md) · [architecture README (canonical names)](../../04-architecture/README.md) · [api-contract](../../04-architecture/api-contract.md) · [world-model-schema § 10](../../04-architecture/world-model-schema.md) · [3d-pipeline](../../04-architecture/3d-pipeline.md).

## 1. Intent

**Outcome:** after `pnpm install && uv sync && pnpm dev`, a teammate opens the app and sees **City of Elmina in 3D** (Google photoreal tiles if a key is set; Cesium OSM Buildings with an ion token; otherwise the list view). Then:
1. **Access lens:** "Can I push a stroller from Car Park B to the playground without stairs?" → a streamed, cited answer; the route glows on the ground; an amber unknown segment; a verification request in the management queue.
2. **Flood lens:** drag the scenario bar to **River +3 m (indicative)** → water polygons rise along the Sungai Subang corridor; walk segments turn red/striped; evacuation centres show reachable/unreachable; the disclaimer banner shows.
3. **Ask:** "Priya uses a wheelchair and is at Lakeside Mall. If the river rises 3 m, where can she go?" → the agent calls `list_evacuation_centres` + `plan_route(scenario_id)` → an answer with source labels, unknowns and the disclaimer; the camera flies to the centre.
4. **Management page:** VR queue + flood briefing for the selected scenario (cut-off places, islands, reachable centres).

All of it works **with zero API keys** (mock LLM, list view), and uses the real 3D and a real OpenRouter model when keys are set.

**What the user decided:** a walking skeleton; real OSM import; OpenRouter with the model set in config/env; the best 2026 harness (→ PydanticAI); a 3D wow on the whole of Elmina; 2 deep lenses + thin waste; People track; commit and push to `main` often.

**Assumptions:** the skeleton proves the seams (contracts, events, intents, tools, pipelines) with real data. Depth comes from the lanes afterwards. Python 3.13 (uv-managed), Node 24, TypeScript 5.9.x (TS 7 risk), Cesium chunk lazy-loaded.

**Success criteria**
1. `pnpm dev`, `pnpm test`, `pnpm lint` work; CI is green.
2. The three hero interactions above work deterministically with `LLM_PROVIDER=mock`.
3. With `OPENROUTER_API_KEY` + `LLM_MODEL_DEFAULT` set, the same flows work with a real model.
4. The data pipelines regenerate the seed data from scratch with one command (`pnpm data:build`).
5. The OpenAPI → TS client is generated and committed; CI fails on drift.

## 2. Repository layout

```
.
├── apps/
│   ├── web/                              Vite 8 + React 19 + TS 5.9 + Tailwind 4
│   │   └── src/
│   │       ├── app/                      shell, routes: / (resident), /manage
│   │       ├── features/
│   │       │   ├── scene/
│   │       │   │   ├── sceneStore.ts     scene-intent bus (zustand), replay recorder
│   │       │   │   ├── styles.ts         status → style mapping shared by all adapters
│   │       │   │   ├── cesium/           CesiumScene (lazy), AccessLayer, FloodLayer, WasteLayer, CameraRig
│   │       │   │   ├── mapbox/           MapboxLite (Standard style, slots)
│   │       │   │   └── list/             ListView (text adapter)
│   │       │   ├── flood/                ScenarioBar, DisclaimerBanner
│   │       │   ├── chat/                 ChatPanel, useChatStream (typed SSE), EvidenceCard, UncertaintyBanner
│   │       │   └── manage/               VerificationQueue, FloodBriefing
│   │       └── lib/                      api client wrapper, profile store, env
│   └── api/                              FastAPI app (uv member)
│       └── src/townshiplens_api/
│           ├── main.py, settings.py, sse.py, store.py (SQLite)
│           └── routes/  health, site, layers, places, routes, scenarios, evacuation, waste, chat, verification, briefings
├── packages/
│   ├── spatial/                          Python (BE): models, loaders, profiles, evaluate, plan_route,
│   │   └── src/townshiplens_spatial/     flood/ (scenario overlay, evacuation analytics), tools.py (10 tools)
│   ├── agent/                            Python (AI): PydanticAI agent, mock FunctionModel, prompts, validate.py, run.py, cli.py
│   └── api-client/                       generated TS client + SSE/scene-intent types
├── data/
│   ├── scripts/
│   │   ├── import_osm.py                 Overpass → base layers for the Elmina envelope (walk network, places, hydrology, buildings)
│   │   ├── build_hand.py                 ASF global HAND (CC0) COG → clip to the flood analysis area
│   │   └── build_scenarios.py            stage_p1m..p5m → water polygons + edge/place flood classes + evac analytics
│   ├── seed/elmina/                      site.json, base/*.geojson, access/overlay.geojson, flood/*.json|geojson, waste/points.geojson
│   └── README.md                         sources, licences (ODbL, CC0, Copernicus), dates, how to rebuild
├── config/profiles/*.yaml                default, stroller, wheelchair, older_adult_rest, drive (+ flood thresholds)
├── evals/golden/*.yaml + run_golden.py   hero questions across lenses (mock + optional real)
├── .github/workflows/ci.yml
├── package.json · pnpm-workspace.yaml · biome.json · tsconfig.base.json
├── pyproject.toml (uv workspace) · .python-version · .env.example · .nvmrc · .pre-commit-config.yaml
└── README.md (quick start)
```

## 3. Data slice (BE lane owns afterwards)

| Script | Does | Output | Fallback if the source fails |
|---|---|---|---|
| `import_osm.py` | Overpass for the envelope `3.150,101.460,3.240,101.530` (split into tiles to avoid 504s): footway/path/pedestrian/steps/crossing, places (amenity/leisure/shop subsets, schools, halls, places of worship, community centres, toilets, shelters), waterways, water bodies; nodes ways into edges; claims from tags → `reported/osm_import` | `base/walk.geojson`, `base/places.geojson`, `base/hydrology.geojson` | Committed snapshot stays usable |
| (hand) `access/overlay.geojson` | Deep-spot demo facts: Car Park B, playground, 2 mall exits, toilet, benches, one ramp `incline_pct: unknown`. Labelled `evidence_type=team_survey_placeholder` | overlay | none |
| `build_hand.py` | Download the ASF HAND COG tile(s) covering the flood analysis area (envelope + downstream Sungai Subang corridor); clip | `flood/hand.tif` (not committed; rebuildable) | Synthetic HAND from the GLO-30 DEM is out of scope; skeleton tests use a tiny fixture raster |
| `build_scenarios.py` | For stages 1–5 m: connected inundation polygons (simplified), `surface_height_m` (stage + river reference height, datum offset placeholder), edge/place flood classes with margin, evacuation reachability + islands per profile | `flood/scenarios.json`, `flood/stage_pNm.geojson` | Same |
| (hand) `waste/points.geojson` | 10 placeholder points marked `unknown` until surveyed | points | none |
| (hand) `flood/evac_centres.geojson` | OSM candidates (auto) + `official_pps` entries backed by news evidence (e.g. Dewan MBSA Matahari, 4 Oct 2024) | centres | none |

`pnpm data:build` runs them in order. **Lane follow-ups (not in the skeleton):** `import_overture.py` (Overture buildings/places) and `build_roads.py` (OSMnx drive graph), as listed in [dev-setup](../../05-team/dev-setup.md). Attribution: OSM (ODbL), ASF HAND (CC0), Copernicus GLO-30 (Copernicus licence) in the UI credits and `data/README.md`.

## 4. Backend slice
- `packages/spatial`: models per schema §2–3 and §10; loads walk graph + places + scenario overlays into memory (NetworkX + Shapely STRtree); `evaluate(…, scenario)`; `plan_route` strict → lenient with `scenario_id`; flood analytics (reachability, islands); **10 tools** with Pydantic I/O returning `{ok, data, evidence[], warnings[]}`. The `drive` profile is defined but only *stubbed* (road graph = BE lane, week 1–2).
- `apps/api`: endpoints per [api-contract v0.2](../../04-architecture/api-contract.md): `/healthz`, `/site`, `/layers/{lens}`, `/graph` alias, `/places`, `/places/{id}`, `/routes`, `/scenarios`, `/scenarios/{id}`, `/scenarios/{id}/affected`, `/evacuation-centres`, `/waste-points`, `/chat` (SSE), `/verification-requests` (+ resolve, `STAFF_TOKEN` header), `/briefings/flood`.
- SQLite (SQLAlchemy 2) for VRs and the question log; seed data read from files.
- Tests: fixture graph (all route statuses), scenario monotonicity (higher stage ⊇ flooded set), "no FAIL edge in a returned route", VR dedupe, API smoke.

## 5. Frontend slice
- **Resident page:** lens toggles (access / flood / waste), profile selector, scenario bar (flood), disclaimer banner, **scene** (Cesium hero → Mapbox lite → list, chosen by available tokens and the user toggle), chat panel (stream, tool chips, evidence cards, uncertainty banner; `scene.intent` → `sceneStore`).
- **Cesium adapter:** photoreal tiles or the OSM Buildings fallback, clamped polylines and billboards, water polygons per scenario, fly-to, credits. **Mapbox adapter:** Standard + GeoJSON layers in slots. **List adapter:** text.
- **Manage page:** VR queue (resolve form) + flood briefing (scenario select → affected lists, islands, centres).
- Tests: vitest (SSE parser, intent reducer, styles mapping), one Playwright smoke (list view: access hero + flood hero via mock).

## 6. AI slice
- PydanticAI agent: `OpenRouterModel(settings.llm_model_default)` or the mock; 10 tools wrapped from `packages/spatial`; `FinalAnswer` output (summary, steps, claims with evidence IDs, `scene_intents`, `scenario_id`, caveats, followups); `@output_validator` → `validate.py` (citations, route caveats, flood rules: disclaimer, no "safe"/"selamat"/"安全", no path depths) → `ModelRetry` (max 2) → template fallback.
- `run_turn()` maps `run_stream_events()` → SSE `text.delta`, `tool.call`, `tool.result`, then from the validated answer `scene.intent`, `citation`, `uncertainty`, `disclaimer`, `verification.requested`, `done`.
- **Mock** `FunctionModel`: scripted for 3 hero questions (access, flood-resident, flood-management) + an "I don't know" path. Default when there's no key.
- CLI `uv run python -m townshiplens_agent.cli "…"`; golden runner with 6 questions (2 per hero + 2 adversarial: "is it safe?", unknown place).

## 7. Tooling and CI
Root scripts: `pnpm dev` (web + api), `pnpm test`, `pnpm lint`, `pnpm gen` (OpenAPI → TS), `pnpm data:build`, `pnpm golden`. CI: pnpm + uv install → lint → typecheck → pytest → vitest → OpenAPI drift → golden (mock) → Playwright (list view). pre-commit: ruff, biome, gitleaks. `.env.example` documents every variable: `OPENROUTER_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL_DEFAULT`, `LLM_MODEL_ESCALATE`, `LLM_OUTPUT_RETRIES`, `VITE_GOOGLE_MAPS_API_KEY`, `VITE_CESIUM_ION_TOKEN`, `VITE_MAPBOX_TOKEN`, `STAFF_TOKEN`, `DATABASE_URL`.

## 8. Out of scope for the skeleton (stubs, owned by lanes later)
The OSMnx drive graph and `drive` routing · resource-constrained rest-point search (the gap is flagged only) · real staff auth · evidence upload · closures UI · water rise *animation* (levels switch; a tween is a stretch) · datum calibration UI (the constant lives in `site.json`) · the full resident-agent runner (deterministic invariants only) · Promptfoo · deploy workflows · multilingual aliases beyond seeds · MET warning banner · MCP server.

## 9. Verification plan
1. `uv run pytest` and `pnpm -r test` green; `pnpm golden` (mock) 6/6.
2. `curl -N` `/chat` for each hero question with the mock provider → the expected event sequence, including `scene.intent` and (flood) `disclaimer`.
3. `pnpm data:build` from a clean checkout reproduces the seed files (allowing for OSM drift).
4. Browser pane: list view with no tokens; Cesium OSM fallback with an ion token if available; the three heroes work; the manage page shows the VR (demand increments) and the flood briefing.
5. Commit and push after each verified step.
