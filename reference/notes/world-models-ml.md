# World models, from the ML side (2018 to 2026)

Research note for TownshipLens. Written 2026-10-16. Scope: what "world model" really means in the ML literature, what the main systems do, and what we can honestly claim for an explicit, deterministic township model with an LLM planner/narrator.

Source status: items marked **[read]** were downloaded to `reference/papers/world-models/` and at least the abstract/introduction was read (pdftotext or WebFetch). Items marked **[memory]** are from background knowledge and were not re-verified in this session; check before quoting numbers.

---

## 1. Definition: the formal elements

A world model is an internal model an agent uses to predict how the world changes, so it can evaluate actions without taking them. Craik (1943, "working models") is the usual ancestor; Sutton and Barto call it a "model" in model-based RL, and Dyna (Sutton 1990) is the classic recipe. **[memory]**

Formal skeleton (POMDP view; the 2026 Shanghai AI Lab perspective paper also frames locality as a POMDP **[read: 2607.06401]**):

| Element | Symbol | Meaning | Learned systems | TownshipLens counterpart |
|---|---|---|---|---|
| Observation | o_t | what the agent senses (pixels, text, tool output) | frames | ticket outcomes, OSM/DEM data, survey claims |
| Latent / belief state | s_t = f(o_<=t, a_<t) | compact sufficient statistic of history; may be stochastic | RSSM (h_t, z_t), VAE code | explicit: graph + per-edge claim status (unknown/reported/verified/stale/contested) |
| Action | a_t | agent or intervention input | motor commands, latent actions | route choice, scenario stage, "verify claim X" |
| Transition / dynamics | p(s_{t+1} \| s_t, a_t) | one-step prediction, may be stochastic | RNN/transformer/diffusion | `evaluate` + flood stage operator (only adds FAIL/UNKNOWN) |
| Observation / decoder | p(o_t \| s_t) | render the state | image decoder (optional) | map renderers, templated answer text |
| Reward / cost | r(s,a) or C(s) | what is good | learned reward head | journey success, reachability, count of unresolved gaps |
| Value | V(s) | expected return | critic | evacuation-reachable fraction per profile |
| Imagination rollout | s_{t+1..t+H} ~ model | simulate H steps with no env interaction | Dreamer imagination | `sim.py` journeys; stage sweeps +1..+5 m |
| Planner / policy | pi(a \| s), or argmax over sequences | choose actions using the model | actor-critic, CEM-MPC, MCTS | search over verification order; LLM proposes goals |

Three distinctions that matter for how we speak:

1. **State vs rendering.** A world model is the state and its dynamics. Pixels are one possible decoding of it. The 2026 perspective paper makes this point explicitly: one internal model can be decoded into RGB, state vectors, or action proposals. **[read: 2607.06401]**
2. **Understanding vs predicting.** Ding et al. (2024, arXiv 2411.14499, "Understanding World or Predicting Future?") split the field into models built to understand (representation) and to predict (rollout). **[memory; cited in 2607.06401, read]**
3. **Epistemic status of the model.** A learned model can be wrong in ways the agent cannot see. A hand-written model can be wrong too, but its assumptions are inspectable. Both need honest uncertainty.

Planning with a model comes in three standard forms: (a) MPC / shooting (sample action sequences, roll out, score, execute first action; CEM is the common sampler); (b) tree search (MCTS over model rollouts); (c) learning a policy/value inside imagined rollouts (Dreamer). **[memory]**

---

## 2. Papers

### 2.1 Ha and Schmidhuber, "World Models" (2018), arXiv 1803.10122 **[read: downloaded; details from memory]**
- Three parts: V (VAE compresses frame to z), M (MDN-RNN predicts next z, stochastic), C (tiny linear controller trained with CMA-ES on [z, h]).
- Policy can be trained entirely inside the "dream" of M and transferred to the real environment (VizDoom).
- Temperature parameter on M's sampling: more uncertainty in the dream makes the agent harder to fool.
- Observed failure mode: the controller exploits imperfections of the learned model (adversarial "dream" policies). The authors add noise to counter it.
- Mechanism: compress, then predict in latent space, then search in imagination.
- Relevance to TownshipLens: the "model exploitation" warning applies to any simulator. Our sim ranks data gaps by flipping claims; an optimizer over a model with UNKNOWN edges will happily route through them. We must keep UNKNOWN tri-state and never let the search treat UNKNOWN as PASS. Also: V/M/C separation is a clean architecture template (data to state, state transition, controller).

