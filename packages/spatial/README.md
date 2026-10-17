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
  base/buildings.geojson       # optional; display only (stylised city; never read by routing, evaluation or flood)
  base/trees.geojson           # optional; display only
  base/parks.geojson           # optional; display only
  base/landcover.geojson       # optional; display only (properties: class, source, osm)
  base/signage.geojson         # optional; display only (Point; text, source_url, as_of all required or the API drops the sign)
  base/landmarks.geojson       # optional; display only (Point; id, name, model, building_id, source_url, as_of)
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
runner that ranks data gaps), `twm` (the Township World Model: actions, the pure transition
`apply`, journey rollouts and what-if diffs), `tools` (tool functions and the `TOOLS` registry).

## Township World Model (`twm.py`, Cycle 1 of `ai/world-model`)

The world as a world model in the planning sense:

- **State:** the `World`.
- **Actions:** a closed vocabulary. `SetRiverStage`, `ClosePath`, `BuildRamp`, `AssumeFact` and `VerifyFact`, each gated by `legal()`, which rejects unknown ids, attributes and scenarios.
- **Transition:** `apply(world, actions)` returns a copy-on-write imagined world. Imagined claims and closures are tagged `whatif`, and the live world is never mutated.
- **Rollouts:** `rollout(...)` uses the same `plan_route` and evacuation reachability as everything else.
- **Diff:** `compare(...)` gives counts per status before and after, the journeys that changed (before and after geometry), the touched paths, a deterministic `ev-whatif-…` evidence id, and a `summary`. The summary also carries `reach_stage_only` when a river rise is combined with other changes, so their effects can be told apart.

Honesty rules:
- A river stage only adds FAIL or UNKNOWN, as everywhere else. A test asserts that a stage never upgrades a journey.
- An outcome resting on an imagined change is `whatif=True` ("would be confirmed").

Journey sets:
- `suite_journeys` comes from `sim.default_tasks`; chat uses a 60-journey prefix.
- `evacuation_journeys` comes from `sim.evacuation_origins`; each journey goes to the nearest reachable centre.

Guards (Cycle 1 review):
- What-ifs and plans cover walking profiles only (`twm.WALKING`). A drive what-if took minutes on the seed.
- `build_ramp` needs a path with steps.
- At most 8 actions per request, and stage ids are checked.
- The tools allow at most 2 world-model runs at once per process (`tools._WM_SLOTS`) and keep a 32-entry result cache keyed by world version, so a repeat request returns instantly.
- After-states carry `demo_evidence`, and `summary.confirmed_on_demo_after` counts imagined confirmations that rest on demo values.
- `base_scenario_id` records the stage of the before state.

`suggest_actions` and `keystone_paths` propose legal candidates from the engine (never from the model): ramps where steps block a profile, unknown facts on many journeys, and the paths most journeys rely on.

Speed: rollouts run inside `routing.eval_memo()`, which evaluates each (state, profile, scenario, edge) once per batch. On the Elmina seed:

| Operation | Before the memo | With the memo |
|---|---|---|
| 50-origin evacuation what-if | 7.2 s | about 2.7 s |
| Suggestions | 29.5 s | about 5 s |

## Profiles

`config/profiles/`: `default`, `stroller`, `wheelchair`, `older_adult_rest` and `drive`.
`drive` only uses edges whose `type` is `street`, `track` or `major_road` (`allowed_types`), assumes 30 km/h,
treats a possibly flooded road as FAIL (walking profiles treat it as UNKNOWN), and always adds
its standing warning (one-way and turn restrictions are not modelled; indicative only).

`older_adult_rest` has `max_rest_free_run_m: 100`. Routing first runs a resource-constrained
search over (node, metres since the last rest point). It is label-setting with dominance
pruning, bounded by `MAX_REST_LABELS` (deterministic, not wall-clock).

