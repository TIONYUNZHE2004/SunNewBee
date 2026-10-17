# AI winners and similar products (research, 2026-10-15)

Question: what did winning AI hackathon teams and comparable products build, and what does that mean for the TownshipLens AI? Input for [ai-target-design](../04-architecture/ai-target-design.md).

**Method and limits.**
- Web search only. This container's network policy blocks direct page fetches (for example `lablab.ai` and `openrouter.ai` were refused), so most findings come from search-result summaries, not full pages.
- Each finding is labelled **fact** (stated by a source), **inference** (my reading) or **unverified**.
- Re-check any figure before it goes into the deck.

## TL;DR

1. **Winners use hosted models plus engineering, not custom training** (inference, consistent across sources). The 2025 Malaysian champion (MySelamat) combined crowdsourced data with route planning through the Google Maps API. No source mentions fine-tuning.
2. **Judges reward a working, focused demo, a clear user story and visible execution** more than technical novelty (fact, from rubrics and guides). Our own rubric weights Impact 25%, Innovation 20% and Feasibility 20%.
3. **Big products converge on our pattern:** an LLM that calls tools over trusted spatial data. Examples are Google "Ask Maps" with Grounding with Google Maps, and Esri ArcGIS agents over MCP (fact).
4. **The gap in the market is the planner side** (inference). Accessibility "what-if" planning tools exist without an LLM (GOAT), and LLM urban-twin assistants exist as research. I found no product that lets a planner ask in plain language "what if we close this bridge, who loses step-free access?" over a verified twin.
5. **Mature agent engineering in 2026 means evaluation, tracing and guardrails**, not bigger prompts (fact, practitioner consensus). That means trajectory checks, deterministic tool-call grading, calibrated LLM judges and CI gates.

## 1. Past winners

