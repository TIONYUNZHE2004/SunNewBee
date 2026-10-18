# Resident journey simulation: design spec

> Date: 19 Oct 2026. Status: approved direction, not started.
> Owner decisions recorded here: R-J1 to R-J7 (see "Rulings").
> Inputs:
> - concept: [docs/03-product/resident-journey-simulation.md](../../03-product/resident-journey-simulation.md);
> - visual prototype: [docs/03-product/prototypes/resident-journey/](../../03-product/prototypes/resident-journey/README.md);
> - 3D map evaluation of 19 Oct 2026, summarised in §3.
>
> **This spec is also the implementation plan:** §8 breaks every phase into tasks with lanes, files, steps, checks and the criteria each task closes. Don't write a separate plan.
>
> This spec is written for a fresh session with no memory of the planning conversation. Read it fully, then read the concept doc and the prototype README, then **open the prototype in a browser** (§9.1), then start at §8.0.

## 1. Goal

In the demo video, a resident asks the assistant for travel advice. The 3D map then **plays the whole trip** with one simulated resident, seen in third person from behind:
- the camera dives in, follows her at street level, and pulls back at the end;
- everything the world model knows about the trip appears where it applies: verified facts, unchecked gaps, rest stops, the destination.

The look is a **toy / miniature clay diorama** of the real Elmina. The owner's target image is [reference-target.png](../../03-product/prototypes/resident-journey/reference-target.png): a clay bus stop with chibi people, flowers, a bus and traffic lights. The prototype is the agreed approximation of it.

The chat answer and the walk always say the same thing. The walk is the answer, shown in place.

### In scope
1. **Phase A:** prerequisite fixes to the current Three.js stylised map (§3).
2. **Phase B:** toy-diorama visual style for the stylised map (§4).
3. **Phase C:** new people models: a rigged hero and a crowd (§5).
4. **Phase D:** the journey simulation itself: backend, contract, agent and player (§6).
5. **The demo story** on one fixed route (§2), reproducible with `DEMO_MODE`.

### Out of scope (this spec)
- **Conditions layer** (R-J1): APIMS haze, MetMalaysia storms, GTFS live buses, `get_conditions` and its validator rule. Leave a seam (`JourneyPlan.conditions: []`) and nothing else.
- Cel outlines and other cartoon variants (R-J2).
- Production hardening for real residents beyond the demo route. The code must still work for any `plan_route` result, but tuning and QA target the demo route.
- Mapbox and Cesium renderers: they only show the step list (§6.5).

## 2. Demo story and route

The route was chosen on 19 Oct 2026 by running `routing.plan_route` from every seed place near the hero district to every clinic and to the other places nearby.

- **Clinics don't work:** from the park area every clinic is 2.4–5 km away, with no verified segment and no rest point after the start.
- **The only short route with every event type** is:

| | |
|---|---|
| From | `osm-way-909868201` "Harmoni 1 @ City of Elmina Show Units" (stand-in for "home") |
| To | `park-b` "Lakeside Mall Car Park B" |
| Profile | `older_adult_rest` (walker) |
| Result | `partly_unverified`, about 966 m, est. 13.8 min, 3 verified rest points, `max_gap_between_rest_m` 639 |

**Story (replaces the clinic example in the concept doc):**
- Aisyah types: *"My mum uses a walker. Can she walk from Harmoni 1 to Lakeside Mall Car Park B?"*
- The assistant answers in chat while the map plays the trip.