### 2.2 PlaNet (Hafner et al., 2018/19), arXiv 1811.04551 **[memory; not downloaded]**
- Introduces the RSSM: latent state split into a deterministic recurrent part h_t and a stochastic part z_t.
- Plans online by CEM-style MPC in latent space; no separate policy network.
- Trained with a variational objective including multi-step latent overlap (so long rollouts stay consistent).
- Relevance: the "deterministic carrier + stochastic part" split maps to our deterministic graph (carrier) plus explicit unknowns (the part we do not know). RSSM puts the uncertainty into z; we put it into claim status.

### 2.3 Dreamer line: V1/V2/V3, Dreamer 4

**DreamerV3 (Hafner et al., 2023; Nature 2025), arXiv 2301.04104 [read: downloaded; details from memory]**
- RSSM world model + actor-critic trained purely on imagined latent rollouts.
- One fixed hyperparameter set across 150+ tasks; robustness tricks: symlog transforms, free bits, return normalisation by percentiles.
- First algorithm to collect diamonds in Minecraft from scratch without human data.
- Mechanism: learn dynamics, imagine, learn behaviour in imagination.
- Relevance: the *loop* (model, imagine, evaluate, improve) is what we copy, not the neural nets. Our "behaviour" is a verification schedule, not a policy; our imagination is an exact graph computation. Their robustness tricks have no analogue needed for us, but "one fixed configuration across tasks" is a good discipline for profiles.

**DreamerV2 (2020, arXiv 2010.02193)** [memory]: discrete categorical latents; human-level Atari from a learned model.

**Dreamer 4, "Training Agents Inside of Scalable World Models" (Hafner, Yan, Lillicrap, Sept 2025), arXiv 2509.24527 [read: abstract confirmed by search; downloaded]**
- Agent learns behaviour entirely inside a learned world model; first to obtain diamonds in Minecraft from offline data only, from raw pixels, with sequences of over 20,000 mouse/keyboard actions.
- Tokenizer + action-conditioned dynamics model in one efficient transformer; "shortcut forcing" objective for real-time inference on one GPU.
- Training stages: pretrain on video, add actions, then finetune policy/reward heads inside the model and post-train in imagination.
- Relevance: shows that an *action-conditioned* model learned from mostly unlabeled data can support planning. For us the analogue is that actions (verifications) change the state, so the model must be action-conditioned, not a passive scenario viewer.