| Event | Winner | What it built | AI approach | Source |
|---|---|---|---|---|
| Great Malaysia AI Hackathon 2025 (APU + MDEC + AWS; 1,741 participants, 300+ teams) | **MySelamat**, team Ctrl + Chill (APU) | Flood rescue: AI-powered SOS, risk-aware navigation, crowdsourced verification, predictive alerts | Crowdsourced social-media data + route planning through the Google Maps API. Internal architecture not published (unverified). | [APU](https://www.apu.edu.my/news/apus-ctrl-chill-team-crowned-champion-great-malaysia-ai-hackathon-2025), [The Star](https://www.thestar.com.my/news/education/2025/11/02/apu-wins-with-life-saving-ai), [EduAdvisor](https://eduadvisor.my/articles/apu-win-great-ai-hackathon-2025), [Digital News Asia](https://www.digitalnewsasia.com/digital-economy/apus-ctrl-chill-team-crowned-champion-great-malaysia-ai-hackathon-2025) |
| UMHackathon 2025 (523 participants, theme data science and ML) | **MEX Assistant** (reported as a Sunway team) | AI chatbot that helps Grab merchants with operations and decisions | Assistant over business data (details unverified) | [Sunway University](https://sunwayuniversity.edu.my/news/2025/fet-students-crowned-champion-umhackathon-2025) |
| A 2026 agent hackathon (event name unverified; profiled by lablab.ai) | **OlympusOS** (solo, 5 days) | An "agentic operating system" for cities: agents war-game scenarios inside a digital twin before acting | Multi-agent simulation in a twin | [lablab.ai](https://lablab.ai/ai-articles/lablab-hackathon-success-stories-part-2) |
| Sime Darby Property University Hackathon | First edition (2026) | No past winners exist. RM6,000 champion prize; finale 14 Nov; winners at Innovation Day in December. | n/a | [SDP](https://www.simedarbyproperty.com/universityhackathon/), [The Star](https://www.thestar.com.my/business/business-news/2026/09/20/sime-darby-property-launches-nationwide-university-hackathon) |

**What this means for us** (inference):
- MySelamat shows a Malaysian jury rewarded flood plus navigation plus AI. Our flood lens fits that, and we must differentiate.
  - **MySelamat:** rescue and response, crowdsourced, "selamat" (safe) in the name.
  - **TownshipLens:** planning and honesty. It never claims "safe", uses a verified twin, and covers access for OKU users all year, not just in floods.
- OlympusOS shows "agents running what-ifs inside a twin" is a winning pitch shape. Our version must stay deterministic and honest: what-ifs run in the engine, not in the LLM.

## 2. How judges score (patterns)

| Pattern | Evidence | Label |
|---|---|---|
| Completion and polish beat novelty; one journey that works perfectly beats ten half-features | lablab rubrics (completion, presentation, applicability, commercial value, innovation); a 2026 guide; an OnboardEase case where execution won without the required agents | fact (rubrics); inference (weighting) |
| A live demo, not screenshots; a clear person-centred story | [lablab guide](https://lablab.ai/guide/how-to-win-an-ai-hackathon), [Masai 2026 guide](https://www.masaischool.com/blog/how-to-win-an-ai-hackathon-in-2026-full-guide/), [dev.to](https://dev.to/jsb-securedme/what-ai-hackathon-winners-actually-have-in-common-1kla) | fact (advice), not official rules |
| Have a fallback for API rate limits during the demo | Same guides | fact (advice). We already have `DEMO_MODE` and a template fallback. |
| "The weakest of idea, execution, impact and explanation caps the score" | dev.to article (snippet only) | unverified |
| Two-round judging: written proposal first, then demo day weighted to execution and defending decisions | [E4C official rules](https://www.engineeringforchange.org/wp-content/uploads/2021/05/E4C-AI-Pilot-Hackathon-Official-Rules-rev4-7-2026.pdf) | fact for that event; our hackathon has the same shape (proposal 23 Oct, pitch 14 Nov) |

## 3. Similar products and research

| Product or work | What it does | AI pattern | Relevance |
|---|---|---|---|
| **Google Maps "Ask Maps"** (Mar 2026) | Chat in Maps for complex place questions, shown on a map | Gemini over Maps data, personalised | Same interaction as ours. Google has breadth; we have verified accessibility facts and honest gaps for one township. [PCWorld](https://www.pcworld.com/article/3086987/gemini-just-became-your-new-google-maps-buddy.html), [Storyboard18](https://storyboard18.com/brand-marketing/conversational-maps-3d-route-view-google-maps-adds-gemini-powered-ask-maps-chatbot-92064.htm) |
| **Grounding with Google Maps** (Gemini API, Oct 2025) | Lets apps ground Gemini answers in 250M+ places, with citations | Provider-side tool | Their terms reportedly exclude emergency-response use (fact per [Google blog](https://blog.google/technology/developers/grounding-google-maps-gemini-api/) coverage; check the terms). This supports our own deterministic flood engine. |
| **Esri ArcGIS agentic AI** (2026) | AI assistants plus external agents calling ArcGIS tools through MCP | Tools over GIS, MCP | Industry is converging on "LLM + GIS tools" (fact). MCP could later expose our 10 tools to other agents. [Esri](https://www.esri.com/about/newsroom/arcnews/the-next-era-of-ai-and-arcgis) |
| **GOAT (plan4better)** | Accessibility what-if scenario planning, baseline vs scenario | No LLM | Proves planners want what-ifs (fact). Our gap: a plain-language what-if over a *verified* twin. [GOAT docs](https://goat.plan4better.de/docs/tutorials/scenario-planning/intro) |
| **ISPRS 2025, "Advanced User Interaction with Urban Digital Twins using LLMs"** | LLM queries a CityGML district twin; tested with planners, utilities and citizens; multilingual hypothesis | LLM over twin APIs | Academic proof of our interaction model. [ISPRS Annals](https://isprs-annals.copernicus.org/articles/X-G-2025/469/2025/isprs-annals-X-G-2025-469-2025.pdf) |
| **Agentic Urban Digital Twins (AUDiTs, 2025)** | Vision paper: LLM agents plus GIS for reasoning in twins | Research agenda | Good citation for "agentic twin" framing. [Springer](https://link.springer.com/article/10.1007/s44212-025-00099-3) |
| **OmniAcc (2025)**, **AccessMyPath** | Wheelchair navigation from GPT-4 plus imagery plus OSM; vibration-sensed surfaces | LLM/vision for *data collection* | Shows data collection is the hard part (inference). Our verification-request loop is our answer. [arXiv 2509.07220](https://www.arxiv.org/abs/2509.07220) |
| **ILMU** (YTL AI Labs, Aug 2025), **MaLLaM** (Mesolitica) | Malaysian LLMs with Malay, Manglish and dialect focus | Sovereign models | Possible BM model candidates. ILMU's MalayMMLU score is self-reported; its origin is disputed; API access and pricing unverified. [Malay Mail](https://www.malaymail.com/news/tech-gadgets/2025/08/12/ilmu-100pc-malaysian-made-ai-model-ilmuchat-available-for-early-access-on-sept-16/187337), [W.Media](https://w.media/ilmu-deep-dive-into-malaysias-first-homegrown-llm-with-prof-chan/) |

## 4. Agent engineering practice (2026)

| Topic | Finding | Label | Source |
|---|---|---|---|
| Workflows vs agents | Start with the simplest solution and add agent autonomy only when needed; agents trade latency and cost for flexibility | fact | [Anthropic, Building effective agents](https://www.anthropic.com/research/building-effective-agents) |
| Tool-calling benchmarks | Quote BFCL and τ-bench together; no single model leads all tool-use benchmarks; leaderboard snapshots conflict | fact (sources disagree on the leader) | [BFCL v4 on BenchLM](https://benchlm.ai/benchmarks/bfclV4), [Spheron](https://www.spheron.network/blog/tool-calling-benchmarks-bfcl-tau-bench-latency-optimization/) |
| Evaluation | Score the tool-call **trajectory**, not only the final answer. Grade tool calls deterministically. Use LLM judges only for qualitative rubrics, from a different model family, calibrated against humans. Gate CI on regressions. Golden sets of 30–200 cases, about 60% normal, 30% edge and 10% adversarial. | fact (practitioner consensus; the specific numbers are illustrative) | [FutureAGI](https://futureagi.com/blog/llm-as-judge-best-practices-2026), [Arize](https://arize.com/blog-course/llm-as-a-judge), [getwidget](https://getwidget.dev/blog/how-to-evaluate-ai-agents/) |
| Memory | Three layers: working (this task), session (this conversation) and long-term. Keep session history in context and give long-term items TTL, provenance and consent. Persistent memory needs its own privacy controls. | fact (patterns; no single standard) | [arXiv 2608.16551](https://arxiv.org/pdf/2608.16551), [unimon guide](https://unimon.co.th/en/blog/ai-agent-memory-design-guide) |
| Malay evaluation | SEA-HELM (AI Singapore) now covers Malay; the leaderboard is at leaderboard.sea-lion.ai. No tool-calling track found. | fact; current rankings unverified | [SEA-HELM GitHub](https://github.com/aisingapore/sea-helm), [ACL 2025](https://aclanthology.org/2025.findings-acl.636/) |

**Library facts checked in this repo** (fact, from the installed `pydantic-ai-slim` 2.56.0):
- `Agent.run(..., message_history=...)` and a `pydantic_ai.conversation.Conversation` type exist. These give session memory.
- The capabilities `Instrumentation` (OpenTelemetry tracing), `SelectModel`, `Caching` and `HistoryProcessor` exist, plus `models.fallback.FallbackModel`.
- `pydantic-evals` 2.56.0 is on PyPI under the MIT licence. Its dependencies are `pydantic-ai-slim==2.56.0`, `pyyaml`, `rich`, `anyio` and `logfire-api`, all checked from the wheel metadata.

## 5. Implications for TownshipLens (inference)

1. **Keep the architecture** (LLM plus deterministic tools plus validator). It matches industry (Ask Maps, Esri) and research. Fine-tuning has no data to learn from and adds no visible value.
2. **Add the planner and staff copilot.** It is the clearest differentiator, and the engine already computes most answers: gap ranking, gap map and briefing comparison.
3. **Make honesty measurable.** Run a live evaluation over the [question catalogue](../../evals/catalogue/questions.yaml) in EN/BM/中文, then put the numbers in the deck. Judges reward visible execution.
4. **Fix multilingual honesty before demoing BM or 中文.** The validator is English-only today.
5. **Show the reasoning.** A "how I got this answer" trace (tools called, evidence, gaps) makes the honesty story visible in a live demo.
