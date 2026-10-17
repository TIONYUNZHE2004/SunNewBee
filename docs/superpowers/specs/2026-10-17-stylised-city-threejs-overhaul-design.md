# Stylised city overhaul: Three.js digital twin of Elmina (design spec)

- Date: 2026-10-17
- Status: agreed with the owner (grilling session, 2026-10-17). Ready for an implementation plan.
- Decisions: [ADR 0012](../../00-overview/decisions/0012-stylised-city-on-threejs-with-blender-assets.md) (engine and assets), [ADR 0013](../../00-overview/decisions/0013-living-township-traffic-people-and-sourced-signage.md) (traffic, people, landmarks, signage; supersedes part of ADR 0011)
- Vocabulary: [GLOSSARY.md](../../../GLOSSARY.md) (Digital twin, Sourced feature, Decorative detail, Building archetype, Landmark, Signage)
- Reference image: [assets/2026-10-17-stylised-city-reference-night.png](assets/2026-10-17-stylised-city-reference-night.png)
- Building research: [docs/02-research/elmina-building-types.md](../../02-research/elmina-building-types.md)
- Earlier specs, now superseded for the Stylised view: `2026-10-16-stylised-city-design.md`, `2026-10-16-stylised-city-enhancement-design.md`

This spec is written for a fresh session with no memory of the grilling, so it restates context that the ADRs only summarise. Read `AGENTS.md` and `CLAUDE.md` first: their honesty invariants, CI checklist and cost guardrails all still apply.

---

## 1. Goal

The Stylised map should look like the reference image: a hand-made, SimCity-style diorama with these qualities:
- varied, detailed buildings;
- soft shadows and ambient occlusion;
- glowing windows and signs, and pools of lamp light;
- busy streets.

It must look that way **in every time of day**, not just at night. It must also be recognisably **the real City of Elmina**: a viewer looking at it should feel they are seeing Elmina's digital twin going about its day.

### What the owner said is wrong today
1. Too much empty space on the map.
2. Model quality is too low: buildings are a few windows and all look alike.
3. Lighting is poor. The owner said "ray tracing"; what they mean is the look of soft shadows, AO, emissive glow and lamp light. Real path tracing is not required.
4. Motion was promised but can't be seen.

### Why, from the code (facts as of commit `856a1bf`)
**Buildings** (`apps/web/src/features/scene/cesium/stylised/`):
- Every building is a flat-roofed extrusion with a 0.6 m parapet.
- Facades are drawn in one shader (`buildingsPrimitive.ts`).
- 98% of the 7,803 buildings use the same "grid" window style. Curtain glass never triggers, because the tallest building is 35.2 m.
- About 94% of heights are the 9 m default, so most buildings come out as 3 storeys.
- There are only 6 colour tones per theme.

**Ground** is a base colour plus parks only. The seed has no forest, grass, farm or construction land cover. A tree-scatter helper exists (`model.ts` `scatterTrees`) but is never called.

**Lighting:**
- AO is off at every tier because Cesium's HBAO streaked.
- There is no tone mapping and no image-based lighting.
- Lamps exist only as emissive heads plus light pools painted into the ground.

**Motion:**
- Birds are 0.9 m across against a 1,200 m home view, and are hidden at night.
- Clouds are hidden at night and during routes or floods.
- ADR 0011 banned traffic.

**Props** (cars, trees, lamps) are Cesium ellipsoids, cylinders and boxes (`props.ts`).

**Camera:** the Stylised home is perspective at a 1,200 m range, -35° pitch and 30° vertical FOV (`cesium/home.ts`).

---

## 2. Decisions (all agreed with the owner)

### 2.1 Truth boundary
| Kind | Examples | Rule |
|---|---|---|
| **Sourced feature** | footprints, roads, water, land cover, building heights, landmarks, signage | Drawn because a named source says it exists there. Keep the source. |
| **Decorative detail** | facade ornament, moving vehicles, walking people, birds, window flicker | Drawn only for liveliness. Labelled "Decorative details are illustrative.", never pickable, never cited, never described by the assistant. |

