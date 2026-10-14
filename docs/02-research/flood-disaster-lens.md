# Lens 2: Flood / Disaster "What-If" (research)

> Researched 14-15 Oct 2026. Claims cite [F#] (see Sources). "Ran" = executed by us against live public APIs on 14-15 Oct 2026. Anything not verified is marked "(unverified)". Companion file: `reference/notes/flood-sources.md`.
> Context: TownshipLens is becoming a Township World Model of City of Elmina with lenses. Lens 1 = accessibility ([world-model-schema](../04-architecture/world-model-schema.md)). This doc scopes **Lens 2: flood what-if for township management and residents**.

## TL;DR for TownshipLens

1. **Recommended MVP: a "HAND scenario" flood lens.** Pre-compute inundation at 5-6 river-stage scenarios (e.g. +1, +2, +3, +4 m above Sungai Subang bed) with **HAND (Height Above Nearest Drainage)** from the Copernicus GLO-30 DEM. A global CC0 HAND raster already exists (ASF, built from GLO-30) [F20], so day 1 can be "download a COG tile and clip it". Upgrade path: pysheds/WhiteboxTools local HAND, then a pluvial ponding layer, then SFINCS/LISFLOOD-FP calibrated on real events.
2. **Be honest about what it is: an indicative scenario, not a forecast.** At 30 m DEM resolution (vertical error of order 1-4 m vs flood depths of 0.15-0.5 m) we **cannot** claim per-footpath water depth. We classify edges `likely_flooded / possibly / unlikely` and tie this to the existing PASS / FAIL / UNKNOWN model: **unknown is never passable**, which is exactly our house philosophy.
3. **Local facts that shape the story (important):**
   - Elmina's built-up core is **not low-lying**. SRTM samples (ran, 100-point grid over the Elmina area) give a 19-107 m range, median 38 m; Sungai Subang runs at roughly 20-34 m; Lakeside Mall area about 45 m. A "bathtub" at realistic levels floods the **river corridor, ponds and downstream neighbours**, not the whole township. A dramatic whole-township flood would be dishonest.
   - The documented flooding is **next door, downstream**: Kampung Kubu Gajah / Paya Jaras (Sungai Subang, Sungai Buloh, Sungai Kedondong overflows) flooded in Apr 2024, 4 Oct 2024 and Apr 2025 [F6][F7][F8][F9]. SDP itself says it "upgraded the river and pond systems" there [F4].
   - SDP says Central Park is a **temporary flood basin sized to Q1000** [F4]. This is developer-sourced and uncorroborated. We found no independent engineering evidence (unverified).
4. **Best demo moment:** drag a stage slider; water rises along Sungai Subang and the retention ponds in 3D; roads/paths turn red; a resident asks "can Aisyah with a stroller reach Dewan Bunga Matahari?"; the router re-plans, says which segment is cut off, which are **uncertain**, and why. Then flip to management view: "which evacuation centres are cut off at +3 m; which streets become islands".
5. **Do not extract heights from Google 3D Tiles.** Google prohibits recording measurements (heights, elevations) from the tiles and geodata extraction [F12][F13]. Use DEM for all hydrology; the tiles are backdrop only.
6. **Data reality for the real-time angle:** JPS/DID Public InfoBanjir has **no documented public API** (unverified; no terms page found) [F15]. The documented, open feed is **MET Malaysia warnings via api.data.gov.my** [F16]. Use that for a "live heavy-rain warning" banner; treat river-gauge scraping as out of scope unless JPS gives permission.
7. **Biggest risks:** false reassurance (a "green" map before a real flood), model-vs-reality mismatch against residents' memories, licence slips (FABDEM is non-commercial) and scope creep into hydraulic modelling. Mitigations are in section 9.

---

## 1. Local story

### 1.1 Where Elmina sits (our reading)
- City of Elmina is in the Sungai Buloh / Bukit Subang / Denai Alam area of Shah Alam, Petaling District; Wikipedia gives centre approx 3.1992 N, 101.5006 E [F5]. Our Overpass bbox (3.155-3.205, 101.475-101.545) includes Saujana Utama in the west and Subang Bestari in the east.
- **Taman Sri Muda (Section 25) is roughly 20 km south-south-east** of Elmina (our estimate from coordinates, unverified) and is in a different, Klang River-fed floodplain setting. It is not an analogue of Elmina's terrain. Its story is relevant as *the* Shah Alam flood narrative judges will know.

### 1.2 Dec 2021 Klang Valley floods and Shah Alam
- On 20 Dec 2021, 321 personnel were deployed to evacuate Taman Sri Muda (about 4,400 houses); it was cut off to vehicles and boats were the only access [F1]. Death toll reports differ by source and time (Malay Mail: 4 in Taman Sri Muda / 7 Selangor-wide at one point; The Vibes: 6 / 9) [F1][F2].
- Selangor government attributed it to exceptional rain plus high tide closing the sluice gate, and substations flooded so pumps failed; a new sluice gate with 5,100 L/s pumping was announced [F2].
- 18 Dec 2021: Shah Alam PPS included Balai MPKK Bukit Naga (Seksyen 32) and SK Jalan Kebun (Seksyen 30) [F3].
- **We found no report naming Elmina, Denai Alam or Bukit Subang as flooded in Dec 2021** (unverified absence; local searches are incomplete).

### 1.3 Flooding near Elmina, 2021-2026 (found)
| Date | Where | What | Source |
|---|---|---|---|
| Aug 2023 (campaign piece) | Paya Jaras / Kampung Kubu Gajah | Overflows from Sungai Buloh, Sungai Subang and Sungai Kedondong in heavy rain; residents "anxious" | [F6][F7] |
| 16 Apr 2024 | Subang / Sungai Buloh incl. Kampung Kubu Gajah | Water 0.3-0.6 m, river overflow per Fire & Rescue (secondary summary; Malay Mail page returned 403 to us) | [F7] |
| 4 Oct 2024 | Paya Jaras (Kampung Kubu Gajah houses) | Flash flood; PPS: Dewan MBSA Seri Pagi (101 people), Dewan Kenanga Petaling land office (265), Dewan MBSA Matahari (48) | [F8] |
| 12 Nov 2024 | Shah Alam Seksyen 13, Setia Alam, Bukit Raja, Meru | Sungai Damansara rose; up to ~2 ft; delayed retention pond at Taman Mutiara Bukit Raja 2 cited | [F9] |
| Apr 2025 | Kampung Kubu Gajah | About 100 families affected; "chest level" in one home (secondary summary) | [F7] |
| 22-23 Apr 2025 | Klang Valley incl. Elite/NKVE near Shah Alam | Overnight storm; highway flooding | [F10] |

**Reading:** the recurrent flooding is **fluvial overflow and flash floods on the neighbouring Kampung Kubu Gajah / Paya Jaras low ground**, immediately downstream of Elmina's river system. Elmina residents are affected mostly via **road access** (flooded roads, cut links), which is exactly what a routing lens addresses.

### 1.4 Rivers and catchment
Overpass (ran, bbox 3.155,101.475,3.205,101.545, OSM base timestamp 2026-06-01) shows **Sungai Subang** (about 11 river ways) running through Elmina's Central Park area at roughly 3.176-3.194 N, 101.506-101.527 E, plus Sungai Plong, Sungai Kedondong, Sungai Hampar, Sungai Pelampas and Sungai Buloh (far NW). Media attribute Paya Jaras floods to Sungai Buloh + Sungai Subang + Sungai Kedondong [F6]; **which main river Sungai Subang drains to (Sungai Buloh / Damansara) is not verified by us**. Ask JPS/SDP.

### 1.5 SDP's own measures (what we can cite)
- **Q1000 flood basin claim:** The Edge Malaysia Weekly (25 Nov-1 Dec 2024) says the 300-acre Central Park "was designed to function as a temporary flood basin" based on a Q1000 stormwater system; Azmir Merican (SDP) said SDP "upgraded the river and pond systems" at the Subang River in Kampung Kubu Gajah [F4]. Wikipedia repeats a Q1000 claim without a citation [F5]. Another summary says "parts of the park" can accommodate Q1000 [F4b]. **Treat as marketing-grade until SDP provides drawings or a stormwater report.**
- **Mapped retention ponds (OSM, ran):** three features named "flood retention pond" (two basin polygons at about 3.189, 101.524 / 3.1877, 101.523; one pond at 3.1938, 101.5092), 1 `man_made=pumping_station`, 6 `waterway=drain`, 3 ditches, 48 embankments. These are crowd-mapped; capacities unknown.
- Elmina Rainforest Knowledge Centre uses rainwater harvesting [F4c].
- **To do (ask mentors):** SDP stormwater masterplan, pond volumes, Q-design of drains, sustainability/IAR sections on flood (we did not read IAR 2025 for flood content; URL in site-selection L11).

---

## 2. Data available

### 2.1 Elevation

| Dataset | Resolution | Licence | Notes | How to get |
|---|---|---|---|---|
| **Copernicus GLO-30** | 30 m DSM | Free, with attribution and liability notice; check the current licence PDF (old mirrors link an older stricter one) [F18][F19] | Surface model (includes buildings, trees). Cloud-optimised GeoTIFF on AWS, no login [F19] | `aws s3 ls --no-sign-request s3://copernicus-dem-30m/` (eu-central-1); tile for 3N 101E. Note Sentinel Hub access to the 30 m instance is restricted to authorised categories [F18b] |
| **FABDEM** (GLO-30 minus trees/buildings via ML) | 30 m | **CC BY-NC-SA 4.0: non-commercial, share-alike** [F21] | MAE in built-up areas 1.61 -> 1.12 m [F22]. Best for flow modelling, but **licence conflicts with any SDP commercial use**; fine for a hackathon, flag it in the proposal | University of Bristol data portal / GEE community catalog |
| NASADEM / SRTM | 30 m (1 arc-sec) | Public domain-style (NASA) (unverified wording) | Used in our sampling via OpenTopoData `srtm30m` (ran) | OpenTopography, Earthdata, OpenTopoData API |
| ALOS AW3D30 | 30 m | JAXA terms (free with registration/attribution; unverified) | Often good in the tropics | JAXA / OpenTopography |
| ASTER GDEM | 30 m | NASA/METI free | Our sample gave a similar range (13-108 m) | OpenTopoData `aster30m` |
| **ASF Global HAND (GLO-30)** | 30 m | **CC0**, Copernicus attribution still applies [F20] | Pre-computed HAND; stream threshold not stated; COG tiles pixel-aligned to GLO-30 [F20] | `s3://glo-30-hand/` (us-west-2, `--no-sign-request`) [F20] |
| Malaysian LiDAR (JUPEM/DID) | 1-5 m (unverified) | Not openly downloadable as far as we found | A UTHM study found TanDEM-X the best global DEM for Selangor vs GNSS [F23]. Official LiDAR needs a request | Email JUPEM/DID; ask SDP whether their drainage consultants hold LiDAR/survey (likely) |

**Sampled Elmina relief (ran, OpenTopoData SRTM30, 10 x 10 grid, 3.165-3.201 N, 101.495-101.549 E):** min 19 m, p10 24 m, median 38 m, p90 68 m, max 107 m. Sungai Subang points: 20 m (3.1944, 101.5265), 28 m (3.1827, 101.5205), 34 m (3.1762, 101.5057). Lakeside Mall 45 m, Eco Lake 37 m, Dewan Refelsia (Bukit Subang) 41 m. SRTM is a surface model, so building/tree pixels read high. **Implication:** relief is gentle-to-rolling, not flat; there are real 10-20 m height differences between river and urban platforms.

### 2.2 Google 3D Tiles: policy confirmation
Google's Map Tiles policies bar image analysis, machine interpretation, object detection and geodata extraction and restrict caching/offline [F12]. Google's FAQ states that programmatically reading and recording measurements (heights, distances, elevations) from the imagery is derivative and prohibited, and that the tiles are not survey-grade [F13]. Overlaying **your own** 3D objects is allowed if not derived from the tiles, and you must attribute the Google part [F13]. **Therefore:** all flood heights come from DEM; water polygons are our own geometry; we must not sample the tiles for heights or "snap" water to them programmatically. Manual visual alignment of a constant offset is, in our reading, display-only (unverified; ask mentors).

### 2.3 OSM (Overpass, ran)
Bbox 3.155,101.475,3.205,101.545, OSM base 2026-06-01. Counts (elements incl. ways/nodes/relations returned by `out tags center`):

| Feature | Count | Notes |
|---|---|---|
| `waterway=river` | 17 | Mostly Sungai Subang segments, Plong, Kedondong, Hampar, Pelampas, Buloh |
| `waterway=stream` / `drain` / `ditch` / `pressurised` | 10 / 6 / 3 / 1 | Drains very under-mapped (our judgement) |
| `natural=water` | 34 | Includes lakes (Eco Lake), ponds, `water=basin` x2, 11 `water=wastewater` (oxidation ponds, not retention) |
| Named "flood retention pond" | 3 | Subset of the above |
| `landuse=basin` | 0 | Retention ponds are tagged via `natural=water` + `water=basin/pond` |
| `man_made=*` | 172 total | incl. 48 embankment, 1 pumping_station, 19 storage_tank, 11 wastewater_plant, 4 water_tower, 51 street_cabinet |
| `amenity=shelter` | 23 | Mostly park pavilions/bus-stop style, **not** evacuation shelters |
| `emergency=*` | 3 | all `fire_hydrant` |
| `social_facility` | 1 | `group_home` |
| `amenity=community_centre` | 4 | Dewan Refelsia (x2 polygons), Dewan Serbaguna U16/1, **Dewan Bunga Matahari** (3.1799, 101.5414) |
| `amenity=school` | 23 | Many are building parts of SMK Subang Bestari; real schools about 8-10 |
| `amenity=place_of_worship` | 32 | Mostly surau; Masjid Denai Alam, Masjid Saujana Utama, Masjid Jamiul Ehsan, Masjid Subang Bestari U5 |
| `amenity=clinic` / `police` / `hospital` / `fire_station` | 14 / 1 / 0 / 0 | Police: Balai Polis Saujana Utama |

**PPS link:** "Dewan MBSA Matahari" was a PPS in the 4 Oct 2024 flood [F8]; OSM's "Dewan Bunga Matahari" (MBSA-style name) in Subang Bestari is plausibly the same hall (unverified). Candidate evacuation centres from OSM are **only candidates**; official PPS status is set per-event by the district disaster committee.

### 2.4 Official flood/rain data
| Source | What | Access finding |
|---|---|---|
| **JPS Public InfoBanjir** (publicinfobanjir.water.gov.my) | Telemetry river levels and rainfall (Normal/Waspada/Amaran/Bahaya bands), ~1,500 stations, 15-min updates via the app [F15][F24] | Pages `/hujan/`, `/aras-air/`, `/main/` exist; **no documented API, download or terms found** [F15]. Scraping needs written permission (not done). |
| **MET Malaysia via data.gov.my** | `GET api.data.gov.my/weather/forecast` and `/weather/warning` (JSON; fields incl. `heading_en`, `text_en`, `valid_from/to`) [F16] | Open; licence/rate-limit pages not checked by us. Legacy `api.met.gov.my` (token) status unverified |
| NADMA / JKM PPS | Event-by-event PPS lists; JKM "Info Bencana" portal [F25] | No standing open dataset found. PPS lists appear in news per event [F3][F8] |
| NADMA SMS early warning | Cell-broadcast via telcos [F26] | Not an API for us; reference for communication design |
| DID flood hazard maps | DID is mandated to produce flood hazard maps for major basins [F27] | Not openly downloadable that we found. Request via mentors |
| Global flood maps | WRI Aqueduct Floods (about 1 km, riverine/coastal, no flood protection; licence inconsistently stated: CC BY 4.0 vs unrestricted) [F28]; Global Flood Database (MODIS 250 m, 913 events 2000-2018) [F29]; JRC global river flood hazard maps (not checked) | Coarse; useful only as sanity context. 1 km is useless at township scale |
| Google Flood Hub | Malaysia **is** in the country list [F14] | Forecasts of river flood warnings at gauge/virtual-gauge points; not a street-level inundation source we can embed (unverified API terms) |

---

## 3. Methods ranked (honesty vs effort)

| # | Method | Inputs | Python tools | Runtime | 30 m accuracy limits in this terrain | Student effort |
|---|---|---|---|---|---|---|
| **a** | **Bathtub / static fill** (all cells below level L connected to the source) | DEM, a source/seed (river pixel), level | rasterio, numpy, scipy.ndimage.label, WhiteboxTools | Seconds | Ignores hydraulics and drainage; over-predicts behind embankments/culverts; vertical error 1-4 m >> depth thresholds. Good for **"which places are lower than the river"** only | 1-2 days |
| **b** | **HAND inundation** (cell floods if HAND < stage in its sub-catchment) [F30] | DEM + stream network (or precomputed ASF HAND [F20]) | pysheds `compute_hand` [F31], WhiteboxTools, pyflwdir | Seconds-minutes for 5 km x 5 km | Hydrologically sensible (follows drainage, not just elevation); depends on stream threshold; ignores culverts, pond storage, river-bed bathymetry; stage->rainfall link absent | 3-4 days (1 day with ASF HAND) |
| c | **SCS-CN rainfall-runoff + depression filling** (pluvial ponding) | DEM, land-cover/CN, design storm rainfall | numpy, pysheds fill/resolve flats, `richdem`/Whitebox `FillDepressions` | Minutes | Finds where water collects; ignores the drainage network that actually carries most urban runoff; CN parameters guessed; MSMA IDF curves for Shah Alam not verified by us | 1 week |
| d | **Import official hazard maps** | DID/JPS maps or Aqueduct/Fathom-type data | geopandas, rasterio | Minutes | Authority and credibility are best, but we found no open Selangor DID maps; Aqueduct is ~1 km | Blocked on access |
| e | **2D hydrodynamic** (HEC-RAS 2D, LISFLOOD-FP, ANUGA, SFINCS [F32]) | LiDAR-grade DEM, buildings, roughness, inflow hydrograph/rain, drainage, calibration events | HEC-RAS (GUI/Windows), ANUGA (Python), SFINCS + hydromt_sfincs | Minutes-hours/run | The right tool, but needs data we lack (channel geometry, drain capacities, validation levels) and calibration. A wrong-but-pretty 2D model is **worse** than an honest coarse one | **Out of scope** for 4 weeks / 3 students; offer as the SDP pilot path |

**Recommendation: (b) HAND, shipped as "stage scenarios".**
- **MVP:** scenarios `stage_plus_1m ... stage_plus_4m` ("river rises N m above its normal level"), plus a **qualitative** label mapping stages to JPS-style bands (Normal/Waspada/Amaran/Bahaya) *only if* we can obtain the local gauge thresholds (unverified). We do **not** claim "100 mm of rain = +2 m".
- **Hybrid cheap add-on:** (a)-style *local sinks* layer (depression fill) to show "ponding hotspots" on roads (stretch).
- **Upgrade path:** (1) SDP shares survey/LiDAR + pond/drain data -> redo HAND at 5 m; (2) calibrate stage levels against 4 Oct 2024 / Apr 2025 event marks (resident photos, flood marks); (3) SFINCS pluvial+fluvial run for 2-3 design events, replacing HAND polygons behind the same API.

**How to present uncertainty (rules for UI and AI):**
- Banner always: "Indicative scenario from a 30 m elevation model. Not a forecast. Water extents are approximate; local drainage, pumps and pond storage are not modelled."
- Three-class edge status (see section 5) rather than centimetre depths; show depth as bands ("shallow / deep") never as a number to two decimals.
- Show the **margin**: "edges within +-1 m of the modelled water line are UNKNOWN".
- Never output "safe". Output "not in the modelled flood extent".
- Record the scenario's provenance: DEM source and date, method, HAND threshold, margin, git hash; this reuses our claims/evidence idea.

---

## 4. Visualisation in the browser

Stack reminder: the project stack is Vite + React 19 + R3F + `3d-tiles-renderer` (per brief); the user prompt allows CesiumJS too. Both are covered.

| Technique | How | Notes |
|---|---|---|
| **Water as extruded polygon / mesh** | Pre-computed flood polygons (GeoJSON per scenario) -> triangulate -> flat translucent mesh at water-surface height (per sub-catchment HAND stage + local bed) | Works in both Cesium (`PolygonGraphics` with `height`/`extrudedHeight`) and three.js (`ShapeGeometry`). Must align datums: Copernicus DEM heights are orthometric (EGM2008); Google tiles are ellipsoidal. Compute the geoid offset with pyproj (we did not compute it) |
| **Draping onto the photoreal mesh** | Cesium: classification of 3D tiles (`ClassificationType.CESIUM_3D_TILE`) so the flood footprint colours the tile surface, not a floating plane (unverified on Google tiles) | Avoids z-fighting, no height data needed from tiles; but depth is not physical |
| **Clipping** | `ClippingPolygon` hides/isolates regions of 3D tilesets and terrain; Cesium's tutorial applies it to Google 3D Tiles [F33] | Use to cut the dry mesh under a pond, or to isolate the Elmina area; visual use only |
| **Cesium water material** | Needs a water mask; Google tiles have none, and Cesium says it cannot apply the water effect the same way [F34] | Supply our own mask/polygon and a custom material (animated normal map) |
| **Animating level** | Slider sets `stage`; swap pre-baked polygon sets (5-6 levels) and tween opacity/height between them | Pre-bake in Python; browser only interpolates. Avoids runtime flood solves |
| **Colouring cut-off edges** | Overlay lines (Cesium polylines / three.js `Line2`) coloured by the router's edge status for the current scenario/profile | We already render route overlays; add a `scenario_id` layer. Colour-blind-safe palette (red/orange/grey + pattern) |
| **2D fallback** | MapLibre fill + line layers with the same GeoJSON | Needed anyway for the text/2D fallback |
| **Examples** | Cesium community threads on clipping a flood polygon against terrain and on polygons "floating" above Google tiles [F35]; ISPRS 2019 CesiumJS flood viewer architecture (CityGML+glTF) [F36]; three.js water (`Water`/`Water2` examples); deck.gl `GeoJsonLayer`/`PolygonLayer` with extrusion (not verified by us for flood specifically) | We found **no ready-made CesiumJS flood repo** (unverified absence) |

Performance: keep each scenario below ~50k polygon vertices; simplify (shapely `simplify`) and merge; use one draw call per scenario; keep the photoreal tileset at default SSE. Google tiles billing/caps from site-selection §5 still apply.

---

## 5. Routing under flood

### 5.1 Depth thresholds (what the literature supports)

| Mode | Threshold we propose | Basis |
|---|---|---|
| Wheelchair / stroller | **> 0.05-0.10 m = FAIL, band to 0.15 m = UNKNOWN** | **No published source found; our engineering default** (kerb height, small wheels, electronics). Mark as such. Do not present as standard |
| Pedestrian (default) | > 0.30 m FAIL; 0.15-0.30 m UNKNOWN | Depth bands used in UK flood-risk assessments: <0.15 m very low, 0.15-0.3 "danger for some", 0.3-0.6 "danger for most" [F37] (Defra/EA FD2320 framework [F38]). Needs velocity; we have none, so conservative |
| Pedestrian stability limits | Wading difficult > ~1.2 m or > 0.8 m/s; D x V of 0.4 m2/s conservative for healthy adults | Australian Rainfall & Runoff stability guidance [F39] |
| Car | > 0.30 m FAIL; > 0.25 m for ordinary-vehicle caution; emergency vehicles tolerate more | 0.3 m used for "severely flooded" links in a study applying Pregnolato's depth-disruption function [F40]; 25 cm vehicle depth used in NHESS 2016 reply [F41]; 0.5 m used in an Okayama road-removal study [F42] |

Treat thresholds as **versioned YAML profile parameters** (same as `packages/spatial/profiles/`); display them to users.

### 5.2 Engine integration (reuses NetworkX engine, does not touch verified claims)
- Add a **scenario overlay**, not a claim: for scenario `s` and edge `e`, store `flood_class(e, s) in {likely_flooded, possible, unlikely}` plus `max_depth_band`. Computed offline by intersecting edge geometry with the HAND depth raster (sample min/mean/max along the line, with the margin).
- Evaluate: `FAIL` if `likely_flooded` for the profile; `UNKNOWN` if `possible`; else defers to the usual accessibility evaluation. **Existing tri-state rules apply** (strict pass uses PASS only; lenient pass adds UNKNOWN with weight x5).
- A flood scenario can **only add** FAILs/UNKNOWNs; it never turns an accessibility UNKNOWN into PASS.
- **Evacuation-centre reachability:** for each candidate centre, `nx.multi_source_dijkstra` from all residential nodes over PASS edges; report (i) reachable count, (ii) components isolated from all centres ("islands"), (iii) travel-time isochrones (`nx.single_source_dijkstra_path_length` with cutoff). Compare baseline vs scenario.
- **Evacuation route modes:** `walk`, `step_free` (stroller/wheelchair), `drive`. Needs a drivable graph (OSM highways) alongside the sidewalk graph; the MVP graph is park-scale, so Lens 2 needs a **township-scale road graph** (OSM via OSMnx, ~1 day).
- Related work: QGIS depth-threshold road removal (Okayama, 0.5 m, ~1.4% of roads unusable) [F42]; Bonn study combining d x v >= 3 with shortest paths to shelters [F43]; OSM-based Dijkstra flood route engine in Ratnapura [F44]; flood-mapping-for-route optimisation feasibility (arXiv 2109.11712) [F45].

---

## 6. Disaster-management context (Malaysia)

- **NADMA** (est. 1 Oct 2015) coordinates agencies at federal, state and district levels; it operates the NDCC and the SMS early-warning arrangement with telcos [F25][F26]. **JKM** manages PPS (evacuation centres) and the Info Bencana portal [F25]. **JPS/DID** issues river-level/flood warnings via InfoBanjir and its app [F15][F24]. **MET Malaysia** issues rain warnings (myCuaca, data.gov.my API) [F16][F46]. **MBSA** (Shah Alam city council) runs drainage maintenance, opens halls as PPS (Dewan MBSA Seri Pagi / Matahari in 2024 [F8]) and has been identifying retention-pond sites [F47]. Precise statutory duties under Act 776 and committee composition not verified by us.
- **SDP township operations** (our inference, ask Farah/mentors): maintain township drainage/ponds until hand-over to the council, manage township communications and security, and are the first call for residents. Whether Elmina's drains/ponds are handed over to MBSA is an open question (same as the park ownership item in site-selection §7).
- **What management would plausibly want** (hypotheses to validate): (1) **pre-positioning**: which roads/gates/halls get cut at stage X so teams and sandbags go there first; (2) **resident communication**: draft BM/EN/中文 notices ("these streets likely cut off if river rises 3 m") with the right hedging; (3) **vulnerable-resident routes**: for registered elderly/OKU residents (we have no such list; privacy), identify who has no step-free route to a centre; (4) post-event: compare predicted vs observed and improve (the existing gap-loop).
- **Ethical/communication risks:** false reassurance (user reads "not flooded" as "safe"); false alarm/panic from red maps; liability if residents rely on it instead of official warnings; privacy if vulnerable-resident data is mapped; stigma/property-value effects of publishing flood extents for a developer's own estate (SDP may be sensitive). **Controls:** always show authoritative sources and 999/MBSA Pasukan PANTAS contact (03-55105811 per a Nov 2025 report [F47b], verify), no "safe" wording, scenario-not-forecast banner, no real-time claims, demo with SDP's comms team in the loop, no personal data in the MVP.

---

## 7. Related products / competitors

| Product | What | Relevance / gap |
|---|---|---|
| **Google Flood Hub** | Free river-flood forecasts, AI hydrologic + inundation models, ~150 countries; **Malaysia listed** [F14][F48] | Forecast at river-point/area level, no street/route-level "what is cut off for a stroller", not township-aware |
| **JPS Public InfoBanjir / MyPublicInfoBanjir app** | Live levels, rainfall, warnings, SOS contacts [F15][F24] | Authoritative, real-time, but no scenario what-if, no routing |
| **myCuaca / RakanMET** (MET Malaysia) | Weather and heavy-rain warnings [F46] | Weather only |
| **NADMA SMS alerts** | Mass early warning [F26] | Broadcast only |
| **Singapore PUB** | Flood-prone areas list, MyWater app; Marina catchment overland-flow mapping from mobile laser scanning at ~10 cm height accuracy [F49] | Gold standard for data quality; we do not have it |
| **ICEYE Flood Insights / FloodMapp / Fathom** | Commercial satellite/hydraulic flood depth products [F50] | Expensive; none found covering Malaysia township routing (Fathom/FloodMapp Malaysia coverage not verified) |
| Telegram "banjir" channels | Community alert groups | We found no official Telegram channel; the official channels are the website, Facebook, X, apps [F24] |

**Our gap:** *"township-scale, route-aware, uncertainty-honest what-if, built on a verified world model"*: connecting the flood footprint to **who can still get where**, and to evidence/UNKNOWN.

---

## 8. Recommendation: MVP flood lens design

### 8.1 Data
- DEM: **Copernicus GLO-30** (licence-safe) for the MVP; FABDEM optional for a non-commercial comparison panel only.
- Precomputed HAND (ASF, CC0) for a quick start; recompute with **pysheds** for local control (stream threshold to be tuned so that mapped Sungai Subang/streams are reproduced).
- OSM: waterways, ponds, drains, road/footway graph (OSMnx), candidate evacuation centres (halls, schools, mosques; 4 + ~8-10 + ~32 in the bbox).
- MET warnings API as an optional live banner.
- Evidence of past events: photos/flood marks from the 4 Oct 2024 and Apr 2025 events (ask SDP, MBSA, community groups) to sanity-check scenario footprints in Kampung Kubu Gajah and any flooded Elmina roads.

### 8.2 Pipeline (Python backend, offline then served)
1. Fetch GLO-30 tile(s) -> clip to Elmina+Paya Jaras bbox -> condition DEM -> flow dir/acc -> streams -> HAND.
2. For each stage S in {1,2,3,4,5} m: depth = max(S - HAND, 0) per sub-catchment, mask to connected inundation, vectorise to GeoJSON + depth-band raster, simplify.
3. For each graph edge: sample depth along geometry; set `flood_class` per scenario with margin M (default 0.5-1.0 m, versioned).
4. Persist `scenarios`, `scenario_edge_status`, `scenario_place_status` (Postgres/GeoJSON). Routing engine takes `scenario_id`.
5. Evacuation analytics per scenario: reachable centres per profile; isolated components; isochrones.

### 8.3 LLM tools (names follow the existing deterministic-tool pattern; JSON-schema sketches)

```jsonc
// get_flood_scenarios: lists available scenarios and their disclaimers/provenance
{ "name": "get_flood_scenarios", "input_schema": { "type": "object", "properties": {}, "additionalProperties": false } }
// -> [{ "scenario_id":"stage_p3m", "label":"River +3 m (indicative)", "method":"HAND", "dem":"GLO-30",
//       "margin_m":1.0, "created":"2026-10-20", "disclaimer":"...", "evidence_ids":["ev-f01"] }]

// simulate_flood: (re)build or select a scenario by level OR by named rain band (only qualitative mapping)
{ "name": "simulate_flood", "input_schema": { "type": "object", "properties": {
   "stage_m": { "type": "number", "minimum": 0, "maximum": 6 },
   "rainfall_band": { "type": "string", "enum": ["heavy","very_heavy","extreme"] } },
  "oneOf": [ { "required": ["stage_m"] }, { "required": ["rainfall_band"] } ] } }
// -> { "scenario_id": "...", "approximate": true, "note": "rainfall_band maps to a stage by a documented assumption table" }

// plan_route: existing tool + scenario
{ "name": "plan_route", "input_schema": { "type": "object", "required": ["from","to","profile"], "properties": {
   "from": {"type":"string"}, "to": {"type":"string"},
   "profile": {"type":"string","enum":["default","stroller","wheelchair","older_adult_rest","drive"]},
   "scenario_id": {"type":"string"} } } }
// -> route_status in {confirmed, partly_unverified, blocked, no_data}; flood_notes[] per edge; unknowns[]

// list_evacuation_centres: candidates, with provenance (OSM candidate vs official PPS)
{ "name": "list_evacuation_centres", "input_schema": { "type": "object", "properties": {
   "scenario_id": {"type":"string"}, "profile": {"type":"string"}, "near_place": {"type":"string"} } } }
// -> [{ "place_id":"dewan-bunga-matahari", "status_source":"osm_candidate|official_pps",
//       "reachable_under_scenario": true, "route_status":"partly_unverified", "capacity": null }]

// affected_places: what is cut off / inundated under a scenario
{ "name": "affected_places", "input_schema": { "type": "object", "required": ["scenario_id"], "properties": {
   "kind": {"type":"string","enum":["facility","road","path","all"]},
   "profile": {"type":"string"} } } }
// -> { "likely": [...], "possible": [...], "isolated_components": [...], "evidence_ids": [...] }
```
Guardrails inherited from the assistant design: every claim cited; uncited claims rejected; the LLM may not invent depths or say "safe"; the tool output includes `disclaimer` that the answer template must include.

### 8.4 UI
- **Scenario bar** (slider + presets "Heavy rain / River +2 m / +3 m / +4 m") with the permanent banner.
- 3D: water polygons animate; roads/paths recoloured by status; cut-off facilities pinned with a "cut off" badge; evacuation centres shown with reachability ticks.
- **Resident mode:** chat + "route to a safe place" (names the centre, shows the route and unknown segments, says "check official PPS list and MBSA/JPS first").
- **Management mode:** list of cut-off places/roads, isolated components, a "what to pre-position" table, a print/PDF briefing, and an "export advisory draft" (BM/EN/中文) for staff to edit (never auto-sent).
- Uncertainty: stripe pattern for UNKNOWN edges; margin shown in legend; a "why this edge?" popover showing HAND value, stage, margin, DEM source.

### 8.5 Demo moment (60-90 s)
Open Elmina 3D at normal level. Drag slider to **+3 m**: Sungai Subang and ponds swell; two road links and a footbridge turn red, one stripe-patterned. Ask: "Priya (wheelchair) is at Lakeside; where can she go if the river rises?" The assistant answers with one reachable hall (confirmed), one "possible but unverified segment", and the reason; then the management view lists "3 candidate centres reachable, 1 isolated cluster". Close on the gap loop: "to turn this unknown into a fact, staff verify kerb ramp X; model re-runs."

### 8.6 Four-week build split (3 students)
| Week | Backend | Frontend | AI |
|---|---|---|---|
| 1 | Fetch GLO-30 + ASF HAND, clip Elmina, OSMnx road graph, candidate-centre list, validation against SRTM samples | Water polygon prototype on 3D tiles (flat mesh + slider), datum alignment test | Tool schemas, disclaimer policy, golden Qs for flood |
| 2 | pysheds HAND, 5 scenarios, edge classification, scenario API | Edge colouring by status, scenario bar, legend + uncertainty UI | `plan_route(scenario_id)` + `affected_places` tool wiring |
| 3 | Evacuation reachability/islands/isochrones; test suite (Hypothesis monotonicity: higher stage never un-floods an edge) | Management panel + resident flow, 2D/MapLibre fallback | Evals: no "safe" claims, cites scenario provenance, handles unknown; BM/中文 |
| 4 | Calibrate against Oct 2024/Apr 2025 photos if obtained, perf, docs | Polish, demo choreography, accessibility of the UI itself | Persona simulation under flood; fix top failures |

### 8.7 Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Misleading "dramatic" flood in a high-relief township | High | Stage scenarios in realistic bands; show Kampung Kubu Gajah downstream context; ask SDP for real levels |
| 30 m DEM too coarse for paths | Certain | Three-class status + margin; never print depth precision; upgrade path to LiDAR/SFINCS |
| False reassurance / panic / liability | Medium | Disclaimer, no "safe" word, official links, SDP comms review |
| Google tiles policy breach (height extraction) | Low if careful | DEM-only hydrology; keep the tiles as backdrop; get mentor sign-off |
| FABDEM licence (NC-SA) | Medium | Use GLO-30 in product; FABDEM comparison only |
| Datum mismatch (orthometric vs ellipsoidal) | Medium | Compute geoid offset once; visual verification at ponds; document |
| Data access (JPS, SDP drainage) delays | High | Do not depend on them for MVP; API-optional banner |
| Scope creep into hydraulic modelling | High | Method (b) only; (e) listed as pilot path |
| Overpass/OSM drain under-mapping | Certain | State it; treat drains as unknown; request SDP drainage GIS |

---

## 9. Open questions for mentors / SDP
1. Stormwater masterplan, pond volumes, Q-design and hand-over status (SDP vs MBSA) for Elmina drains and ponds.
2. Gauge thresholds (JPS Waspada/Amaran/Bahaya) for the Sungai Subang/Buloh stations and permission to read InfoBanjir data.
3. LiDAR/survey data from SDP consultants; any flood-mark records for 2024-2025.
4. Is publishing flood scenarios for Elmina acceptable to SDP communications? Required wording?
5. Official PPS list for Elmina/Subang Bestari area; is Dewan Bunga Matahari = "Dewan MBSA Matahari"?

## Sources
- [F1] Malay Mail, 20 Dec 2021, Taman Sri Muda evacuation: https://www.malaymail.com/amp/news/malaysia/2021/12/20/search-and-rescue-personnel-focusing-evacuation-efforts-on-taman-sri-muda-s/2029838 ; deaths: https://www.malaymail.com/amp/news/malaysia/2021/12/20/as-floodwaters-go-down-in-selangor-seven-found-dead-one-still-missing/2029844
- [F2] The Vibes (deaths; sluice gate): https://www.thevibes.com/index.php/articles/news/50101/floods-six-individuals-found-drowned-in-taman-sri-muda ; https://www.thevibes.com/index.php/articles/news/50864/taman-sri-muda-floods-not-due-to-project-near-sluice-gate-sgor-govt
- [F3] Utusan, 18 Dec 2021, 17 PPS Klang/Shah Alam: https://www.utusan.com.my/nasional/komuniti/2021/12/banjir-17-pps-dibuka-di-klang-shah-alam/
- [F4] The Edge Malaysia Weekly, "Creating a resilient development", 25 Nov-1 Dec 2024: https://theedgemalaysia.com/node/734822 ; [F4b] search summary of SDP statement (Q1000 "parts of the park"): https://www.simedarbyproperty.com/node/1487 (unverified: not fetched by us); [F4c] https://www.edgeprop.my/content/1887949/shaping-new-landscapes
- [F5] Wikipedia, Elmina, Malaysia: https://en.wikipedia.org/wiki/Elmina,_Malaysia
- [F6] The Star, Paya Jaras folk anxious over floods, 10 Aug 2023: https://thestar.com.my/metro/metro-news/2023/08/10/paya-jaras-folk--anxious-over-floods (river names come from a secondary search summary)
- [F7] Malay Mail, 16 Apr 2024 floods in Subang/Sungai Buloh: https://www.malaymail.com/news/malaysia/2024/04/16/floods-hit-several-areas-in-subang-sungai-buloh/129143 (403 to our fetcher; content from search summary); Bernama: https://www.bernama.com/en/general/news.php?id=2288516 ; Selangor Journal: https://selangorjournal.my/?p=321203
- [F8] RTM, Paya Jaras flash flood, 4 Oct 2024: https://berita.rtm.gov.my/nasional/senarai-berita-nasional/senarai-artikel/banjir-kilat-di-paya-jaras-semakin-pulih-3-pps-masih-beroperasi
- [F9] Utusan, 13 Nov 2024: https://www.utusan.com.my/berita/2024/11/hujan-lebat-luar-biasa-punca-banjir-kilat-di-selangor-semalam/
- [F10] Malay Mail, 23 Apr 2025: https://www.malaymail.com/news/malaysia/2025/04/23/flash-floods-hit-klang-valley-after-overnight-thunderstorm-major-highways-affected/174122
- [F12] Google Map Tiles API policies: https://developers.google.com/maps/documentation/tile/policies
- [F13] Google, Photorealistic 3D Tiles FAQ: https://mapsplatform.google.com/resources/blog/commonly-asked-questions-about-our-recently-launched-photorealistic-3d-tiles/
- [F14] Google Flood Hub country list (Malaysia present): https://support.google.com/flood-hub/answer/16508958?hl=en
- [F15] JPS Public InfoBanjir portal: https://publicinfobanjir.water.gov.my (no API/terms found)
- [F16] data.gov.my realtime weather API: https://developer.data.gov.my/realtime-api/weather
- [F18] Copernicus DEM licence PDF: https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf ; [F18b] https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM.html
- [F19] AWS Registry, Copernicus DEM: https://registry.opendata.aws/copernicus-dem/
- [F20] AWS Registry, Global 30 m HAND (ASF, CC0): https://registry.opendata.aws/glo-30-hand/ ; service page https://gis.asf.alaska.edu/arcgis/rest/services/GlobalHAND/GLO30_HAND/ImageServer
- [F21] FABDEM licence (GEE community catalog): https://gee-community-catalog.org/projects/fabdem/
- [F22] Hawker et al. 2022, ERL 17 024016: https://iopscience.iop.org/article/10.1088/1748-9326/ac4d4f
- [F23] UTHM, global DEM assessment Selangor: https://publisher.uthm.edu.my/periodicals/index.php/mari/article/view/17122
- [F24] Lowyat, MyPublicInfoBanjir app: https://lowyat.net/2021/229356/govt-encourages-public-to-download-mypublicinfobanjir-app-for-flood-related-updates-and-warnings ; Malay Mail flood-season guide: https://www.malaymail.com/amp/news/malaysia/2024/10/07/dont-panic-all-the-steps-apps-numbers-you-need-for-malaysias-flood-season/152650
- [F25] NADMA role: https://www.malaysia.gov.my/en/topics/role-of-the-national-disaster-management-agency-nadma ; Malay Mail explainer: https://www.malaymail.com/news/malaysia/2021/12/29/decoding-malaysias-disaster-management-what-exactly-is-nadmas-role-and-who/2031704
- [F26] NADMA SMS early warning: https://utusansarawak.com.my/sistem-hebahan-amaran-awal-banjir-melalui-sms-diwujudkan-nadma
- [F27] CIDB draft CIS on flood risk assessment (DID mandate): https://www.cidb.gov.my/wp-content/uploads/2023/10/DRAFT-CIS-FOR-FLOOD-RISK-ASSESSMENT-IN-MALAYSIA.pdf
- [F28] WRI Aqueduct Floods: https://datasets.wri.org/datasets/aqueduct-floods-hazard-maps
- [F29] Global Flood Database (GEE): https://developers.google.com/earth-engine/datasets/catalog/GLOBAL_FLOOD_DB_MODIS_EVENTS_V1
- [F30] TauDEM HAND inundation depth: https://hydrology.usu.edu/taudem/taudem5/help54/InunDepth.html
- [F31] pysheds: https://github.com/mdbartos/pysheds
- [F32] SFINCS docs: https://sfincs.readthedocs.io ; paper doi 10.1016/j.coastaleng.2020.103796
- [F33] Cesium clipping polygons tutorial: https://cesium.com/learn/cesiumjs-learn/cesiumjs-clipping-polygons/
- [F34] Cesium forum, water material on Google tiles: https://community.cesium.com/t/please-help-unable-to-override-water-material-in-google-photorealistic-3d-tiles/45465
- [F35] Cesium forum, flood polygon vs terrain: https://community.cesium.com/t/get-geometry-of-polygon-clip-with-terrain-for-flood-water-simulation/31294 ; floating polygons: https://community.cesium.com/t/display-3d-polygon-layer-at-plane-true-elevation/27283
- [F36] ISPRS 2019 CesiumJS flood visualisation: https://isprs-archives.copernicus.org/articles/XLII-2-W11/669/2019/
- [F37] Depth/velocity bands in a UK SFRA extract: https://www.hinckley-bosworth.gov.uk/download/downloads/id/6958/as53_land_off_bosworth_road_and_cunnery_close.pdf
- [F38] Defra/EA FD2320 note: https://n-somerset.gov.uk/sites/default/files/2024-08/CD%20K10%20Supplementary%20Note%20on%20Flood%20Hazard%20Ratings.pdf
- [F39] ARR people and vehicles stability: https://arr.ga.gov.au/__data/assets/pdf_file/0006/40488/ARR_People_and_Vehicles_stability.pdf
- [F40] Pregnolato et al. 2017 and downstream use of 0.3 m: https://research-information.bris.ac.uk/ws/files/191868409/Full_text_PDF_final_published_version_.pdf ; https://arxiv.org/pdf/2609.16963 (unverified details)
- [F41] NHESS 2016 author reply (25 cm vehicle depth): https://nhess.copernicus.org/preprints/nhess-2016-309/nhess-2016-309-AC1.pdf
- [F42] Okayama road-removal study (0.5 m): https://ousar.lib.okayama-u.ac.jp/ja/search/p/639/item/69964?all=study
- [F43] Bonn d x v flood routing (ISPRS 2023): https://repos.hcu-hamburg.de/bitstream/hcu/965/1/isprs-archives-XLVIII-1-W2-2023-437-2023.pdf
- [F44] Ratnapura evacuation route engine: https://ir.lib.pdn.ac.lk/handle/20.500.14444/7603
- [F45] arXiv 2109.11712 flood mapping for route optimisation: https://arxiv.org/pdf/2109.11712
- [F46] myCuaca / RakanMET: https://apps.apple.com/app/id955289490
- [F47] MBSA retention pond sites: https://www.sinarharian.com.my/article/661021/edisi/selangor-kl/banjir-kilat-mbsa-kenal-pasti-kawasan-sesuai-bina-kolam-takungan ; [F47b] Pasukan PANTAS number from a Nov 2025 report (verify): https://www.bharian.com.my/amp/berita/nasional/2025/11/1475932/bhplus
- [F48] Nearing et al., Nature 2024: https://research.google/pubs/ai-increases-global-access-to-reliable-flood-forecasts/ (doi 10.1038/s41586-024-07145-1)
- [F49] PUB Marina mapping: https://www.eco-business.com/ms/news/pub-maps-marinas-flood-prone-areas/ ; PUB flood-prone areas list: https://pub.gov.sg/-/media/PUB/PDF/Flood-Management/List-of-Flood-Prone-Areas-as-at-Apr-2025.pdf
- [F50] ICEYE Flood Insights: https://www.iceye.com/gov/actionable-flood-impact-data
- OpenStreetMap via Overpass (kumi.systems mirror; ODbL), queries run 14-15 Oct 2026; OpenTopoData SRTM/ASTER sampling: https://api.opentopodata.org
