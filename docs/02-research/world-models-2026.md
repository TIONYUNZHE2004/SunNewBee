# World models in 2026, and a real one for the township

Research brief for the `ai/world-model` branch, 16 Oct 2026. It answers four questions:

- what a world model actually is;
- how LLMs work as or with one;
- what we can honestly build in the days before the 11 Nov final;
- which features win judges.

The raw material is in `reference/`:

- 30 PDFs in `reference/papers/world-models/`;
- 4 shallow clones in `reference/repos/world-models/`;
- four source notes, each tagging every claim as read, abstract-only or from memory:
  - [world-models-ml.md](../../reference/notes/world-models-ml.md)
  - [world-models-llm.md](../../reference/notes/world-models-llm.md)
  - [world-models-urban.md](../../reference/notes/world-models-urban.md)
  - [world-models-repos.md](../../reference/notes/world-models-repos.md)

Check the PDF before you put any number on a slide.

## TL;DR

1. **A world model is a functional thing, not a neural network.** It has a state, actions, a transition function that predicts the next state, and imagined rollouts that a planner uses to choose actions without trying them in the real world. Learned latent models (Dreamer, MuZero, V-JEPA 2-AC) and video simulators (Genie 3, Cosmos) are one family. **Explicit, executable models are another, mainstream family:**
   - AlphaZero's rules;
   - physics engines;
   - GraphCast-style structured simulators;
   - DeepMind's 2025 *Code World Models*, where MCTS runs over LLM-written Python.
2. **The LLM should not be the simulator.** GPT-4 predicts full text-world state transitions with only about 59% accuracy (ByteSized32-State-Prediction, 2406.06485). Agents given a world-model tool call it under 1% of the time and misread it about 15% of the time (2601.03905). The pattern that works is **"the LLM proposes, the world model disposes"**: LLM+P, LLM-MCTS, FunSearch/AlphaEvolve, WebDreamer, Code World Models.
3. **TownshipLens already has most of an explicit world model** but presents it as lookups. Pieces in place:
   - a state: graph, tri-state claims, flood stage, closures;
   - an exact evaluator;
   - stage scenarios;
   - a journey simulator that flips claims on copies.

   Missing: first-class **actions**, a **`step()`** transition, **rollouts over populations**, a **belief over unknowns**, and a **planner** the LLM can drive.
4. **Recommendation:** build the **Township World Model (TWM)**.
   - An explicit, partially observed, deterministic transition model with a closed vocabulary of actions.
   - An honest **belief layer** over UNKNOWN facts, which is the one *learned* part: calibrated from real OpenStreetMap and DEM data, and updated by every ticket staff resolve.
   - **Planners** on top: what-if rollouts, a value-of-information "verify next" planner, and an LLM-proposed intervention search.
   - **Visible rollouts** on the 3D map.
5. **The ranked shortlist** (section 6) leads with:
   - **What-if Lab**: counterfactual rollouts and a 3D diff;
   - **Verify-next planner**: expected journeys unlocked per survey hour;
   - **Rising-river population rollout**: synthetic residents by persona, animated, labelled "simulation, not a forecast";
   - **Fix-it planner**: the LLM proposes interventions, beam search scores them.

## 1. What a world model is

Formal skeleton, in POMDP form (from [world-models-ml.md §1](../../reference/notes/world-models-ml.md)):

| Element | Meaning | Learned systems | TownshipLens |
|---|---|---|---|
| state s / belief b(s) | what is true now, or a distribution over it | RSSM latent, JEPA embedding | walk graph + per-edge claims (`unknown/reported/verified/stale/contested`), flood stage, closures |
| action a | an intervention the agent can choose | motor command, latent action | raise river to stage k, close a path, add a ramp, verify a fact, move residents |
| transition T(s, a) → s' | predicts the next state | neural dynamics | `evaluate.py` + stage operator (only adds FAIL/UNKNOWN), claim overlay |
| observation / decoder | renders the state | pixel decoder | Cesium / Mapbox / List renderers, answer text |
| reward / value | what is good | learned heads | journeys confirmed per profile, centres reachable, gaps resolved |
| rollout | simulate H steps, no real-world interaction | imagination (Dreamer) | journey suites, stage sweeps, population runs |
| planner | chooses actions using the model | CEM-MPC, MCTS, actor-critic | VOI greedy, beam search over interventions, LLM as proposer |