- Fill empty land with **real land cover**, never invented buildings.
- Construction land is drawn as a construction site (bare earth, hoarding, cranes), because Elmina really is a township still being built.
- Flood scenarios stay a **tinted, hatched ground overlay**, with classes `likely_flooded` and `possible`. **Never** draw a realistic rising water surface, because it would imply a water depth (honesty invariant). Base water stays decorative and never touches flood layers (ADR 0011).

### 2.2 Engine and asset pipeline (ADR 0012)
- The **Stylised** map style moves to a new **Three.js** renderer.
- The **Realistic** map style (Google Photorealistic 3D Tiles) **stays on Cesium, unchanged**.
- The Mapbox lite and List fallbacks are unchanged.
- **Blender 5.2** is installed at `C:\Program Files\Blender Foundation\Blender 5.2`.
  - Iterate visually through **Blender MCP**. It is already configured for this project as MCP server `blender`, `uvx mcp-for-blender==2.1.3`, with telemetry disabled. The addon is installed and enabled in Blender.
  - The owner must open Blender and have the addon's server running on port 9876 (sidebar `N` → "MCP for Blender" shows "Connected on port 9876").
  - MCP tools include `execute_blender_code`, `get_viewport_screenshot`, `get_scene_info` and the Poly Haven, Sketchfab and Poly Pizza search and download tools.
  - Final assets come from **committed Blender Python scripts** run headless (`blender --background --python <script>`), so every archetype and prop can be regenerated.
  - Bake AO and lightmaps where it pays off, and export glTF (`.glb`, Draco or meshopt compressed).
- **Asset sources and licences are unrestricted for this work** (owner ruling): paid assets, CC-BY, Sketchfab and AI generators are all fine.
  - Still keep a credits file (`apps/web/public/stylised/CREDITS.md` or similar) listing each third-party asset and its licence. It costs little and keeps attribution honest.
  - The AGENTS.md dependency rule is waived for this work only. Prefer permissive npm packages anyway.

### 2.3 Google data exemption (scoped, do not spread)
- **Allowed for this overhaul only:**
  - Google Street View and Google Photorealistic 3D Tiles as modelling reference;
  - as a **building-height source** (sampling heights per footprint);
  - and as texture or colour reference.
- **Not allowed, still:** using Google data in routing, evaluation, flood, the agent, answers or evidence.
- **Do not edit AGENTS.md.** Its "never derive heights from Google 3D tiles" rule stays for everything else. This exemption is recorded only here.
- Google Map Tiles API calls are billable. The owner approved a one-time height-sampling run. Cache the results, keep request counts small, commit the derived heights to the seed, and never re-fetch in a loop.

### 2.4 Content
**Building archetypes.** Twelve archetypes plus one neutral generic, each modelled from reference photos of real Elmina buildings (see the research doc). Wall colours, roof form and colour, porch and car-porch style are decided per precinct from Street View and 3D tiles.

| # | Archetype |
|---|---|
| 1 | 2-storey intermediate link house, 20'×70' |
| 2 | 2-storey long or corner link house, 22'×80' |
| 3 | 2-storey superlink, 36'×70', rooftop solar |
| 4 | 2-storey semi-detached, 40'×80' |
| 5 | Bungalow |
| 6 | 1-storey twin or stacked townhouse |
| 7 | 2–3-storey shop office row with covered five-foot way |
| 8 | High-rise residential tower |
| 9 | School block |
| 10 | Mosque |
| 11 | Factory (detached and semi-detached) |
| 12 | Mall or low-rise commercial |
| — | Neutral generic, for footprints that match nothing |

**Landmarks** are modelled individually:
- Kanopi Residences (36-storey tower)
- Elmina Lakeside Mall (single-storey, open-air, lakeside)
- Masjid Denai Alam

Others from the research doc are added as they come up: Urban Park tiger playground, Outdoor Sculpture Museum, Elmina Pavilion, Sakura Lake, Elmina Green entrance roundabout.

