# Stylised 3D city (Project 2)

> **Superseded for the Stylised view** by [2026-10-17-stylised-city-threejs-overhaul-design.md](2026-10-17-stylised-city-threejs-overhaul-design.md) (ADR 0012/0013). Kept for history.

Status: written 2026-10-16 in the owner's absence (autonomous overnight run, "do not wait for review"). Every judgment call below is also a ledger ruling. Builds on Project 1 (`docs/superpowers/specs/2026-10-16-frontend-redesign-two-screens-design.md`, merged on `feat/redesign-two-screens`).

Owner's decisions, verbatim intent: the 3D city should look like the stylised low-poly isometric night illustration in the redesign handoff (lit windows, trees, props), but on the **real Elmina layout and scale**. Chosen route "B": download real building shapes once, commit them, and draw them with our own renderer inside the existing Cesium viewer. Needs a **Day** look and a **Night** look (Project 1's theme store drives both). Realistic Google tiles stay available as a second view.

## Goal

When a judge opens the map they see a clean, readable, stylised Elmina: low-poly buildings with the real footprints and heights, glowing windows at night, a bright palette by day, trees and roads, and our existing route / flood / place layers lying on top, exactly as they do today.

## Honesty and licence constraints

- Building footprints and heights come only from OpenStreetMap (ODbL; the attribution already in `site.json` and the footer covers it). **Never derive heights or hydrology from Google 3D tiles** (display-only licence). Inferred heights are labelled as inferred in the data (`height_source`).
- The stylised city is **display only**. No routing, flood class or access fact is computed from it. Decorative props (trees, cars) are illustrative: hidden from assistive tech, never pickable, never counted, and the settings popover says "Decorative details are illustrative."
- Flood layers and status lines keep their meaning: nothing in the stylised view may colour a building "safe" or flooded.
- Stylised is not a claim of photographic accuracy. Settings names the views honestly: **Stylised** and **Realistic photos (Google)**.

## Scope

In: building data pipeline, a `GET /layers/buildings` endpoint, the stylised renderer for Cesium (ground, roads, water, buildings, trees, optional static cars) with day/night looks, a Map style control, tests, a quality pass, docs.
Out: new access/flood facts, per-building facts or click cards (buildings are not selectable), animated traffic, interiors, a second township, the Business Park focus area (the data pipeline takes the radius as a parameter so it can be added later).

## Data pipeline (`data/scripts/build_buildings.py`)

- Source: Overpass via `data/scripts/overpass.py` (cache in `data/cache/`, tiled sequential requests, backoff). Keep request count small; the run is one-off. Query `way["building"]` and `way["building:part"]` (skip relations/multipolygon holes in v1; record how many were skipped), `node["natural"="tree"]`, within `RADIUS_M` (default 3500) of `site.scene.home`; widen only if the file size budget below allows.
- Output `data/seed/elmina/base/buildings.geojson`: one Polygon per building, coordinates rounded to 6 d.p., simplified (drop collinear vertices), properties `{id, height_m, min_height_m, levels?, kind, roof, name?, height_source: "osm_height"|"osm_levels"|"default"}`. Height rule: `height` tag, else `building:levels * 3.2`, else a deterministic per-id default by `kind` (residential 7-12 m, commercial 12-30 m, industrial 8-14 m, civic 10-18 m), so rebuilding is reproducible. `kind` is derived from OSM tags (`building`, `amenity`, `shop`).
- Output `data/seed/elmina/base/trees.geojson` (OSM trees only; a seeded scatter inside `leisure=park|garden` and along residential streets is generated at render time, not committed).
- Size budget: `buildings.geojson` <= 6 MB (the committed `walk.geojson` is already 5 MB); if over, reduce `RADIUS_M`. Data regeneration is committed separately from code (`data: ...`).
- Tests use a tiny committed fixture and a stubbed Overpass; no network in tests. `site.json` gains `"buildings": {"file": "base/buildings.geojson", "radius_m": ..., "as_of": ...}` only when the file exists.

## API

`GET /layers/buildings` (public, cached in memory) returns `{ "buildings": FeatureCollection, "trees": FeatureCollection, "as_of": ..., "attribution": [...] }` or `404` when the seed has no buildings (tiny fixture, e2e). Models added to the FastAPI app; `pnpm gen` regenerates `packages/api-client` and the result is committed. No change to the World model.

## Renderer (Cesium, inside the existing viewer)

New `apps/web/src/features/scene/cesium/stylised/`:

- `model.ts` (pure, unit-tested): GeoJSON to render model, grid bucketing (about 800 m cells) so each cell is one `Primitive`, palette selection per building (seeded hash of `id` over the warm/cool/rose tones from the handoff), window-lit decision (seeded, about 58% lit), tree and car placement (seeded RNG, never random per frame).
- `palette.ts` (pure): `paletteFor("day"|"night")`: ground, road, water, wall tones, roof tones, window colours, tree colours, sky colour, fog. Night uses the handoff colours (indigo walls, warm and cyan windows); Day is bright and desaturated.
- `StylisedCity.tsx`: effect-managed component. Hides the Google tileset / OSM buildings and shows a flat ground (`baseLayer: false`, `globe.baseColor` from the palette; **no Ion imagery, no billable service**), adds one extruded-polygon `Primitive` per grid cell, a roads layer from the existing walk/major-road segments (width by type), water polygons from the existing hydrology / flood water polygons, instanced trees, and optional static cars at kerbsides. Calls `viewer.scene.requestRender()` after every change (requestRenderMode). Cleans up primitives on unmount or style change.
- Windows: per-wall pattern drawn by a custom material/appearance (lit and unlit cells, floor banding, roof edge glow). **Task 1 of the plan is a spike** to prove an approach at 5k and 20k buildings with a frame-time budget; fallback ladder if the spike fails: (1) st-based window material with per-instance repeat attributes, (2) tiled canvas-generated window texture per height class, (3) emissive floor banding with roof-edge glow only. Acceptance: at <= 400 m range, Night windows are clearly visible; Day looks flat-lit, not black.
- Lighting: a `DirectionalLight` per theme (low warm sun for Day, dim cool moonlight for Night); no shadows in v1.
- Performance budget: first frame of the city <= 3 s on a mid laptop at 20k buildings; interactive pan/zoom >= 30 fps; geometry created in batches with `asynchronous: true`. If a budget is missed, reduce `RADIUS_M` or building detail rather than ship jank, and log it.

## Integration with Project 1

- `sceneStore.mapStyle` (already exists, default `"realistic"`) becomes `"stylised"` by default **when buildings data is available and WebGL works**, else `"realistic"`, else the old fallback chain (Mapbox lite, then List). `selectView` stays the single place where this is decided; its tests are extended.
- Stylised needs no map key, so it works without `GOOGLE_MAPS_API_KEY`/Ion. e2e and golden use the tiny fixture (no buildings), so they still land in the List view and are unchanged.
- Settings popover gains a **Map style** radiogroup (Stylised / Realistic photos (Google)); Realistic is disabled with a reason when no Google key is configured.
- Theme store drives Day/Night: the stylised city re-skins in place (palette swap + light), with a requestRender, without re-creating geometry where possible (per-instance colour attributes updated, else rebuild only the colour-dependent primitives).
- Route, flood, place and path layers are unchanged and still clamp to ground. In the stylised view the ground is the flat ellipsoid, so `heightReference` is `CLAMP_TO_GROUND`, never `CLAMP_TO_3D_TILE`.
- Cost: Stylised does no billable tile loads. The visual check therefore needs no Google budget; only the optional "Realistic" comparison does (kept to a couple of loads).

## Testing and quality

- Unit tests (vitest): height inference, kind mapping, grid bucketing, seeded determinism (same input gives same colours and windows), palette contrast, GeoJSON parse errors (missing height, invalid polygon, self-intersection skipped and counted), `selectView` with and without buildings data.
- Python tests (pytest): `build_buildings.py` with a stubbed Overpass: output schema, rounding, height rules, deterministic defaults, size-budget guard, request budget.
- API test: `/layers/buildings` returns data from a tiny fixture and `404` when absent; `pnpm gen` drift check.
- Visual check in a real browser (WebGL, keyless dev server): Day and Night at the home view and at street level; frame-time sample; console free of shader/GL errors; routes/flood/place layers legible on top; a screenshot comparison against the handoff reference image by eye, recorded in the quality report.
- Wording/honesty tests from Project 1 keep running; add a test that decorative props are `aria-hidden`/unpickable and the "illustrative" note is present.
- CI-equivalent checklist reported PASS / FAIL / BLOCKED / NOT RUN, mock-backed where applicable.

## Risks and fallbacks

- Window shading may not hit the performance budget: fallback ladder above; Night then reads through floor banding and roof glow.
- OSM coverage may have few `height`/`levels` tags: default heights are deterministic and labelled; the look stays plausible, not exact. Documented in the data README.
- Overpass may be slow or rate-limited: the script resumes from cache; if blocked, report BLOCKED and ship the renderer against the committed fixture only (the style stays off by default without data).
- Multipolygon buildings (courtyards) are skipped in v1; the count is logged.
- 4-5 km outer radius is not guaranteed to fit the size budget; radius is a parameter.
