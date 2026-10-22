# townshiplens-spatial

The world model and the deterministic engines behind TownshipLens. It loads a township data
directory into an in-memory `World` (walk graph, places, claims, flood scenarios, evacuation
centres, waste points, accessibility profiles) and exposes 22 tools that the AI agent and the API
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

The loader rejects duplicate IDs within one source file, overlapping edge/place IDs,
negative or non-finite edge lengths, unusable positions or line geometry, and incident edges
that assign different positions
to the same node ID. An overlay may intentionally replace a base record by ID, but the
resulting graph must remain consistent. Equal coordinates with distinct IDs do not create
a junction. This catches malformed input; it does not establish original OSM identity for
the legacy seed.

## Modules

`world` (loader), `models` (pydantic), `profiles` (loads `config/profiles/*.yaml`), `evaluate`
(per-edge PASS/FAIL/UNKNOWN per profile), `routing` (profile- and scenario-aware route search),
`flood` (affected places, islands, evacuation reachability), `vr_store` (SQLite verification
requests), `attributes` (attribute catalogue and value validation), `sim` (resident-agent batch
runner that ranks data gaps), `twm` (the Township World Model: actions, the pure transition
`apply`, journey rollouts and what-if diffs), `journey` (`build_journey`: a planned route as
ordered journey events for the 3D player), `tools` (tool functions and the `TOOLS` registry).

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
  - an active place closure or a FAIL flood assessment excludes the stop;
  - possible flood or uncovered/partial scenario coverage caps the stop at unverified.
    Search, returned rest lists and unpreviewed centre rows use the same availability gate;
    retained uncertain stops carry flood warnings and evidence;
  - verified or reported absent: never counts, and is left out of `rest_points`;
  - no claim (OSM only), unknown, stale, contested or only reported present: counts only in
    the lenient pass.
- A route that keeps the limit only thanks to unverified rest points is at most
  `partly_unverified`, lists them in `rest_points_unverified`, and gets a warning naming them.
  No VRs are filed for them.
- A route within the limit wins over any route that is not, verified or not.
- When no route keeps the limit, the router minimises the longest stretch without a rest
  point, then route weight. It still excludes failed edges and unavailable rest points.
  That route has `rest_limit_met: false`, is never `confirmed`, and the result warns
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
  wheelchair, older_adult_rest x baseline, +1, +2, +3 m) for a seeded sample (seed 47, N=50) of
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

Route evidence (`routing.evidence_for_route`) also cites the destination place
(`ev-place-<id>`, the same record the tools emit) and, for profiles with a rest rule
(`max_rest_free_run_m`), each rest point's own rest claims (`ev-<place>.seating` /
`ev-<place>.shelter`, or `ev-place-<id>` when it has none) and the route-level
`ev-<route>.rest_gap` (`max_gap_between_rest_m`, the limit and the rest point ids). Placeholder
bench claims therefore set `demo_evidence` on rest-profile routes.

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

## Journey plans (`journey.py`, spec 2026-10-19 §6.1)

`build_journey(world, route, profile, start_time) -> JourneyPlan` turns a planned route into the
trip the 3D player animates. It is deterministic and reads world-model data only; the player
never invents events.

- `JourneyPlan`: `route_id`, `profile`, `start_time` (local `HH:MM`), `pace_m_per_s`
  (`routing._pace_m_per_min(profile) / 60`, the same pace as `Route.est_minutes`), `polyline`
  (travel order, chained by graph node so reversed edges and out-and-back spurs are oriented),
  `spans` (`[from_m, to_m, eval]`, one per route segment), `events`, `conditions: []` (seam).
- Distances (`at_m`, `spans`) are metres along the polyline in a local WGS84 tangent plane,
  the frame the Three.js scene uses, so the hero is at the element when its event fires. They
  differ from `Route.distance_m` (haversine) by well under 1% (Elmina demo: 963.5 vs 965.5 m).
- `JourneyEvent`: `kind`, `at_m`, `element_id`, `source`, `attributes`, `status`, `demo`,
  `evidence_id`, `title`, `body`, `hold_s` (`HOLD_S`: rest 60, unknown 8, others 3 simulated s).
  Every event has an `element_id` (edge, rest place or destination place) or a named
  route-level `source`: `route.max_gap_between_rest_m` (gap) or `route.to_place` (arrive, which
  also carries the destination id). Route-level events have `status: "route"`; rest points use
  `verified|unverified`; edge events carry the cited claim's status.