Three distinctions we use in the pitch:

- **State vs rendering.** The world model is the state and its dynamics. Our 3D city is one *view* of it. A 2026 benchmark finds video world models lack persistent state: events stop advancing when the camera looks away (WRBench, 2606.20545). Ours is stored and versioned, and never changes when you rotate the camera.
- **Predict only what decisions need.** MuZero's lesson is that the model must predict decision-relevant quantities (reward, value, policy), not pixels. Ours predicts route status and reachability per mobility profile.
- **Engineered vs learned dynamics.** The Dreamer/MuZero/LeCun camp would call our transition a simulator rather than a learned world model. We claim the *functional* definition (state, transition, rollouts, planning) and say plainly that the dynamics are engineered. The **belief** over unknown facts is where learning happens (section 4).

Where we sit in the 2026 taxonomy ([world-models-ml.md §3](../../reference/notes/world-models-ml.md)):

- **Learned latent:** Dreamer 4, V-JEPA 2-AC.
- **Video / renderer:** Genie 3, Cosmos. Kang et al. (2411.02385) show they fit cases rather than abstract laws.
- **Code world models:** WorldCoder, GIF-MCTS, Code World Models.
- **Explicit / structured:** AlphaZero, GraphCast-like simulators. **TownshipLens is here.** The transition is hand-written, tested code. The LLM is the interface, acting as proposer and narrator.

The July 2026 roadmap paper (2607.06401) defines world models as "compression modeling of state transitions" and explicitly counts bounded systems with explicit participants, rules and intervention spaces, which describes a township.

## 2. LLMs as, and with, world models

What the evidence says ([world-models-llm.md](../../reference/notes/world-models-llm.md)):

- **The LLM as simulator is unreliable.**
  - RAP plans by MCTS inside the LLM's imagined states, so nothing is verified.
  - ByteSized32 measures the cost: about 59% state-prediction accuracy, worse on arithmetic and environment-driven changes.
  - For us, an LLM-predicted flood or route is exactly the hallucination our honesty rules forbid.
- **LLM proposes, exact model disposes.** Successful precedents:
  - **LLM+P**: natural language → PDDL → classical planner → narration. This is our architecture today.
  - **LLM-MCTS**: the LLM gives a prior over actions and a real simulator gives values.
  - **FunSearch / AlphaEvolve**: the LLM writes programs and an exact evaluator scores them.
  - **WebDreamer**: propose k actions, simulate each, execute the best, replan.
  - **Code World Models** (DeepMind, 2510.04542): an LLM writes the game as Python and MCTS searches over the code. It matches or beats Gemini 2.5 Pro in 9 of 10 games, and illegal moves become impossible by construction.
- **Agents skip tools they may skip.** 2601.03905 gave agents a world model as a tool and found them failing to use it (under 1% call rate, about 15% misinterpretation). The **simulate step must be forced and its numbers checked**, the same way `final_answer` is forced and `validate.py` checks it.
- **Selective foresight.** WorldEvolver (2606.30639) drops low-confidence predictions before they reach the agent. That is our tri-state: outcomes resting on UNKNOWN claims are flagged, never ranked as fact.
- **Replay regression.** WorldCoder and GIF-MCTS validate code models against logged transitions. Our resolved tickets are exactly that dataset: claim X resolved to Y. Any change to the evaluator must reproduce them.

## 3. Urban LLMs: what judges have seen, and what is new

From [world-models-urban.md §2](../../reference/notes/world-models-urban.md).

**Seen before, so we don't lead with these:**

- a chat box that flies a map to a place;
- thousands of generative-agent dots (AgentSociety, OpenCity, CitySim);
- an LLM "predicting" flood risk or depth;
- fine-tuned city models (CityGPT, UrbanLLM);
- a flood slider with a confident "safe zone" legend.

**Novel for a township developer:**

