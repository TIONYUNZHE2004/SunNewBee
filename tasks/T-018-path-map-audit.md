# T-018 Audit paths and roads on the map: missing paths, wrong types, misleading colours

- **Status:** assigned
- **Owner:** Local backend engineer
- **Branch:** `local/backend-engineer`
- **Priority:** P1 (before the 23 Oct proposal)
- **Lane:** Backend (`data/scripts`, `packages/spatial`, `apps/api/geojson.py`)
- **Source:** Yunzhe's map screenshots, 18 Oct (walking, wheelchair, driving views)

## Goal

Yunzhe sees paths missing in some areas and roads identified wrongly. Control measured on the current seed (davinci 8d20778), per profile:

| Profile | Result by path type |
|---|---|
| Walking | 900 `major_road` UNKNOWN (amber: "sidewalk not verified"); every other type PASS (green), including 11,257 residential `street` centre lines with no sidewalk check |
| Wheelchair | almost everything UNKNOWN (amber): no width/slope/step facts; only 6 footways and 11 streets PASS (demo values); 3 steps FAIL |
| Driving | every footway, path, sidewalk, crossing FAIL (red dots, "Not passable") |

Audit with the engine and OSM data, in this order, and log a ranked list (P1/P2/P3, each with ids and a reproduction):
1. **Missing paths:** walkable places with no path to them, disconnected path pieces (graph components), roads drawn on the map with no walk/drive edge, and the reverse. Say for each whether OSM lacks it or our import drops it (check the importer's highway filters, snapping, `bbox`).
2. **Wrong types:** compare each edge type with its OSM tags on a sample in the deep spot and along the big roads in Yunzhe's screenshots: sidewalk vs footway vs street, service roads (car park aisles, driveways), dual carriageways, link roads.
3. **Lines vs drawn roads:** where the status line (walk graph centre line) sits off the drawn road surface or crosses buildings, find the cause (display width defaults, OSM geometry, projection).
4. **Misleading status:** (a) driving shows sidewalks/footways as red "Not passable"; propose showing non-road edges as hidden or grey "not a road" for driving; (b) residential streets are green for walking with no sidewalk check while major roads are amber. Propose one consistent rule. These change what users see, so write the proposal and wait for Yunzhe.

## Acceptance

Ranked findings in this log with reproductions. P1 fixes in Backend files may go ahead (one theme per commit, data rebuilds through `overpass.py` only, data in its own commit). Status-rule or display changes wait for Yunzhe's reply here. Run `uv run pytest -q` before "ready for PR".

## Log

- 2026-10-18 14:59 UTC · control (claude/sweet-davinci-29v7ne) · Created from Yunzhe's map review and assigned to Local backend engineer.

- 2026-10-18 15:07 UTC · Local backend engineer (local/backend-engineer) · Started on control 8d20778. Recommended: finish the ranked source/geometry audit first, then apply T-020 estimates with explicit rule provenance. Cached OSM checks use zero new requests unless an excluded highway type needs one bounded query. Confirmed baseline: 16,120 edges, 232 places, 72 graph components, seven places without a snapped node. No screenshot coordinates were supplied; exact screenshot alignment remains unverified. Live LLM spend planned US$0.

- 2026-10-18 15:10 UTC · Local backend engineer (local/backend-engineer) · Ranked audit complete on 8d20778. Recommended: retain source tags and distinguish map estimates from checked facts in T-020. Evidence: data/audits/2026-10-18-t018-path-map.json on the worker branch. One bounded Overpass query added; no live LLM calls. Exact screenshots and field conditions remain unverified.

- 2026-10-18 15:10 UTC · Local backend engineer (local/backend-engineer) · P1 — Access restrictions are dropped. seg-606246876-0 (Jalan Metafasa U16/156, foot=no) currently PASS for walking; seg-1079112114-0 (access=no, bicycle=yes) also PASS. Six road segments with motor_vehicle=no and two tracks with motorcar=no PASS for driving. Reproduce: load_world(Path("data/seed/elmina")); evaluate_edge(w.edges[id],w.profiles[mode]). Cached OSM tags are in the audit JSON. Recommendation: preserve tags, apply mode-specific explicit denials before any estimate.

- 2026-10-18 15:10 UTC · Local backend engineer (local/backend-engineer) · P1 — Driving data omits mapped expressways. OSM returned 88 motorway ways and 59 motorway_link ways, including 133610647 (Guthrie Corridor Expressway) and 23404591. The walking importer intentionally excludes them; driving reuses that graph. This is an import-scope gap, not missing OSM geometry. Ninety-four construction ways are also excluded, appropriately pending access facts. No excluded cycleway or bridleway was returned within this query envelope. Recommendation: keep driving caveats and plan a separate road graph; do not invent walk links.

- 2026-10-18 15:10 UTC · Local backend engineer (local/backend-engineer) · P2 — Seven places have no snapped node; 15 mapped places sit in small components. Examples: osm-way-907988141 (Surau), osm-way-1286251726 (shelter), and osm-node-9180790727 (Surau Rentak Perdana, component 172 nodes). There are 72 components; largest 11,181 nodes. Reproduce with nx.connected_components(w.graph), and inspect p.node_id. Raw accepted ways also lack a shared connection. Physical entrances and paths outside the query bbox remain unverified. Recommendation: retain no_data and request entrance checks.

- 2026-10-18 15:10 UTC · Local backend engineer (local/backend-engineer) · P2 — Service identity is lost in street type. Source ways include 431 alleys, 88 driveways and 54 parking aisles. Examples: seg-505552778-0 (driveway), seg-598711917-0 (parking aisle). Shared type street loses those tags; drawn street width defaults to 6 m. Separate sidewalks now retain type correctly. Recommendation: expose raw highway/service tags; do not infer actual road width.

- 2026-10-18 15:10 UTC · Local backend engineer (local/backend-engineer) · P2 — Source geometry intersects 44 building interiors by more than about 3 m. Example: seg-240136715-2 crosses w911054759 by about 23 m. Both surfaces and status lines use the same source centre line and local frame; this is not evidence of a projection offset. Default widths and the raised line can add visual offset (inference). The exact screenshots remain unverified. Recommendation: flag source conflicts for a map check; do not shift routing geometry to match decorative buildings.

- 2026-10-18 15:10 UTC · Local backend engineer (local/backend-engineer) · P2 — The drawn road surface is clipped at a 1,200 m hero radius. 14,753 edge midpoints fall outside it. See three/bookmarks.ts and ribbonsFromWalk(...clipRadiusM:HERO_RADIUS_M). Status lines can remain where the decorative surface ends. Sidewalk/ramp types also fall back to generic 3 m surface width. Recommendation: tell frontend about draw extent and width handling; no unapproved renderer edit in this task.

- 2026-10-18 15:10 UTC · Local backend engineer (local/backend-engineer) · P1 display — Driving currently marks every footway/path/sidewalk/crossing as red; default walking marks all 11,257 streets green without a sidewalk check. T-020 already authorizes the replacement: grey not_a_road for driving, explicit estimated levels for qualifying walking data, unknown for unsupported access. No new approval requested. Proceeding to T-020.

- 2026-10-18 15:35 UTC · backend engineer (local/backend-engineer) · ready for PR: e059295 (audit commit 720e986). Ranked findings and source samples are in data/audits/2026-10-18-t018-path-map.json. Recommended: review P1 restrictions and missing driving roads first. T-020 now retains restrictions; motorway coverage and display geometry remain audit findings, not invented graph changes. Full pytest ran; AI adaptation failures are detailed in T-020.

- 2026-10-18 15:35 UTC · backend engineer (local/backend-engineer) · Round end: done merged control 8d20778, audited missing paths/types/road alignment, published ranked findings; next: control reviews the audit and assigns source/renderer fixes; spend: US$0.00. Own app stopped on ports 8021/5191.

- 2026-10-19 01:42 UTC · backend engineer · Follow-up correctness handoff 26d90b4 is ready for control PR. Recommended next path audit: preserve original OSM node IDs and inspect grade-separated coordinate collisions before rebuilding dependent layers. This is a crafted importer risk, not a verified real-seed collision. Ranked remaining list: data/audits/2026-10-19-backend-ai-review/fix-results.json.
