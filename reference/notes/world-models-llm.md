# LLMs as / with world models: planning and agents (2023-2026)

Research notes for TownshipLens (branch ai/world-model, written 2026-10-16).
Target pattern: **the LLM proposes, the world model disposes.** The LLM proposes candidate
interventions or questions. `packages/spatial` (graph, tri-state evaluate, flood stages, `sim.py`)
scores them by rollout. The agent only explains what the tools returned.

Confidence note: bullets for 2025-2026 papers (2510.04542, 2601.03905, 2606.30639, 2606.09032)
come from abstracts and the first pages I read. Older papers' bullets are from memory of the
papers and should be spot-checked against the PDFs before being quoted in a pitch.
Papers marked (no PDF) were not downloaded.

---------------------------------------------------------------------------------------------

## 1. Per-paper notes

### RAP: Reasoning with Language Model is Planning with World Model (2305.14992, Hao et al., 2023)
- The same LLM plays two roles: a **world model** (predicts next state given state+action, in text) and a **reasoning agent** (proposes actions).
- Search: MCTS over reasoning steps. Reward = LLM likelihood of action, self-evaluation, or task-specific signals. Rollouts are done in the LLM's imagined states.
- Shown on Blocksworld, math (GSM8K) and logic. Big gains over chain-of-thought on Blocksworld plans.
- Core loop: LLM proposes action -> LLM predicts next state -> LLM scores -> MCTS selects. **Everything is LLM, so nothing is verified.**
- Relevance: gives the *structure* (state, action, transition, reward, search) that we keep, but we replace the LLM transition with `sim.py` and tools. RAP's failure mode (hallucinated states) is the thing our honesty invariants forbid.

### LLM-MCTS: LLMs as Commonsense Knowledge for Large-Scale Task Planning (2305.14078, Zhao et al., 2023)
- LLM serves two jobs: a **commonsense world model** (prior over where objects are, to sample a belief state) and a **policy prior** that biases MCTS action selection.
- Search: MCTS with the LLM as an action prior (PUCT-style); transitions simulated by a real or learned simulator, not the LLM.
- Beats pure-LLM policy and pure-MCTS on large household tasks (VirtualHome) because the prior prunes the branching factor.
- Core loop: LLM proposes priors -> simulator rolls out -> MCTS backs up values.
- Relevance: the closest match to our target. For "which intervention first?" the LLM supplies a *prior over candidates* (ramp at stairs near clinic, verify lift status) and `sim.py` supplies values. An LLM prior also keeps the search tractable on the ~thousands of walk edges.

### WorldCoder: a Model-Based LLM Agent (2402.12275, Tang et al., 2024)
- The agent writes a **Python program as the world model** (transition and reward), refines it from observed transitions, and plans with it (e.g. value iteration / planner).
- Refinement uses data consistency plus an **optimism-under-uncertainty** objective to drive exploration toward states where the model might allow reward.
- Much more sample efficient than deep RL, and transfers because the code is editable.
- Core loop: LLM proposes code -> unit-check against logged transitions -> repair -> classical planner uses the code.
- Relevance: our world model is already code. WorldCoder motivates a **regression harness**: every verified Ticket outcome is a logged transition (claim X resolved to Y) that the evaluator must reproduce. It also gives the optimism idea for choosing which gap to verify.

### GIF-MCTS: Generating Code World Models with LLMs guided by MCTS (2405.15383, Dainese et al., 2024)
- Builds the code world model by MCTS over **code edits**: Generate, Improve, Fix. Nodes are programs; reward = fraction of a transition dataset the program reproduces.
- Introduces the Code World Models Benchmark (CWMB). Reports better accuracy and sample efficiency than WorldCoder-style repair, and the resulting model lets a planner beat LLM-as-policy.
- Core loop: LLM proposes edit -> executed on held-out transitions -> score -> MCTS.
- Relevance: if we let an LLM propose *new rules for the evaluator* (e.g. "a handrail=none stair fails older_adult_rest"), the right gate is replay against verified claims, with search over edits rather than one-shot generation. Out of scope for the hackathon, but a clean "future work" slide.

### Code World Models for General Game Playing (2510.04542, Lehrach et al., Google DeepMind, 2025)
- LLM converts natural-language rules and trajectories into executable Python: state transition, legal moves, termination. Also generates heuristic value functions and (for hidden-information games) inference functions.
- Planning: MCTS or similar search over the generated code, **not** over LLM calls. Evaluated on 10 games (4 new, 5 imperfect-information); outperforms or matches Gemini 2.5 Pro in 9 of 10.
- Authors list three advantages: verifiability (legal moves enumerated by code), strategic depth (classical search), generalisation (the LLM only does data-to-code translation).
- Relevance: the strongest 2025 statement of our thesis. Illegal moves are the game analogue of an invented ramp or invented water depth. Enumerating legal actions from the engine means the LLM can never propose something the world cannot do.