- **gaps as first-class results;**
- **a verification loop that closes:** a resident question files a ticket, staff resolve it, and the same answer changes;
- **ranking the field survey by value** ("these 6 facts unlock 40% of stroller journeys"), which turns data work into a budget decision;
- **honest scenarios;**
- **an engine plus a validator-gated LLM.** The Sep 2026 LLM evacuation paper (2609.37009) independently converges on this split: an LLM for behaviour, a validation engine for physical feasibility.

## 4. The Township World Model (TWM): design

```
              ┌──────────── LLM (planner + narrator) ────────────┐
 resident /   │ proposes typed Actions / questions; narrates only│
 staff  ───▶  │ TurnRecord facts; validate.py gates every number │
              └───────▲──────────────────────────────┬───────────┘
                      │ Outcomes (diffs, counts,     │ Actions (closed vocabulary,
                      │ evidence ids)                ▼ ids must exist)
 ┌───────────────────────────── Township World Model ─────────────────────────────┐
 │ State s = (graph, claims+status+age, flood stage, closures, population)        │
 │ Belief b(u) for each UNKNOWN fact u: P(PASS) from OSM/DEM calibration + tickets│
 │ step(s, a) → s'   (copy-on-write overlay; never mutates the live world)        │
 │ rollout(s, [a…], journeys | population) → Outcome (status per profile, diff)   │
 │ planners: what-if · verify-next (VOI) · fix-it (beam) · tipping point (stages) │
 └────────────────────────────────────────────────────────────────────────────────┘
                      │ state + diffs                ▲ ticket outcomes = observations
                      ▼                              │ (belief update, replay tests)
            3D map (rollouts, diff overlay)    /tickets (verify-next board)
```

- **Actions** form a closed vocabulary validated against the world:
  - `RaiseRiver(stage)`, `ClosePath(edge, until)`, `ReopenPath(edge)`;
  - `AssumeFact(edge, attr, value)`, which is hypothetical and labelled "what-if";
  - `AddRamp(edge)` / `MakeStepFree(edge)`, as a hypothetical capital works;
  - `VerifyFact(edge, attr, outcome)`, which is a real observation when staff resolve a ticket and simulated inside the planners.

  Inventing an id fails validation, as the "legal moves" idea from Code World Models requires.
- **Transition.** `step` is a pure function on a copy-on-write overlay of claims and closures. The `sim.py` flip logic already does this. Its rules come from the honesty invariants:
  - a scenario only adds FAIL or UNKNOWN;
  - a hypothetical PASS is tagged `sim_hypothetical`;
  - a hypothetical PASS can produce "would be confirmed if built/verified", never "confirmed";
  - nothing is ever persisted.
- **Rollouts.**
  - **Journey suites:** the existing `run_suite` / `run_evacuation`, generalised over action sequences.
  - **Population rollouts:** synthetic residents by persona, with seeded origins and profile speed bands, moving along engine-computed routes as the river stage rises. They report reach and time ranges and render as animated agents.
- **Belief, the learned part, kept honest.**
  - Each UNKNOWN fact gets P(PASS) for the profile thresholds.
  - The prior is calibrated on **real** labelled data: OSM-tagged ways in the wider Klang Valley (incline, kerb, surface, width, wheelchair) plus Copernicus DEM slope along each edge.
  - It is updated by **Beta-Bernoulli counts from resolved tickets**, so the model visibly learns as staff verify.
  - It is used **only for planning** (which fact to verify first, expected unlocks) and never to mark a path PASS or to tell residents a probability.
  - If calibration data turns out too sparse, we fall back to transparent per-attribute priors in config and say so. A learned component that isn't real would break the brand.
- **Planners.**
  - **What-if:** apply actions, roll out, diff.
  - **Verify-next:** greedy myopic VOI, from [world-models-urban.md §5](../../reference/notes/world-models-urban.md). Score_u = q_u · Gain_u / cost_u, where Gain_u is the number of journeys u alone would move from partly unverified to confirmed. EVSI variant by Monte Carlo over the belief when routes overlap. Greedy is justified because optimal sequential probing is PSPACE-complete (Canadian Traveller variants, 1207.4710). Submodularity is *not* claimed.
  - **Fix-it:** the LLM proposes candidate interventions as a shortlist prior, LLM-MCTS style. The engine runs beam search over sets (llm-reasoners `beam_search` structure). Shortlist regret against exhaustive search is reported offline.
  - **Tipping point:** sweep `baseline → stage_p5m` and report the first stage where a route breaks.
