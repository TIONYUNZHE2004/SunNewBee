# Reference Library

Papers, repos and source notes collected during research (14 Oct 2026). The **docs** in [`../docs/`](../docs/README.md) explain what we concluded; this folder holds the raw material behind those conclusions.

```
reference/
  README.md              ← this index
  clone-repos.sh         ← recreates repos/ (shallow clones, ~4 GB, gitignored; categories 3d access ai flood stack)
  download-papers.sh     ← downloads all PDFs into papers/ (PDFs are gitignored; only the notes and scripts are tracked)
  notes/                 ← machine-readable source lists written by each research track
  papers/{ai,access,3d,flood}/ ← PDFs, named <arXiv id>_<short title>.pdf
  papers/context/        ← SDP reports, DOSM, UNICEF toolkit, PDPA summary
  repos/{3d,access,ai,flood,stack}/
```

**Setup on a new machine**

```bash
bash reference/clone-repos.sh
```

```bash
bash reference/download-papers.sh
```

You can also clone one or more categories: `bash reference/clone-repos.sh flood 3d`. `download-papers.sh` has no category argument; it downloads everything and skips files that already exist.

**Priority legend:** ★★★ read or skim this week · ★★ read the section you need · ★ background.

---

## Repos

### 3D and maps (`repos/3d/`): owner FE
| Repo | Why it's here | Where to look first | Pri |
|---|---|---|---|
| [NASA-AMMOS/3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) | Previously planned 3D renderer; now the **spike/fallback** after ADR 0007 (Cesium). Loads Google Photorealistic 3D Tiles in three.js/R3F | `src/r3f/README.md`, `example/r3f/`, `src/plugins/` (GoogleCloudAuthPlugin) | ★ |
| [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) | React renderer for three.js (v9, React 19); fallback only now | `docs/` | ★ |
| [pmndrs/drei](https://github.com/pmndrs/drei) | Helpers: `Html` labels, `Line`, controls | `src/core/Html.tsx`, `Line.tsx` | ★★ |
| [maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js) | Open 2D map (the lite view is now Mapbox, see ADR 0007); reference for GeoJSON layers | `test/examples/` (GeoJSON line layers) | ★★ |
| [visgl/react-map-gl](https://github.com/visgl/react-map-gl) | React bindings for MapLibre | `examples/` | ★★ |
| [reearth/resium](https://github.com/reearth/resium) | **Our hero 3D renderer wrapper** (React + CesiumJS 1.146, ADR 0007). Read the CesiumJS API itself via `npx ctx7@latest` (the `CesiumGS/cesium` repo is ~1.2 GB, not cloned) | `README`, `src/` (`Viewer`, `Entity`, `Cesium3DTileset`) | ★★★ |
| [OvertureMaps/overturemaps-py](https://github.com/OvertureMaps/overturemaps-py) | Download Overture buildings/places by bbox (fallback scene + POIs) | `README` | ★★ |
| [tordanik/OSM2World](https://github.com/tordanik/OSM2World) | OSM → glTF/3D Tiles for the open-data fallback scene | `README` | ★ |
| [ThatOpen/engine_components](https://github.com/ThatOpen/engine_components) / [engine_web-ifc](https://github.com/ThatOpen/engine_web-ifc) | IFC/BIM in the browser, if SDP provides BIM | examples | ★ |
| [sparkjsdev/spark](https://github.com/sparkjsdev/spark) | Gaussian-splat renderer for three.js: the pilot-phase capture story | `README`, examples | ★ |
| [visgl/react-google-maps](https://github.com/visgl/react-google-maps) | `<Map3D>` for Google's `Map3DElement`: a 2-hour ToS-safe prototype path (pre-GA, too locked down for the flood lens) | `examples/`, `src/components/map-3d/` | ★★ |
| [protomaps/PMTiles](https://github.com/protomaps/PMTiles) | Single-file tile archive; serve per-lens vector tiles from static hosting for the lite view | `js/`, `spec/` | ★★ |
| [opengeospatial/geoparquet](https://github.com/opengeospatial/geoparquet) | GeoParquet spec: our format for versioned base-twin and overlay snapshots (query with DuckDB) | `format-specs/` | ★★ |
| *Not cloned (too large):* [CesiumGS/cesium](https://github.com/CesiumGS/cesium) (~1.2 GB), [mapbox/mapbox-gl-js](https://github.com/mapbox/mapbox-gl-js) (~670 MB shallow), [visgl/deck.gl](https://github.com/visgl/deck.gl) | Read the APIs via npm packages and `npx ctx7@latest`; deck.gl `Tile3DLayer` + `TerrainExtension` is the documented alternative drape pattern | | ★★ |

### Accessibility, routing, agents (`repos/access/`): owner BE + AI
| Repo | Why | Where to look | Pri |
|---|---|---|---|
| [OpenSidewalks/OpenSidewalks-Schema](https://github.com/OpenSidewalks/OpenSidewalks-Schema) | **Base for our world-model schema** (v0.3, Jan 2026) | `opensidewalks.schema.json`, entity docs | ★★★ |
| [networkx/networkx](https://github.com/networkx/networkx) | Routing engine for the MVP | `networkx/algorithms/shortest_paths/weighted.py` (callable weights) | ★★★ |
| [nbolten/unweaver](https://github.com/nbolten/unweaver) | Profile-based pedestrian routing with dynamic costs: a design reference | `unweaver/` profiles | ★★ |
| [joonspk-research/generative_agents](https://github.com/joonspk-research/generative_agents) | The Generative Agents code, to understand what we *don't* build | `README` | ★ |
| [microsoft/soundscape](https://github.com/microsoft/soundscape) | Open-sourced audio navigation for blind users: ideas for non-visual modes | `README` | ★ |

### AI (`repos/ai/`): owner AI
| Repo | Why | Where to look | Pri |
|---|---|---|---|
| [anthropics/anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python) | Reference for provider-native tool use and streaming (no longer our client: models go through OpenRouter) | `examples/tools*.py`, `examples/*stream*` | ★ |
| [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) | **Eval harness**: golden set, assertions, CI | `examples/` (tool-call assertions) | ★★★ |
| [pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai) | **Our agent harness** (ADR 0008, over OpenRouter): tools, `output_validator`, streaming, `FunctionModel`/`TestModel` | `docs/tools.md`, `docs/output.md`, `docs/models/openrouter.md` | ★★★ |
| [jlowin/fastmcp](https://github.com/jlowin/fastmcp) | MCP server for our tool layer (stretch) | `README`, `docs/` | ★★ |
| [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk) | Official MCP SDK | `README` | ★ |
| [modelcontextprotocol/modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol) | MCP spec (2026-07-28) | `docs/specification/` | ★ |
| [UKGovernmentBEIS/inspect_ai](https://github.com/UKGovernmentBEIS/inspect_ai) | Rigorous agent eval framework, if we outgrow Promptfoo | `docs/` | ★ |
| [aisingapore/sealion](https://github.com/aisingapore/sealion) | Southeast Asian language models: multilingual reference | `README` | ★ |

### Flood & disaster (`repos/flood/`): owner BE
| Repo | Why | Where to look | Pri |
|---|---|---|---|
| [mdbartos/pysheds](https://github.com/mdbartos/pysheds) | **HAND pipeline core**: DEM conditioning, flow direction/accumulation, `compute_hand` (GPL-3.0: use as a tool, don't vendor) | `examples/`, `pysheds/sgrid.py` | ★★★ |
| [gboeing/osmnx](https://github.com/gboeing/osmnx) | **Township road and walk graphs** from OSM as NetworkX; the `drive` profile and evacuation graph | `osmnx/graph.py`, `osmnx/routing.py`, `examples/` | ★★★ |
| [rasterio/rasterio](https://github.com/rasterio/rasterio) | Read COG DEM/HAND windows (GLO-30, ASF HAND) over HTTP, clip, vectorise contours | `docs/`, `rasterio/mask.py`, `rasterio/features.py` | ★★ |
| [jblindsay/whitebox-tools](https://github.com/jblindsay/whitebox-tools) | Alternative HAND and depression-filling toolchain (Rust CLI + Python wrapper); a cross-check for pysheds (165 MB) | `whitebox_tools.py`, tool docs | ★★ |
| *Not cloned (pilot path, priority 3):* [Deltares/SFINCS](https://github.com/Deltares/SFINCS) · [Deltares/hydromt_sfincs](https://github.com/Deltares/hydromt_sfincs) (~530 MB) · [Deltares/pyflwdir](https://github.com/Deltares/pyflwdir) | Reduced-physics 2D flood solver and builder once SDP provides LiDAR and drainage data | | ★ |

### Stack templates (`repos/stack/`): everyone
| Repo | Why | Where to look | Pri |
|---|---|---|---|
| [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) | Patterns for uv + FastAPI + Postgres + auth + **generated TS client** + CI. Borrow, don't fork | `backend/`, `frontend/openapi-ts.config.ts`, `.github/workflows/` | ★★★ |
| [hey-api/openapi-ts](https://github.com/hey-api/openapi-ts) | OpenAPI → TypeScript client generator | `docs/` | ★★ |
| [assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui) | Chat UI primitives (fallback if the custom chat is slow to build) | `examples/` | ★ |

---

## Papers

### AI assistant (`papers/ai/`)
| Paper | Year | Use it for | Pri |
|---|---|---|---|
| MapEval: map-based geo-spatial reasoning in foundation models (2501.00316) | 2025 | **Evidence LLMs fail at routing → delegate** | ★★★ |
| Lost in Aggregation: multi-scale LLM spatial navigation (2606.22219) | 2026 | Deterministic walker + LLM beats LLM alone | ★★★ |
| TurnBack: geospatial route cognition (2509.18173) | 2025 | Confidently wrong routes | ★★ |
| GraphArena: LLMs on graph computation (2407.00379) | 2024 | Hallucination on larger graph problems | ★★ |
| FloorplanQA: spatial reasoning over structured layouts (2507.07644) | 2025 | Indoor-layout reasoning limits | ★ |
| Relying on the Unreliable: reluctance to express uncertainty (2401.06730) | 2024 | **Why uncertainty belongs in the UI** | ★★★ |
| τ-bench: tool-agent-user interaction (2406.12045) | 2024 | End-state + tool-call evaluation style | ★★ |
| Judging LLM-as-a-Judge (2306.05685) | 2023 | Judge biases to mitigate | ★★ |
| Ragas (2309.15217) | 2023 | Faithfulness metric vocabulary | ★ |
| GraphRAG (2404.16130) · LightRAG (2410.05779) | 2024 | Why we *don't* need graph-RAG | ★ |
| SEA-HELM (2502.14301) | 2025 | Malay/Tamil/Chinese evaluation | ★★ |
| ReAct (2210.03629) | 2022 | Foundation of the tool loop | ★ |
| 3D-LLM (2307.12981) · LEO (2311.12871) · SpatialVLM (2401.12168) · SpatialRGPT (2406.01584) | 2023–24 | 3D/spatial VLMs: background, and why they aren't a fact source | ★ |

### Accessibility, routing, simulation (`papers/access/`)
| Paper | Year | Use it for | Pri |
|---|---|---|---|
| Project Sidewalk: global-scale crowd+AI sidewalk assessment (2206.13677) | 2022 | Crowd + AI validation workflow precedent | ★★★ |
| Generative Agent Simulations of 1,000 People (2411.10109) | 2024 | **Fidelity needs real interviews → our agents are constraint checkers** | ★★★ |
| Agentic Property-Based Testing (2510.09907) | 2025 | LLM proposes properties, harness verifies: our simulator pattern | ★★★ |
| Shiny Stories, Hidden Struggles: disability in LLMs (2605.20191) | 2026 | LLMs idealise disability → don't role-play OKU | ★★ |
| Down Syndrome stereotypes in LLM personas (2512.02275) | 2025 | Persona stereotype risk | ★ |
| Generative Agents (2304.03442) | 2023 | The foundational agent architecture | ★★ |
| UXAgent (2504.09407) | 2025 | Simulated usability pre-tests | ★★ |
| AXNav (2310.02424) | 2023 | Natural-language accessibility test cases | ★ |
| GATSim (2506.23306) | 2025 | LLM urban-mobility simulation | ★ |
| Melnikov et al., shade and pedestrian route choice, Sci Rep (2022) | 2022 | **Shade discount ×0.86** used in our profiles | ★★ |
| *Not downloaded (publisher blocks scripts; open in a browser):* bench-spacing review, [MDPI Sustainability 17(18):8251](https://www.mdpi.com/2071-1050/17/18/8251) · impersonification bias, [MDPI Information 16(11):931](https://www.mdpi.com/2078-2489/16/11/931) | 2025 | Rest-point intervals · persona bias | ★★ |

### 3D (`papers/3d/`)
| Paper | Year | Use it for | Pri |
|---|---|---|---|
| 3D Gaussian Splatting (2308.04079) | 2023 | The splat baseline | ★ |
| CityGaussian (2404.01133) · Hierarchical 3DGS (2406.12080) · Octree-GS (2403.17898) | 2024 | City-scale splats: the pilot-phase story | ★ |
| VGGT (2503.11651) · MapAnything (2509.13414) · DUSt3R (2312.14132) | 2023–26 | Feed-forward reconstruction: fast future capture | ★ |
| ConceptGraphs (2309.16650) | 2023 | Structured scene graphs ground LLMs better than raw 3D | ★★ |

### Flood & disaster (`papers/flood/`)
| Paper | Year | Use it for | Pri |
|---|---|---|---|
| Hawker et al., A 30 m global map of elevation with forests and buildings removed (FABDEM), ERL (Hawker2022) | 2022 | DEM accuracy numbers (GLO-30 vs bare-earth in built-up areas) and the licence context (FABDEM is non-commercial) | ★★★ |
| Pregnolato et al., The impact of flooding on road transport: a depth-disruption function (Pregnolato2017) | 2017 | Graded rather than binary road closure; basis of the ~0.3 m `drive` threshold | ★★★ |
| Bonn, An interactive evacuation tool to improve the public flood perception, ISPRS 2023 (ISPRS2023) | 2023 | Closest methodological template: shortest path to shelters per flood stage with depth × velocity | ★★★ |
| Defra/EA supplementary note on flood hazard ratings, FD2320/FD2321 (DefraEA_FD2320) | 2008 | UK-style danger bands behind our pedestrian depth thresholds | ★★ |
| Feasibility study of urban flood mapping using traffic signs for route optimization (2109.11712) | 2021 | Flood-aware routing on a road graph | ★★ |
| Assessing transport resilience to heavy rainfall: an integrated modelling framework (2609.16963) | 2026 | Recent use of the depth-disruption function; 0.3 m severe-flood link cut-off | ★★ |
| Extraction and visualization of 3D building models in urban areas for flood simulation, ISPRS 2019 (ISPRS2019) | 2019 | Web 3D flood viewer architecture (Cesium) | ★ |
| CIDB draft Construction Industry Standard on flood risk assessment in Malaysia (CIDB2023) | 2023 | Malaysian context: DID mandate and flood-risk-assessment practice | ★★ |
| *Not downloaded:* ARR people-and-vehicles stability guideline (server returns 403 to scripts; [open in a browser](https://arr.ga.gov.au/__data/assets/pdf_file/0006/40488/ARR_People_and_Vehicles_stability.pdf)) · Nobre et al. 2011 (original HAND), Garousi-Nejad et al. 2019, Teng et al. 2017, Leijnse et al. 2021 (SFINCS) (no verified open PDF URL; see [flood-sources](notes/flood-sources.md)) · Ratnapura evacuation engine (repository page, no direct PDF) | | D × V limits (0.4 m²/s) · HAND concept and limits · method review · SFINCS | ★★ |

### SDP and Malaysia context (`papers/context/`)
| Document | Use it for | Pri |
|---|---|---|
| SDP Integrated Annual Report 2025 (24 MB, local only) | Landbank, 27 townships, SHIFT32, digital section, **age-inclusive design** quote, CDTO profile | ★★★ |
| SDP Sustainability Report 2025 (24 MB, local only) | **SSR2030 Community Experience pillar, "Inclusivity & Social Equity"** | ★★★ |
| UNICEF × SDP Inclusive Playground Toolkit (2022) | Elmina precedent; Universal Design / MS 1184 checklist ideas for our field survey | ★★★ |
| DOSM Current Population Estimates 2026 | Ageing statistics | ★★ |
| SDP AGM 2026 Q&A | Leadership mindset, SHIFT32 | ★★ |
| SDP IAR 2024 · SR 2024 | Prior-year baseline | ★ |
| SDP Q1 2026 results · Kenanga 4Q25 note | Latest financial narrative | ★ |
| Bandar Bukit Raja booklet | Backup site (shortlist #3) | ★ |
| One Asia Lawyers: PDPA 2024 amendments | Plain-language PDPA summary | ★★ |

---

## Datasets (flood and township twin)

**Not stored here.** These are large or live; the pipeline scripts in `data/scripts/` (`import_osm.py`, `import_overture.py`, `build_roads.py`, `build_hand.py`, `build_scenarios.py`) download them into `data/raw/` (gitignored) and write small derived GeoJSON/GeoParquet files. Details, licences and access commands: [notes/flood-sources.md](notes/flood-sources.md) and the 2026-10-14 section of [notes/3d-sources.md](notes/3d-sources.md).

| Dataset | Use it for | Licence note | Pri |
|---|---|---|---|
| Copernicus DEM GLO-30 (AWS COG tiles, tile N03 E101) | The only licence-safe open DEM for the MVP: HAND input and scenario heights (30 m surface model, vertical error < 4 m; EGM2008) | Free with attribution and liability notice | ★★★ |
| ASF global 30 m HAND (from GLO-30) | Day-1 quick start for `stage_p*m` scenarios before our own pysheds recompute | CC0 (Copernicus attribution still applies) | ★★★ |
| OpenStreetMap via Overpass or Geofabrik (Elmina envelope `3.150,101.460,3.240,101.530`) | Buildings, waterways, ponds, roads, footways, candidate evacuation centres (halls, schools, mosques) | ODbL | ★★★ |
| Overture Maps (buildings, transportation, places) | Building heights and places cross-check for the base twin | ODbL (places mostly CDLA-Permissive) | ★★ |
| FABDEM v1.2 | Comparison panel only, never in the product | CC BY-NC-SA 4.0 (non-commercial) | ★ |
| MET Malaysia warnings API (`api.data.gov.my`) | Optional live "heavy rain" banner | Open data; check rate limits | ★★ |
| JPS Public InfoBanjir; NADMA/JKM PPS lists | River levels and official evacuation centres: **ask for permission or the list**; no documented API, no scraping | Terms not found | ★★ |
| Google Photorealistic 3D Tiles | Hero backdrop only (display-only: no tracing, caching or height extraction) | Map Tiles API ToS | ★★★ |

---

## Source notes (`notes/`)
| File | Written by | Contents |
|---|---|---|
| [3d-sources.md](notes/3d-sources.md) | 3D research track | repos + papers, with verification notes |
| [ai-sources.md](notes/ai-sources.md) | AI research track | repos + papers |
| [access-sources.md](notes/access-sources.md) | Accessibility research track | repos + papers, incl. unverified flags |
| [stack-sources.md](notes/stack-sources.md) | Stack research track | repos + doc pages |
| [context-sources.md](notes/context-sources.md) | SDP/Malaysia context track | SDP reports, policy PDFs |
| [flood-sources.md](notes/flood-sources.md) | Flood lens research track | repos, papers and datasets for the flood lens (priority-marked) |

> Items marked "(unverified)" in the notes could not be confirmed from a fetched page. Check them before quoting.