- Every `evidence_id` is in `routing.evidence_for_route(world, route)`. `demo` is true exactly
  when that evidence is `team_survey_placeholder`.

| Rule | Kind / title | Evidence |
| --- | --- | --- |
| First edge with a `covered` claim (yes, not `unknown`) | `covered` "Covered walkway" | `ev-<edge>.covered` |
| First UNKNOWN `major_road` | `unknown` "Crossing <name>" | the edge's unknown claim, else `ev-<route>.walkways` |
| Longest stretch without a rest point, when over the limit; fires `limit` m into it | `gap` "No mapped rest stop ahead" | `ev-<route>.rest_gap` |
| Longest run of adjacent UNKNOWN `street` edges with one name | `unknown` "<street name>" | as main road |
| First PASS edge with verified claims (OSM passability never counts) | `verified` "Step-free path" | the edge's verified claim |
| UNKNOWN ramps, adjacent ramp edges as one, at most 2 | `unknown` "Ramp" | the unknown claim |
| Each rest point after the start, rest-rule profiles only | `rest` "<place name>" | the place's rest claim |
| Arrival | `arrive` "<destination name>" | `ev-place-<id>`, else walkways |

Events sort by `at_m`, ties in the rule order above (the ramp before the bench at its foot).
More than `MAX_EVENTS` (12) events: rest points are thinned evenly along the route (by `at_m`).
An event whose evidence is not in the route's evidence raises `JourneyEvidenceError` (event kind,
element id, evidence id), never a bare `KeyError`; `POST /journeys` turns it into a named 500
and the chat drops the `journey.play` intent. Wording follows the
honesty invariants: UNKNOWN says "Not checked yet" (the UI and answer add "verification request
filed"; `build_journey` files nothing), placeholder facts say "Demo value · not surveyed." and
never "Verified", and no card says safe, blocked or a water depth. A covered claim that is
stale or contested is worded by its status; rest cards are neutral ("Rest stop: …"); the gap card
drops "about N m" when the rest stop is under 10 m ahead.

Served by `POST /journeys` (apps/api) and attached to the chat's `journey.play` scene intent
(packages/agent `run.py`); both build from the same `plan_route` route (AC-D4).

## Tests

```
uv run pytest packages/spatial -q
```

Tests run against the tiny fixture world in `tests/fixtures/tiny`. `test_journey.py` also checks
the spec §2 demo table and hypothesis properties (200 seed place pairs, routes ≤ 2 km) on the
Elmina seed; those skip when the seed is missing.

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

## Development Simulation (`devsim.py`, developer lens)

A Hypothetical Development (about 30 storeys, 500 homes, not an SDP project; ADR 0014) near Lakeside Mall. `devsim_models.py` holds the plan shapes. Every number is computed by the routing engine (default profile); the residents' lines are simulated reactions.

- `place_tower(world, brief)`: puts the tower on the north-east corner of OSM `way/1564861412`, inside the lot and at least 200 m from the Kanopi lot.
- `compute_facts(world, site)`: the closed frontage edge and the detour for an existing nearby home to Car Park B, plus the walks from the entrance to Urban Park and to Lakeside Mall.
- `build_development_plan(world, brief)`: the 45 s building timeline (demo polish spec §6.3) as a `DevelopmentPlan`: facts, cast, acts, bubbles, tags (detour, lorry route), banners (Hari Raya, monsoon, handover), anchors, and the modules below (`impact`, `lorry_route`, `schedule` with `estimate_sources`, `flood`, `access_matrix`, `residents`), the `month_keys` that map playback seconds to project months, and the Impact `brief` (During construction / At handover / Daily life), which replaces the old end card. It takes about 8 s cold on Elmina; the API caches it per world version.
- `check_plan(plan)`: the honesty gate. Digits in every copy string (bubbles, tags, banners, brief rows and notes, the hypothetical label) must be the values for that slot, recomputed from the plan's data; the copy must avoid banned words (safe, selamat, depth, flood). The data must agree with itself (impact counts, schedule series, month keys, flood, matrix vs facts) and every resident line must pass `check_line`. `build_development_plan` raises `DevsimCheckError` if it fails.
- `DevsimUnavailable`: the world cannot host the simulation (no parcel, places or streets, as in the tiny fixture). The API returns 404 and the tool returns `available: false`.
- Dump a plan: `python -m townshiplens_spatial.devsim --dump <path>` from the repo root (`--world` picks the data directory).

Impact facts for the demo-polish building timeline (all carried by `DevelopmentPlan`; each takes the world and site and is cached per world version):

- `devsim_impact.hoarding_impact(world, site)`: every residential building within 500 m, walking to Lakeside Mall (mall or its Car Park B), Urban Park and the nearest school and clinic before and after the hoarding closes the frontage paths. It reports homes 2+ min longer, the longest extra, wheelchair links cut, one option per hoarded side and `best_side`. It uses one search per target (`walk_tree`, the routing engine's edge costs) and takes about 1.5 s on Elmina.
- `devsim_impact.lorry_route(world, site)`: the `drive` route from the nearest major road to the site gate, with the schools, kindergartens, parks and playgrounds within 50 m. The school-run time is a labelled assumption.
- `devsim_impact.flood_exposure(world, site)`: the lowest river-rise scenario the world has at which the entrance's walk to the main road crosses `likely_flooded`, and the nearest evacuation centre with its `osm_candidate` / `official_pps` label.
- `devsim_impact.daily_life_matrix(world, site)`: walk minutes from the entrance to four targets for default, stroller and wheelchair. A cell is `"?"` (partly unverified), `"gap"` (no_data) or `"blocked"`.
- `devsim_schedule.schedule(storeys, homes)`: the ESTIMATE schedule and cost. Every constant is a row of [docs/04-architecture/devsim-estimates-sources.md](../../docs/04-architecture/devsim-estimates-sources.md), and a test compares the two.
- `devsim_residents.build_residents(world, site)`: 40 simulated residents, 20 in the tower and 20 neighbours from the Elmina Day population living in those 500 m homes. Each has facts and three template lines (`devsim_lines.py`) checked by `check_line`.

Computed facts on the Elmina seed (the web copy is built from these):

| Fact | Value |
| --- | --- |
| Detour home / closed edge | `w909852736` / `seg-910300105-0` |
| Walk to Car Park B, before to after | 2,684 m to 2,923 m, +3 min |
| Tower to Urban Park | 659 m · 9 min |
| Tower to Lakeside Mall | 712 m · 10 min |

## Navigation compare (`compare.py`, demo polish)

`compare.compare(world, from_id, to_id, profile, scenario_id=None) -> CompareResult` is a pure
function of the world; the `compare_routes` tool wraps it.

- `fastest` is the `default` profile's route and `recommended` the requested profile's route,
  both from `routing.plan_route`. `same_path` is true when their edge sequences match; then
  `fastest` is the recommended route, `stop` is null and `extra_minutes` is 0.
- `stop` is the first edge of `fastest` that `evaluate_edge` FAILs under the requested profile:
  `at_m` (edge `length_m` sum before it), attribute, value, the profile's hard limit, evidence id.
  A steps edge without a usable step claim cites `ev-<edge>.type` (the implied step).
- `reasons` use **known facts only**: a value counts when the evaluator could rest a result on
  it (a verified, valued, fresh claim, or a reported/verified value that breaks a hard limit).
  Unknown values never count for or against a route (spec D2). `steps` sums, `max_incline_pct`
  is the largest absolute incline, `min_width_m` the narrowest, `covered_share` the known
  covered length over the route length rounded to 0.05, `rest_stops` the verified rest points
  plus known (PASS) seating/shelter places within 15 m of the route. A field is null when no
  edge has a known value; `rest_stops` is null rather than 0 when none is known (an unmapped
  bench is not a known absence). The evidence ids behind each field are on
  `ReasonSet.evidence_ids` (excluded from the payload) and all returned with the result.
- `unchecked`: contiguous runs of UNKNOWN edges on `recommended` per attribute (from
  `route.unknowns`; flood and flood coverage are scenario facts, not survey gaps, and are left
  out), ordered by `start_m`.
- `pois` along `recommended`: first lowered/flush `kerb`, first `covered_start`, steepest known
  `incline`, each `seating` rest stop, each `unknown` run start, `arrival`; `demo` marks
  `team_survey_placeholder` evidence.
- `no_data` / `blocked` short-circuit: no recommended route, stop, unchecked stretch or ticket.
- The tool files one verification request (reason `unknown`) for the first unchecked stretch's
  first edge and attribute when `file_vrs` (dedupe: a repeat returns the same id with
  `created=False`), and sets `confirm_n` = `impact.fact_impact(world, edge, attribute)
  .became_confirmed` (sampled wheelchair journeys that checking it would confirm; null when
  the fact is not an open path question). `POST /routes/compare` passes `file_vrs=False`.

## The tools (22: 10 lookups + 6 world-model tools + 3 Elmina Day tools + `simulate_event`, `simulate_development`, `compare_routes`)

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
| `simulate_event` | `(name, segment_ids, starts_at, ends_at, profiles?)`: a planned event's closures compared before and after over the everyday sample journeys (see Event comparison) |
| `simulate_development` | `(brief?)`: the Development Simulation plan for the fixed hypothetical tower (see Development Simulation) |
| `compare_routes` | `(from_id, to_id, profile=wheelchair, scenario_id?, file_vrs=true)`: fastest (default walking) route next to the profile's route, with the stop point, known-fact reasons, unchecked stretches, points of interest, one ticket for the first unchecked stretch and `confirm_n` (see Navigation compare) |
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

A centre linked by `place_id` uses that place's explicit mapped entrances, just like a route to the place itself; driving snaps from those entrance coordinates. The centre's own node remains the fallback when no entrance is mapped. An explicit entrance pointing to a missing graph node is a data gap, so routing cannot silently substitute an older area or centre snap.

Driving endpoint-gap warnings describe the first returned route's actual graph endpoints. An unused entrance touching a road cannot suppress the warning for the selected off-graph entrance.

Positive seating, shelter and sidewalk verifications require a value and a usable verification date, as do the hard edge constraints. An undated rest claim counts only in the lenient search; a route depending on it names the stop in `rest_points_unverified` and stays `partly_unverified`. An undated positive sidewalk cannot establish PASS. Derived road-section and access-layer `sidewalk_status` values are `unknown` for unusable verifications and `stale` after expiry; the raw claim and evidence keep their audit status. Negative rest/sidewalk barriers and the default profile's reported-sidewalk policy retain their existing treatment.

Flood-island centre membership and place samples use the same explicit entrances and mode-specific road snaps as routing. Any entrance in a centre-connected component prevents a place from being sampled as isolated. Components disconnected from every centre at baseline remain data gaps. Island counts describe flood-induced graph components under ruling R5; they do not establish a legal, verified or rest-constrained route for an individual origin.

## Flood impact markers (T-024)

Public river scenarios are baseline and +1/+2/+3 m. All scenario disclaimers state
“Flash floods from heavy rain are not shown.” No flood data was rebuilt.
`flood.affected` retains its existing briefing lists and flood-induced island counts, and adds
uncapped `flooded_places` and `cut_off_places` (`id`, `name`, `type`, `lonlat`), plus
`flooded_path_m` (sum of physical lengths of likely-flooded mapped edges).
Flooded markers describe the place itself. Cut-off markers exclude flooded places and mean
no mapped non-FAIL path from any entrance to any available centre, for the selected profile.
Unknown edges remain usable; driving respects one-way directions. Mapped components already
isolated at baseline can appear here; the older island field remains flood-induced only.
Places without mapped entrances or road snaps are omitted as data gaps. These markers do not
establish a verified route or a route within a rest-distance limit.

## Closure comparison (T-026; T-025 event alias)

`events.simulate_closure(world, ClosureScenario(name, reason, closures), profiles, at)`
compares the same sample trips before and after hypothetical closures. Reasons are
`event`, `works`, `accident`, `flooding`, `other`. Each closure has its own `starts_at`,
`ends_at`, and `segment_ids` or `road_names`; names can include a mapped stretch
`<road> between <cross street A> and <cross street B>`. Unknown/ambiguous names are errors.
A scenario is bounded to 40 segment/window pairs and 40 windows. All windows are
validated, even when inactive. Times accept ISO offsets; naive datetimes are UTC.

`at` defaults to the first listed closure start. Only windows with `start <= at < end`
apply. Other staff closures are also frozen at `at`. This is one instant, not a timeline
or a worst case across the windows. Neither live state nor the closure store changes.
Default profiles are `default`, `wheelchair`, `drive`; up to five known profiles are
supported. Total samples are capped at 300, split evenly between profiles, exposed by
`sample_limit_per_profile`. Sample origins rotate across up to ten mapped transport and resident-destination
categories. Origins and destinations favour places near the site centre; outlying
journeys are not represented. Each endpoint is capped at 10% when enough pairs exist.
These are deterministic sample journeys, never measured demand.

`trips_affected` counts rerouted or newly disconnected trips. `trips_no_route` includes
existing gaps; `trips_no_route_before` and `trips_newly_no_route` distinguish them.
Pre-existing disconnected data stays `no_data` and is never attributed to a closure.
Extra metre/minute medians cover rerouted trips only (null if none); minutes describe
physical distance/profile pace, never traffic delay. Per-profile counts use the same rules.
Trips whose origin or destination maps onto a closed-course node have
`on_closed_course=true` and are counted separately in `trips_on_course`. These access-during-
the-event cases are excluded from ordinary detour, no-route and newly-no-route summaries.
The total sample still includes them. Origins and destinations rotate together; samples
that cannot meet the 10% endpoint-share target carry an explicit limitation warning.
`places_cut_off` contains newly lost mapped centre access in at least one selected
profile; pre-existing isolation and missing entrances are excluded.

Peak assumptions, road-class capacities and pressure bands live together in
`config/traffic/peak_weights.yaml`. Weights use the destination type, `at` in the site's
time zone, weekdays unless stated, and start-inclusive/end-exclusive windows. Results
carry `weights_note`: “Peak weights are an assumed travel pattern, not measured.”
Detour roads group newly used segments by mapped name, counting each rerouted sample
trip once per road. For a mixed-class road, `road_class` is the newly used segment class
with the lowest capacity, a conservative bottleneck assumption. `weighted_trips` sums
the destination/time weights;
`trips` is the unweighted count. Unnamed segments group into maximal degree-two chains, split at junctions and named
roads. Labels use a nearby mapped road, direction and measured chain length, with
coordinates when those words coincide. Each chain has its own pressure; absent classes are `unknown` and use the `others` capacity.
Rows sort by weighted trips, name, class. Duplicate warnings are removed.
Pressure = weighted trips / class capacity: secondary 4, tertiary 3, unclassified 2,
residential 1, service 0.5, others 1. Bands are low <1, medium 1–3, high >3.
The disclaimer is “Detour pressure, estimated from mapped road class and sample trips,
not traffic counts.” Pressure is for management, never a resident route claim.

Suggestions have numbered `basis` fields. High-pressure residential detours suggest
reviewing signs via an adjacent mapped higher-capacity road when one exists; the route
has not been assessed. Up to three detour roads get marshal suggestions. Mapped one-way
detour segments suggest reviewing temporary two-way operation. Newly cut-off places
suggest reviewing a crossing at a mapped closure-boundary junction. At least half of
sample trips affected triggers rescheduling, plus splitting when multiple segments are
active. Suggestions disclose unassessed alternatives; they do not change routing rules.

`route_batch()` shares strict/lenient shortest-path trees, weighted adjacency and road
snaps within an immutable snapshot, preserving route selection, direction and endpoint
checks. Static road nodes and up to 512 road snaps are shared across snapshots, keyed
by road membership and endpoint coordinates; closures never change the geometry snap.
Search frontiers pause after requested targets and resume for later destinations,
preserving insertion-order ties. Road snaps use an exact spherical candidate grid
followed by the same distance and tie checks. Aggregate RouteState calculations omit
only unused presentation fields; resident routes and rest-limit checks retain them.
One frozen snapshot serves course planning, impacts and animation. Rest-constrained
searches keep their normal solver. A bounded baseline cache
(12 profile/sample entries) keys by graph, world version, date, frozen closure set, profile
and sample. Only baseline routes intersecting active proposed segments are recalculated.
The API warms the default three-profile closure baselines first on startup, and again
after world, date or active-closure changes. Future event windows with different staff
closures calculate their own baseline. `timing_ms` includes snapshotting, cache
lookup/calculation, impacts and suggestions.

`simulate_event(EventSpec(...))` uses the same engine, retaining the old event shape,
everyday sample and disclaimer. The API/tool aliases preserve existing callers.
Stored named closures keep the public `event_name` separate from private staff notes;
labels use their actual reason, including named works/accidents/flooding/other closures.

### Marathon proposals (T-028)

`marathon.plan_course(world, start, distance_km, shape="loop", finish=None,
avoid_roads=[], prefer_roads=[])` returns an ordered, continuous course, its actual
length and consecutive road stretches. Start/finish accept place ids or exact,
unambiguous full names. Point-to-point needs a finish. Major roads are excluded
unless explicitly named in `prefer_roads`. Active closures and steps are excluded.
This is a proposed road-closure layout, not a running or profile access assessment.
Road direction, crossing provision and event approval still need review.

The deterministic search samples eight directions at three radii and preferred-road
anchors. It joins each outward shortest path to a return path that excludes its edges;
bounded repeated-path fallbacks remain. Named roads have lower search cost than
unnamed paths; preferences reduce cost further. An in-band repeat-free candidate
precedes repeated candidates. Up to 24 candidates are ranked by preference and newly
lost mapped centre access across default, wheelchair and driving profiles. Direction
and parallel-edge rules are retained. This is a bounded heuristic, not a global minimum.
If no in-band single loop is found, a bounded multi-lap proposal may meet a long
request; repeated metres and lap counts remain explicit. Repeated roads and distances
outside ±10% get warnings. Proposals have at most 400 ordered segments;
ad-hoc closure requests still have a 40-segment limit. The bounded proposal cache
invalidates on world/version/date/active-closure changes.

`marathon.simulate_marathon(world, MarathonRequest(...))` proposes the course and
runs the unchanged closure engine at `starts_at`. It accepts one ISO datetime window,
up to five profiles and the same road edits. It returns `{course, impact, animation}`. The public,
read-only `POST /marathon/plan` takes that request; no event is stored. The spatial
`tools.simulate_marathon` wrapper is for management only. Label all proposals:
“Proposed course on mapped roads, not an approved route.”

`GET /layers/road-labels` returns a list of `{name, road_class, length_m, anchor,
bearing_deg}`. Geometry and length are clipped to the configured display boundary
(site bbox if none); an unreadable configured boundary fails instead of widening it.
The anchor is the midpoint of the longest clipped segment; its local tangent sets the
bearing (clockwise from north). Class comes from that segment's mapped highway tag.

`MarathonResult.animation` contains `course_coordinates` in traversal order and up
to five `rerouted_trips` with `before_coordinates` / `after_coordinates`, place ids and
profile. The label is “Simulation · illustrative”. These are example routes from the
same closure sample, not vehicle/crowd counts. Missing or disconnected geometry is
omitted, never joined with a fabricated connector.

### Low-lying terrain scenarios (T-029)

Generated terrain uses scenario id `lowlying`, `kind: lowlying`, and possible-only
edge/place classes. `stage_m: 0` means baseline river rise; it is not a terrain value
or a water depth. The label is “Low-lying areas that may collect water (indicative)”.
The loader requires its GeoJSON before it lists the scenario. The Elmina seed has it since
22 Oct 2026 (`data/README.md`, T-029); the tiny fixture does not.

With generated data, the loader also derives `stage_p1m+lowlying` (and each other
positive river stage). These have `kind: combined` and `components` listing their
inputs. River `likely_flooded` always wins; terrain can only add `possible`, never
remove a river class. Missing raster coverage combines conservatively. Separate
`scenario_coverage` maps keep the terrain screen's gaps independent of river coverage.
GET `/scenarios`, `/scenarios/{id}`, `/scenarios/{id}/affected`, and normal layer APIs
use these ids. River-rise playback and built-in day stages retain river-only inputs.

Limits: GLO-30 is a 30 m surface model, including buildings and trees. Drains, culverts
and rainfall amounts are not modelled. A terrain mark is a possible collection area,
not a forecast. Unmarked areas do not establish absence. The data pipeline README
records thresholds, limitations and generation requirements.

Decision A (Task 2): terrain-only possible marks evaluate UNKNOWN for every profile,
including driving, at paths and assessed endpoints. A combined scenario retains the
original river rules: a river possible class still excludes driving, and a river
likely_flooded class remains FAIL. Physical barriers and closures also remain FAIL.
The access layer uses the same factual assessment as routing. Terrain-only marks use
“low-lying terrain may collect water (indicative)” rather than a river-flood assertion.

Task 2 audit refinement: general closure samples draw up to ten origins across mapped
resident destination and transport-access categories, rather than only the seven seed
car parks. Pair selection caps each endpoint at 10% when enough distinct pairs exist.
A small-pool limitation is emitted once across profiles. The sample is deterministic,
bounded and not measured demand. Pre-existing no-route cases remain in its denominator.
Closure cutoff counts and course ranking use `RESIDENT_DESTINATION_TYPES` (homes,
schools, shops, parks, clinics, community/evacuation centres and other listed resident
destinations); bins, seating and shelters are excluded. Legacy event results retain
their prior place-count contract. Unnamed labels use landmark/direction/measured length,
with a geographic qualifier for collisions; arbitrary stretch indices are not public names.
