# Glossary

Shared vocabulary for TownshipLens. **Use these words consistently** in code, docs and the pitch. If a word is misused in a PR or slide, link here. Add a term when the team starts using a new word.

## Product terms

| Term | Meaning in TownshipLens | Not to be confused with |
|---|---|---|
| **TownshipLens** | The product: a 3D **Township World Model** of City of Elmina with lenses, an AI assistant that answers from it, and the management tools behind it ([ADR 0009](decisions/0009-township-world-model-platform.md)). | |
| **Lens** | A themed set of data overlays + tools + views on the shared base twin. MVP lenses: `access` (accessibility & getting around, deep), `flood` (flood / disaster what-if, deep), `waste` (recycling & waste, thin). Data-centre siting is roadmap only. A new lens = new overlay + tools + views, no change to the base twin. | "Layer" (one toggle inside a lens) |
| **Base twin** | The shared, lens-independent part of the world model: buildings, terrain/DEM, hydrology (waterways, ponds, drains), road and walk network, places. | The 3D scene (presentation only) |
| **Overlay** | The data a lens adds on top of the base twin: access claims, flood scenarios and edge/place status, waste points. Stored as GeoJSON/GeoParquet files plus SQLite rows. | |
| **Site** | A named area inside the model. The **whole of City of Elmina** is covered by the base twin (envelope `3.150,101.460,3.240,101.530`, clipped to a polygon). The **deep spot** for verified accessibility detail is Elmina Urban Park + Lakeside Mall frontage ([site-selection](../02-research/site-selection.md), [ADR 0006](decisions/0006-mvp-site.md)). | "Township" (the whole SDP development) |
| **Township** | A whole SDP development (e.g. City of Elmina). TownshipLens scales *township by township*. | |
| **Facility** | A place people go to: a community hall, park, mall, sports centre, surau, etc. | |
| **Place** | Any named thing a resident can ask about: a facility, a toilet, a bench, a shelter, a car park, a drop-off point. A **node** in the world model. | |
| **Entrance** | A specific way into a facility. It has its own attributes (step-free?, door width, automatic door?, opening hours). Residents usually ask about *entrances*, not buildings. | "Place". A building has several entrances. |
| **Path segment** (edge) | One walkable stretch between two nodes. It carries attributes such as steps, slope, width, surface, shelter and lighting. | "Route" |
| **Route** | An ordered list of path segments from A to B that the routing engine computes for a **profile**. | |
| **Profile** | A set of mobility constraints and preferences, e.g. `stroller`, `wheelchair`, `older_adult_rest`, `default`, and `drive` (flood lens). It decides which segments are allowed and how each is weighted. | "Persona" |
| **Persona / resident agent** | A *test* actor that combines a profile with a task ("get from car park B to the hall's main entrance at 7pm"). Used to find gaps. **Never presented as a real resident.** | Real user research participants |
| **Journey** | One run of a persona's task through the world model. Its outcome is `success`, `success_with_unknowns`, `blocked` or `no_data`. | |

## Data and trust terms

| Term | Meaning |
|---|---|
| **World model** (Township World Model) | Our **structured, verified representation of the whole township**: the base twin (buildings, terrain, hydrology, network, places) plus lens overlays (access claims, flood scenarios, waste points), with attributes, provenance and closures. It is **not** a generative AI "world model" like Genie or Marble, and we say so explicitly in the pitch. |
| **Spatial graph** | The node/edge part of the world model (walk and drive networks), loaded into the routing engine (NetworkX). |
| **Attribute** | One fact about a node or edge, e.g. `has_steps=false` or `width_cm=120`. Each attribute has its own provenance. |
| **Tri-state value** | Accessibility attributes are `yes`, `no` or `unknown`, never a silent default. `unknown` is a first-class answer. |
| **Provenance** | Where a fact came from (`source_type`: site_visit, photo, SDP_document, OSM, staff_report, resident_report), who recorded it, and when. |
| **Verified** | A fact confirmed by an authorised person on a given date, with evidence attached. |
| **Verification date / freshness** | When a fact was last verified. Old facts get flagged (e.g. older than 90 days for things that change, such as closures). |
| **Evidence** | A photo, document or note that supports a fact. Answers cite evidence IDs. |
| **Closure** | A time-bounded state that overrides normal attributes (walkway closed for works, hall closed for an event). A flood scenario acts like a hypothetical closure. |
| **Knowledge gap** | A question or journey the world model can't answer confidently because a fact is missing, unverified, stale or conflicting. |
| **Verification request (VR)** | A ticket created automatically when a knowledge gap is hit. Staff resolve it by verifying, correcting or rejecting the fact. **This loop is our main differentiator.** |
| **Staff console** | The ops-facing dashboard for VRs, edits, recurring questions and gap heat-maps. |

## AI terms

| Term | Meaning |
|---|---|
| **Grounded answer** | An answer whose every factual claim comes from a tool result and cites it. |
| **Tool / function calling** | The LLM chooses from a fixed set of approved functions (e.g. `plan_route`) instead of answering from memory. |
| **Unsupported claim** | Any factual statement in an answer that no tool result backs up. This is our #1 eval metric to drive to zero. |
| **Abstain** | The assistant explicitly says it doesn't know, explains why, and (where relevant) files a VR. |
| **Scene intent** | A typed instruction (the `scene.intent` SSE event) that the AI or UI emits instead of calling a renderer: `camera.fly_to`, `place.focus`, `route.highlight`, `flood.set_level`, `layer.toggle`. One adapter per renderer (Cesium, Mapbox lite, list) draws it. Replaces the older "map action". | Renderer API calls |
| **Golden set** | Our fixed list of test questions with expected tool calls and answers, used for evals. |
| **MCP** | Model Context Protocol, an open standard for exposing tools to LLM clients (stretch goal). See [stack-decision](../04-architecture/stack-decision.md). |
| **PydanticAI / OpenRouter** | The agent harness (typed tools, output validator, streaming) and the model gateway (model chosen in env) we use ([ADR 0008](decisions/0008-agent-harness-pydantic-ai.md)). `LLM_PROVIDER=mock` runs without keys. | |

