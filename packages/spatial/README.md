# townshiplens-spatial

The world model and the deterministic engines behind TownshipLens. It loads a township data
directory into an in-memory `World` (walk graph, places, claims, flood scenarios, evacuation
centres, waste points, accessibility profiles) and exposes 10 tools that the AI agent and the API
call by name through `townshiplens_spatial.tools.TOOLS`. All answers come from these engines;
the LLM never computes routes or flood extents.

## Data-directory contract (used by `load_world()`, the fixtures and the seed)

```
<data_dir>/
  site.json                    # Site (models.Site)
  base/walk.geojson            # LineString features -> models.Edge (properties: id, kind="segment", type, from, to, length_m, name?, claims{})
  base/places.geojson          # Point features -> models.Place (properties: id, kind, type, name, aliases[], node_id, entrance_ids[], claims{})
  base/hydrology.geojson       # optional; display only
  access/overlay.geojson       # same feature shapes as walk/places; an existing id REPLACES, a new id ADDS
  flood/scenarios.json         # models.FloodBundle
  flood/<scenario_id>.geojson  # water polygons: properties {scenario_id, surface_height_m}
  flood/evac_centres.geojson   # Point features -> models.EvacCentre
  waste/points.geojson         # Point features -> models.WastePoint
```

Node IDs (`n-...`) are implicit: an edge's `from`/`to` plus the first/last coordinate of its
LineString define a node and its position. Coordinates are WGS84 `[lon, lat]`.

## Modules

`world` (loader), `models` (pydantic), `profiles` (loads `config/profiles/*.yaml`), `evaluate`
(per-edge PASS/FAIL/UNKNOWN per profile), `routing` (profile- and scenario-aware route search),
`flood` (affected places, islands, evacuation reachability), `vr_store` (SQLite verification
requests), `attributes` (attribute catalogue and value validation), `sim` (resident-agent batch
runner that ranks data gaps), `tools` (tool functions and the `TOOLS` registry).

## Profiles

`config/profiles/`: `default`, `stroller`, `wheelchair`, `older_adult_rest` and `drive`.
`drive` only uses edges whose `type` is `street`, `track` or `major_road` (`allowed_types`), assumes 30 km/h,
treats a possibly flooded road as FAIL (walking profiles treat it as UNKNOWN), and always adds
its standing warning (one-way and turn restrictions are not modelled; indicative only).

`older_adult_rest` has `max_rest_free_run_m: 100`. Routing first runs a resource-constrained
search over (node, metres since the last rest point): a node with a `seating` (benches) or
`shelter` place resets the counter, and no step may run past the limit. It is label-setting with
dominance pruning, bounded by `MAX_REST_LABELS` (deterministic, not wall-clock). A route within
the limit wins over any route that is not, verified or not. Only when no route keeps the limit
does the router fall back to the usual strict/lenient order. The fallback route has
`rest_limit_met: false`, is never `confirmed` (at most `partly_unverified`), and the result
warns "longest stretch without a rest point is about N m (limit 100 m)" (N rounded to 10 m, never
down to the limit). Routes carry `rest_limit_m` / `rest_limit_met`; `RouteResult` (and the
`plan_route` tool data) carries `max_rest_gap_m` / `rest_limit_m`. Other profiles: all `None`.
In `sim`, invariant I7 fires only when a route claims the limit but breaks it (a routing bug);
fallback routes are listed under `rest_advisories` ("over the rest limit, no alternative").

## Route status

| Status | Meaning |
| --- | --- |
| `confirmed` / `partly_unverified` | A route exists; `partly_unverified` crosses UNKNOWN edges |
| `blocked` | The endpoints are connected in the unfiltered graph, but every path is cut by a known FAIL |
| `no_data` | The endpoints are in different graph components (for `drive`: no connecting road, or a place with no mapped road within the snap distance), or a place or profile is unknown. A data gap, never "not reachable" |

`plan_route` files at most 10 verification requests per call (`MAX_ROUTE_VRS`); the overflow is
counted in `verification_requests_truncated`. Flood unknowns never file a VR.

## Tests

```
uv run pytest packages/spatial -q
```

Tests run against the tiny fixture world in `tests/fixtures/tiny`.

## The 10 tools

| Tool | Purpose |
| --- | --- |
| `find_place` | Fuzzy/alias/CJK-aware place search; unknown queries return `ok` with empty data |
| `get_place_details` | Place record with per-attribute claims and evidence |
| `plan_route` | Route for a profile (optionally under a flood scenario); files verification requests for unknowns |
| `nearby_amenities` | Amenities within walking distance, profile-aware |
| `get_closures` | Stub in the skeleton (closures not modelled) |
| `create_verification_request` | Deduplicated verification request, demand increments on repeats |
| `list_flood_scenarios` | Scenarios with disclaimers (indicative, not forecasts) |
| `affected_places` | Likely/possible flooded places and paths, plus isolated components |
| `list_evacuation_centres` | Centres labelled `official_pps` or `osm_candidate`, with reachability from a place |
| `find_waste_points` | Waste/recycling points by type, nearest first when `near_place` given |

Flood definitions: an island is a connected component of the passable (non-FAIL) graph for the
profile and scenario that contains no evacuation-centre node. `centres_reachability` registers a
transient place `__centre__<id>` for centres without a place id; `find_place` skips ids starting
with `__`.

## What to build next (BE lane)

- Oneway- and turn-aware drive graph (the `drive` profile reuses the walk extract's street/track/major_road edges).
- Closures (`get_closures`).
- Staleness TTL configuration.
- Performance caching keyed by `world.version`.