- **Rest points are tri-state** (`evaluate.rest_point_state`, from the place's own `seating` /
  `shelter` claim):
  - verified present and fresh: counts;
  - verified or reported absent: never counts, and is left out of `rest_points`;
  - no claim (OSM only), unknown, stale, contested or only reported present: counts only in
    the lenient pass.
- A route that keeps the limit only thanks to unverified rest points is at most
  `partly_unverified`, lists them in `rest_points_unverified`, and gets a warning naming them.
  No VRs are filed for them.
- A route within the limit wins over any route that is not, verified or not.
- Only when no route keeps the limit does the router fall back to the usual strict/lenient
  order. That route has `rest_limit_met: false`, is never `confirmed`, and the result warns
  "longest stretch without a rest point is about N m (limit 100 m)" (`rest_gap_text`; N rounded
  to 10 m, never down to the limit). `rest_search_truncated` marks a search that hit the cap.
- Routes carry `rest_limit_m`, `rest_limit_met` and `rest_points_unverified`. `RouteResult`
  (and the `plan_route` tool data) carries `max_rest_gap_m` and `rest_limit_m`. For other
  profiles the limit fields are `None`, but `rest_points` / `max_gap_between_rest_m` count
  shelters too and leave out rest points recorded absent (informational only; routes unchanged).
- In `sim`, I7 fires only when a route claims the limit but breaks it (a routing bug). Each
  journey whose route is over the limit gets one entry in `rest_advisories`
  (`rest_limit_no_alternative`, or `rest_search_stopped_early`), with the number of segments
  longer than the limit. The report's `rest_long_segments` counts those distinct segments across
  the run: a rest point at a node cannot split them.
- The gap ranking includes `sidewalk` (major roads), but on the Elmina seed it is structurally
  empty: a major road carries no `width_m`, `step_count` or `incline_pct` claim, so flipping its
  sidewalk alone never makes a journey `confirmed`. It stays empty until those are surveyed.
- `sim.run_evacuation` runs evacuation journeys: a profile x river-stage table (default, stroller,
  wheelchair, older_adult_rest x baseline, +1, +3, +5 m) for a seeded sample (seed 47, N=50) of
  origins, each to the nearest reachable centre via `flood.centres_reachability`. Places that are
  a centre, or share a centre's node, are excluded (a 0 m journey is not a journey) and counted in
  `origins_excluded_centres`. E1 (a worse river stage never improves a journey) and E2 (baseline
  equals no scenario) are critical violations. `sim.snapshot_world` gives a run one consistent
  view (claims and closures copied, closure time frozen, closure-set hash).

## Route status

| Status | Meaning |
| --- | --- |
| `confirmed` / `partly_unverified` | A route exists; `partly_unverified` crosses UNKNOWN edges |
| `blocked` | The endpoints are connected in the unfiltered graph, but every path is cut by a known FAIL |
| `no_data` | The endpoints are in different graph components (for `drive`: no connecting road, or a place with no mapped road within the snap distance), or a place or profile is unknown. A data gap, never "not reachable" |

A route whose facts include `team_survey_placeholder` evidence carries `demo_evidence: true`
(also on `RouteResult` for `routes[0]`). The status is not downgraded: `confirmed` stays
`confirmed`, and the UI and agent say "confirmed on demo values, not yet surveyed".

`plan_route` files at most 10 verification requests per call (`MAX_ROUTE_VRS`); the overflow is
counted in `verification_requests_truncated`. Flood unknowns never file a VR.

## Tests

```
uv run pytest packages/spatial -q
```

Tests run against the tiny fixture world in `tests/fixtures/tiny`.

## Rising river (`rollout.py`, Cycle 3)

`river_rollout(world, profiles, n=30)` follows synthetic residents (the seeded origin sample of `sim.evacuation_origins`) at every precomputed river stage, each heading for the nearest reachable centre. It returns:
- counts per stage per profile: reach, confirmed, confirmed on demo values, cut off, no mapped connection;
- per resident: the status per stage, the route walked per stage, and the **tipping stage**, the first stage at which they no longer reach a centre;
- the distinct route geometries, deduplicated.