### Can Language Models Serve as Text-Based World Simulators? (2406.06485, Wang et al., 2024; ByteSized32-State-Prediction)
- Benchmark of ~76k transitions from 31 text games. Asks GPT-4 to predict next state (action-driven and environment-driven changes) and game progress.
- Result: GPT-4 is only about 59% accurate on full state prediction and worse on environment-driven transitions and arithmetic or common-sense-heavy changes. The authors conclude it is **not yet a reliable simulator**.
- Relevance: direct evidence for "never let the LLM be the simulator". Gives us a quotable reason and a metric style (state-prediction accuracy) we can turn around: report how often a bare LLM's claimed route or flood status disagrees with the engine on our golden set.

### LLM+P: Empowering LLMs with Optimal Planning Proficiency (2304.11477, Liu et al., 2023)
- LLM translates a natural-language problem to PDDL; a classical planner solves it optimally; the LLM translates the plan back to language.
- Works when a domain PDDL is supplied; fails when the LLM must invent the domain. Reported as a large jump over LLM-only planning.
- Relevance: this is exactly our current architecture (LLM -> structured tool args -> deterministic engine -> narration). The "translate back" step needs a validator. We have it (`validate.py`). Use LLM+P as the citation for the pattern.

### Is Your LLM Secretly a World Model of the Internet? WebDreamer (2411.06559, Gu et al., 2024)
- Model-based planning for web agents: the LLM proposes candidate actions, **simulates each one's outcome in natural language**, scores the imagined outcomes, and executes the best (MPC-style, replan each step).
- Beats reactive baselines on VisualWebArena and Mind2Web-live while being cheaper and safer than real tree search (which would need backtracking on irreversible sites).
- Core loop: LLM proposes k actions -> LLM imagines outcome -> LLM scores -> execute best -> repeat.
- Relevance: the *shape* is what we want (propose k, simulate each, pick best, replan). The key difference: our "imagination" step must be `sim.py`, since web pages cannot be exactly simulated but our township can. WebDreamer's motivation (some actions are irreversible, so simulate first) maps to "don't file or promise anything before simulating".

### Current Agents Fail to Leverage World Model as Tool for Foresight (2601.03905, Qian et al., 2026)
- Gives agents a world model as a callable tool. Finding: some agents call it under 1% of the time; ~15% of the time they misinterpret or misapply predicted rollouts; accuracy can drop by up to 5% when simulation is available or required.
- Attribution points to three gaps: knowing **when** to simulate, **interpreting** the output, and **integrating** it into later reasoning.
- Relevance: a warning for our PydanticAI agent. A simulator tool that the model may skip will be skipped. Make the simulate call part of the forced flow (as with `final_answer`) and have `validate.py` check that numbers in the narration equal fields in the tool result.

### Self-Evolving World Models for LLM Agent Planning (2606.30639, Zhang et al., 2026; WorldEvolver)
- Frozen agent and frozen world-model parameters; the world model improves via **context**: episodic memory (retrieve past real transitions), semantic memory (rules distilled from prediction-vs-observation mismatches), and **selective foresight** (drop low-confidence predictions before they reach the agent).
- Evaluated on ALFWorld and ScienceWorld with the Word2World and AgentBoard benchmarks; best prediction accuracy across three backbones.
- Relevance: "selective foresight" = our tri-state. UNKNOWN edges should be dropped or labelled before they feed any ranking. The mismatch log is our Ticket outcomes.

### Bridging the Agent-World Gap: Text World Models for LLM-based Agents (2606.09032, Li et al., 2026 survey)
- Taxonomy: world model as **simulator for search**, as **verifier / ranker** of candidate actions, as training-data generator, and as environment substrate. Contrasts LLM-as-world-model with code-as-world-model.
- Verifier example: software-engineering work that predicts virtual test reports for candidate patches before running real tests.
- Relevance: a ready-made vocabulary for the write-up. TownshipLens is "code-as-world-model, used as simulator for search and as verifier for the LLM's claims".

