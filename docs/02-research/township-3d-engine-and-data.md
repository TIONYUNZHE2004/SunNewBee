# Township 3D Engine and Data Architecture (whole City of Elmina, Oct 2026)

> Research date: 14 Oct 2026. Scope: after the pivot to a 3D "Township World Model" for the whole City of Elmina (Sime Darby Property, Shah Alam), which 3D engine to build on, what data exists for the whole township, what a thin recycling lens can show, and how to structure and serve layered data. Facts marked **(unverified)** were not confirmed. Builds on [3d-data-and-rendering.md](3d-data-and-rendering.md), [site-selection.md](site-selection.md) and the [walking-skeleton spec](../superpowers/specs/2026-10-14-walking-skeleton-design.md) (section 2 proposed Mapbox Standard). Source lists: [../../reference/notes/3d-sources.md](../../reference/notes/3d-sources.md).

## TL;DR

- **Engine: CesiumJS 1.146 + Resium 1.27 as the hero 3D view; keep the skeleton's Mapbox Standard map as the "lite 2.5D" view; list view stays the always-on accessible path.** Reason: the pivot needs photoreal buildings (Google Photorealistic 3D Tiles) *and* lines/markers on the ground *and* a rising water surface. Cesium is the only candidate where all three are built in and documented: `createGooglePhotorealistic3DTileset`, ground/3D-Tile clamping (`ClassificationType`, `HeightReference.CLAMP_TO_3D_TILE`), extruded polygons at height `h`, and `camera.flyTo`. Mapbox GL JS cannot load Google tiles (no supported path found, unverified), so on its own it cannot give photoreal buildings.
- **Fallback chain:** (1) same Cesium app with Cesium OSM Buildings + Cesium World Terrain if Google tiles look poor over Elmina or billing is blocked (free ion Community plan); (2) Mapbox Standard lite view; (3) list view and a recorded demo video.
- **R3F + `3d-tiles-renderer` is no longer the primary.** It remains the most flexible renderer, but it has no built-in draping; clamping lines onto a photoreal mesh means per-vertex raycasts, which is the grey area in Google's "no deriving geometry" clause. At whole-township scale that is the wrong place for three students to spend week 1.
- **Google Maps JS `Map3DElement`** is still not labelled GA anywhere in the 2026 release notes (features are weekly/beta/alpha; latest 3.66.8b on 8 Oct 2026). Good for a 2-hour ToS-safe prototype (`<Map3D>` in `@vis.gl/react-google-maps` 1.10.1), too locked down for the flood lens.
- **Flood water in Cesium:** a translucent extruded polygon whose top face sits at absolute height `h`; the depth buffer against the photoreal mesh makes it "fill" low ground and hide behind hills. Which segments are flooded is computed by **our backend from a DEM**, never read from the Google mesh (ToS). The only open DEM we verified (Copernicus GLO-30) is a 30 m surface model with <4 m vertical accuracy, so label the lens "illustrative scenario, not a forecast".
- **Elmina envelope bbox (S, W, N, E): `3.150, 101.460, 3.240, 101.530`** (about 10.0 km x 7.8 km, ~78 km2, roughly 3-4x the township's ~5,000 acres; clip to a polygon). OSM in that box on 14 Oct 2026: **6,901 buildings, 1,161 footway + 249 path + 20 pedestrian ways, 3 steps, 0 entrances, 0 `amenity=recycling`, 5 waste baskets, 4 toilets, 20 shelters, 16 playgrounds, 32 parks, 83 water bodies, 123 waterway features (26 river, 43 drain, 41 ditch, 13 stream)**. Sparse accessibility data confirms the verification-loop story.
- **Google 3D over Elmina: still unverifiable from here.** No source confirms mesh quality; use the 5-minute check in section 2.4 before any commitment.
- **Recycling (thin lens):** no OSM recycling points in Elmina, no open MBSA/SWCorp dataset found, no Elmina-specific SDP recycling centre found. Realistic MVP = 20-40 hand-curated points (bins, nearby recycling/e-waste points, SDP composting sites) each marked verified/unknown, plus text links to MBSA for schedules.
- **Data architecture:** do not adopt CityGML/CityJSON wholesale. Use *base twin + lens overlays* in versioned GeoJSON/GeoParquet files, an in-memory spatial index (Shapely/NetworkX) at runtime, SQLite for claims and verification requests, **no PostGIS for the MVP**. Serve 3D lenses as per-lens GeoJSON (a few MB gzipped each); build PMTiles only for the 2D lite view and context layers.

---

## 1. 3D engine decision

### 1.1 Versions (npm, checked 14 Oct 2026)

| Package | Version | Last modified |
|---|---|---|
| `cesium` | 1.146.0 | 2026-10-01 |
| `resium` | 1.27.0 | 2026-10-06 |
| `3d-tiles-renderer` | 0.5.3 | 2026-09-18 |
| `@react-three/fiber` | 9.8.1 | 2026-10-14 |
| `three` | 0.186.1 | 2026-09-24 |
| `mapbox-gl` | 3.33.0 | 2026-10-13 |
| `deck.gl` / `@deck.gl/geo-layers` | 9.4.0 | 2026-09-05 |
| `@vis.gl/react-google-maps` | 1.10.1 | 2026-09-21 |
| `maplibre-gl` | 6.14.0 | 2026-10-11 |
| `pmtiles` | 4.5.0 | 2026-08-10 |

### 1.2 Comparison

Scores are our judgement from docs read this session (ctx7 for Cesium, Resium, Mapbox, deck.gl, 3d-tiles-renderer, react-google-maps). "Spike" means a half-day test is needed before trusting it.

| Criterion | CesiumJS + Resium | R3F + 3d-tiles-renderer | Mapbox GL JS 3.33 Standard | deck.gl 9.4 + Tile3DLayer | Google Maps JS 3D (`Map3DElement`) | MapLibre 6.14 |
|---|---|---|---|---|---|---|
| Google photoreal tiles | Yes, `createGooglePhotorealistic3DTileset` (own key, or via ion) | Yes, `GoogleCloudAuthPlugin` + `TilesAttributionOverlay` | **No supported path found** (unverified) | Yes, `Tile3DLayer` with `X-GOOG-API-KEY` header | Native (it is Google's own viewer) | No |
| ToS / attribution | `showCreditsOnScreen`; Cesium warns the tileset may only be used with the Google geocoder (pass `onlyUsingWithGoogleGeocoder: true` only if true) | Built-in attribution overlay | n/a | You must collect `copyright` from tile glTF `asset` yourself (documented `onTraversalComplete` snippet) | Handled by Google | n/a |
| Terrain + water surface | Polygon `height` + `extrudedHeight`; `Material.WaterType`; terrain via `createWorldTerrainAsync` | Any three.js plane or `Water` shader; you write everything | Terrain via `setTerrain` (raster-dem); water via `fill-extrusion` or a three.js custom layer (spike) | `SolidPolygonLayer`/`PolygonLayer` with 3D coordinates, update data per frame (spike) | `Polygon3DElement` exists (extruded and animated behaviour not verified) | `fill-extrusion` + terrain; no photoreal |
| Clamp lines/markers to photoreal mesh | **Built in**: polyline `clampToGround` + `ClassificationType`, `HeightReference.CLAMP_TO_3D_TILE`, `scene.clampToHeight` | None built in; raycast per vertex (ToS grey area) | n/a | **Built in**: `Tile3DLayer` with `operation: 'terrain+draw'` + `TerrainExtension` drapes GeoJSON | `CLAMP_TO_GROUND` default for polylines/polygons/models | n/a |
| Drape GeoJSON | `GeoJsonDataSource` with `clampToGround` | Manual | Native on its own tiles/terrain | `GeoJsonLayer` + `TerrainExtension` | Manual conversion to `Polyline3DElement` | Native on terrain |
| Camera flyTo | `camera.flyTo` / `setView` (heading, pitch, roll) | Write your own tween | `map.flyTo` | `FlyToInterpolator` | `flyCameraTo`, `flyCameraAround` | `map.flyTo` |
| Mid-range phones | Heaviest bundle; tune `maximumScreenSpaceError`, `resolutionScale`, memory cap; a 2 GB phone crashed in one forum report (unverified outcome) | Lighter, you control everything | **Best** (vector 2.5D) | Medium | Google-managed; `qualityMode`, `maxMemoryMegabytes` added Oct 2026 (beta) | Best, but no 3D wow |
| React integration | Resium (`Viewer`, `Entity`, `Cesium3DTileset`, `useCesium`); imperative escape hatch needed for animation | Excellent (R3F is React-native) | `react-map-gl/mapbox` | `DeckGL` component, declarative | `<Map3D>` in `@vis.gl/react-google-maps`; camera props controlled/uncontrolled | `react-map-gl/maplibre` |
| Student learning curve | Medium: big API but excellent docs and Sandcastle | High: geodesy and shaders on you | Low | Medium | Low | Low |
| 2D fallback | Cesium `SceneMode.SCENE2D` exists but is not our accessible fallback | Separate | Same engine, pitch 0 | Separate | None | Same engine |
| Maturity risk | Low (monthly releases) | Pre-1.0 (0.5.x) | Low | Low | **High**: no GA label; weekly/beta/alpha churn | Low |

Google's own renderer guide lists CesiumJS and deck.gl as supported 3D Tiles renderers ([guide](https://developers.google.com/maps/documentation/tile/use-renderer)); Mapbox is not mentioned.

### 1.3 Licence and cost (numbers from pricing pages, 14 Oct 2026)

| Item | Current numbers | Source |
|---|---|---|
| Google Photorealistic 3D Tiles (Enterprise SKU) | 1,000 free billable events/month; $6.00 per 1,000 up to 100k, $5.10 to 500k, $4.20 to 1M | [pricing](https://developers.google.com/maps/billing-and-pricing/pricing) |
| Google Maps JS 3D (`Map3DElement`) | Not listed under its own SKU; nearest are Dynamic Maps (10,000 free, $7.00 per 1,000) and Immersive Maps (5,000 free, $7.00 per 1,000). Which one applies is **unverified** | same |
| Cesium ion Community (free) | Personal and non-commercial; unfunded educational use and exploratory evaluation allowed; 1,000 Google root tiles/month, 10 GB storage, 15 GB/month streaming, individual account only | [ion pricing](https://cesium.com/platform/cesium-ion/pricing/) |
| Cesium ion Commercial | $149/month individual ($524 team); 5,000 Google root tiles, 150 GB streaming | same |
| CesiumJS library | Open source; the library itself carries no per-load fee | (unverified licence text; Apache-2.0 to our knowledge) |
| Mapbox GL JS | 50,000 map loads/month free; then $5.00 per 1,000 (50k-100k), $4.00 (100k-200k), $3.00 (200k-1M) | [Mapbox pricing](https://www.mapbox.com/pricing) |
| Mapbox 3D features | Page gives no separate price for Standard 3D | same |

Implication: with our own Google key the Cesium route costs nothing at hackathon scale (one page load is about one root-tile event, so 1,000 loads/month free). A pilot that SDP funds leaves the ion Community plan (project with funding or government connection needs Commercial), which matters only if we use ion assets rather than our own Google key.

### 1.4 Recommendation

**Primary: CesiumJS + Resium, Google tiles via our own API key.**

1. It is the only option where *photoreal backdrop + draped lines/markers + translucent water at height + camera control* are all documented built-ins. The three lenses reduce to adding Cesium primitives; the AI drives the camera via `flyTo`.
2. Draping is rendering, not extraction, so it stays on the right side of Google's "visualisation only, no derived geometry" rule, which a hand-rolled raycast does not obviously do.
3. The fallback is the *same app* with a different tileset (Cesium OSM Buildings + World Terrain on ion Community). Reversal costs a config switch, not a rewrite.
4. Resium covers React; use `useCesium()` for the imperative parts (water animation, camera tweens). Note ctx7's Resium getting-started snippet shows the legacy `createWorldTerrain()`; use `createWorldTerrainAsync` (current API in the 1.146 reference).

**Architecture to avoid a two-renderer mess:** the AI and the UI emit *scene intents* (typed events: `camera.fly_to`, `route.highlight`, `flood.set_level`, `layer.toggle`, `place.focus`); a thin adapter per renderer (Cesium hero, Mapbox lite) draws them. The skeleton's `scene.highlight` event already points this way. The list/text view consumes the same events as text.

**What we give up:** a heavier bundle and mobile risk. Mitigate with lazy-loading the Cesium chunk, `requestRenderMode: true`, a higher `maximumScreenSpaceError`, lower `resolutionScale`, a memory cap, a "Lite view" button, and one real mid-range Android test in week 2 (no published mobile benchmarks were found).

**Pick R3F instead only if** nobody on the team will touch Cesium *and* the Day-1 spike shows Cesium cannot render our water convincingly. Pick deck.gl instead if the team prefers fully declarative React: it has the best documented draping on Google tiles, but we found less guidance on 3D water and no built-in credits line.

### 1.5 Drawing flood water in Cesium (API names checked against the 1.146 reference via ctx7)

Method: draw one flat water polygon whose **top face is at absolute height `h`** (metres on the ellipsoid, matching the Google tiles). Because primitives depth-test against the photoreal mesh, the surface appears only where the mesh is below `h`.

| Need | API | Note |
|---|---|---|
| Photoreal tiles | `Cesium.createGooglePhotorealistic3DTileset({ key, onlyUsingWithGoogleGeocoder })` or `GoogleMaps.defaultApiKey = key` | Add to `viewer.scene.primitives`; hide the globe if only tiles are wanted |
| Water slab | `PolygonGraphics`: `height` (start altitude), `extrudedHeight` (end altitude), `perPositionHeight: false` | With `extrudedHeight` below `height`, the top face is the water surface |
| Translucent colour | `material: Color.fromCssColorString('#1e6fb8').withAlpha(0.55)` | Simple, cheap, reliable on phones |
| Animated rise (simple) | `height: new CallbackProperty(() => level, false)` | Rebuilds geometry each frame; fine for a spike, costly for a big polygon |
| Animated rise (fast) | One static `Primitive` with `PolygonGeometry`, change `modelMatrix` along the local up vector each frame | Spike needed (unverified); avoids rebuilding geometry |
| Rippling water look | `Material.WaterType` (`'Water'` material, normal map, `animationSpeed`, `frequency`) | Uniform names not verified this session; check Sandcastle |
| Flooded route segments | Polyline entity per segment with `clampToGround: true` and `classificationType` (property exists on polygon graphics; polylines use the same enum); test `Entity.supportsPolylinesOnTerrain(scene)` | Colour set from backend `flooded` flag |
| Markers on the mesh | `HeightReference.CLAMP_TO_3D_TILE` on billboards/points | Cesium notes `Cesium3DTileset#enableCollision` must be `true` for clamping to photoreal tiles |
| Evacuation centres | Billboards + labels, `heightReference: CLAMP_TO_3D_TILE` | Same data model as other places |
| Camera | `viewer.camera.flyTo({ destination, orientation: { heading, pitch, roll }, duration })`; `setView` (verified) | Respect `prefers-reduced-motion` by using `setView` |
| Attribution | `showCreditsOnScreen: true` | Mandatory for Google tiles |

**Rules that keep it honest and compliant**
1. **Where the water is** comes from our DEM and a "connected bathtub" rule (cells below `h` connected to the river), precomputed in 0.5 m steps and stored as polygons plus lists of flooded edge IDs. A plain "everything below `h`" plane would flood unconnected hollows. Do not sample the Google mesh to decide what is flooded (analysis/extraction ToS clause); using it only as the depth-tested backdrop is visualisation.
2. **DEM limits:** Copernicus GLO-30 is a 30 m *surface* model (buildings and trees included), EGM2008 heights, absolute vertical error under 4 m (90%) ([Copernicus](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)). That is too coarse for ankle-to-knee depths. Present levels as scenarios ("+1 m, +2 m, +3 m above the river's normal level"), show a disclaimer, and ask SDP/JPS for LiDAR or a flood study.
3. **Datum:** Google tiles are ellipsoidal, the DEM is EGM2008. Calibrate one constant offset per site using a known flat reference (Elmina lake surface) rather than assuming a geoid value.
4. **Local flood context:** nearby Sungai Buloh, Paya Jaras and Shah Alam areas flood in heavy storms (news reports April 2025, Aug 2023, Nov 2022), but we found no Elmina-specific flood report for 2025-2026. Do not claim Elmina is flood-prone; the lens is a *what-if* tool.

**If we fall back to other engines:** Mapbox = `setTerrain` + three.js custom layer (`type: 'custom'`, `renderingMode: '3d'`, `onAdd`/`render`, pattern verified in Mapbox docs) or a `fill-extrusion` polygon; deck.gl = `SolidPolygonLayer` with `Tile3DLayer` (`operation: 'terrain+draw'`); R3F = a transparent plane in an ENU frame (`EastNorthUpFrame` component with `lat`, `lon`, `height` props, verified) with `depthWrite=false`.

### 1.6 Google Maps JS 3D: GA status (2026)

The 2026 release notes label every 3D item by channel (weekly, beta, alpha), never GA: `MarkerElement` and `FlattenerElement` arrived in beta (Feb 2026) and weekly (Mar 2026); `Route3DElement` and `Label3DElement` are alpha; beta added `MapMode.ROADMAP`, `colorScheme`, `qualityMode`, `maxMemoryMegabytes` (1-8 Oct 2026). Polyline/Polygon/Model 3D elements default to `CLAMP_TO_GROUND` (since 3.60.1, Feb 2025), and models accept only `.glb`. Google's launch-stages page defines GA as production-ready and does not mention 3D Maps. Conclusion: treat as pre-GA; use for a quick prototype only ([release notes](https://developers.google.com/maps/documentation/javascript/releases), [reference](https://developers.google.com/maps/documentation/javascript/reference/3d-map-draw), [launch stages](https://developers.google.com/maps/launch-stages)).

---

## 2. Whole-Elmina coverage

### 2.1 Extent and bounding boxes

No official boundary polygon was found. Reports put City of Elmina at about 5,000 acres (one listing says 6,500 including a 1,500-acre business park): Elmina West about 2,662 acres, Elmina East about 1,088 acres, Denai Alam about 1,000 acres plus Bukit Subang 250 acres ([PropertyGuru](https://www.propertyguru.com.my/new-property-launch/reviews/city-of-elmina-shah-alam-216064), [StarProperty](https://www.starproperty.my/news/exploring-the-green-city-of-elmina/96357); sources disagree). "Elmina Valley" and "Elmina Gardens" appear in OSM as neighbourhoods inside Elmina East, not as separate official estates.

We bounded it from OSM: every Elmina-named feature (suburb, neighbourhoods, roads, parks, business park, mall) within a wide search, excluding two clear outliers (a Honda dealer and a toy store at the edges).

| Area | Evidence (OSM names, lat/lon) | bbox (S, W, N, E) |
|---|---|---|
| **Envelope (whole city)** | Southernmost "Elmina Ridge & Peak" 3.160, "Persiaran Elmina" works to 3.150; north "Taman Perdagangan Elmina" 3.239; west "Persiaran Elmina 1/1" 101.464; east Elmina City Square/Temu/clinic 101.525-101.526 | **3.150, 101.460, 3.240, 101.530** |
| Elmina East core | Lakeside Mall 3.1813/101.5099; Urban Park; Central Park; Valley 1-5; Gardens (3.190, 101.519); Rainforest Knowledge Centre 3.171/101.5006 | 3.150, 101.495, 3.200, 101.530 |
| Elmina West + Green + business park | Elmina Green 3.2075/101.4975; Google Data Center, Elmina Business Park 3.223/101.5185 | 3.190, 101.460, 3.240, 101.510 |

Caveats: the envelope also contains parts of Denai Alam (centroid 3.160, 101.512), Bandar Saujana Utama (3.206, 101.480) and Bukit Subang. At ~78 km2 it is about 3-4x the township's land area, so **counts below are upper bounds**. Before building the graph, clip to a polygon (ask SDP for the master-plan boundary, or buffer the union of `landuse` polygons named Elmina*).

### 2.2 Overpass counts (OSM, 14 Oct 2026, envelope bbox)

Public Overpass was overloaded (repeated 504s); counts below are what completed. Re-run when quiet; save a Geofabrik Malaysia extract for the real import.

| Feature | Envelope count | Elmina East core |
|---|---|---|
| `building=*` | **6,901** (6,899 ways + 2 relations) | 3,085 |
| `highway=footway` | **1,161** | 368 |
| `highway=path` | **249** | 48 |
| `highway=pedestrian` | **20** | 20 |
| `highway=steps` | **3** | 1 |
| `entrance=*` | **0** | 0 |
| `barrier=kerb` | **1** | 0 |
| `highway=residential` | **2,406** | 805 |
| `highway=primary/secondary/tertiary/trunk/motorway` | **684** | 297 |
| `highway=service` | **1,806** | 597 |
| `highway=crossing` (nodes) | **167** | 97 |
| any `wheelchair=*` tag | **214** (209 ways, almost all footways; none with `incline`/`width` checked) | 209 |
| `amenity=toilets` | **4** | 3 |
| `amenity=school` / `kindergarten` | **27 / 11** | 13 / 10 |
| `amenity=place_of_worship` | **43** | 18 |
| `amenity=community_centre` | **7** (4 distinct names; one MBSA-operated hall U16/1; Dewan Saujana Utama and Dewan Serbaguna Rentak Perdana are in adjacent estates) | 4 |
| `amenity=recycling` | **0** | 0 |
| `amenity=waste_basket` | **5** | 5 |
| `amenity=waste_disposal` | **0** | 0 |
| `amenity=shelter` | **20** (many are park/pavilion shelters, not evacuation centres) | 15 |
| `amenity=bench` | **6** | 6 |
| `leisure=park` / `playground` / `pitch` | **32 / 16 / 75** | 20 / 7 / 21 |
| `highway=bus_stop` | **98** | 36 |
| `waterway=*` | **river 26, drain 43, ditch 41, stream 13**, plus weir 1, dam 1 | river 15, stream 5, drain 2 |
| `natural=water` | **83** | 30 |
| `emergency=*` | 2 fire hydrants, 1 water tank | 2 hydrants |
| Any `amenity=*` (801 elements in the dump above includes leisure/bus stop etc.) | 801 mixed features | 311 |

> The Elmina West sub-box (3.190, 101.460, 3.240, 101.510) tag dump completed (326 amenity/leisure/waterway features) but its way counts did not (Overpass 504s); treat West way counts as not measured. The earlier [site-selection](site-selection.md) run found 58 buildings and 54 footways in the Urban Park MVP bbox, so most of the 6.9k buildings are houses in the residential estates.

Reading: the network skeleton exists (about 1,430 footway/path/pedestrian ways plus ~4,900 road ways) but accessibility facts do not (no entrances, one kerb, four toilets, zero recycling points). Flood-relevant hydrology is rich (83 water bodies, 123 waterway segments), and about 98 bus stops can seed the "evacuation / pickup point" idea.

### 2.3 Overture buildings

- Overture buildings are conflated from OpenStreetMap (highest priority), Esri Community Maps, Microsoft and Google Open Buildings ML footprints, and a few national datasets; licence ODbL ([docs](https://docs.overturemaps.org/guides/buildings/)). The Google Open Buildings merge (Dec 2023 alpha) added most of the new footprints across South and Southeast Asia ([GeoWeek](https://www.geoweeknews.com/?p=41050), via search summary).
- Malaysia-specific coverage claims: none official. A 2024 informal review of an Indonesia/Malaysia bbox found that buildings visible on imagery appeared in the data ([dev.to](https://dev.to/krschap/exploring-overture-map-data-2l49)); one OSM contributor had added ~715,932 buildings in KL/Putrajaya/Selangor by Aug 2024 ([diary](https://www.openstreetmap.org/user/Zh9567/diary)). Building `height` coverage in Malaysia: no statement found.
- Latest release on the public bucket: 2026-09-23.1 (listing checked 14 Oct 2026).
- **We queried release 2026-09-23.1 directly (anonymous S3, bbox filter on `bbox` struct, 14 Oct 2026):**

| Area | Overture buildings | with `height` | with `num_floors` | First listed source (OSM / Google Open Buildings / Microsoft ML) |
|---|---|---|---|---|
| Envelope | **22,369** | **0** | 670 (3.0%) | 6,787 / 8,207 / 7,375 |
| Elmina East core | 6,433 | 0 | 154 (2.4%) | 3,033 / 1,764 / 1,636 |
| Elmina West + Green | 10,157 | 0 | 211 (2.1%) | 3,348 / 4,780 / 2,029 |

  Overture has **3.2x the buildings OSM has** in the envelope (22.4k vs 6.9k), thanks to Google and Microsoft footprints, but **no building has a height** and only ~3% have floors. So 3D buildings must come from the Google mesh (photoreal) or from default-height extrusion (fallback); do not promise accurate extruded heights. Overture transportation shows 8,871 road/path segments in the envelope (residential 3,742, service 1,661, footway 966, unclassified 840, tertiary 572, secondary 408, path 212). The envelope still contains non-Elmina land (see 2.1), so cut by polygon before using these totals.

### 2.4 Google photoreal tiles over Elmina: evidence and a 5-minute check

**Evidence found:** none. Searches for Google Earth 3D in Shah Alam or Elmina returned no screenshots, community reports or coverage lists. The only related finding is that Elmina and Shah Alam are on an OSM community list of areas updated with Esri World Imagery (2D, undated). The Google coverage table lists Malaysia at country level only ([coverage](https://developers.google.com/maps/coverage)). So: **unverified.**

**5-minute manual check (any teammate, no key needed):**
1. Open `earth.google.com/web`, search "Elmina Lakeside Mall", switch **3D on**, tilt to about 60 degrees, zoom to street level.
2. Judge six things: building sides textured (not flat extrusions), roofs correct, trees as blobs or sharp, lake surface flat, Iconic Bridge intact, are the Rainforest Centre and Elmina Gardens covered or only blocky buildings.
3. Pan to Elmina West (3.205, 101.480) and the business park (3.223, 101.518): coverage is often patchy at the suburban edge.
4. Screenshot all three; record the date the imagery was captured (Earth shows it).
5. Optional (+5 minutes, needs a key): open the `3d-tiles-renderer` Google example or Cesium Sandcastle "Google Photorealistic 3D Tiles", fly to `3.1813, 101.5099`, and read the on-screen copyright credits.

Pass = building shapes recognisable from above and at 45 degrees. If it fails, run fallback chain step 1 (OSM Buildings + terrain) and make the wow factor come from the flood animation instead.

---

## 3. Recycling and waste data (thin lens)

| Source | What exists | Usable for MVP? |
|---|---|---|
| **MBSA** (Shah Alam city council) | Door-to-door recycling programme with Nestlé from 22 May 2023 in Seksyen 31, 32, 33 and Alam Budiman, with a street-level schedule PDF; a 2021 pilot of 540 households in Seksyen 18 and 24; bulk waste collected weekends (Jan 2022 report); in Aug 2026 more than 2,000 food premises had to separate food waste, collected by MBSA-appointed contractors. Contact 03-55105133 (from MBSA PDF page) ([schedule PDF](https://mbsa.gov.my/ms-my/mbsa/perkhidmatan/perkhidmatanperbandaran/Documents/Collection%20Schedule%20for%20MBSA%20(Fasa%203)-%20Rev.-3.0.pdf), [Utusan 2021](https://www.utusan.com.my/ekonomi/2021/10/mbsa-nestle-bekerjasama-program-kitar-semula/)) | **Elmina not covered.** Link out and mark "schedule unknown" |
| **Domestic collector** | KDEB Waste Management serves 11 Selangor councils *except* Shah Alam (Bernama 2019, via search); Alam Flora's concessions are KL, Putrajaya, Pahang and others, not Shah Alam. MBSA contractor for Shah Alam **not identified** (renewal process in progress per a Sept 2026 Star snippet) | No schedule data; ask SDP township office |
| **SWCorp** | No downloadable Selangor/Shah Alam recycling-centre list or data.gov.my dataset found. Selangor's SELKitar programme lists other districts, not Shah Alam ([The Sun](https://thesun.my/news/malaysia-news/selangor-expands-recycling-programme-to-all-districts-with-e-waste-focus/)) | Not as data |
| **DOE e-waste** | A Feb 2026 report says the DOE portal lists registered collection centres and drop-off points; MCMC publishes KITAR boxes for old phones; DOE E-Waste Collection Day was the last Saturday of each month in 2021 (current status unknown). Three DOE-licensed e-waste recovery plants are in Shah Alam (industrial, not drop-offs) | Hand-curate 2-5 points; confirm URLs before linking |
| **Aggregators/apps** | Zero Waste Malaysia map: 1,764 recycling/buy-back/RVM places and 545 e-waste points nationally, 613 in Selangor, updated 8 Oct 2026; aggregates SWCorp, DOE, MCMC, Tzu Chi lists; **no licence, no API stated** ([map](https://malaysia4u.com/tools/zero-waste)). KITARecycle (SWM Environment) works in southern states, not Selangor. A Malay Mail piece (16 Jul 2026) names three plastic-for-credit apps but the page returned 403. "iCycle", "Recycle For Life", "TrashIt": not found | Reference only; **do not scrape** (no licence) |
| **OSM near Elmina** | `amenity=recycling` **0**, `waste_basket` 5, `waste_disposal` 0 in the envelope | Seed bins only |
| **SDP initiatives** | Waste Management Project since 2016; 30+ tonnes of household recyclables at Bandar Bukit Raja (not Elmina); "Beyond Bins" campaign at Bandar Bukit Raja; Elmina Central Park edible gardens (100+ plots) linked to an organic-waste recycling programme; waste sorting and upcycling workshops at Elmina Rainforest Knowledge Centre with UKM-YSD Chair (Jan-Feb 2025) ([StarProperty](https://www.starproperty.my/news/property-news/sime-darby-property-launches-beyond-bins-campaign/82578), [UKM-YSD](https://myiklimysd.ukm.my/sime-darby-property-and-ukm-ysd-chair-for-sustainability-collaborate-on-waste-management-skills-at-elmina-rainforest-knowledge-centre/)) | Yes: composting and workshop sites as "SDP programme" points |

**Realistic MVP (2-3 days of work total):** a recycling lens with one `waste_point` place type (`bin`, `recycling_drop_off`, `e_waste_drop_off`, `composting_site`, `programme_site`), about 20-40 points:
1. the 5 OSM waste baskets plus field-surveyed bins near the park (all `reported` until visited);
2. 3-8 recycling/e-waste points within about 10 km, each hand-entered with its source URL and checked-on date (never bulk-copied);
3. the Central Park composting/edible-garden site and the Rainforest Knowledge Centre as SDP programme points;
4. an honest "collection day: unknown, ask MBSA" card with the council contact, which feeds the same verification-request queue as accessibility gaps.

That reuses the claims/verification model, adds no new infrastructure, and the AI answers "where can I drop off old batteries?" with verified/unknown wording.

---

## 4. Township-scale data architecture

### 4.1 How 2026 urban twins structure layered data

| Standard | State (verified this session) | Role for us |
|---|---|---|
| **CityGML 3.0** | Conceptual model approved 2021; GML encoding adopted later; adds BIM links, indoor spaces, dynamic sensor data ([OGC](https://www.ogc.org/standard/citygml/)) | Reference vocabulary only; no Malaysian CityGML source for Elmina |
| **CityJSON 2.0** | OGC Community Standard 20-072r5; JSON encoding of a CityGML 3.0 subset; Nov 2023 ([OGC](https://www.ogc.org/standards/cityjson/)) | Interchange only if SDP supplies city models |
| **3D Tiles 1.1** | OGC Community Standard 22-025r4; glTF content, semantic metadata, implicit tiling, multiple contents ([OGC](https://www.ogc.org/standards/3DTiles)); a 3D Tiles 2.0 work item had its RFC close 23 Jul 2026 | What Google and Cesium stream; we consume, not produce |
| **OGC API Features** | Part 4 (create/update/delete) was still a draft in the sources found; pygeoapi supports the draft ([pygeoapi docs](https://docs.pygeoapi.io/en/latest/transactions.html)) | Not needed; our FastAPI already serves lens GeoJSON |
| **Overture schema** | Themes buildings, transportation, places, base; release 2026-09-23.1 on the bucket | Source of buildings/POIs, ODbL |
| **OpenSidewalks** | Network-first schema (nodes, edges, zones) as GeoJSON; still a draft ([repo](https://github.com/OpenSidewalks/OpenSidewalks-Schema)); separate OSM-US PWG sidewalk tagging schema 1.0 (Mar 2026) | Borrow edge/node field names for the accessibility lens |

Common pattern: a **base twin** (terrain, buildings, hydrology, network, places) shared by all applications, plus **thematic overlays** that reference base feature IDs and carry their own attributes and provenance. 3D Tiles carries the heavy visual layer; vector feature layers carry the analytic content.

### 4.2 Recommendation for us

**Model: base twin + lens overlays, one common envelope.**

```
base:   buildings, terrain/DEM, hydrology (waterway, water), network edges/nodes, places
lens:   accessibility  -> claims on edges/nodes/places (status verified|unknown|reported, evidence_ids)
        flood          -> scenario table: (scenario_id, level_m) -> flooded_edge_ids, flooded_building_ids, zone polygon
        recycling      -> waste_point places + programme sites
feature common fields: id, lens, geometry, status, source, source_url, valid_from, valid_to, evidence_ids
```

Flood results are **precomputed scenarios** (about 8-10 levels), not live hydraulics, which keeps the demo deterministic and tool-callable (`flood.set_level` returns flooded segments and evacuation options).

**Storage at about 15-100k features (envelope has ~7k buildings and ~1.4k pedestrian ways in OSM):**

| Option | Verdict |
|---|---|
| **GeoJSON/GeoParquet files in `data/seed/` + in-memory Shapely STRtree + NetworkX** | **Recommended runtime.** Matches the skeleton, zero ops, versioned in git (ODbL attribution in `data/README.md`) |
| **SQLite** (skeleton already has it) | Keep for claims, verification requests, question log |
| **DuckDB + spatial / GeoParquet** | Use at build time for Overture/OSM joins, DEM zonal stats, clipping to the Elmina polygon; GeoParquet is good for analytical snapshots, less so low-latency serving (FOSS4G 2026 talk via search) |
| **PostGIS** | Defer. Worth it only with multiple concurrent editors or live tile serving (Martin); adds Cloud SQL ops for a 4-week team |

### 4.3 Serving vector layers to the 3D engine

| Layer | Hero 3D (Cesium) | Lite 2D/2.5D (Mapbox/MapLibre) |
|---|---|---|
| Routes, flooded segments, evacuation centres, waste points | **GeoJSON per lens** from FastAPI (gzip, ETag, bbox param); a few thousand features is fine as entities | Same GeoJSON, or PMTiles |
| Buildings, full footway network | Not drawn as vector in 3D (Google tiles or OSM Buildings already show buildings) | **PMTiles** (built with tippecanoe) from static storage, no tile server |
| Flood water polygon | One polygon per scenario level (GeoJSON, pre-simplified) | Fill layer, same polygon |

Rules of thumb (our judgement, unverified by benchmark): keep each lens under about 2-5 MB gzipped as GeoJSON; Cesium entity creation gets slow beyond several thousand dynamic entities, so batch static lines as primitives if needed; switch a layer to PMTiles/MVT only when it exceeds that or is needed in the 2D view. The PMTiles JS library is 4.5.0 and needs a protocol registration in MapLibre/Mapbox ([PMTiles](https://github.com/protomaps/PMTiles)); Cesium has no native vector-tile entity path we verified.

---

## 5. Next actions (week 1)

1. Run the 5-minute Google 3D check (section 2.4) and screenshot it.
2. Half-day Cesium spike: Google tiles at `3.1813, 101.5099`, one clamped polyline, one translucent extruded polygon animated 0 to 3 m, `flyTo`, credits on screen. Test on one mid-range Android phone.
3. Ask SDP: master-plan boundary polygon for Elmina; evacuation/PPS list; any LiDAR or flood study; MBSA waste contact; permission to publish waste points.
4. Download a Geofabrik extract and Copernicus GLO-30 tiles for the envelope; clip to the Elmina polygon; recount.
5. Add ADR-0009 (hero engine = Cesium; ADR-0007 downgraded to lite view) and a superseded note in the skeleton spec section 2.

## 6. Open questions

1. Real mesh quality of Google tiles over Elmina West and the business park (unverified).
2. Does an unfunded student project qualify for ion Community, or do we use only our own Google key (preferred)? Pilot with SDP would need a paid plan if ion assets are used.
3. Which Google SKU bills `Map3DElement`?
4. Official Elmina boundary and the actual share of the envelope that is Elmina.
5. Who collects domestic waste in Elmina and are there recycling points not in OSM?
6. Exact `Material.WaterType` uniforms and Primitive `modelMatrix` animation approach (spike).

---

## Sources

**Engines and APIs**
- Cesium reference via ctx7 (`/websites/cesium_learn_cesiumjs_ref-doc`): https://cesium.com/learn/cesiumjs/ref-doc/global.html , https://cesium.com/learn/cesiumjs/ref-doc/PolygonGraphics.html , https://cesium.com/learn/cesiumjs/ref-doc/Cesium3DTileset.html , https://cesium.com/learn/cesiumjs/ref-doc/Camera.html , https://cesium.com/learn/cesiumjs/ref-doc/Entity.html , https://cesium.com/learn/cesiumjs/ref-doc/Material.html
- Resium via ctx7: https://github.com/reearth/resium
- 3d-tiles-renderer R3F docs via ctx7: https://github.com/nasa-ammos/3dtilesrendererjs/blob/master/src/r3f/README.md , https://github.com/nasa-ammos/3dtilesrendererjs/blob/master/src/r3f/API.md
- deck.gl via ctx7: https://github.com/visgl/deck.gl/blob/master/docs/developer-guide/base-maps/using-with-3d-tiles.md , https://github.com/visgl/deck.gl/blob/master/docs/api-reference/geo-layers/tile-3d-layer.md
- Mapbox GL JS via ctx7: https://docs.mapbox.com/mapbox-gl-js/guides/styles/work-with-layers , https://docs.mapbox.com/mapbox-gl-js/example/add-terrain , https://docs.mapbox.com/mapbox-gl-js/example/add-3d-model
- react-google-maps `Map3D`: https://github.com/visgl/react-google-maps/blob/main/docs/api-reference/components/map-3d.md
- Google Maps JS releases / 3D reference / launch stages: https://developers.google.com/maps/documentation/javascript/releases , https://developers.google.com/maps/documentation/javascript/reference/3d-map-draw , https://developers.google.com/maps/launch-stages
- Google Map Tiles policies, coverage, renderer guide, pricing: https://developers.google.com/maps/documentation/tile/policies , https://developers.google.com/maps/coverage , https://developers.google.com/maps/documentation/tile/use-renderer , https://developers.google.com/maps/billing-and-pricing/pricing
- Cesium ion pricing: https://cesium.com/platform/cesium-ion/pricing/
- Mapbox pricing: https://www.mapbox.com/pricing
- Cesium mobile tuning threads (secondary): https://community.cesium.com/t/error-when-loading-cesium3dtileset-on-mobile-devices-with-lower-ram/21057 , https://community.cesium.com/t/photorealistic-3d-tiles-too-many-draw-calls/24369

**Elmina extent and data**
- OSM data via Overpass (ODbL), queries run 14 Oct 2026: https://overpass-api.de/api/interpreter
- PropertyGuru and StarProperty on estate acreage: https://www.propertyguru.com.my/new-property-launch/reviews/city-of-elmina-shah-alam-216064 , https://www.starproperty.my/news/exploring-the-green-city-of-elmina/96357
- Overture buildings guide: https://docs.overturemaps.org/guides/buildings/ ; Google Open Buildings in Overture: https://www.geoweeknews.com/?p=41050 ; review: https://dev.to/krschap/exploring-overture-map-data-2l49 ; OSM Klang Valley diary: https://www.openstreetmap.org/user/Zh9567/diary
- Copernicus DEM GLO-30: https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM
- Flood context (news): https://www.malaymail.com/news/malaysia/2025/04/23/flash-floods-hit-klang-valley-after-overnight-thunderstorm-major-highways-affected/174122 , https://www.nst.com.my/amp/news/nation/2023/08/943719/heavy-rain-causes-flash-floods-shah-alam , https://www.nst.com.my/amp/news/nation/2025/11/1322495/rising-evacuations-19-flood-relief-centres-open-selangor

**Recycling**
- MBSA schedule PDF and Nestlé programme: https://mbsa.gov.my/ms-my/mbsa/perkhidmatan/perkhidmatanperbandaran/Documents/Collection%20Schedule%20for%20MBSA%20(Fasa%203)-%20Rev.-3.0.pdf , https://www.utusan.com.my/ekonomi/2021/10/mbsa-nestle-bekerjasama-program-kitar-semula/
- Selangor recycling expansion: https://thesun.my/news/malaysia-news/selangor-expands-recycling-programme-to-all-districts-with-e-waste-focus/
- Zero Waste Malaysia map: https://malaysia4u.com/tools/zero-waste
- E-waste (Malay Mail, Feb 2026): https://www.malaymail.com/amp/news/malaysia/2025/02/07/the-growing-e-waste-crisis-in-malaysia-what-you-need-to-know-and-how-to-act/164970
- SDP: https://www.starproperty.my/news/property-news/sime-darby-property-launches-beyond-bins-campaign/82578 , https://myiklimysd.ukm.my/sime-darby-property-and-ukm-ysd-chair-for-sustainability-collaborate-on-waste-management-skills-at-elmina-rainforest-knowledge-centre/ , https://www.theedgemarkets.com/article/city-elmina-gets-first-community-edible-gardens

**Standards and architecture**
- CityGML: https://www.ogc.org/standard/citygml/ ; CityJSON: https://www.ogc.org/standards/cityjson/ ; 3D Tiles: https://www.ogc.org/standards/3DTiles
- OGC API Features Part 4 draft / pygeoapi: https://portal.ogc.org/files/108198 , https://docs.pygeoapi.io/en/latest/transactions.html
- OpenSidewalks: https://github.com/OpenSidewalks/OpenSidewalks-Schema ; PWG schema: https://openstreetmap.us/news/2026/03/pwg-schema-release/
- Cloud-native formats overview: https://atlas.co/courses/gis-basics/cloud-native-formats-pmtiles/ ; PMTiles: https://github.com/protomaps/PMTiles

*Not verified:* Mapbox loading Google tiles, Cesium `Material.WaterType` uniforms, Primitive `modelMatrix` water animation, Elmina photoreal quality, Elmina-specific flood history, Google SKU for `Map3DElement`, any official Elmina boundary, mobile frame-rate numbers.
