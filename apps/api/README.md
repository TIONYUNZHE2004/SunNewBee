# TownshipLens API

FastAPI service over the spatial world model (`packages/spatial`) and the chat agent (`packages/agent`).

## Run

```bash
uv run uvicorn townshiplens_api.main:app --reload --port 8000
uv run pytest apps/api -q
pnpm gen   # regenerate packages/api-client (openapi.json + schema.d.ts)
```

With no seed data present the API falls back to the tiny test fixture.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | liveness |
| GET | `/site` | site config |
| GET | `/layers/{lens}` | `access`, `flood`, `waste`; `?profile=&scenario_id=`; LineStrings carry `status_for_profile` (ok, unknown, blocked, flooded_likely, flooded_possible); 404 unknown lens |
| GET | `/graph` | alias of `/layers/access` |
| GET | `/places?q=` | find_place; `/places/{id}` 404 if unknown |
| POST | `/routes` | `{from, to, profile, scenario_id}` |
| GET | `/scenarios` | flood scenarios |
| GET | `/scenarios/{id}` | water polygons, `surface_height_m` shifted by `site.scene.datum_offset_m`; 404 |
| GET | `/scenarios/{id}/affected` | `?profile=` |
| GET | `/evacuation-centres` | `?scenario_id=&profile=&near=` |
| GET | `/waste-points` | `?type=&near=` |
| GET | `/verification-requests` | `?status=open` |
| POST | `/verification-requests/{id}/resolve` | header `X-Staff-Token`; `{action: verify, correct or reject, value, note}`; 401 (wrong token), 503 (token not configured), 404, 409 (already resolved), 422 (value missing) |
| GET | `/briefings/flood` | `?scenario_id=&profile=`; centres measured from `lakeside-mall` or the first facility |
| POST | `/chat` | SSE; streams `townshiplens_agent.run.run_turn` events (`LLM_PROVIDER=mock` gives the deterministic assistant); if the agent cannot load it emits `error` + `done` |
| GET | `/schema/chat-event` | docs-only, exports the ChatEvent union |

## Environment (repo-root `.env`)

`TL_DATA_DIR` (default `data/seed/elmina`, falls back to the tiny fixture), `DATABASE_URL` (sqlite; default `.data/<site id>.db`, one file per world), `STAFF_TOKEN` (default `change-me`, which the resolve endpoint refuses with 503; set it), `LLM_PROVIDER`, `OPENROUTER_API_KEY` and model settings (used by the agent).

## Build next

- Real staff auth (replace the shared token), audit trail on resolutions
- Closures (`get_closures` is a stub)
- Evidence upload for VR resolutions
- Deploy to Cloud Run with a persistent database