### Not downloaded (cite from memory, check before quoting)
- **Tree of Thoughts** (2305.10601) and **LATS** (2310.04406): LLM proposes thoughts or actions, LLM or environment evaluates, BFS/DFS or MCTS expands. LATS adds environment feedback and reflections as value. Relevance: search shape only; our evaluator is exact so no self-evaluation noise.
- **Generative Agents** (2304.03442): memory stream, reflection, planning. Relevance: only as inspiration for a persona-driven resident simulator; the personas would be mobility profiles in `config/profiles`, behaviour must stay rule-driven.
- **Voyager** (2305.16291): LLM writes skills as code, verified by environment feedback and self-verification, stored in a library. Relevance: code-as-skill with environment verification; weak match.
- **FunSearch** (Nature, 2023) and **AlphaEvolve** (2506.13131): LLM proposes programs, an automated evaluator scores, an evolutionary database keeps the best. Relevance: the cleanest "LLM proposes, evaluator disposes" precedent. The evaluator must be fast and exact: ours is.

---------------------------------------------------------------------------------------------

## 2. Design patterns we can copy

Common skeleton: **candidate generator (LLM) -> typed Action objects -> deterministic simulator -> scored results -> LLM narration constrained to results.**

### P1. Propose -> simulate -> score -> explain (WebDreamer, LLM-MCTS, FunSearch)
- LLM never emits a score. It emits `Intervention` objects validated by Pydantic; the engine returns `Outcome`.
- Sketch:
  ```python
  class Intervention(BaseModel):          # closed vocabulary, ids must exist in World
      kind: Literal["add_ramp","verify_claim","close_edge","add_shelter_link"]
      target_id: str
  class Outcome(BaseModel):
      intervention: Intervention
      delta_reachable_places: int
      delta_confirmed_routes: int
      unknown_edges_resolved: int
      evidence_ids: list[str]
  @agent.tool
  def propose_and_score(ctx, candidates: list[Intervention]) -> list[Outcome]:
      return [sim.rollout(world, c, profile=ctx.deps.profile) for c in candidates[:8]]
  ```
- `sim.rollout` works on a copy-on-write overlay of claims, never mutates `World`.
- Honesty: a hypothetical ramp is always labelled "what-if", never a claim. The overlay must not be written to SQLite or `access/overlay.geojson`.

### P2. Closed-vocabulary candidate generation (code-world-model "legal moves", 2510.04542)
- The engine exposes `legal_interventions(world, profile)` and the LLM chooses from it or ranks it. An invented id fails validation and triggers `ModelRetry`.
- Gives "plan validity rate = 100% by construction" for ids; the remaining risk is irrelevant choices, handled by P3.

### P3. Search over interventions (RAP / LLM-MCTS / LATS)
- For single-step questions, enumerate and rank exhaustively (cheap graph). For budgeted sets ("best 3 ramps"), use greedy or beam search with marginal gain; MCTS only if the candidate set is large.
- LLM-MCTS-style prior: ask the LLM for a ranked shortlist, then evaluate the shortlist plus a random sample so that the prior cannot hide good candidates. Report the shortlist's regret against exhaustive search offline.
- Sketch: `beam_search(world, legal, k=3, width=5, objective=sim.score)` as a pure function in `packages/spatial`, exposed as one tool.

### P4. Counterfactual queries ("what if the river rises 2 m / lift is broken")
- Already close to existing scenarios. Generalise to `world.with_overrides(claims=..., flood="stage_p2m")` returning a lightweight view.
- Tool: `compare(a, b)` returns a diff of route status and reachable places. The LLM narrates the diff only.
- Output is tri-state: a counterfactual can only add FAIL/UNKNOWN for floods, and an assumed PASS (hypothetical ramp) is tagged `hypothetical` and cannot produce "confirmed", only "would be confirmed if built".

### P5. Value-of-information ranking (WorldCoder optimism, active learning)
- `sim.py` already ranks gaps by flipping claims. Make it VOI: for each UNKNOWN claim, simulate both PASS and FAIL, and score the expected change in the decision (e.g. number of resident-journeys that move between `partly_unverified`, `confirmed` and `blocked`).
- Weight by journeys affected per profile. The LLM may propose *which gap to ask a human about*, but the ordering and numbers come from the engine.
- Output feeds Tickets directly: "Verify lift at Block C: resolves N journeys."

### P6. Code-as-world-model with replay regression (WorldCoder, GIF-MCTS)
- Treat resolved Tickets as a test set: `(claim state before, outcome)`. Any change to `evaluate.py` must still reproduce them (pytest + hypothesis, already in repo style).
- If we ever let an LLM propose evaluator rule edits, accept only those that keep replay accuracy at 100% and pass the golden set. Human review remains in the loop.

