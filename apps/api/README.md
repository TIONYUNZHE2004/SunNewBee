# TownshipLens API

FastAPI service over the spatial world model (`packages/spatial`) and the chat agent (`packages/agent`).

## Run

```bash
uv run uvicorn townshiplens_api.main:app --reload --port 8000
uv run pytest apps/api -q
pnpm gen   # regenerate packages/api-client (openapi.json + schema.d.ts)
```

With no seed data present the API falls back to the tiny test fixture.
An existing world with ambiguous IDs, invalid edge lengths or inconsistent routing geometry
fails to load; it does not silently switch to the tiny fixture or return a route over malformed data.

Road-section and access-layer `sidewalk_status` describe usable verification: undated or
valueless verified claims become `unknown`, and expired claims become `stale`. Raw claims
and evidence retain their audit status. An undated positive sidewalk cannot confirm a route;
an undated rest stop can support only a `partly_unverified` journey that names the unchecked stop.

When no route meets a profile's rest limit, `/routes` recommends the route with the smallest
longest stretch without rest, then the lowest route weight. `/journeys` uses that same route.
The response still reports the exceeded limit and caps the route at `partly_unverified`.

## Endpoints

"Staff" means the `X-Staff-Token` header is required: 401 (wrong or missing token), 503 (token not configured; the default `change-me` counts as not configured).

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | liveness, plus `world_model`: the background warm-up's state (`warming` / `warm`), timings and world version |
| GET | `/site` | site config |
| GET | `/profiles` | read-only profile parameters (hard/soft limits, allowed types, speed, `stub`) for the "Assumptions" view |
| GET | `/layers/{lens}` | `access`, `flood`, `waste`; `?profile=&scenario_id=`; LineStrings carry `status_for_profile` (verified, likely_ok, unknown, blocked, not_a_road, flooded_likely, flooded_possible), plus access_level, rule_id and tags_used; crossing edges also carry `crossing` / `crossing_status` (the marking claim, display only: zebra stripes are drawn only where it is `marked`); 404 unknown lens. Sends `ETag` and `Cache-Control: private, max-age=0, must-revalidate`; a matching `If-None-Match` gets 304. The ETag changes when a claim changes (`world.version`) and on API restart |
| GET | `/layers/gaps` | Gap map (Task 42): walk edges and places with `unknown_count`, `stale_count`, `relevant_count`, `unknown_attributes` and open-VR `demand`; `?profile=`. Edge facts are `evaluate.relevant_attributes`; places count the claims they carry. Counts only, no status or verdict. ETag also changes when VR demand changes |
| GET | `/layers/street_furniture` | Display-only street furniture for the stylised city (B-T7): `{furniture, as_of, attribution}`, one Point per OSM traffic signal, bus stop, shelter, bench or picnic table inside the outline plus seed seating/shelter places that coincide with none (`source: seed_place`). Only features with a source `id`, a known `kind` and a finite Point are served. 404 when the world has no `base/street_furniture.geojson`, 502 when unreadable; ETag like `/layers/buildings`. Routing, evaluation and answers never read it |
| GET | `/graph` | alias of `/layers/access` (no ETag) |
| GET | `/places?q=` | find_place |
| GET | `/places/{id}` | `?scenario_id=&profile=&near=`; 404 if the place or scenario is unknown, 422 for an unknown profile |
| POST | `/routes` | `{from, to, profile, scenario_id}`; plans only, never files verification requests (the chat and staff do) |
| POST | `/journeys` | `{from_id, to_id, profile, start_time, scenario_id?}` → `JourneyPlan` (spatial `build_journey`) for the recommended route, planned per request like `/routes` (no route store; files no verification requests). Equals the plan the chat attaches to `journey.play` for the same endpoints, profile, scenario and start time (AC-D4). 422 unknown profile or bad `start_time` (`HH:MM`); 404 unknown place (not in `world.places`, nor a `__centre__<id>` target) or scenario; 409 with a bare `NoJourney` body `{route_status, message, warnings}` (top level, no `detail` wrapper) when there is no route: `no_data` → "No mapped connection (data gap)" (never "blocked"), `blocked` → a known barrier cuts every path; 500 with a named message when an event lacks route evidence (`JourneyEvidenceError`) |
| GET | `/scenarios` | flood scenarios |
| GET | `/scenarios/{id}` | water polygons, `surface_height_m` shifted by `site.scene.datum_offset_m`; 404 |
| GET | `/scenarios/{id}/affected` | `?profile=`; existing fields plus uncapped `flooded_places` / `cut_off_places` (`id`, `name`, `type`, `lonlat`) and `flooded_path_m`; 404 unknown scenario |
| GET | `/evacuation-centres` | `?scenario_id=&profile=&near=` |
| GET | `/waste-points` | `?type=&near=` |
| GET | `/briefings/flood` | `?scenario_id=&profile=`; centres measured from `lakeside-mall` or the first facility |
| GET | `/verification-requests` | `?status=` (default `open`; `all` returns every status), `&reason=&element_id=&attribute=`; each row adds the claim's `current_value`; a resolved row's `resolution` omits the staff `note` (kept in `GET /audit`) |
| POST | `/verification-requests` | staff; `{target_id, attribute, reason}`; sanitised with `safe_vr_args` (source `staff`), deduped against the open VR (demand + 1); 503 if the store is unavailable |
| GET | `/closures` | public; `?active=true` (default: in force now) or `false` (ended or not started); every row is a staff report (`source_label` "Reported closure (staff)") |
| POST | `/events/simulate` | public; `{name, segment_ids, starts_at, ends_at, profiles?}`; deterministic before/after sample trips, detour roads and numbered suggestions; no writes; 422 invalid input, 503 solver busy |
| POST | `/events` | staff; `{name, segment_ids, starts_at, ends_at}`; 201 `{event, closures}`; atomically stores named staff course closures, audit `event:create`; 422 invalid course/window |
| POST | `/closures` | staff; `{element_id, reason: works/event/flooding/other, starts_at?, ends_at?, note?}`; 404 unknown element, 422 end not after start; audit row `closure:create` |
| POST | `/closures/{id}/end` | staff; ends it now; 404, 409 (already ended); audit row `closure:end` |
| POST | `/verification-requests/{id}/resolve` | staff; `{action: verify, correct or reject, value, note, evidence_id}`; `verify` without a value confirms the current value; `evidence_id` (from `POST /evidence`) attaches a photo to the claim and is refused on `reject`; 404, 409 (already resolved), 422 (value missing, unknown or rejected `evidence_id`, type mismatch) |
| PATCH | `/elements/{id}/attributes/{key}` | staff; `{value, status: verified, unknown or reported, source_type, note}`; writes an audit row; 404, 422 |
| GET | `/audit` | staff; `?element_id=&limit=` (1 to 1000, default 200) |
| GET | `/kpis` | `open_vrs`, `median_hours_to_resolve`, `journeys_confirmed_pct` (share of the latest simulation run's journeys that are `confirmed`; `partly_unverified` is not counted, and the run may be for any scenario; public, counts only) |
| POST | `/evidence` | staff; multipart `file` (JPEG or PNG, max 5 MB; type by magic bytes, EXIF/GPS/text chunks stripped); returns `{evidence_id, photo_url}`; 413, 415, 422 |
| GET | `/evidence/{id}` | the stored photo (`nosniff`, restrictive CSP); 404 unknown id |
| POST | `/simulations` | staff; `{scenario_id, profiles}` starts the journey tests (plus evacuation journeys) in a background thread and returns `202 {run_id, status: "queued"}` with a `Location` header. One run at a time per world: a second POST while one is queued or running returns `409 {detail, run_id}` with the running id. 422 unknown scenario. A run has a total time budget (`SIM_TIME_BUDGET_S`, default 600 s); when it runs out the run ends as `timeout` with no report |
| POST | `/simulations/{run_id}/cancel` | staff; stops a queued or running run: it ends `cancelled` at once (the worker stops at its next journey) and the slot is free again; 404 unknown, 409 already ended (body is the run) |
| GET | `/simulations` | recent run summaries, `?limit=` (1 to 50, default 5) |
| GET | `/simulations/{run_id}` | `{run_id, status: queued\|running\|done\|failed\|cancelled\|timeout, progress, error, report}`; `report` only when `done`, persisted in the per-world SQLite store (a run active at a restart is marked `failed`). The report holds (counts, results, ranked data gaps, invariant violations, one `rest_advisories` entry per older-adult journey over the rest limit, `rest_limit_m`, `rest_long_segments` = distinct segments longer than the limit on those routes, and `evacuation`: a profile x river-stage table of results from a seeded sample of 50 origins to the nearest reachable evacuation centre, centres themselves excluded from the origins and counted in `origins_excluded_centres`, with E1 and E2 violations, also listed in `invariant_violations`. E1: a journey blocked at a lower river stage is never confirmed at a higher one, and a stage with no confirmed or no reachable centre never gains one at the next; the nearest-centre result itself may improve when a nearer centre floods. E2: baseline equals no scenario. `blocked_by_flood` means a known FAIL cuts every path: a flood class, or at baseline a known barrier. The run works on a snapshot taken at its start (claims, closures and the clock frozen); the report records `world_version` and `closure_hash`. Interrupted runs are marked failed once at app startup); 404 |
| POST | `/chat` | SSE; streams `townshiplens_agent.run.run_turn` events (`LLM_PROVIDER=mock` gives the deterministic assistant); if the agent cannot load it emits `error` + `done` |
| GET | `/schema/chat-event` | docs-only, exports the ChatEvent union |
| POST | `/what-if` | public; `{actions, profile, scope: journey\|suite\|evacuation, from_id?, to_id?, scenario_id?}`. A Township World Model diff on a copy of the world: `summary`, `counts_before` / `counts_after`, `changed`, `diff_geojson` (all features tagged `whatif`), `evidence_id`, `disclaimer`. 422 for illegal or invented actions. Nothing is stored |
| GET | `/verify-next` | public; `?profile=&scope=suite\|evacuation&budget=1..40`. A survey plan (planner.py): which unchecked facts to verify first, with the engine-verified count of journeys that would be confirmed if they pass, and open tickets linked |
| GET | `/belief` | public; the planner's Beta belief per (path type, attribute), with its sources (OSM prior observations, real staff verifications). Planning only |
| GET | `/river-rollout` | public; `?profiles=&n=5..50`. Synthetic residents per persona at every river stage, with routes for the 3D animation; cached by world version (the first call on the seed takes about 15 s). A simulation, not a forecast |
| GET | `/what-if/suggestions` | public; `?profile=&near_place=`. Engine-proposed legal actions with readable labels, plus the river stages; 422 unknown profile or place |

Scenario/profile selections on routes, access/flood layers, the graph alias, place details,
evacuation centres and flood briefings are validated before calculation: unknown scenarios
return 404; unknown profiles return 422. A malformed selection never falls back to baseline.

Route results and evacuation reachability include destination flood checks. Likely flooded
destinations block a connected journey; possible destinations cap walking at `partly_unverified`
and block driving. Flood at the origin is named in warnings and evidence so a resident can
ask about leaving; it does not independently block or cap the route. Disconnected data
remains `no_data`. Explicit raster coverage gaps at either endpoint or on paths cap
river-stage routes at `partly_unverified`, while baseline remains unchanged. Access/flood
LineStrings expose `flood_coverage: uncovered|partial` with unknown status where applicable;
coverage gaps do not create a flood class.

Routes also report mapped walking geometry: `sidewalk_m`, `road_m` (street/major-road
centre lines), `road_without_mapped_sidewalk_m`, and `road_sections` (segment id,
name, metres and sidewalk claim/status). A missing, stale, contested or explicitly
absent sidewalk claim contributes to the last count. These fields describe the mapped
route, not verified sidewalk access, and do not change the route's passability status.
The access layer preserves `type: sidewalk` and includes `sidewalk`/`sidewalk_status`
on street/major-road lines. Walking searches prefer mapped walking paths within each
strict/lenient search; returned distance/time remain based on physical length.

## Environment (repo-root `.env`)

`TL_DATA_DIR` (default `data/seed/elmina`, falls back to the tiny fixture), `DATABASE_URL` (sqlite; default `.data/<site id>.db`, one file per world, shared by the VR, audit and simulation stores), `EVIDENCE_DIR` (default `.data/evidence`, flat directory of random-hex photo files), `SIM_TIME_BUDGET_S` (default 600, total seconds before a simulation run ends as `timeout`), `STAFF_TOKEN` (default `change-me`, which staff endpoints refuse with 503; set it), `LLM_PROVIDER`, `OPENROUTER_API_KEY` and model settings (used by the agent). A relative `DATABASE_URL` path is resolved against the repo root. Rows in an old `.data/townshiplens.db` (the pre-per-world default) are not read any more; copy or delete the file. `pnpm db:reset` deletes the local `.db` files (stop the API first).

## Build next

- Real staff auth (replace the shared token)
- Deploy to Cloud Run with a persistent database

## World-model warm-up (Cycle 9)

`warm.py` starts one daemon thread from the lifespan (`WARM_WORLD_MODEL=true`, the default; tests set it to false). The thread computes the screens' default requests through the same cached tool functions as the endpoints, so the cache keys match:

- `GET /river-rollout`;
- `GET /what-if/suggestions` for wheelchair;
- `GET /verify-next` with wheelchair / evacuation / 15.

It warms again whenever `world.version` changes (it polls every 10 s). It takes the same two solver slots as requests, and a failing job is logged and skipped. `/verify-next` now goes through the cached `tools.plan_verifications`, so a busy solver returns 503.


Access estimates use the spatial rules documented in `packages/spatial/README.md`.
Routes add `likely_ok`, per-segment rule metadata, and `access_metres` in metres.
These estimates are never checked facts. Driving non-roads are grey `not_a_road` lines.

The access-layer cache and ETag include the current date, so expiry of a staff check cannot retain a previous day's Verified label or return 304 for expired data. The chat SSE `route_status` enum includes `likely_ok` for map-derived access estimates; generated API-client schemas must include this value.

Driving routes respect mapped one-way directions, mode overrides and roundabout direction
where source tags are present. A connected graph cut by forbidden traversal is `blocked`
with a reported OSM `oneway` reason/evidence; a disconnected road graph remains `no_data`.
Conditional/changing directions remain unknown with a warning. Legal turn restrictions and
missing directional source coverage remain unmodelled, so driving remains indicative.

Route `maneuvers` are deterministic directions along the selected graph path. Each step has a 1-based index, action, metres to the next step, initial true-north bearing (degrees, or null for directionless geometry), exact mapped street name (or null), mapped edge type, access level/rule, ordered segment IDs and a `[longitude, latitude]` point. Distances use physical edge lengths. Turns use oriented incoming/outgoing local tangents: under 20 degrees continues, 20 to under 60 is slight, 60 through 150 is a turn, above 150 is a U-turn. Continues merge only when name, type, access level and rule match. A straight entry into a mapped crossing uses `cross`; a turning entry retains its turn action and crossing type. No crossing control or destination side is inferred. `arrive` covers zero metres and no segments; a zero-edge route has only `arrive`. Results without a route have no steps. Every real turn is returned, including on long routes; answer summaries must disclose omitted steps. Driving remains indicative because legal turn restrictions are not modelled.

Different places that share one graph node remain `partly_unverified` when a place entrance is explicitly inferred and lacks a mapped entrance or usable real staff access-point verification. Zero mapped metres do not prove that entrance connection. The gap appears in `unknowns` as `access_point`, with the normal evidence and verification-request behavior. Same-place queries, canonical centre/place aliases, explicit mapped entrances and fresh staff checks retain their existing behavior. Evacuation-centre rows use the same zero-edge rule.

Rest-stop availability uses active place closures and the selected flood scenario, as well as
seat/shelter claims. A closed or scenario-FAIL stop cannot satisfy the rest-distance limit.
Possible flood or missing raster coverage keeps a stop unverified, with existing rest and flood
warnings/evidence. The route and evacuation-centre responses share this rule.

River scenarios are baseline and +1/+2/+3 m only. Disclaimers state that flash floods
from heavy rain are not shown. Impact markers distinguish likely-flooded places from
non-flooded places with no mapped non-FAIL path to an available centre. Missing entrances
are data gaps and omitted. Existing flood-island fields keep their flood-induced meaning.

Event timestamps accept ISO offsets (naive values are UTC, like closures); the window
is start-inclusive and end-exclusive. `POST /events` persists the event name and window
on every segment closure. These load again after restart and resident route warnings
name the event. Public closure rows expose `event_name`; staff notes remain private.
Individual course closures can be ended through the existing closure endpoint.

Event simulation defaults to walking, wheelchair and driving, with the same bounded
everyday sample before and after. Responses include trip rows/statuses, per-profile
counts, all/new no-route counts, reroute-only median extra metres/minutes, newly
cut-off mapped places, ranked detour roads, and rule-based suggestions with numeric
bases. The disclaimer is “Estimate from mapped roads and sample trips, not traffic
counts.” Other closures are assessed at the start, rather than across the entire
window. There is no traffic, crowd or queue model. The spatial README defines each
metric and the 300-trip/40-segment request bounds.
