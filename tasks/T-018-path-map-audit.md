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