Reach is monotone across stages (a test asserts it).

`tipping_point(world, from_id, profile, to_id=None)` takes one journey across all stages. A start or destination that is likely flooded at a stage breaks the trip there, even if a path to it still exists.

It is a simulation, not a forecast. Stages are labels, never depths, and departure times, warnings, crowding and travel times are not modelled. On the seed it takes about 13 s for 3 profiles × 30 residents × 6 stages, and the tools cache it.

## Fix-it search (`fixit.py`, Cycle 4)

`find_fixes(world, profile, scope, stage, budget<=3, extra_actions)` runs a beam search (width 2) over sets of fix candidates:
- candidates are `build_ramp` / `verify_fact` from `twm.suggest_actions`, capped at 6, plus legal assistant proposals; closures are never candidates;
- each set is scored by one rollout of its imagined world against a "before" computed once (confirmed first, then reach);
- the search has a 20 s time budget, with `stopped_early` set if it runs out;
- it equals exhaustive search on the tiny world (tested).

On the Elmina seed it takes about 10–15 s, and **no candidate pair changes any sampled evacuation journey**, for any persona, at normal level or at +5 m. The binding constraint there is unverified data, which `planner.py` addresses.

## The tools (10 lookups + 6 world-model tools)

| Tool | Purpose |
| --- | --- |
| `find_place` | Fuzzy/alias/CJK-aware place search; unknown queries return `ok` with empty data |
| `get_place_details` | Place record with per-attribute claims and evidence |
| `plan_route` | Route for a profile (optionally under a flood scenario); files verification requests for unknowns |
| `nearby_amenities` | Amenities within walking distance, profile-aware |
| `get_closures` | `(near_place?, active_only=true)`: staff-reported closures ("Reported closure (staff)"); an active one makes its edge FAIL for every profile in `evaluate_edge` |
| `create_verification_request` | Deduplicated verification request, demand increments on repeats |
| `list_flood_scenarios` | Scenarios with disclaimers (indicative, not forecasts) |
| `affected_places` | Likely/possible flooded places and paths, plus isolated components |
| `list_evacuation_centres` | Centres labelled `official_pps` or `osm_candidate`, with reachability from a place |
| `find_waste_points` | Waste/recycling points by type, nearest first when `near_place` given |
| `suggest_interventions` | `(profile, near_place?)`: engine-proposed what-if actions with readable labels (ramps, verifications, keystone paths) and the river stages |
| `plan_verifications` | `(profile, scope, budget)`: verify-next survey plan (planner.py), engine-verified, with open tickets linked |
| `river_tipping_point` | `(from_id, profile, to_id?)`: the status per river stage and the stage where the trip degrades or breaks |
| `rising_river_rollout` | `(profiles?, n=30)`: synthetic residents per stage (rollout.py); counts, the first residents cut off, routes |
| `find_fixes` | `(profile, scope, scenario_id?, budget<=3, proposals?)`: the best set of imagined fixes by beam search on the world model |
| `simulate_what_if` | `(actions, profile, scope=journey\|suite\|evacuation, from_id?, to_id?, scenario_id?)`: what-if diff (summary, counts, changed journeys, `diff_geojson`, `ev-whatif-…` evidence, disclaimer). Never changes the real world |

Flood definitions: an island is a connected component of the passable (non-FAIL) graph for the
profile and scenario that contains no evacuation-centre node. `centres_reachability` registers a
transient place `__centre__<id>` for centres without a place id; `find_place` skips ids starting
with `__`.

## What to build next (BE lane)

- Oneway- and turn-aware drive graph (the `drive` profile reuses the walk extract's street/track/major_road edges).
- Closures: `plan_route` does not say when a closure forced a detour on a route that still exists (it names closures only when they leave no route or close an endpoint place). A closed place does not block routing to or through it.
- Staleness TTL configuration.
- Performance caching keyed by `world.version`.