- **Agent contract.**
  - New tools: `simulate_what_if`, `plan_verifications`, `find_fixes`, `river_tipping_point`, `run_population`.
  - The validator checks every number in the narration against the Outcome in `TurnRecord`.
  - Comparative words ("best", "most") are allowed only when a rank field exists.
  - The mock and template produce the same shapes, so validator, mock and template still change together.
- **Exposure.** The TWM tools are also served over **MCP** (fastmcp; PydanticAI can consume the same server in-process). Any agent, including Claude Desktop, can then query the township. This is cheap and impresses technical judges.

## 5. What is feasible before the 8 Nov feature freeze

| Week | Work |
|---|---|
| 16–18 Oct (Cycle 0) | Live-model path solid: prompt caching, fact-free repair, answer-first rendering, streamed drafts with a visible validator trace; this brief. |
| 19–24 Oct | TWM core (Actions, `step`, rollout, diff) + What-if tool + multi-turn memory + 3D diff overlay. |
| 25–31 Oct | Verify-next planner with belief layer (config priors first, calibration second) + `/tickets` board + ticket-driven belief updates. |
| 1–5 Nov | Population rollout + Cesium animation; fix-it planner (beam search, LLM shortlist). |
| 6–8 Nov | MCP server, evals (faithfulness, planner regret, latency, live spend), pitch numbers. BM/中文 if time allows. |

## 6. Ranked feature shortlist

Scores are 1–5. Judge impact weighs the People track and Sime Darby Property's interests (resident inclusion, ops cost, liability).

| # | Feature | Judge impact | Feasibility | Why it wins | Main honesty risk |
|---|---|---|---|---|---|
| 1 | **What-if Lab**: "If the river rises 3 m *and* we add a ramp at X, how many wheelchair users can still reach a centre?" Counterfactual rollouts with a before/after 3D diff | 5 | 4 | Makes "world model" literal and visible; works in chat and on the map; developers think in interventions | Hypotheticals leaking into facts: overlay never persisted, every line says "what-if" |
| 2 | **Verify-next planner** (VOI): "Which 5 facts should staff verify first?" Expected journeys unlocked per survey hour, on `/tickets` | 5 | 4 | Unique; turns honesty gaps into an ROI-ranked survey plan; closes the ticket loop | Priors are assumptions: staff-only, labelled "planning estimate" |
| 3 | **Rising-river population rollout**: synthetic residents by persona evacuating as stages rise, animated on 3D, with reach and time *ranges* | 5 | 3 | Biggest visual moment; still exact (engine routes), not LLM dots | Reads as a forecast: persistent "simulation, not a forecast · no crowding/departure model" banner, no depths |
| 4 | **Fix-it planner**: the LLM proposes interventions, beam search scores sets, the agent explains "the 3 cheapest fixes that give stroller users a confirmed route to Lakeside" | 4 | 3 | The cleanest "LLM proposes, world model disposes" demo; cites Code World Models / LLM-MCTS | Costs are rough: shown as unit counts, not ringgit |
| 5 | **Learned belief** (OSM + DEM calibration, ticket-driven updates): "the model gets smarter every time staff verify" | 4 | 2–3 | Answers "is anything learned?"; real data only | Sparse labels: fall back to config priors and say so |
| 6 | **Answer-first streaming with a visible validator trace**: draft → "sent back: …" → "✓ checked" | 4 | 5 (done in Cycle 0) | Shows the honesty gate working live | Drafts are provisional: guarded and replaced |
| 7 | **Multi-turn memory** ("and if it rises another metre?") | 3 | 4 | Needed for natural what-if conversations | PDPA: no user words in VRs; history in memory only |
| 8 | **MCP server for the TWM** | 3 | 5 | "Any agent can plug into the township"; cheap | None beyond existing tools |
| 9 | **Tipping-point scrub**: "at which river stage does my route break?" | 3 | 5 | Strong single-sentence answer, reuses stages | Stage labels only, never a depth or probability |
| 10 | BM / 中文 answers + voice | 3 | 3 | Inclusion story for Malaysia | Validator regexes must cover BM/中文 wording |

