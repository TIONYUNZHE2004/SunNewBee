# 3D Data Sources and Web Rendering for TownshipLens (state of play, Oct 2026)

> Research date: 14 Oct 2026. Scope: which *existing* 3D data we can use for one Sime Darby Property (SDP) township facility in Malaysia (team decided: **no own capture**), and which web renderer to show it with. Anything we could not confirm is marked **(unverified)**. Machine-readable repo and paper lists: [../../reference/notes/3d-sources.md](../../reference/notes/3d-sources.md).

## TL;DR for TownshipLens

- **Recommended MVP = hybrid.** Google Photorealistic 3D Tiles as a *visual backdrop* + **our own lightweight annotated geometry** (path graph, entrances, toilets, seating) drawn on top. The "truth" (accessibility facts) lives in the spatial graph, never in the photoreal mesh.
- **Renderer: `3d-tiles-renderer` (NASA-AMMOS) inside React Three Fiber (R3F).** It fits the team's baseline stack, is Apache-2.0, loads Google tiles, and lets us put ordinary three.js objects (lines, markers, glowing routes) in the same scene. **CesiumJS (+Resium)** is the batteries-included fallback; **MapLibre 2D** is the mandatory accessibility/2D fallback.
- **Malaysia is on Google's coverage table** for Map Tiles 3D and Maps JavaScript 3D ([coverage](https://developers.google.com/maps/coverage)), but *quality over one specific township is unverified*. **Day-1 task: open that exact facility in the 3D viewer and judge it.** Older Google Earth 3D lists name Shah Alam/Klang/Port Klang ([community list](https://list.fandom.com/wiki/List_of_3D_locations_in_Google_Earth), weak source).
- **Biggest licensing trap: you may overlay your own objects, but they cannot be "extracted, traced, or otherwise derived by hand or machine" from the tiles; no caching/offline; visualisation only** ([Google policies](https://developers.google.com/maps/documentation/tile/policies)). So: digitise the path graph from **field survey, OSM, SDP plans or our own photos, not by tracing the Google mesh**. Demo needs live internet (record a backup video).
- **Cost is a non-issue for a hackathon**: 1,000 free billable events/month, then $6.00 per 1,000 ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing)); one root-tile request buys a 3-hour session ([usage](https://developers.google.com/maps/documentation/tile/usage-and-billing)). Needs a Cloud billing account and the product is in the **Enterprise** tier (unverified whether a student can get it instantly).
- **Fallback if Google tiles look bad or the ToS bites: OSM/Overture 3D buildings (ODbL, open) + one hand-made glTF of the facility + the same overlay.** If SDP gives BIM/IFC, convert it to glTF and use it instead of photoreal.
- **Gaussian splats are the 2026 hot trend (Cesium shipped hierarchical-LOD splat tiles; `KHR_gaussian_splatting` is at Release Candidate), but they need own capture or a ready-made dataset.** For us: mention as "future pilot path", do not build on it.
- **Do not trust any 3D scene for accessibility facts** (step heights, slopes, widths). Photogrammetry mesh smooths curbs and steps. Keep the "verified, timestamped graph" story.

---

## 1. Jargon cheat-sheet

| Term | Meaning |
|---|---|
| **3D Tiles** | Open standard (OGC) for streaming huge 3D datasets as a tree of small tiles; the viewer only loads what is near the camera. Google's photoreal map is delivered this way. |
| **glTF** | "JPEG of 3D": the standard file format for 3D models on the web. Each 3D tile is a glTF. |
| **Photogrammetry mesh** | A 3D surface reconstructed from many aerial photos. Looks real, but is "melted" at fine detail (stairs, railings, thin objects). |
| **LOD** | Level of detail: show coarse versions far away, fine up close. |
| **Gaussian splat (3DGS)** | A scene stored as millions of fuzzy coloured blobs; renders photoreal views fast, but has no clean surfaces to route on. |
| **WGS84 (lat/lon/height)** | GPS coordinates. Our graph nodes will have these. |
| **ECEF** | Earth-Centred, Earth-Fixed XYZ in metres from Earth's centre. What 3D Tiles use internally. |
| **ENU** | East-North-Up: a flat local metre grid anchored at one point (e.g. the hall entrance). Easiest way to place our graph. |
| **ODbL** | Open Database Licence (OSM). Must credit and share-alike *the database* if you publicly use adapted data. |
| **IFC / BIM** | Building Information Model: architects' structured 3D model of a building, with rooms, doors, stairs, lifts. |

---

## 2. Data sources compared

### 2.1 Summary table

| Source | What you get | Malaysia / Klang Valley | Cost / licence | Fit for our overlay + routing | Verdict |
|---|---|---|---|---|---|
| **Google Photorealistic 3D Tiles** (Map Tiles API) | Textured photogrammetry mesh of buildings, trees, terrain | Listed as available for MY ([coverage](https://developers.google.com/maps/coverage)); per-township quality **unverified** | Enterprise SKU: 1,000 free events/mo, $6/1k after ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing)); strict ToS | Excellent visual; cannot derive geometry from it | **Primary backdrop** (with caveats) |
| **Cesium ion + Google tiles** | Same tiles via Cesium's hosted service | Same | Community tier free for non-commercial: 1,000 Google root tiles/mo; Commercial $149/mo = 5,000 ([Cesium pricing](https://cesium.com/platform/cesium-ion/pricing/)) | Good if using CesiumJS | Alternative way to access same data |
| **Cesium OSM Buildings** | Global 3D-Tiles building extrusions from OSM, 350M+ buildings, updated quarterly; needs "© OpenStreetMap contributors" ([Cesium](https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/)) | Global, so yes; per-building height completeness **unverified** | Free ion account usable | Clean boxes: good "neutral" backdrop | **Fallback backdrop** |
| **OpenStreetMap (raw)** | Footprints, `height`/`building:levels`, footways, `wheelchair=*`, `kerb=*`, entrances | ~715,932 buildings added in KL/Putrajaya/Selangor by one contributor by Aug 2024 ([OSM diary](https://www.openstreetmap.org/user/Zh9567/diary)); accessibility tags per township **unverified** | ODbL (attribution + share-alike) | Great source for **path graph seed** | **Must use** as geometry/graph seed |
| **Overture Maps** | Buildings, transportation, places, base; release 2026-08-19.0, schema v1.18 ([notes](https://docs.overturemaps.org/blog/2026/08/19/release-notes/)) | Malaysia not called out; places counts large (third-party: 828,683 MY places, [source](https://openplacesapi.com/coverage/malaysia), unverified); filter `country=MY` yourself | Buildings/transport/base ODbL; places mostly CDLA-Permissive ([attribution](https://docs.overturemaps.org/attribution/)) | Nice single download; buildings merge OSM + Microsoft + Google footprints | **Useful** (POI + footprints) |
| **Google Open Buildings 2.5D Temporal** | Building presence/height rasters 2016–2023, ~4 m effective resolution ([Earth Engine](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1?hl=ar)) | ~130+ countries, MY coverage **unverified** | Per dataset page | Too coarse for a single facility | Skip |
| **Microsoft ML footprints** | Footprints only (already in Overture) | Via Overture | ODbL | No height | Skip (use via Overture) |
| **MapLibre GL JS 3D buildings + terrain** | 2.5D extruded buildings over vector tiles, globe, terrain | Whatever tiles we supply (e.g. Overture/OSM PMTiles) | BSD-style OSS; v6.14.0 current (inferred 2026) ([releases](https://github.com/maplibre/maplibre-gl-js/releases)) | Perfect **2D/2.5D fallback** and accessible map | **Must use as fallback** |
| **Mapbox** | Vector tiles w/ 3D buildings, terrain | Yes (commercial) | Proprietary token, ToS (not reviewed) | No advantage over MapLibre | Skip (unverified) |
| **Sketchfab / CC models** | Hand-made models of random buildings | Unlikely for a Malaysian township | Per-model CC licence; editorial licences prohibit commercial use ([Sketchfab licence](https://sketchfab.com/licenses)) | Poor georeferencing | Only for props (benches, trees) |
| **Open Gaussian-splat datasets** | Research scenes (Mip-NeRF360 etc.), not Malaysian townships | None expected (unverified) | Mostly research/non-commercial | No | Skip |
| **Procedural from OSM (OSM2World, Blosm)** | Textured/untextured 3D from OSM into glTF/OBJ/3D Tiles | Anywhere OSM has data | OSM2World MIT ([repo](https://github.com/tordanik/OSM2World)); Blosm GPL, Pro paid ([repo](https://github.com/vvoovv/blosm)) | Good to build the "clean twin" fallback | **Fallback tool** |
| **SDP BIM / CAD / IFC** | Authoritative geometry for one building: doors, stairs, ramps, lifts | Only if SDP provides it (ask mentors!) | Needs permission; no public data | Best for routing and annotations | **Ask on day 1**; render via That Open Engine/web-ifc, or convert to glTF |
| **JUPEM SmartKADASTER CityGML** | KL/Putrajaya LoD city models (research papers) | KL & Putrajaya only; no evidence of open download ([paper](https://isprs-annals.copernicus.org/articles/VIII-4-W2-2021/99/2021/)) | Government, unclear | Probably irrelevant to a Selangor township | Skip unless a mentor offers |

### 2.2 Google Photorealistic 3D Tiles in detail

**What it is.** Google's photoreal Earth/Maps 3D mesh served as OGC 3D Tiles. Any 3D-Tiles-capable renderer can show it; Google's docs list CesiumJS, Cesium for Unreal/Unity and deck.gl ([renderer guide](https://developers.google.com/maps/documentation/tile/use-renderer)).

**Coverage.** The coverage table shows Malaysia with Map Tiles 2D/3D and Maps JavaScript 3D available ([table](https://developers.google.com/maps/coverage)). The table is country-level only; "coverage" does not guarantee crisp photogrammetry in a suburban township. Analysts note new 3D tiles are concentrated in high-density city areas ([overview](https://www.aiviagroup.com/comparing-google-3d-tiles-with-other-geospatial-datasets/), via search snippet). Action: judge your exact facility (Google Earth web with 3D enabled, or Cesium sandcastle / `3d-tiles-renderer` Google example).

**Pricing and quotas.**
- SKU "Photorealistic 3D Tiles", Enterprise category; 1,000 free billable events/month; $6.00 / 1,000 for 0–100k ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing)).
- One *root tileset* request gives a session token valid for up to 3 hours of renderer tile requests; renderer tile requests are unlimited per day; root queries capped at 10,000/day per project ([usage and billing](https://developers.google.com/maps/documentation/tile/usage-and-billing)). In practice: **one page load ~= one billable event**.
- Plans page lists 3D Tiles only under Enterprise (custom) ([plans](https://mapsplatform.google.com/pricing/)). Whether a new student account can enable it without sales contact is **unverified**; check in the Cloud console today.
- Google's EEA terms remove some Map Tiles content for EEA billing addresses (from 8 July 2025); not relevant to a Malaysian billing address.

**ToS essentials** (from [Photorealistic 3D Tiles policies](https://developers.google.com/maps/documentation/tile/policies)):

| Topic | Rule |
|---|---|
| Caching / storing | Do not pre-fetch, index, store or cache beyond what headers permit (`max-age`, `ETag` etc.) |
| Offline | Prohibited, including for analysis |
| Purpose | **Visualisation only**; no image analysis, object detection, geodata extraction or resale |
| Attribution | Read `copyright` from each tile's glTF `asset`, merge into one line; CesiumJS `showCreditsOnScreen: true` |
| Mixing with other data | Allowed, but make clear what is Google data; don't overlap the Google logo; keep third-party attributions separate |
| Overlays | Your own 3D objects may sit on top, but may not be extracted, traced or derived (by hand or machine) from the tiles |

Implications for us:
1. **No computer vision on the tiles** (e.g. "detect stairs from the mesh" is out). Accessibility facts come from field verification, OSM, SDP data.
2. **Digitise paths from non-Google sources.** Do not trace the walkway polyline by clicking on the Google mesh; use OSM footways, SDP plans, our own site photos/GPS walk, or a neutral 2D basemap (e.g. OSM). Position them in the scene by coordinate, not by tracing. (Interpretation, not legal advice. Ask the organisers.) Raycasting a node's lat/lon down onto the mesh just to get a *display height* is a gray area; prefer a fixed local ground height or terrain data (unverified risk).
3. **Cannot ship a static/offline demo.** Plan a screen-recorded demo video for judges and a graceful fallback (OSM buildings) when the tiles fail.
4. Protect the API key (HTTP referrer restrictions + billing budget alert). Passing tiles through our own proxy is *probably* fine if headers/caching rules are respected (unverified).
5. Also note this will be viewed under SDP's "pilot" scrutiny: a production deployment would need a proper Google Maps Platform contract (cost modelled above).

### 2.3 Cesium ion route

Cesium ion hosts Google's tiles too and counts "root tiles" against plan quota: Community (free, personal/non-commercial) 1,000/month, Commercial 5,000, Premium 10,000 ([pricing](https://cesium.com/platform/cesium-ion/pricing/)). Community may be used for unfunded educational activities and exploratory evaluation, but projects with funding or government connection need a paid licence, so a *pilot with SDP* would trigger Commercial (cost $149/mo individual, per the same page). For the hackathon, our own Google key is simpler.

### 2.4 OSM / Overture / procedural fallback

- **OSM** is where the *graph* can start: `highway=footway`, `highway=steps`, `kerb=*`, `wheelchair=*`, `entrance=*`, `amenity=toilets`, `amenity=bench`, `shelter`. Tag completeness in Malaysian townships is **unverified**: query [Overpass Turbo](https://overpass-turbo.eu/) for `wheelchair=*` near the facility. A proposal for richer OSM accessibility tags exists ([wiki](https://wiki.openstreetmap.org/wiki/Proposal:Accessibility)), but widespread adoption is not established. We will probably map the missing tags ourselves, then publish back to OSM if the team wants impact.
- **Overture** (release 2026-08-19.0, schema v1.18.0; buildings/transportation/divisions/base/places GA, addresses alpha, per [2026 release notes](https://docs.overturemaps.org/blog/2026/01/21/release-notes/)) mixes OSM + Microsoft + Google footprints. OK for footprints and POIs. Height coverage in Malaysia is patchy (a 2024 informal review found heights only on some buildings, [dev.to](https://dev.to/krschap/exploring-overture-map-data-2l49)); the Aug 2026 release says hundreds of thousands of buildings got updated height/floors, nothing Malaysia-specific. Use `overturemaps` CLI with a bbox. Licence: attribute "© OpenStreetMap contributors, Overture Maps Foundation" ([attribution](https://docs.overturemaps.org/attribution/)).
- **Blender route:** Blosm or OSM2World to produce a glTF of the surrounding buildings, then hand-model the facility (hall, ramps, steps) in Blender. About 2 to 4 days for one person; gives a controlled, route-friendly, fully-licensed scene.

### 2.5 SDP BIM / IFC (ask for it)

If SDP supplies an IFC for the community hall, **That Open Engine** (`@thatopen/components`, MIT; v3.x with 2D drawings added in 3.4.0, April 2026 per [OSArch](https://osarch.org/tags/thatopenplatform/)) or its WASM parser **web-ifc** can load it in the browser. IFC carries doors, stairs, ramps, lifts, so the route graph can be *derived* from authoritative data, a strong feasibility story. Simpler: convert IFC to glTF with Blender/IfcConvert for R3F. Georeferencing IFC is often missing: you need a manual anchor (one known corner lat/lon + rotation).

---

## 3. Web rendering options (2026)

### 3.1 Comparison

| Option | Status (Oct 2026) | Strengths | Weaknesses | Google tiles? | Our fit |
|---|---|---|---|---|---|
| **3d-tiles-renderer + three.js / R3F** | Apache-2.0; v0.5.3 (2026-09-18); has Google tile examples, R3F package, plugins (Potree, MVT annotations, terrain etc.) ([repo](https://github.com/NASA-AMMOS/3DTilesRendererJS), [changelog](https://raw.githubusercontent.com/NASA-AMMOS/3DTilesRendererJS/master/CHANGELOG.md)) | Same scene graph as our overlay; full control; light | Pre-1.0 API changes (0.4 to 0.5 removed deprecated APIs); less hand-holding than Cesium; WebGPU/splat support not confirmed in changelog | Yes (needs API key) | **Primary** |
| **CesiumJS (+ Resium)** | CesiumJS 1.146 (2026-10-01), monthly releases; KHR_gaussian_splatting support added from 1.139 ([changes](https://raw.githubusercontent.com/CesiumGS/cesium/main/CHANGES.md), [Cesium blog](https://cesium.com/blog/2026/04/27/3d-gaussian-splats-lod/)); Resium is MIT React wrapper, active ([repo](https://github.com/reearth/resium)) | Georeferencing, polylines, billboards, camera flyTo, credits built in; strongest 3D-Tiles ecosystem; splat tiles | Heavy bundle; own scene graph so custom glowing route shaders less natural; React wrapper not R3F | Yes (set `showCreditsOnScreen: true`; `requestsByServer['tile.googleapis.com:443']` about 18) | **Fallback / spike alternative** |
| **Google Maps JS "3D Maps" (`gmp-map-3d`, `Map3DElement`)** | Available for Malaysia; some features still labelled Alpha/Beta (e.g. `Route3DElement`, `Label3DElement` alpha; `ROADMAP` mode beta) in 2026 release notes ([releases](https://developers.google.com/maps/documentation/javascript/releases?hl=en), [reference](https://developers.google.com/maps/documentation/javascript/reference/3d-map)); GA status of whole element **unverified** | Easiest ToS-compliant way (Google logo/attribution/session handled); markers, polylines, models supported (per docs sidebar) | Locked-down: cannot embed arbitrary three.js; beta channel churn; billing SKU not found on pricing page (unverified) | Native | **Good 2-hour demo prototype**, risky as main |
| **deck.gl `Tile3DLayer`** | v9.4.0 (2026-09-05); layers ported to WebGPU ([releases](https://github.com/visgl/deck.gl/releases)); Google tiles documented ([doc](https://github.com/visgl/deck.gl/blob/master/docs/api-reference/geo-layers/tile-3d-layer.md)) | Great for data overlays (ArcLayer, PathLayer); works with MapLibre | Less natural for fine 3D annotation models | Yes (API key header) | Option if map-centric UI |
| **MapLibre GL JS 5.x/6.x** | v6.14.0 (inferred Oct 2026); globe, terrain, fill-extrusion ([releases](https://github.com/maplibre/maplibre-gl-js/releases)) | Light; mobile-friendly; accessible fallback | Not photoreal | No | **2D/2.5D fallback** |
| **R3F v9 + drei** | R3F v9.8.1 (24 Sep, React 19.x); v10 alpha (WebGL+WebGPU) ([releases](https://github.com/pmndrs/react-three-fiber/releases)); three.js r186 ([releases](https://github.com/mrdoob/three.js/releases)) | Team baseline; huge ecosystem | WebGPU path still alpha in R3F | via 3d-tiles-renderer | Base layer |
| **Gaussian splat viewers** | **Spark 2.x** (World Labs, MIT, three.js, LOD tree + `.RAD` streaming, April 2026; v2.3.x) ([repo](https://github.com/sparkjsdev/spark), [World Labs](https://worldlabs.ai/blog/spark-2.0)); mkkellogg GaussianSplats3D **no longer in active development**, author points to Spark ([repo](https://github.com/mkkellogg/GaussianSplats3D)); PlayCanvas **SuperSplat** editor (MIT) ([repo](https://github.com/playcanvas/supersplat)) | Photoreal indoor/outdoor captures | Need a capture; no routable surfaces | n/a | Post-MVP / mention only |

### 3.2 WebGPU in 2026

WebGPU now ships in all four major engines (Chrome since 113, Android Chrome since 121, Safari with iOS/macOS 26, Firefox on Windows 141+ and Apple Silicon 145+; Linux/Android Firefox still rolling out) per aggregator coverage ([search summary](https://ascii.co.uk/news/article/news-20251126-7cbd345e/webgpu-now-supported-across-chrome-firefox-safari-edge); secondary sources, **verify on caniuse/MDN**). Tooling follows: three.js `WebGPURenderer`/TSL under active work (r183–r186), deck.gl 9.4 ported layers to WebGPU, R3F v10 alpha supports both. **Recommendation: stay on WebGL2** for the MVP (works on every phone, every library above), treat WebGPU as an upgrade path. One guide cites ~60% Android coverage depending on GPU drivers (unverified).

### 3.3 Performance on mid-range phones

No hard benchmarks found (unverified). Rules of thumb for our team:
- Cap screen-space error / tile quality (e.g. `errorTarget` higher on mobile) and `devicePixelRatio` at 1.5 to 2; restrict camera to a ~300 m radius around the facility so few tiles load.
- Keep our own overlay tiny: a few hundred line segments and <50 markers, instanced.
- Photoreal tiles are heavy on bandwidth; show a loading state and a **"Use simple 2D map"** button.
- Test on one real mid-range Android phone in week 2, not only on laptops.

### 3.4 Accessibility and 2D fallback (requirement, not nice-to-have)

A WebGL canvas is invisible to screen readers. Since our users include wheelchair users and older people:
- Every answer must be **text first** (turn-by-turn: "Exit the carpark via ramp A. Follow the covered walkway 40 m east..."), with the 3D highlight as enhancement.
- Provide keyboard-operable controls and a list of places (not only click-on-3D); respect `prefers-reduced-motion` (no fly-through animation).
- 2D fallback: MapLibre with the same path graph drawn as GeoJSON; works if WebGL/tiles fail. Aim for WCAG 2.2 AA ([WCAG 2.2](https://www.w3.org/TR/WCAG22/)) on the non-canvas UI.

---

## 4. 2026 trends that matter (and those that do not)

| Trend | State | Relevance to our 4-week MVP |
|---|---|---|
| **Gaussian splats go "tiled"** | Cesium added hierarchical LOD splats to 3D Tiles/CesiumJS/Unreal; splats as glTF payload in 3D Tiles; `KHR_gaussian_splatting` + SPZ compression extension; first shipped in CesiumJS 1.139 (Mar 2026); splats planned for "3D Tiles 2.0" ([Cesium blog](https://cesium.com/blog/2026/04/27/3d-gaussian-splats-lod/)) | Pilot-phase pitch: "when SDP captures a facility, we can stream it as a splat tileset" |
| **KHR_gaussian_splatting status** | Khronos announced a Release Candidate (Feb 2026 coverage); a July 2026 page still lists it as RC; Babylon.js and PlayCanvas reported shipping it; **ratification not confirmed** ([AEC Magazine](https://aecmag.com/news/khronos-announces-gltf-gaussian-splatting-extension/), [Digital Production](https://digitalproduction.com/2026/02/04/gltf-learns-to-splat-without-losing-the-plot/)) | Talk about it as "emerging standard", not "ratified" |
| **City-scale splat products** | MapTiler GeoSplats (beta sign-up), Niantic Spatial + Spexi, Bentley/Terrasolid Tallinn workflow, Arrival.Space compositing splats into Google 3D Tiles ([Radiance Fields](https://radiancefields.com/arrival.space-version-2026.6-composites-gaussian-splats-into-google-3d-tiles)); no evidence Google Maps natively streams splats | Confirms direction; none usable for Malaysia today |
| **Research on large-scale splatting** | CityGaussian, Octree-GS, Hierarchical 3DGS, SOG compression (see papers list) | Background reading for the pitch |
| **Feed-forward reconstruction** | VGGT (CVPR 2025, 1B params; commercial use needs separate checkpoint application), successor VGGT-Omega released 18 May 2026 ([repo](https://github.com/facebookresearch/vggt)); MapAnything (Meta/CMU, metric, 3DV 2026) ([arXiv](https://arxiv.org/abs/2509.13414)); DUSt3R/MASt3R | Could turn 30 phone photos into a rough scene without COLMAP. **Out of scope** (no capture) but a nice "pilot" slide. Note: one secondary source flags possible benchmark contamination in a VGGT-Omega ancestor checkpoint (unverified) |
| **Digital twins (Omniverse, Cesium+Bentley, Esri)** | Enterprise platforms; Cesium ion can build splat/mesh tilesets from photos via iTwin Capture | Pitch language only |
| **Scene graphs for LLM grounding** | ConceptGraphs-style 3D scene graphs for planning | Validates our "structured spatial graph beats raw 3D for LLMs" claim |

---

## 5. Recommendation for the MVP

### 5.1 Decision

**Data:** Google Photorealistic 3D Tiles (visual backdrop) + OSM/SDP-sourced path graph + our own annotation geometry. **Renderer:** `3d-tiles-renderer` in React Three Fiber v9 (WebGL2). **Fallbacks:** (A) OSM/Overture 3D buildings + hand-made glTF of the facility; (B) MapLibre 2D; (C) recorded video. If SDP provides IFC/BIM, it replaces the photoreal backdrop for the facility itself.

**Why this beats the alternatives**
- *vs. Google Maps JS 3D element:* we need to draw arbitrary glowing routes, evidence pins, "unverified" dashed segments, camera moves driven by LLM tool calls. Owning the three.js scene gives that; the Google element may remain Alpha/Beta for some of these features.
- *vs. CesiumJS:* nearly equal; Cesium is the better choice **if** nobody on the team is comfortable with three.js. Both load the same Google tiles, so the choice can be reversed after the Day-1 spike.
- *vs. own capture/splat:* out of scope by team decision; no routable geometry.
- *vs. OSM-only:* weak "wow" and recognisability, which is the point of the 3D piece.

### 5.2 Licensing risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Google tiles quality poor at the township | Medium (unverified) | High | Day-1 look; switch to fallback A |
| Tracing paths off the tiles violates "derived" clause | Medium if careless | High | Digitise from OSM/survey/SDP only; document provenance per path in graph |
| Enterprise SKU not enabled for student account | Medium | Medium | Check on day 1; fallback to Cesium ion Community (1,000 root tiles/mo); or fallback A |
| Offline demo impossible | Certain | Medium | Video capture of a working run; fallback scene works offline |
| API key leakage / bill shock | Low | Low-medium | Referrer restrictions, budget alert at $10 |
| Attribution missing | Low | Medium | Render credits line (Google + OSM + Overture) |
| OSM ODbL share-alike if we publish derived graph | Low | Low | Publish the graph under ODbL or keep private; note in repo |
| SDP IP/ownership of captured/annotated data | Unknown | Medium | Ask organisers (open question in [hackathon brief](../01-hackathon/hackathon-brief.md)) |

### 5.3 Pipeline (step by step)

1. **Pick and pin the facility.** Get one WGS84 anchor (lat, lon) at the main entrance; choose a bounding box ~300 m radius. (Day 1)
2. **Spike the visual (2 to 3 hrs, parallel):** (a) 3d-tiles-renderer Google example with your key pointed at the anchor; (b) CesiumJS sandcastle; (c) `gmp-map-3d`. Screenshot all three; decide quality and effort.
3. **Build the graph (backend):** seed from Overpass/Overture (`highway=footway|steps|path`, `kerb`, `wheelchair`, `entrance`), then edit by hand using field survey notes. Store nodes with `lat`, `lon`, `ground_z_hint`, `type`; edges with `length_m`, `surface`, `step_free`, `slope_pct`, `width_m`, `verified_at`, `evidence_url`, `source`. Load as a NetworkX `MultiDiGraph`; export GeoJSON.
4. **API (FastAPI):** `/route?from&to&profile=stroller` returns `{node_ids[], polyline[lat,lon], steps[], unverified_edges[]}`; `/places` returns GeoJSON with annotations.
5. **Place the graph in 3D (frontend).**
   - Define a local frame at the anchor: **ENU** (x=east, y=north, z=up, metres). With 3d-tiles-renderer, use the ellipsoid helpers (`WGS84_ELLIPSOID.getCartographicToPosition(lat, lon, h, target)` and `getEastNorthUpFrame(...)`; check exact names in the repo docs) to compute the transform from ECEF to ENU. Put the tiles in the world as the library does and add an `<group matrix={enuFrame}>` holding our overlay in local metres.
   - For each node: convert WGS84 to ENU metres (approximation `east = R*cos(lat0)*dlon`, `north = R*dlat` is accurate to well under 1 m inside 300 m; no need for a full library). Use `pyproj` in the backend if you prefer to send ENU ready-made.
   - Heights: Google tiles use **ellipsoidal** height; many Malaysian datasets use mean sea level (a geoid offset of several metres exists; value unverified). Do not mix; instead set `ground_z` per node by *visual calibration* (one constant offset per facility) or draw lines "on ground" with depth test off + slight offset. Avoid automated raycasting for heights if you want to stay clear of the "derive" clause (gray area, see 2.2).
   - Rotate/align check: place 5 known landmarks (building corners from OSM) and confirm they sit on the photoreal buildings; adjust a single (dx, dy, dz, yaw) calibration.
6. **Render the overlay:** routes as `Line2`/tube meshes, entrances/toilets/seats as instanced sprite markers with HTML labels (drei `Html`), unverified edges dashed grey, verified solid. Camera `flyTo` triggered by tool-call results from the AI.
7. **Credits and compliance:** render the tile copyright string collected from each tile asset (3d-tiles-renderer exposes credits via `getAttributions`; check docs), plus "© OpenStreetMap contributors".
8. **Fallback toggle:** MapLibre view fed by the same GeoJSON; automatic if WebGL init fails or tiles error. Also shows text route.
9. **Mobile test:** one mid-range Android in week 2; adjust error target and DPR.
10. **Freeze:** record demo video; export final screenshots for the proposal.

### 5.4 Suggested 4-week allocation (3D part only)

| Week | Frontend | Backend | AI |
|---|---|---|---|
| 1 | Viewer spike, tiles loading, anchor/ENU | Seed graph from OSM/Overture; schema | Tool schema: `route`, `find_place`, `explain_uncertainty` |
| 2 | Overlay renderer, markers, flyTo | Route API, evidence fields | Wire tool calls to highlight actions |
| 3 | 2D fallback + accessibility text | Staff correction endpoints | Resident-agent tests on the graph |
| 4 | Polish, mobile perf, credits | Data verification pass | Evaluation vs map+FAQ baseline |

---

## 6. Open questions

1. **Which exact facility?** Needed to test tile quality and OSM completeness. Ask SDP mentors for a facility list, BIM/CAD, and permission to survey.
2. Does the **Enterprise** Map Tiles SKU enable instantly on a student billing account? (Check Cloud console.)
3. Is **Google 3D Tiles use inside a pilot** acceptable to SDP's legal/IT, and does SDP already have a Google Maps Platform contract?
4. Is it acceptable to derive our path polylines from OSM/survey and *display* them over the tiles? (We believe yes; confirm in writing if possible.)
5. `KHR_gaussian_splatting`: ratified yet? (RC as of mid-2026 sources.)
6. **Maps JS 3D `Map3DElement`**: which features are GA vs weekly/beta/alpha today, and what SKU bills it?
7. Overture and OSM **height/accessibility completeness** at the chosen site (run a null-rate query).
8. Real-device performance numbers for the chosen renderer.

---

## 7. Sources

**Google Maps Platform**
- Photorealistic 3D Tiles policies: https://developers.google.com/maps/documentation/tile/policies
- Coverage table: https://developers.google.com/maps/coverage
- Overview: https://developers.google.com/maps/documentation/tile/3d-tiles-overview
- Renderer guide (Cesium/deck.gl): https://developers.google.com/maps/documentation/tile/use-renderer
- Usage and billing: https://developers.google.com/maps/documentation/tile/usage-and-billing
- Pricing list: https://developers.google.com/maps/billing-and-pricing/pricing
- Plans page: https://mapsplatform.google.com/pricing/
- Maps JS 3D overview / get-started / reference: https://developers.google.com/maps/documentation/javascript/3d/overview , https://developers.google.com/maps/documentation/javascript/3d/get-started , https://developers.google.com/maps/documentation/javascript/reference/3d-map
- Maps JS release notes: https://developers.google.com/maps/documentation/javascript/releases?hl=en
- Community list of Google Earth 3D (weak source): https://list.fandom.com/wiki/List_of_3D_locations_in_Google_Earth

**Cesium**
- ion pricing: https://cesium.com/platform/cesium-ion/pricing/
- Cesium OSM Buildings: https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/
- Splat LOD blog (Apr 2026): https://cesium.com/blog/2026/04/27/3d-gaussian-splats-lod/
- CesiumJS changelog: https://raw.githubusercontent.com/CesiumGS/cesium/main/CHANGES.md
- Resium: https://github.com/reearth/resium

**Renderers / libs**
- 3d-tiles-renderer: https://github.com/NASA-AMMOS/3DTilesRendererJS (changelog https://raw.githubusercontent.com/NASA-AMMOS/3DTilesRendererJS/master/CHANGELOG.md)
- R3F releases: https://github.com/pmndrs/react-three-fiber/releases
- three.js releases: https://github.com/mrdoob/three.js/releases
- deck.gl: https://github.com/visgl/deck.gl/releases , Tile3DLayer doc https://github.com/visgl/deck.gl/blob/master/docs/api-reference/geo-layers/tile-3d-layer.md
- MapLibre GL JS: https://github.com/maplibre/maplibre-gl-js/releases
- Spark: https://github.com/sparkjsdev/spark , https://worldlabs.ai/blog/spark-2.0 , https://radiancefields.com/world-labs-previews-spark-2.0
- GaussianSplats3D: https://github.com/mkkellogg/GaussianSplats3D
- SuperSplat: https://github.com/playcanvas/supersplat
- WebGPU support (secondary): https://ascii.co.uk/news/article/news-20251126-7cbd345e/webgpu-now-supported-across-chrome-firefox-safari-edge

**Open data / tools**
- Overture release notes: https://docs.overturemaps.org/blog/2026/08/19/release-notes/ , https://docs.overturemaps.org/blog/2026/01/21/release-notes/
- Overture attribution/licences: https://docs.overturemaps.org/attribution/
- Overture review dev.to (2024): https://dev.to/krschap/exploring-overture-map-data-2l49
- Open Places API Malaysia (third-party): https://openplacesapi.com/coverage/malaysia
- Google Open Buildings Temporal: https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1?hl=ar
- OSM Klang Valley buildings diary: https://www.openstreetmap.org/user/Zh9567/diary
- OSM accessibility proposal: https://wiki.openstreetmap.org/wiki/Proposal:Accessibility
- OSM2World: https://github.com/tordanik/OSM2World ; Blosm: https://github.com/vvoovv/blosm
- That Open Engine (via OSArch): https://osarch.org/tags/thatopenplatform/
- Sketchfab licence: https://sketchfab.com/licenses
- JUPEM CityGML paper: https://isprs-annals.copernicus.org/articles/VIII-4-W2-2021/99/2021/

**Splats / standards / trends**
- Khronos glTF splat extension: https://aecmag.com/news/khronos-announces-gltf-gaussian-splatting-extension/ , https://digitalproduction.com/2026/02/04/gltf-learns-to-splat-without-losing-the-plot/
- Arrival.Space + Google tiles: https://radiancefields.com/arrival.space-version-2026.6-composites-gaussian-splats-into-google-3d-tiles
- VGGT repo (commercial licence, Omega): https://github.com/facebookresearch/vggt
- Papers: see [../../reference/notes/3d-sources.md](../../reference/notes/3d-sources.md)
- WCAG 2.2: https://www.w3.org/TR/WCAG22/ (standard reference, not re-fetched this session)

*Not covered / unverified:* Mapbox ToS, Apple Maps 3D, Luma web viewer, gsplat.js current status, PlayCanvas engine splat details, Chrome mid-range-phone benchmarks, JUPEM data licensing, exact `3d-tiles-renderer` API names for ENU helpers.