Events along the route, all derived from world-model data (the prototype's `build_scene.py` derives exactly these):

| At (m) | Kind | Card title | Source |
|---|---|---|---|
| 0 | covered | Covered walkway | `seg-1239035870-0`, `covered` claim, status `reported` |
| 44 | unknown | Crossing Persiaran Elmina | `seg-909861395-3`, `major_road`, UNKNOWN (no mapped crossing or sidewalk) |
| 100 | gap | No mapped rest stop ahead | route `max_gap_between_rest_m` 639 > profile `max_rest_free_run_m` 100 |
| 193 | unknown | Persiaran Tamarind | street edges, UNKNOWN, about 230 m without a mapped sidewalk |
| 573 | verified | Step-free path | `seg-1318133037-3`, overlay claims `team_survey_placeholder` → "Demo value · not surveyed" |
| 638 | rest | Urban Park bench 3 | rest point, verified (demo value) |
| 836 | unknown | Ramp | `seg-1306543755-2`, `ramp`, incline UNKNOWN |
| 836 | rest | Urban Park bench 2 | rest point, verified (demo value) |
| 888 | rest | Urban Park bench 1 | rest point, verified (demo value) |
| 963 | arrive | Lakeside Mall Car Park B | destination place |

**Check these before relying on them:**
- Segment ids can change after a seed rebuild. Re-derive them; don't hard-code them in product code.
- If the seed changes, re-run `build_scene.py` and update this table.

No new demo facts are needed for this route. If the plan adds any, they must be `team_survey_placeholder` and labelled.

## 3. Phase A: prerequisite fixes to the 3D map

**Evaluation context:** the 3D map was evaluated on 19 Oct 2026 at :5173 with Stylised, High quality, Day and Night themes, on an RTX 2050:
- 73 fps while orbiting, p95 frame 14 ms;
- no console errors except a missing favicon.

**Owner priority:** first the dashed-line toggle, then cropping to Elmina, then the camera, then the visuals.

| # | Problem | Fix (acceptance: see the table below) |
|---|---|---|
| A1 | **Dashed status lines can't be turned off.** With the stroller profile almost every edge is "Not checked yet", so the whole city is orange. | Add a settings toggle "Path status" (default **off**), persisted like other settings in `sceneSettingsStore`. Off: no status lines. A highlighted route and the journey ribbon still show. Legend follows the toggle. |
| A2 | **Status lines draw through roofs.** `features/scene/three/overlays/lines.ts` uses `depthTest: false`, `renderOrder` ≥ 10. | Depth-test against buildings with a small polygon offset or lift, so lines hide behind buildings but stay visible on the ground. Low-angle screenshot shows no lines over roofs. |
| A3 | **Far distance becomes a solid orange band** at low angles. | Fade line opacity by camera distance, or hide beyond a range. With A1 off by default this mostly disappears. |
| A4 | **Map covers much more than Elmina; no visible boundary.** `site.json` has only `bbox` [101.46, 3.15, 101.53, 3.24] and buildings within `radius_m` 3500. `base/precincts.geojson` mixes Elmina and Subang areas, so it is not a boundary. | Build `base/boundary.geojson` (Elmina outline) in a new data script: OSM boundary or landuse relation for City of Elmina through `data/scripts/overpass.py` (cache, small request count), else the union of Elmina-named precincts plus the Urban Park / Lakeside area, buffered. Record it in `site.json` (`boundary`). **Owner signs off the outline** before the renderer uses it. |
| A5 | **Draw only inside Elmina.** | The stylised renderer clips buildings, ground, land cover, trees and decoration to the boundary. The world sits on a diorama slab whose edge follows the boundary (cut soil section, like the prototype). Routing data is not clipped; this is display only. |
| A6 | **Camera can leave Elmina.** | Clamp pan target to the boundary (`clampPose` in `three/cameraRig.ts`), max range so the whole slab fits. |
| A7 | **Wheel zoom is too aggressive.** About 6 wheel steps go from city view to street level. | Zoom step proportional to current range (exponential), with smoothing. Full city → street takes about 15–20 notches. |
| A8 | **Camera enters buildings.** One wheel step went inside a roof. | Minimum height above the nearest building under or between the camera and the target (raycast, or a height lookup on the footprint grid). Follow camera uses the same check (§6.4). |
| A9 | **Link-house roofs too dark; pure-black strips beside them** (`link_intermediate` / `link_long` archetype GLBs in `apps/web/public/city/archetypes/`). | Fix the material or normals so nothing renders pure black; lighter roof palette. Part of the Phase B palette. |
| A10 | **Flat-roof blocks are bland:** one grey, identical windows, empty roofs. | Phase B: palette per building, rounded parapets, window variation. |
| A11 | **Blue-grey roofs read as water,** which conflicts with the flood honesty rule. | No roof colour in the blue / teal water range. Add a test that roof palette hues stay outside the water hue band. |
| A12 | **Large flat grey empty land.** | Dress land by real class (ESA WorldCover / OSM land cover): grass tone variation and flower clumps, massed trees on wooded land, construction dressing on development land. No invented buildings. |
| A13 | **No distance haze; flat sky; hard map edge.** | Sky gradient and distance fog. The slab edge (A5) closes the map. |
| A14 | **Night ground too bright** under a night sky. | Night grade darkens ground and roads. Lamp pools stay. |
| A15 | **No decorative people visible at street level** (not confirmed: too few or too small). | Diagnose first. Phase C replaces the crowd. |
| A16 | **Quality preset can be stuck on Low** from a stale `localStorage` value (`tl.quality`). | Demo recording uses a preset that forces High (see §6.6). |
| A17 | **Missing favicon (404).** | Add one. |
| A18 | **Dashed overlay hides the city at overview.** | Covered by A1 to A3. Keep it listed so the acceptance pass re-checks the overview screenshot. |

### Phase A acceptance criteria (all must pass)

**Screenshot bookmarks:** "the evaluation bookmarks" are five fixed camera poses stored in a test helper. Capture them before and after Phase A at 1440×900, High quality:
- full-city overview;
- mid-range over the hero district;
- street level on Persiaran Tamarind;
- low angle (pitch −10°) over the link houses south of Urban Park;
- night, mid-range.

| # | Criterion | How it is checked |
|---|---|---|
| AC-A1 | A fresh profile (empty `localStorage`) starts with "Path status" **off**: no status-line objects in the scene, and the legend hides status rows. Turning it on draws them. The choice survives a reload. `route.highlight` and the journey ribbon draw in both states. | vitest on `sceneSettingsStore`; Playwright DOM test on the settings popover; scene object count in `ThreeScene.dom.test.tsx` |
| AC-A2 | With status lines on, no line is drawn over a roof. The status-line material depth-tests. At the low-angle bookmark, no line pixel falls on a pixel whose pick hits a building. | vitest on the line material flags; Playwright: sample 300 pixels where `pick` hits a building, compare against a lines-off render (no difference above noise) |
| AC-A3 | Line opacity fades to 0 beyond a set camera distance (default 1,500 m). At the overview bookmark with lines on, line pixels cover < 5% of the map area. | vitest on the fade function; screenshot pixel count by line colour |
| AC-A4 | `base/boundary.geojson` is valid: one Polygon or MultiPolygon, no self-intersection. It **contains** Harmoni 1, Lakeside Mall, Car Park B, Elmina Urban Park, every node of the §2 route, and both `deep_spots` centres. It **excludes** the centroids of every precinct named Subang / Kampung … Subang. Its area is 6–15 km². `site.json` has `boundary`. The owner sign-off is recorded in the ledger. | pytest in `data/scripts/tests`; ledger entry |
| AC-A5 | No building, tree, land-cover, ground or decoration vertex lies more than 5 m outside the boundary. At the overview bookmark the slab edge with its soil section is visible on every side of the map. Routing, evaluation and the API are unchanged: the golden questions pass, and the `/routes` output for the §2 route is identical. | vitest on the clip function with the seed; screenshot review; `pnpm golden`; pytest comparing route JSON before and after |
| AC-A6 | `clampPose` keeps the target inside the boundary for 1,000 random poses. At max range the whole slab is in view: all slab corners project inside the viewport. | vitest |
| AC-A7 | From max range to min range takes 15–25 wheel notches. No single notch changes the range by more than 20%. The change is smoothed over ≥ 4 frames. | vitest on the zoom function; Playwright counts notches |
| AC-A8 | After 300 random wheel, drag and rotate operations over the hero district, the camera is never inside a building footprint below roof height + 2 m in any sampled frame (every frame, about 2,000). | Playwright stress script with a footprint lookup |
| AC-A9 | At the link-house bookmark, < 0.5% of building pixels have luminance < 0.03. No archetype material renders pure black. | Screenshot luminance histogram masked by building pick; vitest on archetype material colours |
| AC-A10 | In the hero district, flat-roof blocks use ≥ 5 wall colours and ≥ 3 window patterns; roofs carry ≥ 2 kinds of roof detail. | vitest on facade and roof plans for the seed |
| AC-A11 | No roof colour lies within ±25° hue of the water material when saturation > 0.15. | vitest over the roof palette and archetype roofs |
| AC-A12 | Every land-cover class in `base/landcover.geojson` has a dressing rule (table complete, no fallback to bare grey). Grass shows ≥ 2 tones. The building count equals the OSM footprint count in the boundary; no invented buildings. | vitest on the dressing table and building plan |
| AC-A13 | The sky is a gradient, not one colour; fog is on. At the overview bookmark the far ground blends towards the fog colour (the top 10% of ground pixels are within ΔE 15 of it). | Screenshot sampling; vitest on scene config |
| AC-A14 | Mean luminance of ground and road pixels at the night bookmark is ≤ 35% of the day value at the same pose. Lamp pools are still visible (bright pixels near lamp positions). | Paired screenshots, pick-masked |
| AC-A15 | The ledger records why people are not visible at street level (count and on-screen size of agents at the street bookmark), with the fix or a hand-off to Phase C. | Ledger review |
| AC-A16 | With `tl.quality=low` in `localStorage`, loading the demo preset URL (§6.6) renders at High. A normal load keeps the user's choice. | Playwright |
| AC-A17 | Loading `/` and `/tickets` logs no console error and no 404. | Playwright console capture |
| AC-A18 | At the overview bookmark with defaults, the city reads as a city: status-line pixels < 1% of the map area. The before and after screenshot pairs for all five bookmarks are stored in the ledger folder and reviewed by the AI reviewer. | Screenshot pixel count plus reviewer note |
| AC-A19 | **No regression:** median fps while orbiting at the mid-range bookmark ≥ 60 (baseline 73) on the reference laptop. The full CI checklist passes. | `frameStats`; CI checklist |

## 4. Phase B: toy-diorama visual style

**Target:**
- the reference image, approximated by the prototype;
- style variant: **plain toy, no outlines** (R-J2).

**The rendering becomes toy-like; the facts do not.** Footprints, positions, heights, the walk network and every world-model fact stay as they are.

### B1. Look
- **Materials:** clay. In the prototype that is `MeshPhysicalMaterial`, roughness about 0.7, light sheen, a soft pastel palette per role. Apply through `assets/roleMaterial.ts` and the facade, roof and ground layers.
- **Light:**
  - warm sun with soft shadows (PCF soft, shadow frustum following the camera focus);
  - hemisphere fill;
  - ambient occlusion (an AO pass already exists: `three/aoPass.ts`).
- **Grade:** Neutral tone mapping, slightly saturated pastels.
- **Tilt-shift:** depth-of-field focused on the subject. In follow mode the focus is the hero; in overview it is the map centre. The prototype uses `BokehPass` with aperture tuned by camera distance. Respect `prefers-reduced-motion`, and keep a quality switch to disable it.
- **Shapes:** rounded edges everywhere.
  - Buildings use bevelled extrusion; the prototype uses `ExtrudeGeometry` with bevel and negative `bevelOffset`, so footprints keep their size.
  - Trees are clustered spheres, not faceted icosahedra.
- **Diorama slab:** the map sits on a slab with a layered soil edge that follows the Elmina boundary (A5).

### B2. Street dressing kit
**Fact-bearing props**, placed **only where OSM maps them**. They are accessibility facts:
- zebra crossings (`crossing` edges, as in the prototype);
- traffic signals (`highway=traffic_signals` nodes);
- bus stops and shelters (`highway=bus_stop`, `amenity=shelter`; seed places of type `shelter`);
- benches (seating places).

Any new OSM import goes through `overpass.py`.

**Decorative props**, labelled "Decorative details are illustrative.":
- flower planters, lamp posts along kerbs, kerb edging, grass tufts, flowers in parks;
- cars and the crowd.

A decorative prop never triggers a journey event.

### B3. Detail bubble and budget
- **Inside about 150 m of the hero:** street-level detail. That means the dressing kit, high-detail trees and crowd, and kerb geometry.
- **Outside the bubble:** today's LOD.
- **Tilt-shift** blurs the far field, which hides the lower detail.
- **Budget on the reference laptop (RTX 2050):**
  - at least 50 fps in follow mode at 1440×900 with High quality and FX on;
  - at least 30 fps on Medium quality without FX on integrated graphics.
- Record measured numbers in the plan's ledger.

### Phase B acceptance criteria (all must pass)

**Beats:** "the beats" are the §9.1 capture points (dive, each §2 event, mid-walk on Persiaran Tamarind, end of pull-back). Until Phase D lands, they are camera poses at the same places, set by a test helper.

| # | Criterion | How it is checked |
|---|---|---|
| AC-B1 | Every surface material comes from one clay token table: roughness 0.6–0.8, sheen > 0, no metalness except props, pastel palette. No ad-hoc colours in layer code. | vitest on the token table; grep test that layer files import colours only from it |
| AC-B2 | **Fact fidelity under rounding:** each building's rendered footprint area is within ±2% of its OSM footprint, its vertices are within 0.15 m of the outline, and its top is within ±0.1 m of `display_height_m`. | vitest on the building geometry for every seed building in the boundary |
| AC-B3 | **Rounded look:** buildings, roofs, kerbs, footways, trees and props all have bevel or smooth geometry. No building edge renders with a hard 90° profile at the street bookmark. | vitest on generator options; reviewer note on the street screenshot |
| AC-B4 | **Tilt-shift:** in follow mode, the hero region is sharp and the far background (> 60 m) is blurred. The ratio of Laplacian variance (hero box vs. top band of the frame) is ≥ 3 at every follow beat. In overview, a horizontal focus band is visible. | Screenshot analysis script |
| AC-B5 | The FX toggle, Low and Medium quality, and `prefers-reduced-motion` turn depth of field off. Low also turns AO off. | vitest on the quality presets; Playwright with reduced motion |
| AC-B6 | At every beat and at the day, dusk and night bookmarks, < 0.5% of pixels have luminance < 0.03 and < 0.5% are clipped white. | Screenshot histogram |
| AC-B7 | **Fact-bearing props match data one to one:** the count of zebra crossings, signals, bus stops / shelters and benches drawn in the boundary equals the count of matching data features. Each instance carries its source id. None is drawn without one. | vitest on the dressing plan against the seed |
| AC-B8 | Decorative props never appear in `JourneyPlan`, never cause an event, and the "Decorative details are illustrative." note is on screen whenever they are visible. | Import-boundary test; Playwright checks the note at each beat |
| AC-B9 | **Detail bubble:** within 150 m of the focus point, street dressing is present. The switch at the bubble edge fades over ≥ 0.5 s, with no single-frame pop. | vitest on bubble membership; 5 s capture reviewed |
| AC-B10 | The slab edge follows the boundary (A5) and shows ≥ 3 soil layers at the overview bookmark. | Screenshot review |
| AC-B11 | **Performance:** the §B3 budget holds during a scripted fly-through of the beats: median ≥ 50 fps and ≤ 5% of frames over 33 ms on the reference laptop with High and FX on; ≥ 30 fps on Medium without FX. Time to first frame ≤ 8 s on a warm local dev server. | `frameStats` capture; Playwright timing |
| AC-B12 | **Matches the idea:** the §9.1 "Look" row passes at every beat, and the owner approves the first screenshot set (§9.3) before the style rolls out city-wide. | AI reviewer report; owner checkpoint in the ledger |

## 5. Phase C: people models

**Scale (R-J3): the owner overrides the true-scale rule for people only.**
- People may use chibi proportions (head about 1:2.6 of height) and be drawn at **1.4–1.55× true scale**, at all distances.
- Buildings, roads and every fact stay true scale.
- People are decorative, so enlarging them changes no fact.
- Distance scaling follows R-J7 (see P6).
- Record R-J3 and R-J7 in `docs/superpowers/ai-world-model-log.md` as rulings.

**Baseline today:**
- `apps/web/public/city/kits/people.glb` holds 10 archetypes × 2 LODs, about 8k triangles in all;
- no skeleton, no animation clips;
- limbs swing in a shader (`motion/agents.ts`).

The prototype's primitive hero is the **floor**: every Phase C result must read better than it, beat by beat (§9.1).

### C1. Hero (one per journey)
- **Model:** a rigged chibi with a skeletal walk cycle.
- **Prop variants:** walker (`older_adult_rest`), stroller (`stroller`), wheelchair (`wheelchair`), none (`walking`). The demo needs the **walker** variant. The other three may ship as one shared body with a prop swap.
- **Look for the demo:** an older woman, purple baju kurung, lilac tudung, face visible in 3/4 view.
- **Highlight:** a ring on the ground (yellow, as in the prototype), so she stands out from the crowd.
- **Files:**
  - `apps/web/public/city/characters/hero_<variant>.glb`, one skinned mesh plus its prop;
  - a manifest entry like the existing `assets/manifest.ts`;
  - source `.blend` and the build script committed under `data/scripts/characters/` (or the plan's chosen folder), so the asset can be rebuilt.

#### C1 acceptance criteria (all must pass)

| # | Criterion | How it is checked |
|---|---|---|
| H1 | **Clips present, named exactly:** `walk` (loop), `idle` (loop), `sit_down`, `sit_idle` (loop), `stand_up`, `look` (pause and look around, for UNKNOWN events). `sit_down` and `stand_up` ≤ 1.5 s each. | vitest reads the GLB: clip names and durations |
| H2 | **Rig budget:** ≤ 60 bones (WebGL skinning limit, headroom); 1 skinned mesh plus ≤ 2 prop meshes; ≤ 3 materials; textures ≤ 1024², or none (vertex colours). | vitest on the GLB |
| H3 | **Geometry budget:** LOD0 6k–15k triangles; LOD1 ≤ 2k triangles, used beyond 40 m; GLB ≤ 1.5 MB after the same compression as the city kits. | vitest on the GLB plus file size |
| H4 | **Chibi proportions (R-J3):** head height (crown to chin, incl. tudung) is 1/2.4–1/2.8 of total height. Displayed standing height is 2.2–2.5 m in scene units (true 1.55 m × 1.4–1.55). | vitest: bounding box of the head bone group vs the whole mesh at the displayed scale |
| H5 | **Ground contact:** walking at the demo pace (about 1.16 m/s), foot slide ≤ 5 cm per step; feet and walker legs never float > 3 cm or sink > 3 cm on flat footway. The walk-cycle speed is tied to the pace, not fixed. | Playwright frame sampling in a test scene: foot-bone and walker-leg world height and slide per step |
| H6 | **Walker held, not floating:** both hands stay on the walker grips (≤ 3 cm) through `walk`, `idle` and `look`. The walker is parked beside her during `sit_*`. | Same test scene: hand-bone to grip distance |
| H7 | **Sitting:** in `sit_idle` on a prototype-sized bench (seat 0.45 m true × scale), the hip sits on the seat within ±5 cm, with no clipping through seat or back. | Screenshot from the side plus a bone-height check |
| H8 | **Readable from every camera the player uses.** In-engine screenshots at the follow pose (8.5 m back, 4.5 m side, 4.2 m up), straight behind, 3/4 front, side, and at 30 m and 80 m. In each, a reviewer who is told nothing can name "an older woman with a walker". From behind, the silhouette shows separate head / tudung, shoulders, arms and walker, not one blob. | AI reviewer (blind prompt: "describe the figure in the ring") plus owner checkpoint |
| H9 | **Cultural correctness:** tudung covers hair, ears and neck at every animation frame; baju kurung has long sleeves and reaches the ankle; no skin gap at the wrist or neck during `walk` or `sit_*`. | Turntable sheet plus 12 sampled animation frames; owner signs off |
| H10 | **Face in 3/4:** eyes and a mouth or blush mark are visible at the 3/4 front pose and at the rest-stop framing. | Screenshot review |
| H11 | **Frame cost:** adding the hero (skinning, FX on) costs ≤ 1.0 ms per frame on the reference laptop (RTX 2050, 1440×900, High). | `frameStats` with and without the hero, 10 s each, median |
| H12 | **Credits:** every source asset is in `CREDITS.md` (URL, licence, files, location); licence is CC0, or CC-BY with attribution shown on the page. | Review of `CREDITS.md` |

**Checkpoints before H1–H12:**
- (a) a modelling sheet: front, side, back and 3/4 renders in T-pose, plus the walker. The owner approves it before rigging (§9.3).
- (b) a turntable of the rigged model in `walk` and `sit_idle`.

### C2. Crowd
- **Base characters:** CC0 packs (Quaternius, Kenney, or Poly Pizza CC0), localised in Blender:
  - outfits: tudung, baju kurung, songkok, school uniforms;
  - props: stroller, walker, wheelchair.
- **Variety by combination:** body × head × outfit × prop (ADR 0013).
- **Animation:** baked to a vertex animation texture so hundreds can walk cheaply. Today's shader limb swing in `motion/agents.ts` is the same idea.
- **Behaviour:**
  - the crowd walks the footway network (reuse `planAgents`, `poseAt`, `smoothYaw`);
  - density is highest in the detail bubble;
  - the crowd never blocks or interacts with the hero.
- **Legal and tooling:**
  - record every asset in `CREDITS.md` (URL, licence, files, where it lives);
  - pin versions;
  - the Blender MCP was available in the planning session, and `blender -b -P script.py` works headless (Blender 5.2 at `C:\Program Files\Blender Foundation\Blender 5.2`).

#### C2 acceptance criteria (all must pass)

| # | Criterion | How it is checked |
|---|---|---|
| P1 | **Coverage:** at least 6 base bodies: child, school-age, adult man, adult woman, older man, older woman. | Manifest test |
| P2 | **Local dress:** tudung with baju kurung, songkok with baju melayu, school uniforms (white shirt with dark trousers; pinafore with tudung), office wear, casual. Every body has ≥ 3 outfits. ≥ 24 distinct looks in all, counting props (stroller, walker, wheelchair) as distinct. | Manifest test counts looks; owner reviews a contact sheet of all looks |
| P3 | **No twins nearby:** in any follow-camera frame of the demo route, no two people within 10 m of each other share the same look. Look assignment is seeded and deterministic. | vitest on the look-assignment function over the demo route's agent plan |
| P4 | **Budget:** LOD0 ≤ 1.5k triangles per person; LOD1 ≤ 400; hidden beyond 300 m. Crowd draw calls ≤ 20 (instanced). Crowd VAT textures ≤ 4 MB in all. | vitest on the GLB plus `renderer.info` in a test scene |
| P5 | **Animation:** `walk` and `idle` baked to VAT; the cycle rate matches each agent's speed within ±10%, so no visible skating. Agents start at random phases, so no synchronised marching. | vitest on the timing maths plus a 5 s screen capture reviewed by the AI reviewer |
| P6 | **Scale (R-J3, R-J7):** displayed height is 1.4–1.55 × true height within 300 m of the camera, the same as the hero. Beyond 300 m it rises smoothly (no step) to at most 2.5× at 800 m and stays there, so far crowds stay visible. This replaces the old `displayScale` curve (1× to 3×). The hero always uses 1.55×. | vitest on the scale function: values at 0, 300, 550, 800 and 1,500 m, monotonic, continuous |
| P7 | **On the footways:** ≥ 95% of sampled agent positions over 60 s lie within 1.5 m of a walk edge, and none inside a building footprint or water. | vitest with a seeded plan on the demo corridor |
| P8 | **Keep-out around the hero:** no crowd agent comes within 2 m of the hero, or of the route ahead of her within the next 10 m. The crowd never causes a hero stop. | Player test: sample the minimum distance over the full demo playback |
| P9 | **Decorative only:** `JourneyPlan` and the event cards never reference a crowd agent. The crowd module does not import journey events. Crowd figures sit under the "Decorative details are illustrative." note. | Import-boundary test plus a `JourneyPlan` schema test |
| P10 | **Performance:** 400 crowd agents visible in the detail bubble, with the hero, FX on, keep the §B3 budget (≥ 50 fps follow mode, RTX 2050, 1440×900, High). | `frameStats` capture during the demo playback |
| P11 | **Credits:** every pack is in `CREDITS.md` with licence and files. | Review |

## 6. Phase D: the journey simulation

**Principle: the backend computes the whole trip deterministically; the frontend only plays it.** The LLM never computes facts, and the renderer never invents events.

### 6.1 Backend: `packages/spatial/src/townshiplens_spatial/journey.py`
- `build_journey(world, route: Route, profile, start_time) -> JourneyPlan`.
- `JourneyPlan` contains:
  - `route_id`, `profile`, `start_time`, `pace_m_per_s`;
  - `polyline` (route coordinates in travel order; segment coordinates must be oriented and chained, as `build_scene.py` does);
  - `spans` (`[from_m, to_m, eval]`);
  - `events` (ordered);
  - `conditions: []` (seam for later).
- **Event fields:** `kind` (`covered|unknown|gap|verified|rest|arrive`), `at_m`, `element_id`, `attribute`s, `status`, `demo: bool`, `evidence_id`, `title`, `body`, `hold_s` (simulated seconds: rest 60, unknown 8, others 3).
- **Derivation rules:** port them from `docs/03-product/prototypes/resident-journey/build_scene.py`:
  - first `covered` claim;
  - first UNKNOWN `major_road` crossing;
  - rest-gap event when `max_gap_between_rest_m > rest_limit_m`;
  - longest named UNKNOWN street run;
  - first PASS segment as "verified";
  - UNKNOWN ramps;
  - each rest point;
  - arrival.

  Collapse UNKNOWN runs so a route with 28 unknown edges produces a few readable events, not 28 stops.
- **Pace:** reuse `routing._pace_m_per_min(profile)`, which reads `speed_kmh` from `config/profiles/*.yaml` and falls back to `WALK_M_PER_MIN`. This keeps the walk consistent with `Route.est_minutes`.
- **Evidence:** every event cites an `evidence_id` that `plan_route` returned this turn (`routing.evidence_for_route`). An event without evidence is a bug.
- **Tests (pytest + hypothesis):**
  - events are sorted by `at_m`;
  - every event has `element_id` or an explicit route-level source;
  - every event `evidence_id` is in the route's evidence;
  - no event's kind contradicts the edge eval;
  - the demo route yields the §2 table.

### 6.2 Contract
- **New scene intent `journey.play`** with fields `{route_id, start_time}`.
  - The agent and mock emit it after `plan_route`.
  - The server attaches the `JourneyPlan` the same way it attaches route geometry for `route.highlight` (`packages/agent/src/townshiplens_agent/run.py` around line 325).
- **REST:** `POST /journeys` with body `{from_id, to_id, profile, start_time, scenario_id?}`, returning a `JourneyPlan`. Routes are planned per request and there is no route store, so the endpoint does not look up a route id. Used for replay and debugging.
- **Event types:** update `packages/agent/.../events.py`, then run `pnpm gen` and commit `packages/api-client`.
- **Frontend:** `sceneStore.applyIntent` handles `journey.play`. The chat reducer passes it through like the other scene intents.

### 6.3 Agent, mock, template, validator
- These four change together (AGENTS.md).
- **Validator rule:** a `journey.play` intent must reference a route returned this turn. The answer text must not contradict the plan (rest count, unknown places).
- **Answer wording** must follow every honesty invariant:
  - "No known barrier", never "verified", for OSM-derived passability;
  - "demo values, not yet surveyed" for placeholder evidence;
  - never "safe".
- The prototype's chat bubble is the target tone.

### 6.4 Player (Three.js)
**Timeline**, in screen seconds:
- dive: 4 s;
- walk phases at **20× compression** (1 trip minute ≈ 3 s on screen);
- event holds:

  | Event | Screen time | Simulated time | Hero |
  |---|---|---|---|
  | verified | 3.2 s | +3 s | keeps walking slowly |
  | unknown | 3.6 s | +8 s | stops and looks |
  | rest | 4.2 s | +60 s | walks to the bench, sits, stands |
  | gap | 3.4 s | +3 s | walks |
  | covered | 3.0 s | +3 s | walks |
  | arrive | 3.2 s | — | stops |

- then pull-back: 5 s.
- Total for the demo route: about 86 s. These values are copied from the prototype; tune them there first.

**Camera:**
- a new **follow mode**, separate from the orbit rig;
- behind and to the side of the hero (prototype: 8.5 m back, 4.5 m side, 4.2 m up, looking 4 m ahead), smoothed;
- the dive and the pull-back tween between the overview pose and the follow pose;
- **per-event framing:** the ramp shot in the prototype loses the ramp behind the mall podium, so each event kind gets a framing rule (rest: side view of the bench; unknown: look at the element);
- building clearance per A8: lift over obstacles, never dive into the hero.

**Overlay UI:**
- the "Simulation · indicative times, not a prediction" label, always visible;
- HUD: clock from the start time, distance walked, minutes outdoors (paused under covered segments), rests;
- mini-map: route coloured by span status, plus the hero dot;
- event cards anchored to the event's 3D position. Each card shows the source line, "Demo value · not surveyed" when demo, and the element id;
- event markers drawn after post-processing. In the prototype, post passes rendered sprites as black quads, so markers live in a separate overlay scene.

**Route ribbon:**
- PASS solid green, UNKNOWN amber dashes;
- visible even when the A1 status toggle is off.

**Controls (R-J4):**
- play / pause, restart, timeline scrub, and camera mode (follow / overview / free);
- a test and recording hook `window.__journey` with `seek`, `play`, `pause`, `setCam`, `phases` and `total`, the same API as the prototype. It is used by e2e and the acceptance pass.

**Code reuse:** `motion/agents.ts` (`poseAt`, `smoothYaw`), `cameraRig.ts` (`tweenPose`), `routeLine.ts`.

### 6.5 Other renderers
Mapbox lite and the List view render the same `JourneyPlan.events` as a numbered step list with the same cards. No animation.

### 6.6 Demo recording
- Record the demo turn with the mock: `LLM_PROVIDER=mock uv run python -m townshiplens_agent.cli --record "<question>" --profile older_adult_rest`. Never record with a live model.
- `DEMO_MODE=true` replays it.
- **Recording preset:**
  - a query flag such as `?demo=1` (or equivalent) forces Stylised, High quality, Day theme, status lines off and assistant open;
  - the trip auto-plays when the answer arrives.

### Phase D acceptance criteria (all must pass)

**Backend and contract (D1–D3)**

| # | Criterion | How it is checked |
|---|---|---|
| AC-D1 | For the §2 route, `build_journey` returns exactly the §2 events: same kinds, same order, `at_m` within ±2 m, and the same titles. | pytest against the seed |
| AC-D2 | **Property tests on random place pairs in the seed** (hypothesis, ≥ 200 examples, routes ≤ 2 km): events sorted by `at_m`; every event has an `element_id` or a named route-level source; every `evidence_id` is in that turn's evidence; `demo` is true exactly when the evidence is `team_survey_placeholder`; no `verified` event on a non-PASS edge; no `unknown` event on a PASS edge. | pytest + hypothesis |
| AC-D3 | **Readable event count:** for any route ≤ 2 km, ≤ 12 events (UNKNOWN runs collapsed); for the §2 route, exactly the §2 count. | pytest + hypothesis |
| AC-D4 | **Same plan everywhere:** the `JourneyPlan` attached to `journey.play` over SSE equals the one from `POST /journeys` for the same endpoints, profile and start time. `pnpm gen` leaves no diff. | API pytest; CI step 5 |
| AC-D5 | **Validator:** it rejects a `journey.play` whose route was not returned this turn, and an answer whose rest count or unchecked-place count contradicts the plan. The mock answer and the template answer for the demo question pass. A golden question for the demo question is added and passes. | pytest on `validate.py`; `pnpm golden` |
| AC-D6 | **Wording:** no card title, card body, answer or label contains "safe", "selamat", "安全" or a water depth. "Verified" appears only for verified claims. Demo facts carry "Demo value · not surveyed" on cards and "demo values, not yet surveyed" in the answer. | String-scan test over the plan, the mock answer and the UI strings |

**Player (D4)**

| # | Criterion | How it is checked |
|---|---|---|
| AC-D7 | **Timeline maths:** the total screen time equals the sum of the phases; walk phases run at 20× ± 1%; the hold times match §6.4. At the start of each event, the HUD clock, distance and rest count equal the plan's values (clock to the minute, distance within ±2 m). | vitest on the timeline module |
| AC-D8 | **Hero in frame:** over a full playback sampled at 10 Hz, the hero's screen box lies inside the frame with a 10% margin in ≥ 98% of follow-phase samples. She is not hidden by a building (raycast from the camera) in ≥ 95%. At every event hold, the event's element (crossing, ramp, bench, path) projects inside the frame. | Playwright sampling through `window.__journey` |
| AC-D9 | **No clipping:** the camera never comes within 1.5 m of the hero's mesh, and is never inside a building, in any sampled frame. | Same sampling |
| AC-D10 | **Hero behaviour:** she walks during walk phases; stops and plays `look` at each `unknown`; walks to the bench, sits for the hold and stands at each `rest`; stops at `arrive`. Her feet and walker stay on the footway (≤ 3 cm off the ground). | Sampling of the animation state and bone heights per phase |
| AC-D11 | **Cards and markers:** during each hold exactly one card is visible, fully inside the viewport, with the plan's title, body and source line. The demo chip shows exactly when `demo` is true. Markers are never drawn as opaque quads (the prototype bug). | Playwright DOM checks per hold; screenshot check around markers |
| AC-D12 | **Always-on labels:** the "Simulation · indicative times, not a prediction" label is visible in 100% of sampled frames; the mini-map hero dot tracks the hero within 3 px. | Playwright |
| AC-D13 | **Controls:** play, pause, restart, scrub (to any phase, and the state matches a straight play to that time) and the follow / overview / free modes work. `window.__journey` exposes `seek`, `play`, `pause`, `setCam`, `phases` and `total`, with the same meaning as in the prototype. | Playwright; API shape test |
| AC-D14 | **Other renderers:** the List view and Mapbox lite show every event in order as numbered steps, with the same titles and source lines. e2e runs this on the tiny fixture. | `pnpm --filter @tl/web e2e` |
| AC-D15 | **Performance:** during a full playback of the demo route with crowd, hero and FX on, median ≥ 50 fps and ≤ 5% of frames over 33 ms on the reference laptop. | `frameStats` capture |

**Demo recording (§6.6)**

| # | Criterion | How it is checked |
|---|---|---|
| AC-D16 | The demo turn is recorded with `LLM_PROVIDER=mock` only. `DEMO_MODE=true` replays it, and `meta.world` matches the loaded world. | Inspect the `data/demo/*.jsonl` meta; CLI refuses live recording |
| AC-D17 | **Deterministic:** two runs of the demo preset produce identical `JourneyPlan` JSON and identical camera poses at every beat (±1 cm, ±0.1°). Crowd and cars are seeded, so beat screenshots differ by < 1% of pixels. | Playwright double run |
| AC-D18 | **One clean take:** from page load with the demo preset, through question, answer, dive, all events and pull-back, it runs to the end with no console error, no manual step and no hitch over 100 ms. Total length 80–100 s for the §2 route. | Playwright run with a frame-time log |
| AC-D19 | **Matches the idea:** every row of the §9.1 rubric passes at every beat, and the owner approves the final demo run (§9.3). | AI reviewer report; owner checkpoint in the ledger |

## 7. Honesty rules (all existing invariants apply)

- **The "Simulation" label is always on screen.** Times and distances are indicative. The walk shows the route model, not a prediction.
- **Only world-model facts cause events.** Decorative cars, people, flowers and planters never make the hero stop, turn or wait.
- **Fact-bearing street props** (crossings, signals, bus stops, benches) appear only where the data has them.
- **Demo values** show "Demo value · not surveyed" on cards and in the answer text.
- **Gaps are named as gaps:**
  - "Not checked yet" plus "verification request filed" for UNKNOWN;
  - "No mapped rest stop ahead" for the rest gap.
  - Never "blocked" or "unsafe" for missing data.
- **No water-coloured roofs** (A11). Base water is never presented as a flood scenario.
- **Recorded rulings:** R-J3 (people scale) goes into the world-model log.

## 8. Execution plan (task breakdown)

**This section is the implementation plan. There is no separate plan document.** Execute it task by task with `superpowers:subagent-driven-development` (or `executing-plans` inline).

### 8.0 How to run it
- **Ledger:**
  - create `.superpowers/sdd/journey-sim/ledger.md` (gitignored) before the first task;
  - one line per task: `<task id> | lane | state (todo/doing/review/done/blocked) | commit(s) | criteria PASS/FAIL/BLOCKED with evidence`;
  - rulings go there as "Ruling: what — why — cost if wrong".
  - After a context reset, trust the ledger plus `git log` over memory.
- **Lanes:**
  - worktrees `../SunNiuBi-wt/<lane>` on branches `lane/fe`, `lane/be`, `lane/ai`, `lane/data`, plus `lane/assets` for Phase C models (create it like the others);
  - subagents commit on their lane and never push to `main`;
  - the coordinator merges with `--no-ff`, runs the full CI checklist (AGENTS.md, `set -o pipefail`), then pushes.
- **Each task:**
  1. Write the failing test(s) for the criteria it closes (TDD).
  2. Implement.
  3. Run the listed checks.
  4. Commit with a Conventional scope (`feat(web)`, `feat(spatial)`, `feat(api)`, `feat(agent)`, `data:`, `docs:`, `chore(assets)`).
  5. Update the ledger.
- **Review:** a task is "done" only after a reviewer subagent (`superpowers:requesting-code-review`) finds no blocking issue.
- **Checkpoints (STOP):** stop and ask the owner at the four §9.3 checkpoints. Don't continue past one without an answer.
- **Acceptance harness:** visual and performance criteria run against the dev server (`pnpm dev`, Elmina seed, `LLM_PROVIDER=mock`) on :5173, through the harness built in A-T0. They are not part of CI e2e, which stays on the tiny fixture. They run on the reference laptop.

### 8.1 Waves (what can run in parallel)

| Wave | `lane/fe` | `lane/data` | `lane/be` + `lane/ai` | `lane/assets` |
|---|---|---|---|---|
| 1 | A-T0 → A-T1, A-T2, A-T6, A-T7, A-T8, A-T9, A-T11, A-T12, A-T13 | A-T3 (STOP: boundary sign-off), B-T6 | D-T1 → D-T2 → D-T3 | C-T1 → C-T2 (STOP: modelling sheet) |
| 2 | A-T4, A-T5, A-T10 → A-T14 (Phase A gate) | — | D-T4 (contract types) | C-T3, C-T6 |
| 3 | B-T1 → B-T2, B-T3, B-T4, B-T5 → B-T7, B-T8, B-T9 → B-T10 (STOP: style screenshots) | — | — | C-T7 |
| 4 | C-T4, C-T8, D-T5, D-T6, D-T7, D-T8, D-T9 | — | — | C-T5 → C-T9 (Phase C gate) |
| 5 | D-T10 → D-T11 (Phase D gate, STOP: final demo run) | — | — | — |

D-T4, D-T7 and D-T8 can start in wave 2 against a fixture `JourneyPlan` converted from the prototype's `scene.js`; they don't need to wait for the backend.

### 8.2 Phase A tasks

**A-T0 Acceptance harness and baseline** · `lane/fe` · depends: — · enables every visual and performance criterion
- Files:
  - `apps/web/acceptance/playwright.acceptance.config.ts` (baseURL :5173, 1440×900, no webServer);
  - `apps/web/acceptance/support/{bookmarks,pixels,frames,journey}.ts`;
  - script `"acceptance"` in `apps/web/package.json`.
- Helpers:
  - `gotoBookmark(name)`: the five §3 bookmarks, set through the existing camera ops or `three/bookmarks.ts`;
  - `pickMask(kind)`: building / ground / road pixel masks via `three/pick.ts`;
  - `lumaHistogram`, `countColour(hex, tol)`, `laplacianVariance(box)`;
  - `captureFrameStats(seconds)`: wraps `three/frameStats.ts`;
  - `journey.seek/play` (used from Phase D).
- Steps:
  1. Build the helpers with unit tests for the pixel maths (vitest, node).
  2. Capture the **baseline** screenshots and orbit fps for the five bookmarks into `.superpowers/sdd/journey-sim/acceptance/baseline/`.
- Check: `pnpm --filter @tl/web acceptance -g baseline` produces 5 PNGs and a JSON of metrics.

**A-T1 Path status toggle** · `lane/fe` · depends: — · closes AC-A1
- Files: `features/scene/sceneSettingsStore.ts` (new `pathStatus: boolean`, default false, persisted), `features/map-ui/SettingsPopover.tsx` (toggle in the Legend section), `features/scene/StatusLegend.tsx` (hide status rows when off), the Three.js status-line layer mount (`three/overlays/lines.ts` and where `ThreeScene.tsx` adds it), the Mapbox and Cesium status layers (respect the flag too), tests next to each.
- Steps:
  1. Store test.
  2. Popover DOM test.
  3. Scene test: no status-line objects when off; the route highlight still present.
  4. Implement.
- Check: vitest for the touched files; `pnpm --filter @tl/web e2e` (List view unaffected).

**A-T2 Depth-tested, distance-faded status lines** · `lane/fe` · depends: A-T0 · closes AC-A2, AC-A3, AC-A18
- Files: `three/overlays/lines.ts` (+ test).
- Steps:
  1. Test the material: `depthTest: true`, polygon offset or a lift of about 0.3 m above the ground ribbons.
  2. Test the fade function: opacity = 1 below 900 m, 0 above 1,500 m, smooth in between.
  3. Keep `renderOrder` above the ground but below buildings.
  4. Acceptance: low-angle pick-mask check and overview line-pixel share.
- Check: vitest; `acceptance -g "AC-A2|AC-A3|AC-A18"`.

**A-T3 Elmina boundary data** · `lane/data` · depends: — · closes AC-A4 · **STOP for owner sign-off**
- Files: `data/scripts/build_boundary.py`, `data/scripts/tests/test_boundary.py`, `data/seed/elmina/base/boundary.geojson`, `site.json` (`boundary` key), `packages/spatial` `Site` model (optional `boundary` field), `data/README.md`.
- Steps:
  1. Query OSM through `overpass.py`: City of Elmina boundary, or a `landuse` / `place` relation. Keep it to a few requests, cached.
  2. Fallback: the union of precinct polygons whose name contains "Elmina", plus the Urban Park / Lakeside Mall / Harmoni area, buffered 60 m and simplified to about 5 m.
  3. Tests for the AC-A4 containment, exclusion and area rules.
  4. Render a PNG of the outline over the buildings for the owner.
  5. STOP.
- Commit data separately from code (`data:`).
- Check: `uv run pytest data/scripts/tests/test_boundary.py -q`; `pnpm gen` (if the `Site` model changed) with the client committed.

**A-T4 Clip display to Elmina and build the diorama slab** · `lane/fe` · depends: A-T3 signed off · closes AC-A5 (and the AC-B10 shape)
- Files:
  - `GET /site` already returns `site.json`; expose `boundary` (`apps/api/.../routes/core.py`), then `pnpm gen`;
  - web: a new `three/ground/slab.ts` (slab mesh whose outline is the boundary, soil layers as in the prototype);
  - clip in `three/assets/plan.ts` (buildings), `three/ground/landcover.ts`, `groundLayer.ts`, `groundDecor.ts`, tree and decoration planners, `motion/agents.ts` (agents inside only).
- Steps:
  1. Pure `clipToBoundary` helper with tests (point-in-polygon on the local frame).
  2. Apply it in each planner.
  3. Slab geometry test: the outline equals the boundary within 1 m.
  4. Golden and route parity test: `/routes` JSON for the §2 route is unchanged.
- Check: vitest; `uv run pytest apps/api -q`; `pnpm golden`; `acceptance -g AC-A5`.

**A-T5 Camera bound to Elmina** · `lane/fe` · depends: A-T4 · closes AC-A6
- Files: `three/cameraRig.ts` (`clampPose` takes the boundary polygon; `LIMITS.maxRangeM` derived from the slab size), `cameraRig.test.ts`.
- Check: vitest (1,000 random poses); `acceptance -g AC-A6`.

**A-T6 Proportional wheel zoom** · `lane/fe` · depends: — · closes AC-A7
- Files: `three/engine.ts` around the wheel handler (line ~508, currently 0.95^(speed·|Δy|/100)); extract a pure `zoomStep(range, deltaY)` plus a smoothing tween into `three/zoom.ts` with tests.
- Steps:
  1. Test: notch count from max to min range is 15–25; max step ≤ 20%.
  2. Implement.
  3. Wire the smoothing over ≥ 4 frames, respecting reduced motion.
- Check: vitest; `acceptance -g AC-A7`.

**A-T7 Building clearance for every camera** · `lane/fe` · depends: — · closes AC-A8 · reused by D-T5
- Files: new `three/clearance.ts` (footprint grid lookup: max building height near a point; segment-vs-footprint test), used by the orbit rig after each input, and later by the follow camera.
- Steps:
  1. Tests on the grid with seed footprints.
  2. Rig integration: lift the camera to roof height + 2 m, never move it into a footprint.
  3. Playwright stress test (300 random operations).
- Check: vitest; `acceptance -g AC-A8`.

**A-T8 Link-house roofs and black strips** · `lane/fe` · depends: A-T0 · closes AC-A9
- Diagnose first: material role, missing normals, or back faces in `link_intermediate.glb` / `link_long.glb`. Look at the GLB in `three/assets/showroom.ts` and at the role decode in `roleMaterial.ts`.
- Fix in the asset build (`data/scripts/build_archetypes.py` or the GLB source) or in the material. Add a vitest that no archetype role colour is below luminance 0.08.
- Check: vitest; `acceptance -g AC-A9`.

**A-T9 Roof palette and facade variety** · `lane/fe` · depends: — · closes AC-A10, AC-A11
- Files: `three/facade/roofPlan.ts`, `facadePlan.ts`, the palette tables in `three/shared/`, tests.
- Steps:
  1. Water-hue guard test (±25° of the water material, saturation > 0.15).
  2. Variety tests for the hero district (≥ 5 wall colours, ≥ 3 window patterns, ≥ 2 roof-detail kinds).
- Phase B-T1 later moves these colours into the clay token table; keep the guard test.
- Check: vitest.

**A-T10 Land dressing by class** · `lane/fe` · depends: A-T4 · closes AC-A12
- Files: `three/ground/landcover.ts`, `groundDecor.ts`, `groundDetail.ts`, tests.
- Steps:
  1. Table test: every class in the seed's `landcover.geojson` (forest, grass, residential, construction, water, commercial, bare, parking, industrial, scrub, farmland, oil_palm) maps to a dressing.
  2. Grass ≥ 2 tones plus flower clumps.
  3. Massed trees on forest and scrub.
  4. Construction kit on construction land.
  5. Parked cars on parking.
  6. Building count = footprint count.
- Check: vitest; reviewer note on the mid-range bookmark.

**A-T11 Sky, fog and night grade** · `lane/fe` · depends: A-T0 · closes AC-A13, AC-A14
- Files: `three/mood.ts`, `three/lighting.ts`, `three/sun.ts` (and tests): sky gradient, fog per mood, a night multiplier on ground and road materials.
- Check: vitest on the mood tables; `acceptance -g "AC-A13|AC-A14"`.

**A-T12 Street-level crowd diagnosis** · `lane/fe` · depends: A-T0 · closes AC-A15
- Measure the agents in view and their on-screen height at the street bookmark.
- Write the finding in the ledger.
- Fix only if trivial (density or LOD threshold); otherwise hand it to C-T8.

**A-T13 Demo preset and favicon** · `lane/fe` · depends: A-T1 · closes AC-A16, AC-A17
- Files:
  - `apps/web/public/favicon.svg` plus a `<link>` in `index.html`;
  - preset parsing in `features/scene/sceneSettingsStore.ts`, or a small `features/demo/preset.ts`: `?demo=1` forces Stylised, High, Day, path status off and the assistant open, without overwriting the user's stored settings.
- Check: vitest; `acceptance -g "AC-A16|AC-A17"`.

**A-T14 Phase A gate** · coordinator · depends: A-T1…A-T13 · closes AC-A19
1. Merge the lanes.
2. Run the full CI checklist.
3. Run `acceptance -g "AC-A"`.
4. Capture the after-screenshots for the five bookmarks next to the baseline.
5. Measure orbit fps.
6. Fill the ledger.
7. AI reviewer note on the before and after pairs.
8. Push.

### 8.3 Phase B tasks

**B-T1 Clay token table** · `lane/fe` · depends: A-T14 · closes AC-B1
- New `three/shared/clayTokens.ts`: role → colour, roughness 0.6–0.8, sheen.
- Migrate `assets/roleMaterial.ts`, the facade, roof, ground and props materials to it.
- Add a grep test: no hex literal colours in layer files outside the token table (allow-list the decorative randomisers that read the tokens).
- Check: vitest.

**B-T2 Bevelled buildings with fact fidelity** · `lane/fe` · depends: B-T1 · closes AC-B2, AC-B3 (buildings)
- Footprint-extruded buildings: bevel with negative offset (prototype: `ExtrudeGeometry` bevel 0.5, `bevelOffset −0.5`), or a shader bevel for instanced archetypes.
- Archetype GLBs: rounded edges in the asset build.
- Fidelity test over every seed building in the boundary (area ±2%, vertices ≤ 0.15 m, top ±0.1 m).
- Check: vitest.

**B-T3 Rounded trees and ground** · `lane/fe` · depends: B-T1 · closes AC-B3 (trees, kerbs, footways)
- Trees: clustered smooth spheres with instance colour (prototype tree builder), replacing faceted canopies in `kits/trees.glb` or in code.
- Kerbs and footways: bevelled ribbons (`ground/ribbons.ts`, `verges.ts`).
- Check: vitest; reviewer note at the street bookmark.

**B-T4 Light, shadow and grade** · `lane/fe` · depends: B-T1 · closes AC-B6
- `lighting.ts` and `sun.ts`:
  - warm sun with PCF soft shadows;
  - shadow frustum follows the camera focus (prototype `aimSun`: about 70 m half-size near, the whole slab far);
  - hemisphere fill.
- `aoPass.ts` tuning; Neutral tone mapping.
- Check: `acceptance -g AC-B6` at the bookmarks and in the day, dusk and night moods.

**B-T5 Tilt-shift depth of field** · `lane/fe` · depends: B-T4 · closes AC-B4, AC-B5
- Add a `BokehPass`, or a cheaper depth-based blur, to the composer in `engine.ts`.
- Focus = the follow target, or the map centre in overview. Aperture by camera distance (prototype values are the starting point).
- `three/quality.ts`: off on Low and Medium and under reduced motion; AO off on Low.
- Check: vitest on the presets; `acceptance -g "AC-B4|AC-B5"`.

**B-T6 Fact-bearing street furniture data** · `lane/data` · depends: A-T3 · closes the data side of AC-B7
- New `data/scripts/build_street_furniture.py`, through `overpass.py` (cached; few requests):
  - `highway=traffic_signals` nodes;
  - `highway=bus_stop` and `public_transport=platform` nodes;
  - `amenity=bench` / `leisure=picnic_table`;
  - `amenity=shelter`.

  Each inside the boundary.
- Output `base/street_furniture.geojson` with OSM ids; record it in `site.json`.
- Crossings come from `walk.geojson` `crossing` edges, which already exist.
- Tests in `data/scripts/tests`; `data/README.md`; commit as `data:`.

**B-T7 Street dressing kit** · `lane/fe` + `lane/assets` · depends: B-T3, B-T6 · closes AC-B7, AC-B8
- **Models** (clay, rounded): zebra stripes, traffic signal, bus stop with shelter, bench, planter, lamp post, kerb edging, flowers, grass tufts.
- **Fact props:**
  - placed from data only, one to one;
  - each carries `sourceId`;
  - a planner test compares counts with the data.
- **Decorative props:**
  - seeded placement along kerbs and in parks;
  - never on the route line within 1 m;
  - import-boundary test: the journey modules never import the dressing modules;
  - the "Decorative details are illustrative." note appears when they are in view.
- Check: vitest; `acceptance -g "AC-B7|AC-B8"`.

**B-T8 Detail bubble** · `lane/fe` · depends: B-T7 · closes AC-B9
- New `three/detailBubble.ts`: the focus point is the hero in follow mode, or the camera target otherwise. Inside 150 m it mounts the dressing, high-detail trees and the crowd LOD0; at the edge it fades over 0.5 s.
- Tests on membership and fade.
- Check: vitest; 5 s capture reviewed.

**B-T9 Slab polish** · `lane/fe` · depends: A-T4, B-T1 · closes AC-B10
- ≥ 3 soil layers, rounded rim, clay tokens.
- Check: `acceptance -g AC-B10`.

**B-T10 Phase B gate** · coordinator · depends: B-T1…B-T9 · closes AC-B11, AC-B12 · **STOP: owner approves the style screenshots**
1. Merge.
2. Run the CI checklist.
3. Run `acceptance -g "AC-B"`.
4. Fly-through fps.
5. AI reviewer: the §9.1 "Look" row against the prototype, at the beat poses.
6. Present the screenshot set to the owner and STOP.
7. Only after approval: roll the style out city-wide (if it was limited) and push.

### 8.4 Phase C tasks

**C-T1 Source assets and credits** · `lane/assets` · depends: — · closes H12, P11 (initial)
- Choose base character packs (CC0 preferred: Quaternius, Kenney; Poly Pizza CC0) and a walker / stroller / wheelchair source.
- Record each in `CREDITS.md` (URL, licence, files, location).
- Store the sources under `assets-src/characters/` (or the folder the team uses for sources; large binaries via the existing pattern).
- Pin versions or download dates.

**C-T2 Hero modelling sheet** · `lane/assets` · depends: C-T1 · prepares H8–H10 · **STOP: owner approves the sheet**
- Model the demo hero (older woman, purple baju kurung, lilac tudung, walker) in chibi proportions (H4).
- Render a sheet: front, side, back and 3/4, T-pose and a standing pose with the walker, on a neutral background.
  - Blender headless: `"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -P <script>`, or the Blender MCP if connected.
  - Keep renders small to save time (EEVEE, ≤ 16 samples, 1024 px).
- STOP.

**C-T3 Hero rig, clips and export** · `lane/assets` · depends: C-T2 approved · closes H1–H4
- Rig (≤ 60 bones).
- Clips: `walk`, `idle`, `sit_down`, `sit_idle`, `stand_up`, `look`.
- Prop variants: walker, stroller, wheelchair, none.
- LOD0 and LOD1.
- Export `apps/web/public/city/characters/hero_<variant>.glb`, plus a reproducible export script (`data/scripts/characters/export_hero.py`, run with `blender -b`).
- vitest in `three/assets/` reads the GLB: clips, durations, bones, triangles, materials, file size, head ratio.

**C-T4 Hero runtime** · `lane/fe` · depends: C-T3 (can start on the prototype's primitive hero) · closes H5–H7, H11
- New `three/characters/hero.ts`: load the GLB, `AnimationMixer`, walk rate tied to pace (stride length × cycle rate = speed), hand IK or grip constraint to the walker, sit placement on a bench seat.
- Test scene in the acceptance harness: flat footway plus a bench. Sample the bone heights, hand-to-grip distance and foot slide.
- Frame cost with and without the hero.
- Check: vitest (rate maths); `acceptance -g "H5|H6|H7|H11"`.

**C-T5 Hero readability review** · coordinator · depends: C-T4 · closes H8–H10
- Capture the six poses (follow, behind, 3/4 front, side, 30 m, 80 m) plus 12 animation frames.
- Blind AI description test: "Describe the figure inside the yellow ring". It must name an older woman with a walker in every pose.
- Owner check for cultural correctness (H9).

**C-T6 Crowd bodies and outfits** · `lane/assets` · depends: C-T1 · closes P1, P2
- 6 bodies × ≥ 3 local outfits each, plus prop variants.
- A contact sheet of all looks (render) for the owner.
- A manifest listing the looks.
- vitest on the manifest counts.

**C-T7 Crowd VAT bake and renderer** · `lane/assets` + `lane/fe` · depends: C-T6 · closes P4, P5
- Bake `walk` and `idle` to vertex animation textures (Blender script).
- Instanced renderer in `three/motion/` that samples the VAT by phase and speed.
- Replace the shader limb swing.
- Tests: draw calls ≤ 20, triangle budgets, VAT ≤ 4 MB, cycle-rate maths.

**C-T8 Crowd planning and rules** · `lane/fe` · depends: C-T7, A-T4 · closes P3, P6, P7, P8, P9
- `motion/agents.ts`:
  - look assignment (seeded; no twins within 10 m);
  - the R-J7 scale curve (replaces `displayScale`);
  - footway adherence;
  - keep-out around the hero and her next 10 m (reads the hero position from the journey store, never its events);
  - import-boundary test (P9).
- Check: vitest; player sampling for P8 once D-T6 exists.

**C-T9 Phase C gate** · coordinator · depends: C-T3…C-T8 · closes P10 and the Phase C §9.1 rows
1. Merge.
2. Run the CI checklist.
3. Run `acceptance -g "H|P"`.
4. Fps with 400 agents.
5. AI reviewer §9.1 "Hero" row.
6. Push.

### 8.5 Phase D tasks

**D-T1 `JourneyPlan` and `build_journey`** · `lane/be` · depends: — · closes AC-D1, AC-D2, AC-D3
- Files: `packages/spatial/src/townshiplens_spatial/journey.py`, models in `models.py` (`JourneyPlan`, `JourneyEvent`), `packages/spatial/tests/test_journey.py`, `packages/spatial/README.md`.
- Port and harden the derivation in the prototype's `build_scene.py`:
  - segment orientation and chaining;
  - event rules;
  - UNKNOWN collapsing;
  - rest gap;
  - pace via `routing._pace_m_per_min`;
  - `hold_s`;
  - `evidence_id` from `routing.evidence_for_route`.
- Tests:
  - the §2 table on the seed (skipped when the seed is missing);
  - the tiny fixture for CI;
  - hypothesis properties (AC-D2, AC-D3).
- Check: `uv run pytest packages/spatial -q`.

**D-T2 API and event contract** · `lane/be` · depends: D-T1 · closes AC-D4
- `packages/agent/.../events.py`: add `journey.play` to the scene intents, with `journey: JourneyPlan | None`.
- `run.py` (near line 325, where `route.highlight` gets its geometry): attach `build_journey(...)` for `journey.play`.
- REST: `POST /journeys` in `apps/api/.../routes/core.py` with body `{from_id, to_id, profile, start_time, scenario_id?}` → `JourneyPlan`. Routes are planned per request; there is no route store to look up an id.
- `pnpm gen`; commit `packages/api-client`.
- Parity test: SSE plan == REST plan.
- Check: `uv run pytest apps/api packages/agent -q`; `pnpm gen && git diff --exit-code packages/api-client`.

**D-T3 Agent, mock, template and validator** · `lane/ai` · depends: D-T2 · closes AC-D5, AC-D6
- `mock.py`: route questions emit `journey.play` after `route.highlight`; the demo question gets the prototype's answer content.
- `template.py`: same facts.
- `validate.py`: route-returned-this-turn rule; no contradiction on rest count or unchecked-place count; wording scan.
- Golden question for the demo prompt (`pnpm golden`).
- Run the CLI smoke command from AGENTS.md with `--profile older_adult_rest`.
- Check: `uv run pytest packages/agent -q`; `pnpm golden`.

**D-T4 Web contract and timeline** · `lane/fe` · depends: D-T2 types (start on the fixture) · closes AC-D7
- `features/chat/chatReducer.ts`: pass `journey.play` through.
- `features/scene/sceneStore.ts`: `applyIntent` stores the plan.
- New `features/journey/journeyStore.ts` (zustand) plus `timeline.ts`:
  - phases (dive 4 s, walk at 20×, holds per §6.4, pull 5 s);
  - `stateAt(t)` → distance, sim time, phase, event;
  - HUD values.

  Port this from the prototype's `phases` / `stateAt`.
- Fixture: convert the prototype `scene.js` into `features/journey/fixtures/demoPlan.json`.
- Check: vitest.

**D-T5 Follow camera and per-event framing** · `lane/fe` · depends: A-T7, D-T4 · closes AC-D8, AC-D9
- New `three/journey/followRig.ts`:
  - dive and pull tweens between the overview pose and the follow pose;
  - follow pose (8.5 m back, 4.5 m side, 4.2 m up, look 4 m ahead), damped;
  - clearance via `three/clearance.ts` (lift, never dive in);
  - framing rules per event kind (rest: side view of the bench; unknown: element in frame; arrive: destination in frame).
- Check: vitest on the pose maths; `acceptance -g "AC-D8|AC-D9"`.

**D-T6 Hero driver** · `lane/fe` · depends: D-T4, C-T4 (placeholder hero allowed) · closes AC-D10
- New `three/journey/heroDriver.ts`: position and yaw along the polyline (reuse `poseAt` / `smoothYaw`), and a state machine per phase:
  - walk;
  - verified, covered and gap: slow walk;
  - unknown: stop + `look`;
  - rest: walk to the bench, `sit_down`, `sit_idle`, `stand_up`;
  - arrive: idle.
- Check: vitest on the state machine; `acceptance -g AC-D10`.

**D-T7 Journey overlay UI and ribbon** · `lane/fe` · depends: D-T4 · closes AC-D11, AC-D12
- New `features/journey/` components:
  - `SimulationLabel`, `JourneyHud`, `JourneyMiniMap`, `EventCard` (anchored to projected 3D points, clamped to the viewport);
  - markers in an overlay scene rendered after post-processing (prototype fix);
  - route ribbon: PASS solid, UNKNOWN dashes, visible with path status off.
- DOM tests (`*.dom.test.tsx`).
- Check: vitest; `acceptance -g "AC-D11|AC-D12"`.

**D-T8 Controls and test hook** · `lane/fe` · depends: D-T4 · closes AC-D13
- Play, pause, restart, scrub, and camera mode follow / overview / free.
- A "Watch the trip" button in the answer for normal users.
- `window.__journey` with the prototype API (`seek`, `play`, `pause`, `setCam`, `phases`, `total`), exposed in dev and in the demo preset.
- Check: vitest; `acceptance -g AC-D13`.

**D-T9 Step list for List and Mapbox** · `lane/fe` · depends: D-T4 · closes AC-D14
- `features/scene/list/` and the Mapbox renderer render `JourneyPlan.events` as numbered steps with the same card content.
- e2e on the tiny fixture: ask a mock route question and see the steps.
- Check: `pnpm --filter @tl/web e2e`.

**D-T10 Demo preset auto-play and recording** · `lane/fe` + `lane/ai` · depends: D-T3, D-T5…D-T8, A-T13 · closes AC-D16, AC-D17
- With `?demo=1` the trip auto-plays when `journey.play` arrives.
- Record the demo turn: `LLM_PROVIDER=mock uv run python -m townshiplens_agent.cli --record "My mum uses a walker. Can she walk from Harmoni 1 to Lakeside Mall Car Park B?" --profile older_adult_rest`. Commit `data/demo/*.jsonl` as `data:`.
- Determinism double run.
- Check: `acceptance -g "AC-D16|AC-D17"`.

**D-T11 Phase D gate and final demo** · coordinator · depends: everything · closes AC-D15, AC-D18, AC-D19 · **STOP: owner approves the final run**
1. Merge.
2. Run the full CI checklist.
3. Run `acceptance -g "AC-D"`.
4. One clean take with a frame-time log.
5. Full §9.1 prototype comparison (all rows, all beats).
6. Update the docs (§9.0 item 5).
7. Present the run to the owner and STOP.
8. Push after approval.

## 9. Acceptance

Each phase has its own criteria table:

| Phase | Criteria |
|---|---|
| A | AC-A1 to AC-A19 (§3) |
| B | AC-B1 to AC-B12 (§4) |
| C | H1 to H12 for the hero, P1 to P11 for the crowd (§5) |
| D | AC-D1 to AC-D19 (§6), which include the demo recording |

### 9.0 Definition of done (every phase)
A phase is **done** only when all of these hold. "Implemented", "tested", "merged" and "pushed" are different states; report which one applies.

1. Every criterion in its table is checked and recorded in the plan ledger (`.superpowers/sdd/<plan>/`) as **PASS / FAIL / BLOCKED**, with the evidence:
   - the test name;
   - the screenshot path;
   - the measured number.

   A FAIL or BLOCKED criterion keeps the phase open, unless the owner records a ruling that waives it.
2. The full CI checklist in AGENTS.md passes on the merged branch (`set -o pipefail`). Mock-backed results are labelled as mock.
3. The §9.1 prototype comparison has no fails (phases B, C and D).
4. The owner checkpoint for the phase (§9.3) is recorded in the ledger.
5. Docs are updated:
   - the lane README of each area touched (`apps/web/README.md`, `packages/spatial/README.md`, `data/README.md`);
   - the concept doc's status line;
   - `CREDITS.md` for any asset.

   Rulings go into the plan ledger and `docs/superpowers/ai-world-model-log.md`.
6. Performance numbers are measured on the reference laptop (RTX 2050, 1440×900). If measured elsewhere, label them as such; they do not count as a pass.

### 9.1 Prototype comparison by an AI reviewer (required for B, C and D)
The prototype is the visual contract. An AI reviewer (an `evaluator` subagent or a fresh session with Playwright MCP) checks the product against it.

1. **Start both:**
   - prototype: `uv run python docs/03-product/prototypes/resident-journey/build_scene.py`, then `python -m http.server 5190 --bind 127.0.0.1` in that folder;
   - product: `pnpm dev` with `LLM_PROVIDER=mock`, `DEMO_MODE=true`.
2. **Capture matching beats at 1440×900** through `window.__journey.seek()` in both:
   - dive (t ≈ 2.4 s);
   - each event of §2 at 60% of its hold;
   - one mid-walk frame on Persiaran Tamarind;
   - the end of the pull-back.

   Save the pairs side by side under `.superpowers/sdd/<plan>/acceptance/`.
3. **Score each pair against this rubric.** "Better than the prototype" passes. "Different but within the idea" needs a one-line note. "Against the idea" fails.

   | Area | Check |
   |---|---|
   | Story | Same events, same order, same card titles and source lines as §2; Simulation label visible |
   | Camera | Dive → follow from behind / 3/4 → pull-back; hero always in frame and never clipped; the event subject is visible |
   | Look | Toy clay diorama: rounded shapes, pastel palette, soft shadows, tilt-shift blur, slab edge; no pure-black surfaces; no orange lines over roofs |
   | Hero | Reads as an older woman with a walker from behind and from 3/4; walks, stops, sits on the benches |
   | Honesty | Demo chips on demo facts; "Not checked yet" for UNKNOWN; decorative note present; no "safe"; no water-coloured roofs |
   | Data | Footprints, route line and benches line up with the prototype's positions (same data) |

4. **Report:**
   - an overall verdict;
   - per-beat scores;
   - the screenshot pairs;
   - every fail with a fix suggestion.

   The coordinator does not mark the phase done until there are no fails.

### 9.2 Automated checks
- The CI checklist in AGENTS.md: `pnpm lint`, pytest, typecheck, vitest, `pnpm gen` with no diff, `pnpm golden`, and e2e.
- **New tests:**
  - `journey.py` hypothesis tests (§6.1);
  - validator, mock and template tests for `journey.play`;
  - vitest for the timeline maths (phase lookup, compression, HUD values) and the settings toggle (A1);
  - Playwright: a journey on the tiny fixture through the List view (step list rendered, cards present). The 3D stays out of e2e as today, except with a stub like `three.spec.ts`.
- **Performance (§B3):** record fps in follow mode on the reference laptop.

### 9.3 Owner checkpoints
- A4 boundary outline.
- The first Phase B screenshot set, before the style is rolled out city-wide.
- The hero model turnaround, before it is rigged.
- The final demo run.

## 10. Rulings (owner, 19 Oct 2026)

| Id | Ruling | Why | Cost if wrong |
|---|---|---|---|
| R-J1 | Conditions (haze, storm, live bus) are out of scope for now | Focus on the walk and the look first | Story loses "the model surfaces what you didn't ask"; seam kept, so it can be added later |
| R-J2 | Plain toy style, no outlines | Matches the reference image | Crowd may read worse at distance; revisit with screenshots |
| R-J3 | People may be chibi and 1.4–1.55× true scale; true scale stays for everything else | Legibility; people are decorative | Mixed scale may look odd next to cars; tune in Phase B screenshots |
| R-J4 | Player has play / pause / scrub / camera mode | Needed to record and review the demo | Small UI cost |
| R-J5 | Demo route is Harmoni 1 → Car Park B, not a clinic | Only short route with every event type; clinics are 2.4–5 km with no checked facts | Story is "meet me at the mall" rather than a medical trip |
| R-J6 | Prerequisite fixes (§3) come before the simulation; dashed-line toggle and Elmina crop first | The current map hides the city and runs past Elmina | Delays Phase D; D1–D3 backend can run in parallel |
| R-J7 | People are 1.4–1.55× within 300 m and scale up moderately with distance, to at most 2.5× at 800 m (supersedes the P2 curve that reached 3×) | Far crowds must stay visible without looking oversized | Far people may look large next to buildings; tune the cap with Phase C screenshots |

## 11. Risks and open questions

- **Clay quality ceiling in the browser.** The prototype shows the look is reachable in Three.js at 70+ fps on a small scene. City-wide with crowds and FX is unproven, so measure early in Phase B.
- **Hero modelling effort.** Rigging and localised outfits are the slowest item. Start the assets in parallel with Phase A.
- **Elmina boundary source.** OSM may not have a clean City of Elmina outline. The fallback union needs owner sign-off.
- **Ramp-shot framing** needs per-event camera rules (§6.4).
- **Seed drift:** segment ids in §2 and in tests can change after `pnpm data:build`. Derive them; don't hard-code them.
- **Open question:** should the trip auto-play for normal users, or only in the demo preset? The default for this spec: it auto-plays only in the demo preset; normal users get a "Watch the trip" button.