**Archetype assignment.** OSM gives little: `other` 3,740, `residential` 3,663, `industrial` 184, `commercial` 170, `civic` 46. So assign archetypes from:
- the precinct;
- footprint shape and size (a long, narrow row of attached units means terrace; a large box means mall or factory);
- OSM tags where present;
- visual checks against Street View or 3D tiles.

An unmatched footprint gets the neutral generic, never a guessed archetype. Record the archetype and how it was chosen per building.

**True scale everywhere.**
- Building heights are sampled per footprint from Google 3D tiles. If a sample fails, fall back to the archetype's storey count (for example, a 2-storey link house is about 7–8 m plus roof).
- People are about 1.6–1.8 m tall.
- A Myvi-class car is about 3.9 m long.
- A rain tree canopy is 15–25 m across.

**Variety.** People, vehicles and trees each get **6–10 variants**, plus colour and size jitter, so neighbours never look identical.
- **People:** ages, builds, local dress (office wear, school uniform, tudung, baju kurung, sportswear). Walking, jogging, pushing a stroller, cycling.
- **Vehicles:** unbranded local types (Myvi/Axia-class hatchbacks, sedans, MPVs, pickups, **motorcycles**, food-delivery motorcycles, buses, lorries), in varied colours.
- **Trees:** rain tree, coconut and royal palm, frangipani, flame tree, oil palm (plantation land), shrubs.

**Signage (ADR 0013).**
- Only real names from a source: OSM `name` or `brand` POIs (`data/seed/elmina/base/places.geojson` has 224 places), cross-checked where possible.
- A sign attaches to the nearest building and its source can be opened (for example, "Source: OSM, as of <date>").
- **Text only, no logos.** A shopfront with no source gets a blank sign.
- Signs glow at dusk and night.

**Land cover.**
- Primary source: OSM `landuse` / `natural` (forest, grass, farmland, oil palm, construction, parking, residential, water).
- Gaps filled from **ESA WorldCover 10 m** (CC-BY 4.0; attribute it in `site.json`). Google imagery may also be used for colour and detail (see §2.3).
- Fetch OSM through `data/scripts/overpass.py`, which handles caching, tiling and backoff. Keep requests small.

### 2.5 Lighting and time of day
**Auto mode is the default.** It follows the **real Elmina clock** (Asia/Kuala_Lumpur), as ADR 0011 already does with `cesium/timeOfDay.ts` `themeAt()`.
- The sun position is computed from Elmina's latitude and longitude and the date.
- Day, Dusk and Night are **keyframes** with continuous transitions between them, not three hard switches.

The user can **pin** Day, Dusk or Night. An accelerated cycle (for example, one day in about 10 minutes) is a possible later option; do not build it now unless it comes cheap.

Each keyframe is art-directed separately:

| Keyframe | Look |
|---|---|
| **Night** | As in the reference. Deep blue-violet ambient, warm window light, glowing signs, real lamp light pools, vehicle headlights and tail lights. |
| **Day** | Bright warm sun, crisp soft shadows, stronger AO, sky-tinted ambient, water reflections. |
| **Dusk** | Low orange-pink sun, long shadows, windows switching on progressively. |

Expected techniques (the plan decides the details):
- tone mapping (ACES or AgX);
- an HDRI or sky for image-based lighting;
- sun shadows (cascaded or a fitted shadow camera);
- SSAO or GTAO, plus baked AO on assets;
- selective bloom on emissives;
- emissive window and sign materials;
- many cheap lamp lights (light cards, decals, or clustered lighting).

### 2.6 Motion (ADR 0013)
- Vehicles drive along mapped roads and people walk along footways and park paths.
- Density follows the time of day:
  - busy in the day;
  - a commuter rush with lights coming on at dusk;
  - **fewer at night, but still clearly present**: the owner said night must not be too empty.