### 2.4 MuZero (Schrittwieser et al., 2019/2020), arXiv 1911.08265 **[read: downloaded; details from memory]**
- Learns a model that predicts only what planning needs: reward, policy, value. It does not reconstruct observations.
- Three functions: representation h(o) to hidden state, dynamics g(s,a) to (r, s'), prediction f(s) to (policy, value). MCTS runs in the hidden space.
- Matches AlphaZero on Go/chess/shogi without being given rules; state of the art on Atari.
- Key idea: "value-equivalent" models. A model is good if it supports correct decisions, not if it is photorealistic.
- Relevance: strongest argument that a world model is defined by *decision-relevant prediction*, not rendering. Our model predicts route status and reachability per profile, which is exactly the decision-relevant slice. Also AlphaZero (given rules) vs MuZero (learned rules) is the cleanest precedent that a hand-written, exact simulator plus search is a legitimate planning setup: AlphaZero's model is the game rules. **[memory]**

### 2.5 LeCun, JEPA, I-JEPA, V-JEPA, V-JEPA 2

**"A Path Towards Autonomous Machine Intelligence" (LeCun, June 2022, OpenReview, not on arXiv) [memory]**
- Architecture: perception, world model, cost module (intrinsic + critic), actor, short-term memory, configurator.
- Mode-2 reasoning = plan by minimising cost through the world model (MPC style); Mode-1 = amortised reactive policy.
- World model predicts in representation space, may be hierarchical, and must handle uncertainty via latent variables (JEPA).
- Relevance: gives us a vocabulary: cost module (honesty penalties, e.g. unverified edges), world model, actor (LLM proposes), configurator (profile). Nothing in this architecture requires the world model to be neural.

**I-JEPA (Assran et al., 2023), arXiv 2301.08243 [memory]**: predicts representations of masked image blocks from context blocks; no pixel reconstruction, no hand-crafted augmentations.

**V-JEPA (Bardes et al., 2024), arXiv 2404.08471 [memory]**: same idea for video; feature prediction as the sole objective.

**V-JEPA 2 (Assran et al., June 2025), arXiv 2506.09985 [read: downloaded]**
- Self-supervised pretraining on over a million hours of internet video, then a small action-conditioned predictor (V-JEPA 2-AC) trained on a few dozen hours of unlabeled robot data.
- Planning: sample action sequences (CEM), roll the predictor forward in latent space, minimise distance between predicted latent and goal-image latent; execute first action, replan (MPC). Zero-shot pick-and-place on real arms.
- Reports strong video understanding / prediction results; the paper positions latent planning as far cheaper than pixel-space generation.
- Relevance: the planning recipe (goal state, rollouts of candidate action sequences, score distance to goal, replan) transfers directly. Goal = "resident reaches centre X"; candidate actions = route/verification choices; distance = number of unresolved/failing edges.
- 2026 follow-up: AMI Labs (LeCun's startup) reportedly posted a "LeWorldModel" (Mar 2026) and a JEPA identifiability proof under Gaussian-latent assumptions (May 2026). Sources were secondary news, treat as unverified.

### 2.6 Genie family (DeepMind)
- **Genie (Bruce et al., 2024), arXiv 2402.15391 [memory]**: 11B parameter model trained on internet platformer videos with no action labels; learns a discrete *latent action* space; generates playable 2D worlds from an image.
- **Genie 2 (Dec 2024, blog) [memory]**: 3D action-controllable worlds, consistency of order 10 to 20 seconds.
- **Genie 3 (Aug 2025, blog; no technical report) [read via search: TechCrunch, Google blog]**: 24 fps, 720p, real-time interaction; consistency over a few minutes; "promptable world events"; DeepMind states it does not build an explicit 3D scene, each frame is generated autoregressively from prior frames and actions. Official limits: may not follow real-world physics, limited action space, short sessions (the product page cites 60 s). Project Genie opened to AI Ultra subscribers in the US on 2026-01-29.
- Relevance: the opposite design from ours. Their "state" is the frame history; ours is an explicit graph. Their consistency is memory-limited and drifts; ours is exact by construction but only covers what is mapped. Useful as a contrast slide and as a caution against calling our 3D view "the model".

### 2.7 NVIDIA Cosmos
- **Cosmos World Foundation Model Platform for Physical AI (Jan 2025), arXiv 2501.03575 [read: downloaded]**: platform with video curation, tokenizers, pretrained diffusion and autoregressive world foundation models, guardrails, and post-training for robotics/driving.
- **Cosmos-Predict2.5 / "World Simulation with Video Foundation Models for Physical AI" (Oct 2025, rev. Feb 2026), arXiv 2511.00062 [search result only]**: unified Text/Image/Video-to-World with flow matching, Cosmos-Reason1 as text encoder, 200M clips, RL post-training, 2B and 14B open models.
- **Cosmos 3: Omnimodal World Models for Physical AI (Jun 2026), arXiv 2606.02800 [read: abstract via WebFetch]**: one mixture-of-transformers handling language, image, video, audio and robot actions; unifies VLM, video generator, simulator and "world-action model"; open code and checkpoints.
- Relevance: these are *renderers/synthetic-data engines* aimed at training physical AI. We should not claim to compete; we can say our model is the opposite end, a small explicit simulator for a bounded place.

### 2.8 Sora-as-world-simulator and the critique
- OpenAI (Feb 2024, "Video generation models as world simulators") claimed scaling video models is a path to general-purpose simulators. **[memory]**
- **Kang et al., "How Far Is Video Generation from World Model: A Physical Law Perspective" (ICML 2025), arXiv 2411.02385 [read: downloaded, abstract read]**: tests video diffusion models on deterministic physics (e.g. collisions). Models generalise in-distribution but fail out-of-distribution; combinatorial generalisation improves with data, but models do "case-based" generalisation (mimic the nearest training example) rather than abstract the law; they prioritise colour over size/velocity/shape. Conclusion: scaling alone is not enough.
- **Lu et al., "Current World Models Lack a Persistent State Core" (June 2026), arXiv 2606.20545 [read: downloaded]**: WRBench, 9,600 videos from 23 models. Generators treat the scene as a "tracking shot": when the camera looks away and returns, the event did not advance. Scaling Wan 1.3B to 14B lowered re-observed state score 0.66 to 0.62. Argues the stability of an observation-independent *state kernel* should be a first-class objective.
- Also relevant (titles only): "A Mechanistic View on Video Generation as World Models: State and Dynamics" (arXiv 2601.17067); VideoPhy-2 (2503.06800); WorldModelBench (2502.20694). **[search only]**
- Relevance: both critiques are our core pitch. An explicit state that persists in SQLite and evolves independent of what the user is looking at is precisely the "persistent state core". We should quote these as the reason we keep state explicit.

### 2.9 Definition papers and surveys (2025 to 2026)
- **"A Definition and Roadmap for World Models" (Shanghai AI Lab Physical Intelligence Team, Jul 2026), arXiv 2607.06401 [read: downloaded, sections 1 to 2 read]**:
  - Definition 2.1: "a compression modeling of the state transition processes of the physical world, constructed under the constraints of finite computational resources". Properties: omnimodal, multidimensional asynchronicity, locality (POMDP).
  - Argues understanding should be primary and prediction in service of it; generation is downstream of a good compressed representation.
  - Reports a functional taxonomy attributed to Fei-Fei Li (2026): *renderers* (pixels), *simulators* (state transitions), *planners* (actions). Also a two-dimensional taxonomy (function by architecture) and a section on extending world models beyond physical environments (science; bounded social systems with explicit participants, rules, observation channels, intervention spaces).
  - Classes GraphCast-style learned weather models as "structured scientific simulators", not agentic world models, because they do not choose interventions or close the loop. That is the loop we do close (ticket outcome updates state, next question is chosen).
- **"A Comprehensive Survey on World Models for Embodied AI" (Oct 2025), arXiv 2510.16732 [search only]**: taxonomy of embodied world models (latent, video, decision-coupled).
- **"World Models: A Comprehensive Survey of Architectures, Methodologies, Reasoning Paradigms, and Applications" (2026), arXiv 2606.00133; "World Models for Embodied Intelligence: From Plausible to Controllable to Actionable" (2026), arXiv 2609.16697; "From Generation to Simulation: How Far Are World Models from Being True Simulators?" (2026), arXiv 2608.23070 [titles only from search; not opened]**.
- Relevance: use 2607.06401 as the citable taxonomy. The phrase "plausible, controllable, actionable" is a useful ladder; our model targets *actionable but narrow*.

### 2.10 Code world models (explicit models written by LLMs)
- **"Code World Models for General Game Playing" (Lehrach et al., Google DeepMind, Oct 2025), arXiv 2510.04542 [read: downloaded, abstract read]**: LLM translates rules and trajectories into an executable Python world model (state transition, legal moves, termination, plus value heuristics and hidden-state inference) used as the simulator inside MCTS. Claimed advantages: verifiability, strategic depth from classical search, generalisation via data-to-code translation. Evaluated on 10 games, 4 new.
- Related **[search only]**: WorldCoder (Tang et al. 2024, arXiv 2402.12275), GIF-MCTS, CASSANDRA (2601.18620, stochastic code world models), "Generating Symbolic World Models via Test-time Scaling of LLMs" (2502.04728, PDDL), "From Next Token Prediction to (STRIPS) World Models" (2509.13389). **[memory]** Guan et al. 2023 (LLM + PDDL planning) and Hao et al. 2023 RAP, "Reasoning with Language Model is Planning with World Model" (arXiv 2305.14992).
- Relevance: the closest precedent for our architecture: explicit executable model + classical search + LLM for language and proposals. Difference: our transition code is human-written and tested, not synthesised at runtime. If we ever let the LLM propose new rules, they should go through the same verification-request path as facts.

---

## 3. Taxonomy: where an explicit deterministic simulator sits

| Family | State | Dynamics | Strength | Weakness | Examples |
|---|---|---|---|---|---|
| Learned latent | compressed vector (RSSM, JEPA latent) | neural net trained on interaction/video | handles raw sensors, scalable | opaque, compounding error, exploitable | World Models, PlaNet, Dreamer, MuZero, V-JEPA 2-AC |
| Video / observation-level simulators (renderers) | frame history (implicit) | diffusion/autoregressive video | photorealistic, interactive | no persistent state, weak physics, drift | Sora, Genie 1 to 3, Cosmos, WRBench-tested models |
| Explicit / symbolic / structured | typed objects, graphs, rules | hand-written equations, rules, search | exact, auditable, composable, cheap | only covers what is modelled; engineering cost | AlphaZero's rules, physics engines, GraphCast-like structured simulators, our township model |
| Code world models | executable program | LLM-synthesised code | explicit and learnable from text/data | correctness depends on synthesis; verification needed | WorldCoder, CWM for games |
| Hybrids | explicit state + learned parts | mixed | best of both | complexity | Cosmos 3 world-action models (learned), neuro-symbolic planners |

**Where TownshipLens sits.** Explicit/structured, deterministic, partially observable. The state is a walk graph with per-edge claim status. The transition is a hand-written operator (profile evaluation; flood stage addition of FAIL/UNKNOWN). Rollouts are exact computations. The LLM is not the model; it is the interface (planner proposal, narrator).

**Who says explicit/structured models count.**
- **Craik 1943 and Sutton and Barto.** The model in model-based RL is any predictor of next state/reward; the learned-ness is not part of the definition. **[memory]**
- **AlphaZero (Silver et al. 2018).** Planning with a *given* exact simulator is the baseline that MuZero then relaxes by learning the rules. Search over a known model is mainstream. **[memory]**
- **Battaglia, Hamrick, Tenenbaum (PNAS 2013), "Simulation as an engine of physical scene understanding"; Lake et al. (BBS 2017), "Building machines that learn and think like people".** Argue human intuitive physics is an approximate structured simulator with uncertainty, and that machines need compositional causal models. **[memory]**
- **LeCun 2022.** World model is a module that predicts the next state of a representation; does not mandate pixels or neural dynamics, but argues for learning it. **[memory]**
- **Shanghai AI Lab 2026 (2607.06401) [read].** Counts GraphCast-style structured scientific simulators as part of the taxonomy; extends world models to bounded systems with explicit participants, rules and intervention spaces; defines roles (renderer / simulator / planner).
- **Code world models (DeepMind 2025) [read].** Explicitly argue for verifiable executable models paired with classical planners.
- **Kang et al. 2025 and Lu et al. 2026 [read].** Provide evidence that purely learned video models fail at persistent state and law abstraction, motivating explicit state.

Honest counter-position: LeCun and the Dreamer/MuZero community would say our model "does not learn", so it is a simulator, not the object that "world model" usually names in deep learning. The defensible answer is that we claim the *functional* definition (explicit state, transition, rollouts, planning), and are explicit that the dynamics are engineered.

---

## 4. Ideas we can borrow (concrete)

1. **Explicit state tuple.** Make `WorldState = (graph, claims with status and age, scenario stage, ticket queue)` a first-class type. Transition `step(state, action) -> state'` where action is one of: set flood stage, resolve verification request, mark claim stale. Keeps "state + transition + rollout" literal.
2. **Rollouts as batched `step` calls, with intervals not probabilities.** For UNKNOWN edges evaluate two bounding worlds (all-UNKNOWN-pass, all-UNKNOWN-fail). Report best/worst case. Do **not** invent a probability unless a prior is measured. (MuZero lesson: model what the decision needs; Ha lesson: do not let the planner exploit unknowns.)
3. **MPC for verification order.** Candidate action sequences = which claims staff verify next; score = increase in confirmed routes / evacuation reach per profile. Replan after each ticket resolution (V-JEPA 2-AC style CEM/MPC; the search space is small enough for exhaustive or greedy).
4. **Goal-conditioned scoring.** V-JEPA 2-AC minimises distance to a goal latent. Ours: distance to goal = number of non-PASS edges on the best path to the goal place.
5. **Persistent, observation-independent state (WRBench).** Store state in SQLite, advance it by explicit events, test that it does not change when the camera moves or the view switches (List vs 3D). A unit test "render does not mutate state" is cheap.
6. **No compounding error.** Because stages are precomputed and `evaluate` is exact, rollouts do not drift. Keep it that way; if we chain stages in time, label each step as a scenario, not a forecast.
7. **LLM as proposer, code as judge.** Code World Models show the same split: LLM proposes goals/hypotheses (e.g. "which gap matters before the monsoon?"), deterministic code scores them, validator gates the narration.
8. **Model-exploitation guardrail.** Add a test that any planner output touching UNKNOWN edges is labelled `partly_unverified`.

---

## 5. Honest pitch language

Suggested statements for judges. Each is technically defensible given the above.

1. "TownshipLens is an explicit world model of City of Elmina: a graph state with per-edge evidence status, a deterministic transition rule, and simulated resident journeys, rather than a video generator or a neural network trained on the township."
2. "We follow the functional definition used in model-based RL and planning: state, transition, rollouts and a planner. The planner proposes and explains; the simulator, not the language model, computes every route and flood class."
3. "Our dynamics are engineered, not learned. We do not claim to learn physics from data, and our flood scenarios are indicative stage-based scenarios from elevation and mapped drainage, not forecasts and not water depths on paths."
4. "Because the state is explicit and stored, it does not change when you rotate the camera or switch views. Recent benchmarks show that video-based world models often lose that property."
5. "When the state is partly unknown we say so: routes that cross unverified edges are shown as partly unverified, and we report best-case and worst-case bounds instead of made-up probabilities."
6. "What we cannot claim: predictive accuracy for real floods, generalisation to places we have not mapped, learned behaviour of residents, or that the 3D scene is the model. The 3D scene is a view of the state."

---

## 6. Open questions and caveats

- Several 2026 items (surveys 2606.00133, 2609.16697, 2608.23070; Cosmos-Predict2.5 details; AMI Labs claims) were only seen as search snippets. Open them before citing.
- Numbers quoted for V-JEPA 2, Dreamer and MuZero are from memory unless marked [read]; verify against the PDFs in this folder before putting them on a slide.
- Genie 3 has no technical report; every Genie 3 statement comes from DeepMind blog/press coverage.
- "Fei-Fei (2026) renderers/simulators/planners" is cited second-hand through 2607.06401; locate the primary source before attributing.
- The LeCun 2022 position paper is on OpenReview (id BZ5a1r-kVsf), not arXiv; no PDF was downloaded.

---

## 7. Machine-readable block (for reference/download-papers.sh)

```
PAPER|world-models|1803.10122_World-Models-Ha-Schmidhuber.pdf|https://arxiv.org/pdf/1803.10122
PAPER|world-models|1911.08265_MuZero.pdf|https://arxiv.org/pdf/1911.08265
PAPER|world-models|2301.04104_DreamerV3.pdf|https://arxiv.org/pdf/2301.04104
PAPER|world-models|2509.24527_Dreamer4.pdf|https://arxiv.org/pdf/2509.24527
PAPER|world-models|2506.09985_V-JEPA2.pdf|https://arxiv.org/pdf/2506.09985
PAPER|world-models|2411.02385_Video-Gen-vs-World-Model-Physical-Law.pdf|https://arxiv.org/pdf/2411.02385
PAPER|world-models|2501.03575_Cosmos-WFM-Platform.pdf|https://arxiv.org/pdf/2501.03575
PAPER|world-models|2607.06401_Definition-and-Roadmap-for-World-Models.pdf|https://arxiv.org/pdf/2607.06401
PAPER|world-models|2606.20545_Current-World-Models-Lack-Persistent-State.pdf|https://arxiv.org/pdf/2606.20545
PAPER|world-models|2510.04542_Code-World-Models-General-Game-Playing.pdf|https://arxiv.org/pdf/2510.04542
```
