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

"Staff" means the `X-Staff-Token` header is required: 401 (wrong or missing token), 503 (token not configured; the default `change-me` counts as not configured).

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | liveness |
| GET | `/site` | site config |
| GET | `/profiles` | read-only profile parameters (hard/soft limits, allowed types, speed, `stub`) for the "Assumptions" view |
| GET | `/layers/{lens}` | `access`, `flood`, `waste`; `?profile=&scenario_id=`; LineStrings carry `status_for_profile` (ok, unknown, blocked, flooded_likely, flooded_possible); 404 unknown lens. Sends `ETag` and `Cache-Control: private, max-age=0, must-revalidate`; a matching `If-None-Match` gets 304. The ETag changes when a claim changes (`world.version`) and on API restart |
| GET | `/layers/gaps` | Gap map (Task 42): walk edges and places with `unknown_count`, `stale_count`, `relevant_count`, `unknown_attributes` and open-VR `demand`; `?profile=`. Edge facts are `evaluate.relevant_attributes`; places count the claims they carry. Counts only, no status or verdict. ETag also changes when VR demand changes |
| GET | `/graph` | alias of `/layers/access` (no ETag) |
| GET | `/places?q=` | find_place |
| GET | `/places/{id}` | `?scenario_id=&profile=&near=`; 404 if unknown |
| POST | `/routes` | `{from, to, profile, scenario_id}` |
| GET | `/scenarios` | flood scenarios |
| GET | `/scenarios/{id}` | water polygons, `surface_height_m` shifted by `site.scene.datum_offset_m`; 404 |
| GET | `/scenarios/{id}/affected` | `?profile=`; 404 unknown scenario |
| GET | `/evacuation-centres` | `?scenario_id=&profile=&near=` |
| GET | `/waste-points` | `?type=&near=` |
| GET | `/briefings/flood` | `?scenario_id=&profile=`; centres measured from `lakeside-mall` or the first facility |
| GET | `/verification-requests` | `?status=` (default `open`; `all` returns every status), `&reason=&element_id=&attribute=`; each row adds the claim's `current_value` |
| POST | `/verification-requests` | staff; `{target_id, attribute, reason}`; sanitised with `safe_vr_args` (source `staff`), deduped against the open VR (demand + 1); 503 if the store is unavailable |
| GET | `/closures` | public; `?active=true` (default: in force now) or `false` (ended or not started); every row is a staff report (`source_label` "Reported closure (staff)") |
| POST | `/closures` | staff; `{element_id, reason: works/event/flooding/other, starts_at?, ends_at?, note?}`; 404 unknown element, 422 end not after start; audit row `closure:create` |
| POST | `/closures/{id}/end` | staff; ends it now; 404, 409 (already ended); audit row `closure:end` |
| POST | `/verification-requests/{id}/resolve` | staff; `{action: verify, correct or reject, value, note, evidence_id}`; `verify` without a value confirms the current value; `evidence_id` (from `POST /evidence`) attaches a photo to the claim and is refused on `reject`; 404, 409 (already resolved), 422 (value missing, unknown or rejected `evidence_id`, type mismatch) |
| PATCH | `/elements/{id}/attributes/{key}` | staff; `{value, status: verified, unknown or reported, source_type, note}`; writes an audit row; 404, 422 |
| GET | `/audit` | staff; `?element_id=&limit=` (1 to 1000, default 200) |
| GET | `/kpis` | `open_vrs`, `median_hours_to_resolve`, `journeys_confirmed_pct` (from the latest simulation run) |
| POST | `/evidence` | staff; multipart `file` (JPEG or PNG, max 5 MB; type by magic bytes, EXIF/GPS/text chunks stripped); returns `{evidence_id, photo_url}`; 413, 415, 422 |
| GET | `/evidence/{id}` | the stored photo (`nosniff`, restrictive CSP); 404 unknown id |
| POST | `/simulations` | staff; `{scenario_id, profiles}` runs the resident-agent journey tests and stores the report; 422 unknown scenario |
| GET | `/simulations` | recent run summaries, `?limit=` (1 to 50, default 5) |
| GET | `/simulations/{run_id}` | full report (counts, results, ranked data gaps, invariant violations); 404 |
| POST | `/chat` | SSE; streams `townshiplens_agent.run.run_turn` events (`LLM_PROVIDER=mock` gives the deterministic assistant); if the agent cannot load it emits `error` + `done` |
| GET | `/schema/chat-event` | docs-only, exports the ChatEvent union |

## Environment (repo-root `.env`)

`TL_DATA_DIR` (default `data/seed/elmina`, falls back to the tiny fixture), `DATABASE_URL` (sqlite; default `.data/<site id>.db`, one file per world, shared by the VR, audit and simulation stores), `EVIDENCE_DIR` (default `.data/evidence`, flat directory of random-hex photo files), `STAFF_TOKEN` (default `change-me`, which staff endpoints refuse with 503; set it), `LLM_PROVIDER`, `OPENROUTER_API_KEY` and model settings (used by the agent). `pnpm db:reset` deletes the local `.db` files (stop the API first).

## Build next

- Real staff auth (replace the shared token)
- Deploy to Cloud Run with a persistent database