### P7. Keeping the LLM from computing facts (LLM+P, ByteSized32 result, 2601.03905)
- Narration contract: every number, place name, status in the final answer must appear in a `TurnRecord` field. Extend `validate.py` to check outcome fields (deltas, counts) exactly, and to reject any comparative word ("most", "best") unless the tool result has a rank field.
- Force the simulate tool: a `final_answer` that mentions an intervention without a matching `Outcome` in the `TurnRecord` raises `ModelRetry`. Addresses the "agent never calls the world model" failure (<1% usage).
- Selective foresight (2606.30639): outcomes derived from UNKNOWN claims are surfaced with a `confidence="assumes_unverified"` flag, and the template says so.
- The mock agent and `template.py` must produce the same shapes (project rule: validator, mock and template change together).

### P8. MPC-style replanning in conversation (WebDreamer)
- Each turn: re-read state (new Ticket outcomes, scenario level), re-simulate shortlist, answer. No stored plan; avoids stale advice after a verification lands.

---------------------------------------------------------------------------------------------

## 3. Evaluation: how the papers measure, and what we can report

How the papers measure:
- **Task success / plan validity**: LLM+P and RAP use plan correctness on Blocksworld; the CWM game paper measures win-rate and illegal-move avoidance versus LLM-as-policy.
- **World-model fidelity**: ByteSized32 (state-prediction accuracy), GIF-MCTS (fraction of transitions reproduced), WorldEvolver (Word2World prediction accuracy).
- **Downstream agent success with the model in the loop**: WebDreamer (benchmark success and cost), WorldEvolver (AgentBoard).
- **Tool-use behaviour**: 2601.03905 (call rate, misinterpretation rate, accuracy delta).
- **Sample efficiency / cost**: WorldCoder, GIF-MCTS (number of environment interactions); WebDreamer (API calls).

Metrics we can report (all computable offline with the mock LLM, then spot-checked with the live one):

| Metric | Definition | Source of ground truth |
|---|---|---|
| Plan validity rate | share of proposed interventions whose ids and kinds are legal | `legal_interventions` |
| Simulator-verified improvement | mean objective gain of top-1 proposal vs. baseline and vs. random candidate | `sim.rollout` |
| Shortlist regret | best exhaustive score minus best score in LLM shortlist | exhaustive search on small worlds |
| Narration faithfulness | share of numbers/entities in the answer present in `TurnRecord`; share of answers passing `validate.py` first try | `validate.py` |
| Simulate-call rate | share of intervention questions where the tool was called | `TurnRecord` |
| Bare-LLM disagreement | share of golden questions where a tool-less LLM contradicts the engine (mirrors ByteSized32) | golden set |
| VOI ranking quality | does verifying the top-ranked gap resolve more journeys than a random gap (simulated resolution) | `sim.py` |
| Honesty violations | count of "safe", invented depth, `no_data` shown as "blocked" | existing invariant tests |
| Latency / cost | wall-clock and tokens per turn, rollouts per second | traces |

Caveat to state openly: these show the engine is internally consistent and the narration is faithful. They do **not** show the township model matches reality; seed facts are `team_survey_placeholder` until surveyed.

---------------------------------------------------------------------------------------------

## 4. Suggested minimum build (hackathon scale)
1. `sim.rollout(world, Intervention, profile)` and `legal_interventions` (pure, tested).
2. One PydanticAI tool `propose_and_score`; extend `TurnRecord` and `validate.py`.
3. VOI field on the existing gap ranking.
4. Eval script printing the metric table above on the tiny fixture with the mock.

---------------------------------------------------------------------------------------------

## Machine-readable
PAPER|world-models|2305.14992_RAP-Reasoning-via-Planning.pdf|https://arxiv.org/abs/2305.14992
PAPER|world-models|2305.14078_LLM-MCTS.pdf|https://arxiv.org/abs/2305.14078
PAPER|world-models|2402.12275_WorldCoder.pdf|https://arxiv.org/abs/2402.12275
PAPER|world-models|2405.15383_GIF-MCTS.pdf|https://arxiv.org/abs/2405.15383
PAPER|world-models|2406.06485_LLM-Text-World-Simulators.pdf|https://arxiv.org/abs/2406.06485
PAPER|world-models|2304.11477_LLM-P.pdf|https://arxiv.org/abs/2304.11477
PAPER|world-models|2411.06559_WebDreamer.pdf|https://arxiv.org/abs/2411.06559
PAPER|world-models|2510.04542_Code-World-Models-Game-Playing.pdf|https://arxiv.org/abs/2510.04542
PAPER|world-models|2601.03905_Agents-World-Model-Tool-Foresight.pdf|https://arxiv.org/abs/2601.03905
PAPER|world-models|2606.30639_Self-Evolving-World-Models.pdf|https://arxiv.org/abs/2606.30639
PAPER|world-models|2606.09032_Text-World-Models-Survey.pdf|https://arxiv.org/abs/2606.09032