**Build order:** 6 (done) → 1 + 7 → 2 → 3 → 4 → 5 → 8 → 9 → 10. Re-rank after each cycle.

## 7. Risks

- **Hype risk.** Calling an engineered simulator a "world model" invites a sceptical ML judge. Mitigation: the pitch lines in §8, the taxonomy slide, and the honest counter-position.
- **Forecast creep.** Animated evacuees look like predictions. Mitigation: persistent labels, ranges, no departure or crowding model, never "safe", never depths. The validator checks rollout narration.
- **Planner exploits unknowns** (Ha & Schmidhuber's model-exploitation). Mitigation: a hypothetical PASS never yields "confirmed"; a test asserts that any planner output touching UNKNOWN edges is labelled.
- **LLM skips the simulator** (2601.03905). Mitigation: what-if questions route through forced tools; the validator rejects intervention talk without a matching Outcome.
- **Live latency and cost.** Measured in Cycle 0: Haiku 5.5 costs about US$0.003 per turn, but first text took 12–18 s before drafts. Mitigation: prompt caching, parallel find_place, drafts streamed early, demo cache for the pitch.
- **Data truth.** All 18 hero facts are `team_survey_placeholder` until the field survey. Every metric shows the engine is *consistent* and the narration *faithful*, not that the township matches reality. Say so on the slide.
- **Frontend ownership.** shaoxian04 owns `apps/web`. New UI ships as self-contained panels with integration notes in the cycle log.

## 8. Pitch language (technically defensible)

1. "TownshipLens is an explicit world model of City of Elmina. It has a stored graph state with evidence status on every path, a deterministic transition rule, and simulated resident journeys. It is not a video generator, and not a neural network guessing at the township."
2. "We use the functional definition from model-based planning: state, transition, rollouts, planner. The language model proposes and explains. The world model, not the language model, computes every route, count and flood class, and a validator rejects any answer that disagrees with it."
3. "Our dynamics are engineered, not learned. What we learn is our *uncertainty*: which unverified facts are likely to hold, from OpenStreetMap and elevation data, updated every time staff verify a ticket. We use that only to decide what to check next."
4. "Unknowns stay unknown. Routes over unverified paths are 'partly unverified', missing data is a 'data gap', and our flood stages are indicative scenarios, not forecasts or water depths."
5. "Because the state is explicit, it persists. Rotate the camera and nothing changes. Resolve a ticket and every answer that depended on it changes."

## Sources

PDFs are in `reference/papers/world-models/` (list and URLs in `reference/download-papers.sh`). Repos are in `reference/repos/world-models/` (mesa, mesa-geo, llm-reasoners, fastmcp; `reference/clone-repos.sh`). Key papers:

- Ha & Schmidhuber 1803.10122; MuZero 1911.08265; DreamerV3 2301.04104; Dreamer 4 2509.24527; V-JEPA 2 2506.09985; Cosmos 2501.03575.
- Kang et al. 2411.02385; WRBench 2606.20545; World-model definition and roadmap 2607.06401.
- RAP 2305.14992; LLM-MCTS 2305.14078; LLM+P 2304.11477; WorldCoder 2402.12275; GIF-MCTS 2405.15383; ByteSized32-SP 2406.06485; WebDreamer 2411.06559; Code World Models 2510.04542; world model as tool 2601.03905; WorldEvolver 2606.30639; text world models survey 2606.09032.
- CityGPT 2406.13948; UrbanLLM 2406.12360; CityBench 2406.13945; urban LLM agents survey 2507.00914; AgentSociety 2502.08691; CitySim 2506.21805; OpenCity 2410.21286; LLM evacuation with a moving threat 2609.37009; flood pedestrian ABM 2004.10589; Canadian Traveller variants 1207.4710.
