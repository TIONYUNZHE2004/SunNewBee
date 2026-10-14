# 2026 Trends: What's New and What It Means for TownshipLens

> A synthesis of the detailed research docs in this folder, as of **14 Oct 2026**. Use it to answer "is this current?" questions from judges, and to pick pitch lines. Every claim here is sourced in the linked detail doc. If you quote a number in the pitch, cite it from **there**.

| Detail doc | Covers |
|---|---|
| [3d-data-and-rendering.md](3d-data-and-rendering.md) | 3D data sources, web renderers, Gaussian splats, licensing |
| [ai-assistant-research.md](ai-assistant-research.md) | Tool-use LLMs, grounding, spatial-reasoning limits, evals, multilingual, PDPA |
| [accessibility-and-routing.md](accessibility-and-routing.md) | OpenSidewalks, OSM tags, routing engines, unknown handling, Malaysian stats |
| [resident-agent-simulation.md](resident-agent-simulation.md) | Generative agents, synthetic users and their limits, persona testing |
| [competitors.md](competitors.md) | Malaysian township apps, global wayfinding/accessibility products |
| [site-selection.md](site-selection.md) | Which SDP township and facility to use |

---

## Trend 1: Photoreal 3D of the whole world is now a commodity API
- **What happened:** Google Photorealistic 3D Tiles (OGC 3D Tiles) cover Malaysia and can be streamed into open renderers (3d-tiles-renderer for three.js/R3F, CesiumJS, deck.gl). Overture Maps publishes monthly open buildings, places and transportation data.
- **What it means for us:** we don't need our own capture to look real (ADR [0002](../00-overview/decisions/0002-use-existing-3d-data.md)). **Recognisable 3D is no longer a differentiator; verified meaning on top of it is.**
- **Watch-outs:** display-only licence (no tracing, no caching), live internet required, quality per site unverified.

## Trend 2: Gaussian splatting goes mainstream on the web
- Cesium shipped hierarchical-LOD splat tiles (2026). `KHR_gaussian_splatting` is at Release Candidate. Spark (World Labs) is the go-to three.js splat renderer. Feed-forward reconstruction (VGGT, MapAnything, the DUSt3R/MASt3R line) cuts capture-to-model time dramatically.
- **For us:** the **pilot-phase** story ("SDP ops staff walk a facility with a phone and get a splat in minutes"). It isn't in the MVP. The 3D layer is swappable by design.

## Trend 3: "World models" is the AI buzzword of 2025–26, and we use it carefully
- Generative world models (World Labs Marble, Google Genie 3) produce explorable 3D worlds from prompts or images. They're impressive, and they hallucinate geometry.
- **For us:** our "world model" is a **verified, structured** representation. **Say this explicitly** in the pitch. It shows judges we know the field, and it's the reason our answers can be trusted.

## Trend 4: Tool-using LLM agents are mature; hand-rolled loops are fine
- Every major provider has stable tool use and structured outputs. MCP (spec 2026-07-28) is the standard way to expose tools to agents. The frameworks (PydanticAI, Vercel AI SDK 6, OpenAI Agents SDK, LangGraph) are plentiful.
- Small, fast models (Claude Haiku 5.5, Gemini Flash-Lite) make a pilot cost about USD 1 per 1,000 questions, so **cost is not a barrier to deployment**.
- **For us:** a ~100-line Python loop, six tools, server-side validation. MCP as a stretch goal ("any AI agent, e.g. SDP's own, can use the township's verified knowledge").

## Trend 5: The evidence keeps piling up that LLMs can't do spatial reasoning alone
- MapEval, TurnBack, GraphArena, FloorplanQA and *Lost in Aggregation* (2026) all show confident errors in routing, direction and distance aggregation. Delegating execution to deterministic engines recovers most of the accuracy.
- **For us:** this is the scientific core of the Enabler pitch. **"AI for language, algorithms for geometry, people for verification."**

## Trend 6: Grounding and calibrated uncertainty are product features now
- HCI studies show users over-rely on confident AI text and that models rarely hedge unprompted. Best practice moves uncertainty into the UI (badges and data status), not into model self-reports.
- Eval practice is shifting to **deterministic checks first** (tool calls, end-state), with LLM-as-judge only on calibrated slices (Promptfoo, Inspect AI, τ-bench style).
- **For us:** our unsupported-claim metric and the honest "not checked yet" badges match where the field is going.

## Trend 7: Accessibility data is moving from "tags" to "standards + verification"
- OpenSidewalks schema v0.3 (Jan 2026) standardises pedestrian network data with accessibility attributes. Project Sidewalk combines crowdsourcing with AI pre-screening. OpenTripPlanner models unknown accessibility with a cost (`unknownCost`) instead of hiding it.
- **For us:** we extend OpenSidewalks rather than inventing a schema (interoperable), and our **tri-state + provenance** approach goes beyond OSM's norms. That's a credible innovation claim.

## Trend 8: Synthetic users are popular, and their limits are well documented
- Generative Agents (2023) led to agent simulations of 1,000 real people (2024/26), which reached high fidelity only with **two-hour real interviews per person**. UXAgent (2025) does simulated usability pre-testing. 2025–26 studies show LLM disability personas are **homogenised and idealised**.
- **For us:** resident agents are **deterministic constraint profiles** with LLM-generated *test questions*, not role-play. That's an honest, research-backed position, and it pre-empts a likely judge criticism.

## Trend 9: Malaysia's policy context is pushing the same direction
- An ageing population (60+ about 12% in 2025 and rising), 805,509 registered OKU (2024), MS 1184 universal-design standard (weakly enforced), PDPA amendments (2024–25) adding breach notification and processor duties, and national AI governance guidelines. More in [../01-hackathon/sdp-context.md](../01-hackathon/sdp-context.md).
- **For us:** a verified-accessibility data product fits policy momentum, and our privacy-by-design approach (no accounts, redaction, no tracking) fits PDPA.
- ⚠️ Avoid the outdated line "Malaysia becomes an aged nation by 2030". Newer projections differ, so use the cited figures in [accessibility-and-routing § 2](accessibility-and-routing.md).

---

## What we deliberately do *not* chase (and how to say it)

| Hype | Our line |
|---|---|
| Full city digital twin | "We start with one facility and make it *correct*, then scale facility by facility." |
| Generative world models | "Our world model is verified data, because residents need facts, not plausible pictures." |
| LLM agents that 'simulate residents' | "Our agents test the map, not people's feelings. Real residents are consulted in person." |
| Live sensors / crowd detection | "Out of MVP scope. Closures come from staff today, and sensor feeds can plug in later." |
| Compliance certification | "We surface verified facts. We don't certify MS 1184 compliance." |