- Activity clusters near schools, the mall and parks.
- Also: birds (visible at the camera scale used), tree sway, water shimmer, night window flicker, and drifting cloud shadows by day.
- Keep ADR 0011's gating: pause when the tab is hidden or the map is off screen; stop when Motion is off or `prefers-reduced-motion` is set.
- Animation must use real time, not frame count (0011's Cesium flap and sway sped up with camera motion; do not repeat that).

### 2.7 Camera and detail levels
- **Default view:** the hero district, **Elmina City Centre** around Persiaran Garcinia: Lakeside Mall, lake promenade, Urban Park, Kanopi tower, schools.
- **Projection:** perspective with an isometric feel, about 45° pitch. The off-centre frustum for the side panel stays (see `cesium/home.ts`).
- **Zoom:** down to about 30 m (street level, shopfronts readable) and out to the whole township.

| Level | Range | Shows |
|---|---|---|
| Near | ≤ 300 m | Full archetypes (doors, window frames, balconies, roof equipment), readable signage, people, lamps, benches, vehicles. Must hold up to close inspection. |
| Mid | ≤ 1.5 km | Simplified archetypes, vehicles, trees. |
| Far | whole township | Blocks with true roof colours, land cover; landmarks stay prominent. |

### 2.8 Interaction
- **Pickable:** places, landmarks, signs (showing their source), routes.
- Ordinary buildings show "Building type: <archetype> · Source: OSM (+ height source)".
- **Never pickable:** vehicles, people, birds and other Decorative details.
- Routes, flood overlays and place markers get a visual redesign that fits the new look while keeping their meaning: path status colours and the `confirmed | partly_unverified | blocked | no_data` semantics are unchanged.

---

## 3. Integration with the existing app

- **Scene contract is unchanged.** Renderers adapt intents from the zustand `useScene` store (`apps/web/src/features/scene/sceneStore.ts`). The intents are `camera.fly_to`, `place.focus`, `route.highlight`, `flood.set_level` and `layer.toggle`. The Three.js renderer must handle all of them. The agent never touches the scene.
- **Map style:**
  - `MapStyle = "realistic" | "stylised"`, with `resolveMapStyle` and `defaultMapStyle` in `sceneStore.ts`.
  - Today `cesium/CesiumScene.tsx` mounts `<StylisedCity />` inside the Cesium `<Viewer>` when the style is stylised.
  - Recommended: when the style is stylised, mount a new `three/` renderer (for example, `apps/web/src/features/scene/three/ThreeScene.tsx`) **instead of** the Cesium Viewer, keeping one "3D" view and the existing Stylised/Realistic switch.
  - `selectView.ts` (`View = "cesium" | "mapbox" | "list"`) may need a rename or extension. The plan decides, but the user-facing switcher should stay simple.
  - The error-boundary fallback chain must still work: Three.js fails → Mapbox → List.
- **Overlay layers to port:** Cesium versions live in `cesium/layers.tsx`: `AccessLayer`, `GapsLayer`, `RouteLayer`, `FloodLayer`, `WasteLayer`, plus place markers, the "Why this path?" pick and the place card. Port each to Three.js with the same data sources and semantics. Routes and paths must draw above ground decoration and never be hidden by props or buildings (use depth bias, a slight lift, or an overlay pass).
- **Data endpoints:**
  - `GET /layers/buildings` (`apps/api/src/townshiplens_api/routes/core.py`) returns buildings, trees, hydrology, parks and `as_of`, with ETag; 404 when the world has none.
  - New seed outputs need endpoint fields or new endpoints, then `pnpm gen` and a committed `packages/api-client`: archetype per building, sampled heights, land cover, signage with sources, landmark placements.
- **Coordinates:** use a local east-north-up frame centred on `site.json` `center`. Elmina is a few km across, so a flat frame is fine; convert lon/lat with a precise local projection.
- **Seed data:**
  - `data/seed/elmina/base/`: `buildings.geojson` (7,803), `trees.geojson` (491), `parks.geojson` (89), `hydrology.geojson` (204), `places.geojson` (224), `walk.geojson` (16,148 segments; road widths come from the segment type: major 10 m, street 6 m, footway 2.5 m).
  - New derived data goes through `data/scripts/` like the existing builders (`build_buildings.py` is the model). Commit data separately from code.
- **Tiny fixture** (`packages/spatial/tests/fixtures/tiny`) has no buildings, so e2e stays on the List view. Add at least one 3D smoke test: a fixture world with a few buildings, or a dev-only route, that checks the Three.js scene mounts, renders a frame and handles a `route.highlight` intent.
- **Labels:** keep the "Decorative details are illustrative." disclaimer and the OSM ODbL and Copernicus attributions. Add WorldCover and asset credits.

---

## 4. Phasing

Do the hero district first. **Do not roll out township-wide until the owner has passed the hero district at the gate (§5).**

1. **Phase 0, spike.** A Three.js scene mounted in place of the Stylised Cesium view, rendering the existing footprints and ground in the local frame, with tone mapping, sun shadows, SSAO and bloom. Measure fps on the owner's laptop. Prove the intent wiring with `camera.fly_to` and `route.highlight`.
2. **Phase 1, data.**
   - Height sampling from Google 3D tiles.
   - Archetype assignment.
   - Land cover from OSM plus WorldCover.
   - Signage resolution with sources.
   - Landmark placement.
3. **Phase 2, assets.** Blender scripts for the 12 archetypes plus the generic, 3 landmarks, and prop kits (people, vehicles, trees, street furniture, construction kit), with variants and LODs.
4. **Phase 3, hero district.** The full look in Elmina City Centre:
   - all three keyframes and the auto clock;
   - motion;
   - signage;
   - land cover;
   - ported overlays (routes, flood, places, access, gaps, waste);
   - picking and cards.
5. **Gate.** The owner reviews (§5).
6. **Phase 4, township-wide rollout.** LODs, instancing and streaming by distance; performance tuning.
7. **Phase 5, cleanup.**
   - Retire the Cesium Stylised code (`cesium/stylised/`) once Three.js has replaced it.
   - Update docs: `apps/web/README.md`, `data/README.md` and the AGENTS.md architecture notes about Stylised (but **not** its Google rule).
   - Write an overnight-log entry.

---

## 5. Acceptance

**Visual gate.** For each keyframe (Day, Dusk, Night), take screenshots from fixed camera bookmarks:
- hero district near (about 150 m);
- hero district mid (about 800 m);
- whole township.

Put them side by side with the reference image. **The owner decides pass or fail.** Fix bookmarks in code so the shots can be repeated.

**Performance gate.** The owner's laptop: RTX 2050 4 GB, Ryzen 7 7435HS, 8 GB RAM.
- Default view at Medium quality: **≥ 30 fps** at 1440×900.
- Keep High, Medium and Low tiers with auto-detect and auto-lower, as now in `stylised/quality.ts`.
- Respect the 8 GB RAM: watch texture memory and glTF sizes.

**Honesty checks (tests):**
- decorative layers are not pickable;
- no sign renders without a source;
- flood draws no water surface or depth;
- decorative water never touches flood layers;
- the disclaimer is present.

**CI checklist** from AGENTS.md is green, with each check reported as PASS / FAIL / BLOCKED / NOT RUN.

**Cost.** Google tile loads only in the deliberate height-sampling run and in Realistic mode. Use `LLM_PROVIDER=mock` for development.

---

## 6. Risks and open points for the plan
- **Performance versus quality** on 4 GB VRAM and 8 GB RAM. Quality tiers, instancing, LOD, texture atlases and baked lighting are the levers. Measure in Phase 0 before committing to techniques.
- **Height sampling from Google 3D tiles.** Tiles are ECEF glTF, often Draco-compressed. The approach (for example, a Node script with 3DTilesRendererJS, or Python) is open. Ground height can come from the cached Copernicus DEM in `data/cache/`. Validate samples against known heights (Kanopi is 36 storeys).
- **Archetype assignment accuracy.** Prefer the generic over a confident wrong guess. Log per-precinct coverage.
- **Signage staleness.** Show the source date.
- **Scripted modelling quality.** The agent is not a trained artist. Lean on reference photos, viewport screenshots through Blender MCP, and good third-party assets for props.
- **Two engines.** Realistic stays on Cesium. Moving it to Three.js (3DTilesRendererJS) is deferred (ADR 0012).