## 3D and geo terms

| Term | Meaning |
|---|---|
| **3D Tiles** | An OGC standard for streaming large 3D datasets. Google's Photorealistic 3D Tiles use it. |
| **Photogrammetry** | Building 3D models from many overlapping photos. |
| **Gaussian splatting (3DGS)** | A 2023+ technique that represents a scene as millions of small 3D Gaussians. It looks photoreal and renders fast. |
| **WGS84** | Standard lat/lon coordinates (GPS). Our graph stores nodes in WGS84. |
| **ENU** | A local East-North-Up metric frame centred on the site. Used to place graph nodes in a 3D scene. |
| **ECEF** | Earth-Centred Earth-Fixed coordinates, used by 3D Tiles and Cesium. |
| **GeoJSON** | A JSON format for geographic features. It's our interchange format between backend and frontend (GeoParquet for versioned analytical snapshots). |
| **OSM** | OpenStreetMap, a free, editable world map. A source of footpaths and buildings. |
| **Cesium / CesiumJS** | Open-source 3D globe engine; with Resium (React wrapper) it is our hero 3D view ([ADR 0007](decisions/0007-3d-engine-cesium.md)). Supports draping lines on tiles and translucent water polygons. | Cesium ion (the hosted data/plan service) |
| **Photoreal tiles** | Google Photorealistic 3D Tiles: streamed photogrammetry mesh of cities. Display-only licence: attribution on screen, no tracing, caching or deriving heights. Backdrop only; **never** a source of hydrology. | Our own capture |
| **DEM** | Digital Elevation Model: a raster of ground heights. Ours is Copernicus GLO-30 (30 m, a *surface* model, vertical error < 4 m), so results are indicative. | Photoreal mesh heights (not allowed) |
| **Copernicus GLO-30** | The open global 30 m DEM (ESA/Copernicus, free with attribution, EGM2008 heights). Input to HAND. | FABDEM (non-commercial licence: comparison only) |
| **HAND** | Height Above Nearest Drainage: for each cell, its height above the nearest stream along the flow path. A cell with HAND below the river stage is a candidate flood cell. Cheap, deterministic, honest about its limits ([ADR 0010](decisions/0010-flood-lens-hand-scenarios.md)). | A hydrodynamic flood model |
| **Connected inundation** | Only cells hydraulically connected to the river (or pond) at that stage count as flooded; unconnected hollows are ignored (unlike a plain "bathtub"). | |
| **OpenSidewalks** | An open schema for pedestrian paths with accessibility attributes. Our schema aligns with it. |

## Flood and disaster terms

| Term | Meaning |
|---|---|
| **Scenario (flood)** | A precomputed, **indicative** "what if the river rises" case: `baseline`, `stage_p1m`, `stage_p2m`, `stage_p3m`, `stage_p4m`, `stage_p5m`. Not a forecast, and never labelled "safe". A scenario can only add FAIL/UNKNOWN to the world model, never PASS. |
| **River stage** | The assumed rise of the river level above its bed in a scenario (+N m), used with HAND to decide which cells flood. |
| **Edge flood class** | Per scenario and path/road edge: `likely_flooded` (→ FAIL), `possible` (→ UNKNOWN), `unlikely` (normal rules). A margin (default 0.5–1.0 m) covers DEM error. |
| **Evacuation centre / PPS** | *Pusat Pemindahan Sementara*: temporary relief centre opened during floods (usually a hall or school). In the model: `official_pps` (confirmed from an official list or news, with evidence) or `osm_candidate` (an OSM hall, school, mosque or community centre that *could* serve; not an official PPS). |
| **Island (isolated component)** | A part of the walk or road network that is cut off from the rest (and from evacuation centres) under a scenario. Reported to managers. |
| **Isochrone** | The area reachable within a given travel time from a point for a profile, per scenario. |
| **Downstream floods** | The documented recent floods are in Kampung Kubu Gajah / Paya Jaras, downstream of Elmina on Sungai Subang; Elmina's built-up core is not low-lying. The flood lens is framed as "how a river rise affects Elmina residents' routes, their neighbours and evacuation centres", not "Elmina goes under". |
| **NADMA** | National Disaster Management Agency (*Agensi Pengurusan Bencana Negara*): national coordination of disaster response. Official link, always shown in flood answers. |
| **JPS / DID** | *Jabatan Pengairan dan Saliran* / Department of Irrigation and Drainage: rivers, flood monitoring (Public InfoBanjir). No documented public API; ask before using its data. |
| **MBSA** | *Majlis Bandaraya Shah Alam*, Shah Alam City Council: local authority for drains, roads, waste collection and PPS in Shah Alam. |
| **SWCorp** | *Perbadanan Pengurusan Sisa Pepejal dan Pembersihan Awam*: the national solid-waste management corporation; relevant to the `waste` lens. |

## Hackathon terms

| Term | Meaning |
|---|---|
| **SDP** | Sime Darby Property Berhad, the organiser and target customer. |
| **People / Planet** | The two challenge tracks. We are in **People**. |
| **Mechanism / Enabler** | The two required parts of the pitch: *how it works and why it creates value* / *how technology makes it work at scale*. |
| **OKU** | *Orang Kurang Upaya*, Malaysia's official term for persons with disabilities. |
| **JMB / MC** | Joint Management Body / Management Corporation, the strata bodies that run shared facilities. |
