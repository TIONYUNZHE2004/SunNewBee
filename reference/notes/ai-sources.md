# AI Assistant Sources (TownshipLens)

Compiled 2026-10-14. Repo URLs returned HTTP 200 (ragas redirected 301 to its new org path); arXiv IDs verified by fetching abs pages. Sizes are rough estimates (unverified).

## Repos
- https://github.com/anthropics/anthropic-sdk-python | official Claude SDK: tool use, streaming, our default LLM client | 1 | small (pip package)
- https://github.com/vercel/ai | AI SDK 6: ToolLoopAgent + useChat typed tool parts; best all-TypeScript option | 1 | large monorepo, use as dependency
- https://github.com/pydantic/pydantic-ai | typed tools and validated structured outputs in Python; alternative to a hand-rolled loop | 1 | medium
- https://github.com/networkx/networkx | graph algorithms (shortest path, constrained routing) that the LLM must delegate to | 1 | medium (library)
- https://github.com/pmndrs/react-three-fiber | React renderer for Three.js; the 3D scene and map_action highlights | 1 | medium
- https://github.com/promptfoo/promptfoo | YAML eval and regression harness with custom assertions and CI; recommended eval tool | 1 | medium
- https://github.com/modelcontextprotocol/modelcontextprotocol | MCP spec (2026-07-28) and schema; stretch goal to expose tools to staff clients | 2 | medium (spec repo)
- https://github.com/UKGovernmentBEIS/inspect_ai | Inspect AI: tools/agents/scorers eval framework if we want rigorous agent evals | 2 | large
- https://github.com/confident-ai/deepeval | pytest-style LLM metrics (faithfulness, hallucination, G-Eval) | 2 | large
- https://github.com/explodinggradients/ragas | RAG metric vocabulary (faithfulness, context precision); reference only | 3 | medium
- https://github.com/openai/openai-agents-python | OpenAI Agents SDK if swapping providers | 3 | medium
- https://github.com/langchain-ai/langgraph | stateful agent graphs; considered and rejected as overkill | 3 | large
- https://github.com/run-llama/llama_index | RAG/data framework; only if free-text notices retrieval is added | 3 | large
- https://github.com/HKUDS/LightRAG | LightRAG reference implementation; considered, not needed for a curated graph | 3 | medium
- https://github.com/microsoft/graphrag | GraphRAG reference implementation; same reasoning | 3 | large
- https://github.com/aisingapore/sealion | SEA-LION open SEA-language models; multilingual baseline/comparison | 3 | small repo (models on Hugging Face are large)

## Papers
- MapEval: A Map-Based Evaluation of Geo-Spatial Reasoning in Foundation Models | 2025 | arXiv 2501.00316 (https://arxiv.org/abs/2501.00316) | LLMs and map-tool agents fail at distance, direction and routing; argues for delegating | 1
- TurnBack: A Geospatial Route Cognition Benchmark for Large Language Models through Reverse Route | 2025 | arXiv 2509.18173 (https://arxiv.org/abs/2509.18173) | confident wrong route generation (EMNLP 2025) | 2
- Lost in Aggregation: A Multi-Scale Diagnostic Benchmark for LLM Spatial Navigation | 2026 | arXiv 2606.22219 (https://arxiv.org/abs/2606.22219) | deterministic walker + LLM at junctions raises success; supports tool delegation | 1
- GraphArena: Evaluating and Exploring Large Language Models on Graph Computation | 2024 (ICLR 2025) | arXiv 2407.00379 (https://arxiv.org/abs/2407.00379) | LLMs hallucinate on larger graph problems | 2
- FloorplanQA: A Benchmark for Spatial Reasoning in LLMs using Structured Representations | 2025 | arXiv 2507.07644 (https://arxiv.org/abs/2507.07644) | indoor structured-layout reasoning limits | 2
- 3D-LLM: Injecting the 3D World into Large Language Models | 2023 | arXiv 2307.12981 (https://arxiv.org/abs/2307.12981) | 3D-aware LLM background | 3
- An Embodied Generalist Agent in 3D World (LEO) | 2023 | arXiv 2311.12871 (https://arxiv.org/abs/2311.12871) | embodied 3D agent background | 3
- SpatialVLM: Endowing Vision-Language Models with Spatial Reasoning Capabilities | 2024 | arXiv 2401.12168 (https://arxiv.org/abs/2401.12168) | VLM metric spatial QA; why not a fact source | 3
- SpatialRGPT: Grounded Spatial Reasoning in Vision Language Models | 2024 | arXiv 2406.01584 (https://arxiv.org/abs/2406.01584) | region-grounded spatial VLM | 3
- Relying on the Unreliable: The Impact of Language Models' Reluctance to Express Uncertainty | 2024 | arXiv 2401.06730 (https://arxiv.org/abs/2401.06730) | HCI evidence for explicit uncertainty in answers | 1
- tau-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains | 2024 | arXiv 2406.12045 (https://arxiv.org/abs/2406.12045) | model for end-state and tool-call evaluation | 2
- Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena | 2023 | arXiv 2306.05685 (https://arxiv.org/abs/2306.05685) | judge biases to mitigate | 1
- Ragas: Automated Evaluation of Retrieval Augmented Generation | 2023 | arXiv 2309.15217 (https://arxiv.org/abs/2309.15217) | faithfulness / context metrics vocabulary | 2
- From Local to Global: A Graph RAG Approach to Query-Focused Summarization | 2024 | arXiv 2404.16130 (https://arxiv.org/abs/2404.16130) | GraphRAG; why it is not needed here | 3
- LightRAG: Simple and Fast Retrieval-Augmented Generation | 2024 | arXiv 2410.05779 (https://arxiv.org/abs/2410.05779) | lightweight graph RAG; same | 3
- SEA-HELM: Southeast Asian Holistic Evaluation of Language Models | 2025 | arXiv 2502.14301 (https://arxiv.org/abs/2502.14301) | Malay/Tamil/Chinese eval reference | 2
- ReAct: Synergizing Reasoning and Acting in Language Models | 2022 | arXiv 2210.03629 (https://arxiv.org/abs/2210.03629) | foundation of the tool loop | 3
