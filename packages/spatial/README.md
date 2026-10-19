# townshiplens-spatial

The world model and the deterministic engines behind TownshipLens. It loads a township data
directory into an in-memory `World` (walk graph, places, claims, flood scenarios, evacuation
centres, waste points, accessibility profiles) and exposes 10 tools that the AI agent and the API
call by name through `townshiplens_spatial.tools.TOOLS`. All answers come from these engines;
the LLM never computes routes or flood extents.

Place existence has provenance too (`Place.claims.existence`). A placeholder existence claim
keeps `team_survey_placeholder` on name evidence from search, details and nearby amenities.
Amenities expose `demo_place`, `existence`, `source_label`, and `via_unverified: true` for demo
places. Route tool responses retain endpoint/rest-place evidence and demo metadata without
changing the engine's status, selection or distance. MCP receives the same evidence and warnings.

## Data-directory contract (used by `load_world()`, the fixtures and the seed)

```
<data_dir>/
  site.json                    # Site (models.Site)
  base/walk.geojson            # LineString features -> models.Edge (properties: id, kind="segment", type, from, to, length_m, name?, claims{})
  base/places.geojson          # Point features -> models.Place (properties: id, kind, type, name, aliases[], node_id, entrance_ids[], claims{})
  base/hydrology.geojson       # optional; display only
  base/buildings.geojson       # optional; display only (stylised city; never read by routing, evaluation or flood). height_m is OSM/archetype/default (Cesium); display_height_m may be a Google sample (Three.js only)
  base/trees.geojson           # optional; display only
  base/parks.geojson           # optional; display only
  base/landcover.geojson       # optional; display only (properties: class, source, osm)
  base/signage.geojson         # optional; display only (Point; text, source_url, as_of all required or the API drops the sign)
  base/landmarks.geojson       # optional; display only (Polygon: the matched building footprint; id, name, model, building_id, source_url, as_of)
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
its standing warning (mapped one-way tags applied; legal turn restrictions and changing
directions remain unmodelled; indicative only). Direction is relative to the original OSM
edge orientation: `yes/1/true` is forward, `-1` is reverse, and `no/0/false` allows both.
Motorcar/motor-vehicle/vehicle overrides take priority; a mapped roundabout implies forward
unless overridden. These vehicle rules do not restrict pedestrian profiles. Search choices
are keyed by ordered nodes, so opposite parallel carriageways cannot exchange segment IDs.
Unsupported or conditional directions remain unknown estimates with a warning.
See [the OSM direction contract](https://wiki.openstreetmap.org/wiki/Key:oneway).

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

## Access estimates (T-020)

`access.assess_access` adds a map-derived level without rewriting factual
`evaluate_edge` PASS/FAIL/UNKNOWN. `Edge.osm_tags` retains the importer inputs.
All levels carry a stable `rule_id` and `tags_used`; urban estimates add context metadata.

| Mode / basis | Level and rule |
| --- | --- |
| Current staff survey, all relevant facts verified, `verified_by` present, no demo/OSM/what-if source | `verified`, `staff_verified_v1` |
| Sidewalk, crossing, pedestrian infrastructure | `likely_ok`, `pedestrian_infrastructure_v1` |
| Strict walking: paved path / OSM wheelchair=yes | `likely_ok`, `paved_path_v1` / `osm_wheelchair_yes_v1` |
| Strict walking: footway/ramp, every vertex within 60 m of OSM residential centreline | `likely_ok`, `urban_footway_v1` |
| Default walking: mapped path, footway, ramp or steps | `likely_ok`, `mapped_path_walking_v1` / `mapped_steps_walking_v1` |
| Default walking: local street | `likely_ok`, `local_road_walking_v1` |
| Road with mapped sidewalk | `likely_ok`, `mapped_road_sidewalk_v1` |
| Driving: street/major road, or paved track | `likely_ok`, `mapped_road_driving_v1` |
| Driving: footway, sidewalk, crossing, path and other non-roads | `not_a_road`, `driving_nonroad_v1` |

Strict modes are wheelchair, stroller and older-adult-rest. Rough/unknown rural paths,
unpaved tracks, missing road sidewalks, ambiguous incline/width tags, stale/contested
relevant claims and restricted permissions do not support an estimate. Explicit OSM mode
`no`, known physical barriers, active closures and flood FAIL always block routing.
A specific permission overrides generic access (for example `foot=yes` over `access=no`).
Possible flood and raster gaps cap an estimate at unknown; driving treats possible flood
as a barrier. Non-road driving map lines stay grey, including under a flood overlay.

The 60 m urban rule is a **proxy assumption**, using local metre projection and source
vertices. It does not establish a built-up boundary, sidewalk, width, slope or surveyed
passability. Decorative buildings and renderer geometry are never inputs.

Route segments expose `access_level`, `rule_id`, `tags_used` and the unchanged factual
`eval`. `Route.access_metres` totals traversal metres for all five levels, rounded to 0.1 m.
An estimated segment can have `eval=UNKNOWN`; those missing facts remain in `unknowns`.
A route covered by verified facts/estimates is `likely_ok` when any segment is estimated.
Uncovered unknowns, endpoint scenario uncertainty or unmet rest constraints make it
`partly_unverified`. Search penalises estimates 1.4× and uncovered unknowns 5×.
`route_access_estimate` evidence is **reported**, with source
`map-derived estimate (not checked on site)`; it contains rules and per-level metres.
Never describe estimates as checked, verified, safe or confirmed.

Legacy worlds without raw OSM provenance retain factual routing and explicit demo flags;
they receive no map estimate and no Verified layer label. Existing confirmed demo routes
still require the mandatory demo-value caveat. This preserves tiny-fixture semantics.

Reproduce seed counts with `uv run python data/scripts/audit_access.py`.
The before/after report is `data/audits/2026-10-18-t020-access.json`.

## Route status

| Status | Meaning |
| --- | --- |
| `confirmed` / `likely_ok` / `partly_unverified` | A route exists; `likely_ok` uses map estimates; `partly_unverified` has uncovered unknowns |
| `blocked` | The endpoints are connected in the unfiltered graph, but every path is cut by a known FAIL |
| `no_data` | The endpoints are in different graph components (for `drive`: no connecting road, or a place with no mapped road within the snap distance), or a place or profile is unknown. A data gap, never "not reachable" |

Flood-scenario routing checks the destination as well as paths. A likely flooded
destination blocks a connected journey; a possible destination makes a walking route at most
`partly_unverified` (it blocks driving). Origin flood classes remain evidence and named
warnings so a resident can ask about leaving a flooded place. They do not block or cap a
route on their own. Explicit raster coverage gaps at either endpoint still cap scenario
certainty at UNKNOWN. Disconnected endpoints remain `no_data`. These checks
also apply to every evacuation-centre row, including zero-distance journeys and centres
outside the nearest three route previews.

`load_world()` reads explicit `uncovered_edges`, `partial_edges` and `uncovered_places` from
`flood/coverage.json` into `world.flood.coverage`. Under a river-stage scenario, those elements
are UNKNOWN unless another rule already makes them FAIL. Baseline is unchanged. Coverage
evidence uses `attribute: flood_coverage`, `value: uncovered|partial`, and `status: unknown`;
it never invents a flood class or files a survey ticket. Route `unknowns` can refer to endpoint
places as well as segments. Known origin and destination flood classes have their own scenario evidence.

Unknown scenario/profile selections are rejected by the resident tools (`ok: false`, no data,
evidence or ticket writes). Direct `routing.plan_route` returns `no_data` with an explicit
selection error and no route. A nonexistent scenario is never treated as baseline.

A route whose facts include `team_survey_placeholder` evidence carries `demo_evidence: true`
(also on `RouteResult` for `routes[0]`). The status is not downgraded: `confirmed` stays
`confirmed`, and the UI and agent say "confirmed on demo values, not yet surveyed".

`nearby_amenities` excludes candidates with active staff-reported place closures and
returns their named closure warnings and reported closure evidence. Expired or upcoming
closures do not remove a candidate. Staff free-text notes never reach the tool output.

`plan_route` files at most 10 verification requests per call (`MAX_ROUTE_VRS`); the overflow is
counted in `verification_requests_truncated`. Flood unknowns never file a VR.

## Sidewalks and road geometry (T-014)

The importer preserves `highway=footway, footway=sidewalk` as edge type `sidewalk`,
and reads explicit `sidewalk=*` claims on both ordinary streets and major roads.
These remain reported OSM data. A sidewalk's type alone never verifies width, steps,
incline or access. Road and sidewalk lines connect only at their mapped graph nodes;
proximity never invents a connection or a road-sidewalk association.

Walking searches multiply street/major-road costs by 1.25 to prefer a modestly longer
mapped walking path. This preference applies within each strict/lenient search; a
confirmed route still wins over a route needing unknown facts. Distance and time use
actual segment lengths, and driving costs and evaluation rules are unchanged.

Each route exposes `sidewalk_m` (separate sidewalk edges), `road_m` (street/major-road
edges), and `road_without_mapped_sidewalk_m` (road edges without a fresh reported or
verified positive sidewalk claim). All are metres, rounded to 0.1 m. An explicit
`none`, missing, stale or contested claim contributes to the last count. A positive
`separate` tag records a sidewalk elsewhere; it does not imply the route uses it.
`road_sections` lists each traversed road segment's id, name, length, sidewalk value
and claim status. Road distance is counted per traversal, including repeated edges.

Walking route warnings highlight road distance without a mapped sidewalk. These are
geometry caveats, not a passability upgrade, downgrade or new survey ticket. Derived
`route_walkways` evidence carries the composition and road sections with status
`reported` and source `mapped walk graph (not a sidewalk survey)`. Resident answers
should name these road stretches and retain their uncertainty even on a confirmed route.

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

## Elmina Day (`day/`, Cycles 10–21)

A time-stepped rehearsal of 5,000 synthetic residents on the world model. It is a rehearsal, not a forecast, and the residents are not real people.

| Module | What it does |
| --- | --- |
| `population.py` | Residents in real OSM homes, from DOSM shares plus stated assumptions (`SOURCES`) |
| `schedule.py` | Rule-written daily plans: commutes, school runs (a child aged 7–12; `PRIMARY_AGE`), prayers, the clinic, an event |
| `router.py` | Fast routing on per-(persona, stage) cost arrays with a shared distance-field LRU |
| `engine.py` | `Day.run()` moves every trip minute by minute: river stages, closures, re-planning when the water changes on the way, waiting, turning back. `Day.travel()` runs one trip. Each `Day` has a `lock` (its routers are shared caches) |
| `summary.py` | Groups, school, timeline, places, health, tracks, and the calibration rows shown in the Day panel |
| `spotlight.py`, `voices.py` | 40 spotlight residents whose recorded AI lines are kept only while they still match their own trip |
| `compare.py` | Test a change: the same day with an imagined change, trip by trip (better or worse off by group) |
| `myday.py` | Rehearse my trip: a resident's own trip at a time and every 10 minutes around it (outcome, the flooded street that cut it, when the way came back), from place ids or a tapped point |

Calibration against official open data for Petaling district (DOSM, MOE): `data/scripts/calibrate_day.py` and `docs/03-product/calibration-report-2026-10.md`.

## The tools (10 lookups + 6 world-model tools + 3 Elmina Day tools)

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
| `day_rehearsal` | `(day)`: one rehearsed day summarised (trips by outcome, residents by group, school, busiest places, `show_at`) |
| `day_test_change` | `(day, option)`: one of the day's own suggested changes, compared before and after (residents better and worse off by group); the change comes from the server's list |
| `rehearse_my_trip` | `(from_id\|from_point, to_id\|to_point, profile, leave_at, day)`: a resident's own trip through the rehearsed day, with a departure sweep; tapped points are never stored |
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

Correctness audit follow-up: explicit OSM `smoothness=impassable` blocks wheeled modes before positive estimates ([OSM definition](https://wiki.openstreetmap.org/wiki/Key:smoothness)); it does not create a pedestrian prohibition. Adverse smoothness keeps strict-mode and driving estimates unknown. A staff claim without `verified_at` cannot support a checked PASS. Evacuation rows beyond the route-preview limit apply the older-adult rest-gap constraint. `nearby_amenities` accepts optional `scenario_id`; it evaluates scenario edges and destination flood classes, excludes flooded destinations, and warns about flooded origins. Its existing row shape stays unchanged.

The optional `find_place(..., near_place=<place id>)` argument restricts name/type candidates to a straight-line 1 km context. An invalid origin returns `ok=false`. Proximity establishes identity context only; `plan_route` remains the authority for routes, distance, mode and river effects.

Ticket impact counts a resolved staff check only while its value and verification date remain usable under the evaluation TTL. Undated, expired or valueless checks do not count as completed impact; an open ticket can still preview a fresh check. Demo and what-if evidence remain excluded.

Route `maneuvers` are deterministic directions along the selected graph path. Each step has a 1-based index, action, metres to the next step, initial true-north bearing (degrees, or null for directionless geometry), exact mapped street name (or null), mapped edge type, access level/rule, ordered segment IDs and a `[longitude, latitude]` point. Distances use physical edge lengths. Turns use oriented incoming/outgoing local tangents: under 20 degrees continues, 20 to under 60 is slight, 60 through 150 is a turn, above 150 is a U-turn. Continues merge only when name, type, access level and rule match. A straight entry into a mapped crossing uses `cross`; a turning entry retains its turn action and crossing type. No crossing control or destination side is inferred. `arrive` covers zero metres and no segments; a zero-edge route has only `arrive`. Results without a route have no steps. Every real turn is returned, including on long routes; answer summaries must disclose omitted steps. Driving remains indicative because legal turn restrictions are not modelled.

A zero-edge route keeps its `LineString` shape with two identical positions at the routed graph node. Distance remains zero, no segments are invented, and its only maneuver is `arrive` with a null bearing. This lets route camera framing retain the mapped point. See [RFC 7946 §3.1.4](https://www.rfc-editor.org/rfc/rfc7946#section-3.1.4) for the two-position LineString contract.

Different places that share one graph node remain `partly_unverified` when a place entrance is explicitly inferred and lacks a mapped entrance or usable real staff access-point verification. Zero mapped metres do not prove that entrance connection. The gap appears in `unknowns` as `access_point`, with the normal evidence and verification-request behavior. Same-place queries, canonical centre/place aliases, explicit mapped entrances and fresh staff checks retain their existing behavior. Evacuation-centre rows use the same zero-edge rule.
