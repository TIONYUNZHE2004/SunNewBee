# Reference Library

Papers, repos and source notes collected during research (14 Oct 2026). The **docs** in [`../docs/`](../docs/README.md) explain what we concluded; this folder holds the raw material behind those conclusions.

```
reference/
  README.md              ← this index
  clone-repos.sh         ← recreates repos/ (shallow clones, ~4 GB, gitignored)
  download-papers.sh     ← re-downloads all PDFs (PDFs > 10 MB are gitignored)
  notes/                 ← machine-readable source lists written by each research track
  papers/{ai,access,3d}/ ← PDFs, named <arXiv id>_<short title>.pdf
  repos/{3d,access,ai,stack}/
```

**Setup on a new machine**

```bash
bash reference/clone-repos.sh
```

```bash
bash reference/download-papers.sh
```

You can also clone one category: `bash reference/clone-repos.sh 3d`.

**Priority legend:** ★★★ read or skim this week · ★★ read the section you need · ★ background.

---

## Repos

### 3D and maps (`repos/3d/`): owner FE
| Repo | Why it's here | Where to look first | Pri |
|---|---|---|---|
| [NASA-AMMOS/3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) | **Our 3D renderer.** Loads Google Photorealistic 3D Tiles in three.js/R3F | `src/r3f/README.md`, `example/r3f/`, `src/plugins/` (GoogleCloudAuthPlugin) | ★★★ |
| [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) | React renderer for three.js (v9, React 19) | `docs/` | ★★★ |
| [pmndrs/drei](https://github.com/pmndrs/drei) | Helpers: `Html` labels, `Line`, controls | `src/core/Html.tsx`, `Line.tsx` | ★★ |
| [maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js) | **2D fallback map** | `test/examples/` (GeoJSON line layers) | ★★ |
| [visgl/react-map-gl](https://github.com/visgl/react-map-gl) | React bindings for MapLibre | `examples/` | ★★ |
| [reearth/resium](https://github.com/reearth/resium) | React + CesiumJS: the alternative renderer if the R3F spike fails | `README` | ★ |
| [OvertureMaps/overturemaps-py](https://github.com/OvertureMaps/overturemaps-py) | Download Overture buildings/places by bbox (fallback scene + POIs) | `README` | ★★ |
| [tordanik/OSM2World](https://github.com/tordanik/OSM2World) | OSM → glTF/3D Tiles for the open-data fallback scene | `README` | ★ |
| [ThatOpen/engine_components](https://github.com/ThatOpen/engine_components) / [engine_web-ifc](https://github.com/ThatOpen/engine_web-ifc) | IFC/BIM in the browser, if SDP provides BIM | examples | ★ |
| [sparkjsdev/spark](https://github.com/sparkjsdev/spark) | Gaussian-splat renderer for three.js: the pilot-phase capture story | `README`, examples | ★ |

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
| [anthropics/anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python) | **Default LLM client**: tool use, streaming | `examples/tools*.py`, `examples/*stream*` | ★★★ |
| [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) | **Eval harness**: golden set, assertions, CI | `examples/` (tool-call assertions) | ★★★ |
| [pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai) | Typed alternative to a hand-rolled loop | `docs/tools.md`, `docs/output.md` | ★★ |
| [jlowin/fastmcp](https://github.com/jlowin/fastmcp) | MCP server for our tool layer (stretch) | `README`, `docs/` | ★★ |
| [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk) | Official MCP SDK | `README` | ★ |
| [modelcontextprotocol/modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol) | MCP spec (2026-07-28) | `docs/specification/` | ★ |
| [UKGovernmentBEIS/inspect_ai](https://github.com/UKGovernmentBEIS/inspect_ai) | Rigorous agent eval framework, if we outgrow Promptfoo | `docs/` | ★ |
| [aisingapore/sealion](https://github.com/aisingapore/sealion) | Southeast Asian language models: multilingual reference | `README` | ★ |

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

---

## Source notes (`notes/`)
| File | Written by | Contents |
|---|---|---|
| [3d-sources.md](notes/3d-sources.md) | 3D research track | repos + papers, with verification notes |
| [ai-sources.md](notes/ai-sources.md) | AI research track | repos + papers |
| [access-sources.md](notes/access-sources.md) | Accessibility research track | repos + papers, incl. unverified flags |
| [stack-sources.md](notes/stack-sources.md) | Stack research track | repos + doc pages |
| [context-sources.md](notes/context-sources.md) | SDP/Malaysia context track | SDP reports, policy PDFs |

> Items marked "(unverified)" in the notes could not be confirmed from a fetched page. Check them before quoting.
