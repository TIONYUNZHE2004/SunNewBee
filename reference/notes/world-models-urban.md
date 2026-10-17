# World models for townships: urban LLMs, digital twins, evacuation ABM, value of information

Researched 2026-10-16 for TownshipLens (branch ai/world-model). PDFs are in `reference/papers/world-models/`.

Evidence grade: **[read]** = I opened the PDF text or abstract this session. **[abstract]** = only the abstract or search snippet was seen. **[memory]** = recalled from background knowledge and not checked; verify before citing in the pitch.

---

## 1. Papers

### CityGPT (Feng et al., arXiv 2406.13948, KDD 2025) [abstract]
- Fine-tunes small LLMs (ChatGLM3-6B, Qwen1.5, LLaMA3 family) on a "CityInstruction" dataset (SWFT training) so the model "knows" a city's spatial layout.
- Ships CityEval, a text benchmark of urban spatial tasks. The abstract reports that small tuned models can match or beat proprietary LLMs on it.
- The "world model" lives inside the weights. The answer is only as good as the tuning data and there is no per-claim provenance.
- **Relevance to TownshipLens:** this is the opposite design choice. Ours keeps the world in a deterministic graph with claim status, and the LLM only phrases results. CityGPT is useful as a foil on the pitch slide: tuned weights cannot say "this ramp is unverified". It also shows that "spatial hallucination" is a recognised failure that `validate.py` addresses structurally.

### UrbanLLM (Jiang et al., arXiv 2406.12360, EMNLP Findings 2024) [read abstract]
- A fine-tuned LLM that decomposes urban queries into sub-tasks, picks a spatio-temporal model per sub-task, then composes the answer.
- Reported accuracy is about 68% overall, about 96% on single-task queries and about 59% on complex ones (search snippet, not checked in the PDF).
- Same pattern as our agent (tools plus final answer), but without a ground-truth gate on the composed answer.
- **Relevance:** supports our "tool-routing agent" architecture as the accepted pattern. The ~59% on complex multi-step queries is a number to quote when arguing for a validator and a template fallback.

### CityBench (Feng, Zhang, Liu et al., arXiv 2406.13945, v3 May 2025) [read header]
- Benchmark for LLMs on urban tasks, run on a simulator the authors call CitySim (not the same system as the Toyota CitySim below).
- It tests perception, spatial reasoning and decision tasks across many cities.
- **Relevance:** our `pnpm golden` set is the township-scale analogue. We can borrow the framing: score abstention and gap-reporting as correct behaviour, which CityBench-style accuracy metrics do not reward.

### Urban LLM Agents survey (Han et al., arXiv 2507.00914, 2025) [read abstract]
- Defines "urban LLM agents" as semi-embodied in a cyber-physical-social space.
- Organises the field by workflow (sensing, memory, reasoning, execution, learning) and by five application groups: planning, transportation, environment, public safety, urban society.
- Discusses trustworthiness and evaluation as open problems.
- **Relevance:** a ready-made taxonomy for the "related work" slide. Our stack maps to sensing = claims/evidence, execution = 10 tools, and trust = honesty invariants. Public safety is the least populated group, which is our niche.

### AgentSociety (Piao et al., arXiv 2502.08691, 2025) [read]
- LLM-driven agents plus a realistic societal environment plus a distributed engine (Ray, asynchronous). More than 10k agents and about 5 million interactions.
- Four case studies: polarisation, inflammatory messages, universal basic income, and external shocks (Hurricane Dorian).
- Hurricane result, qualitatively: activity level drops sharply when the storm arrives, then recovers (Section 7.5).
- The hurricane case study reports aggregate mobility, not per-person route feasibility. There is no tri-state map facts layer.
- **Relevance:** the canonical "generative society" demo. We should not try to compete on agent count or social realism. The hurricane case is a useful contrast: they simulate whether people move, we compute whether a path exists for a stroller.

### CitySim (Bougie and Watanabe, Woven by Toyota, arXiv 2506.21805, EMNLP 2025 Industry) [read abstract]
- Agents build daily schedules with a recursive value-driven approach, with beliefs, long-term goals and spatial memory.
- Applications: crowd density, place popularity, well-being.
- Claims better alignment with real human behaviour than prior LLM-agent work, at micro and macro level.
- **Relevance:** if we ever add LLM-flavoured resident personas, the value-driven scheduler idea suits "who needs to get where" demand generation. Our `sim.py` already generates synthetic journeys deterministically, and that is better for honesty (reproducible, no model-written facts).

### OpenCity (Yan, Zeng et al., arXiv 2410.21286, 2024) [read abstract]
- Scalability paper: an LLM request scheduler (IO multiplexing) and a "group-and-distill" prompt strategy that clusters agents with similar static attributes.
- About 600x faster per agent with 70%+ fewer requests (v1 abstract; later version quotes 635x and 73.7% fewer requests).
- **Relevance:** group-and-distill is the right trick *if* we ever LLM-drive personas: cluster by (mobility profile, age band, departure window) and run one decision per cluster. For our deterministic rollout it is moot, but it is a one-line answer to "would this scale?".

### LLM-powered evacuation under a moving threat (Ma, Yu, Tang, Li, arXiv 2609.37009, Sep 2026) [read abstract]
- Persona-conditioned LLM pedestrians with a private symbolic ASCII view and a memory knowledge graph updated only from their own observations.
- A **validation engine executes routes exclusively over observed terrain**, decoupling behavioural choice from physical feasibility. This is the same split as our "LLM never computes facts".
- Eight personality compositions, paired randomised blocks. Agents with usable-exit knowledge evacuated in 89.5% of cases versus 1.05% without it.
- Share of high-urgency, low-directness decisions varied from 11.41% to 34.33% across personality compositions.
- Limitations section (5.3) states that results are not claimed to reproduce real transitions without validation.
- **Relevance:** the strongest 2026 external support for our architecture. The "knowledge of a usable exit" finding is a direct argument for a feature: show residents which evacuation routes are *known* usable versus unknown (see feature F2).

### Shirvani, Kesserwani, Richmond: pedestrians in floodwater ABM (arXiv 2004.10589, 2020) [read]
- Pedestrian agents get stability and walking-speed rules in floodwater, with varied body height and weight.
- Hazard Rating HR = (v + 0.5) x d; free walking speed on dry land 1.4 m/s. In their Table 1, HR bands map to speeds: 1.8 m/s (brisk) at low and medium HR, 1.0 m/s at high HR, 0 m/s at severe HR.
- Headline: more realistic stability and speed rules give "significantly prolonged evacuation times and risk exposure". Unstable people need more conservative thresholds than current practice implies.
- **Relevance:** gives defensible dry-land speed anchors and shows why depth-based modelling is a research area in itself. **We must not import HR**: it needs depth and velocity, and our invariant is no depths on paths. Use only the dry-land speed part and the qualitative lesson (flood slows people non-linearly).

### Fried, Shimony, Benbassat, Wenner: Canadian Traveler Problem variants (arXiv 1207.4710, 2012) [read abstract]
- The stochastic Canadian Traveler Problem (edges blocked with probability, revealed on approach) is PSPACE-complete.
- A "remote-sensing" variant, where edge status can be checked from afar for a cost, is NP-hard even on disjoint-path graphs.
- **Relevance:** the formal home of "which unknown edge should we verify". It justifies using a myopic greedy value-of-information heuristic instead of an optimal policy: the exact problem is intractable, and we only need a ranking.

### Not downloaded but cited
- Urban Foundation Models survey (Zhang et al., KDD 2024, arXiv 2402.01749) [abstract via search]: taxonomy of urban data and FM roles. Cite for "urban foundation models" context.
- FLARE (Chen et al., arXiv 2502.17701) [abstract via search]: wildfire evacuation decision prediction with LLMs and the Protective Action Decision Model, about 20% better than theory-informed baselines on three survey datasets. It is prediction on survey data, not simulation.
- Hierarchical generative agents for sequential human behaviour (arXiv 2606.14989) and LLM-driven personalities in emergency simulations (arXiv 2606.31038) [abstract only].
- Xie, Nakai, Sekimoto, ISPRS Annals 2026: 3D urban digital twin plus ABM for flood evacuation, conceptual, no LLM [abstract].
- UrbanKGent, OpenCity-style platform papers, CityLLM (2607.14542) were **not reviewed** by me.
- AccessMap / OpenSidewalks (arXiv 1602.04281, 2016) [abstract]: variable cost-function routing on a sidewalk graph from open data. Project Sidewalk crowd-sources remote labelling of barriers. I found no paper on routing under claim uncertainty, which supports the claim that our tri-state evaluation is not standard.

---

## 2. What judges have seen before

Common in urban-LLM demos (avoid leading with these):
1. A chat box over a map that "flies to" a place. Every urban-LLM paper and most hackathon entries do this.
2. Thousands of generative-agent dots moving on a city (AgentSociety, OpenCity, CitySim style). Impressive, but unverifiable, and the judges know the outputs are model-written.
3. An LLM "predicting" flood or evacuation outcomes or giving risk scores and depths. Reads as unsafe for a developer with liability.
4. A fine-tuned domain model (CityGPT style). Costly and not reproducible in a weekend.
5. A flood layer as a coloured overlay with a slider and a confident legend ("safe zone").

Genuinely novel for a township developer audience (what we have or can add):
- **Gaps as first-class output.** Tri-state answers: confirmed, partly unverified, no mapped connection. Very few demos show "we do not know" as a result.
- **Verification loop that closes:** a resident question that hits a gap files a ticket, staff resolve it, and the same question's answer changes. That is a "living" world model with an audit trail.
- **Ranking the field survey.** "Spend your next 10 site visits here, because these 6 facts unlock 40% of stroller journeys." Developers pay for surveys, so this converts directly to a budget decision. I did not find an urban-LLM paper that does it, though I did not search exhaustively.
- **Honest scenarios:** "indicative, not a forecast", never a depth, never "safe".
- **Deterministic engine plus LLM as phrasing layer**, enforced by a validator. 2026 evacuation-LLM work (Ma et al.) independently converges on this split, which is good to mention.

---

## 3. Feature ideas

Effort is in build days, assuming the existing graph engine, `sim.py`, the ticket flow and the Cesium app.

### F1. "Survey priority" board (data-gap ranking upgraded to value of information)
- **User sees:** on `/tickets` (staff), a ranked list "Verify next": fact, place, number of journeys that would change status, estimated minutes of survey, and a mini before/after of route coverage.
- **Engine computes:** the myopic value of information per unknown claim (section 6), divided by a per-attribute survey cost from config.
- **Honesty risks:** the prior P(PASS) is an assumption. Label it "planning estimate, not a measurement". Never show it to residents. Do not display "will probably pass".
- **Effort:** 2 to 3 days (flip logic exists; add priors, cost config, UI).

### F2. Known-usable evacuation routes per profile ("which routes do we actually know?")
- **User sees:** for a chosen centre or home and profile, a panel: "2 routes confirmed, 1 partly unverified, 1 no mapped connection". Routes drawn with confirmed versus unverified styling.
- **Engine computes:** route status per (origin, evacuation candidate, profile, scenario stage) from existing evaluation. Candidates keep the `osm_candidate` vs `official_pps` label.
- **Honesty risks:** must not read as a recommended evacuation plan. Show "official MBSA / JPS / NADMA guidance applies" and no "safe". Placeholder evidence must show "Demo value, not surveyed".
- **Effort:** 3 days. Mostly UI aggregation over existing tools. Motivated by Ma et al.: knowing a usable exit dominated outcomes.

### F3. Journey-level coverage rollout ("what fraction of residents like X have a confirmed route?")
- **User sees:** a staff dashboard KPI per profile and per scenario stage: confirmed, partly unverified, blocked, no_data percentages across synthetic journeys. A before/after bar when a ticket is resolved.
- **Engine computes:** extend `sim.py` aggregates (it already runs journeys). Weighted by synthetic population cells.
- **Honesty risks:** synthetic origins are not real residents. Label "synthetic journeys, not residents". Percentages describe data coverage, not safety.
- **Effort:** 2 days.

### F4. Time-to-reach with mobility-profile speeds (indicative evacuation clock)
- **User sees:** for each confirmed or partly unverified route: "indicative walking time 14 to 22 min for wheelchair profile, excludes rest stops and queueing". Range, not a point.
- **Engine computes:** length / speed band per profile (config), plus rest-stop time for the older-adult profile. A scenario stage may only lengthen (detour) or remove routes, never shorten.
- **Honesty risks:** speed bands are literature-derived, not measured locally. Never present as a time to safety, and never imply a warning time. No depth-dependent speed.
- **Effort:** 2 to 3 days. See section 5 for defensible ranges.

### F5. Tipping-point scenario scrub ("at which river stage does my route break?")
- **User sees:** a slider over the discrete stages `baseline` and `stage_p1m` to `stage_p5m`, with the route changing status. A sentence like "Route stays partly unverified up to the first modelled stage that cuts it" (stage names only).
- **Engine computes:** route status per precomputed scenario. First stage where status becomes `blocked` (a known FAIL) or `partly_unverified` (a `possible` edge).
- **Honesty risks:** stage labels are not a forecast and imply no probability or depth. The word "breaks" is fine, "floods at" is not. Disclaimer banner always visible.
- **Effort:** 2 days (engine exists, UI and agent phrasing plus validator update).

### F6. Interdependent-fact "keystone" view
- **User sees:** in 3D, highlight a handful of edges that are single points of failure for many journeys ("if this ramp is unusable, 31 journeys lose their only confirmed route").
- **Engine computes:** edge betweenness weighted by journeys, restricted to unknown and verified edges. Also the flip-to-FAIL impact, which tells staff what to keep re-verifying (stale claims).
- **Honesty risks:** "keystone" is a graph property of mapped data, not a statement about the real structure. Show for UNKNOWN as "ask staff to check" and for PASS as "relied upon by N routes".
- **Effort:** 3 days.

### F7. Stale-claim decay and re-verification queue
- **User sees:** a claim's badge goes from Verified to Stale after a configured age. The ticket queue regenerates.
- **Engine computes:** claim age versus a per-attribute half-life, feeding into F1 as a rising P(FAIL).
- **Honesty risks:** half-lives are policy, not physics. Configure transparently. It must only ever downgrade, never upgrade.
- **Effort:** 2 days (status `stale` already exists in the model).

### F8. Persona-flavoured explanation (LLM only phrases)
- **User sees:** same deterministic result, explained for a "caregiver with a stroller" versus "staff planner".
- **Engine computes:** nothing new. Persona only picks the wording template and glossary. The facts are untouched and gated by `validate.py`.
- **Honesty risks:** model tone drifting into reassurance ("you should be fine"). Validator must block reassurance phrases.
- **Effort:** 1 to 2 days.

### F9. Counterfactual "what if we fix this?" for the developer
- **User sees:** staff toggle "assume this ramp is verified passable" and see coverage change for the 3 profiles. Output labelled "hypothetical, no change to the world".
- **Engine computes:** the same flip logic as `sim.py`, run live on one or several claims (budget what-if for capital works, e.g. build a ramp).
- **Honesty risks:** hypothetical edits must never be persisted as claims or leak into resident answers. Use a sandboxed overlay on the evaluation only.
- **Effort:** 3 days. Strong fit for a developer audience: it frames data work and capital work in the same unit (journeys unlocked).

### F10. Small-n grounded validation panel
- **User sees:** "Our simulated route statuses match N of M hand-checked journeys." Not a model-fit claim, only an audit of the pipeline.
- **Engine computes:** compare engine output on a hand-labelled set of 10 to 20 journeys (team walks them, or uses Project Sidewalk-style street imagery review).
- **Honesty risks:** n is tiny, so say so. Do not claim accuracy beyond the sample.
- **Effort:** 2 days plus field time.

Recommended shortlist for the demo: F1 (headline), F3 (the number), F2 or F5 (the emotional story), F9 if time allows.

---

## 4. Evacuation rollout design notes

### How serious evacuation ABMs model things
- **Agent speed by profile.** Disability-aware pedestrian models (e.g. BUMMPEE, EXITUS and cellular-automaton handicapped-pedestrian models, found in search, [abstract/snippet only]) assign each agent a speed and sometimes a stamina. Shirvani et al. [read] use 1.4 m/s as the dry-land mean and rule-based speed states in water.
- **Departure time.** Large-scale models (MATSim tsunami work for Padang, [snippet]) draw departure times from a response-curve distribution, typically after warning plus a lag (a Rayleigh or logistic-type curve in the classic literature [memory]). Warning lead time is explicit (about 30 min for Padang per the MATSim gallery page [snippet]).
- **Route choice.** Shortest or fastest path on a network, often with a share of agents who follow a "familiar" route or the nearest assembly point. Ma et al. [read] instead give agents partial knowledge: they can only use terrain they observed, and a validation engine rejects infeasible moves.
- **Capacity and congestion.** Vehicle models (MATSim) use link capacity and flow. Pedestrian models use cellular automata or social-force style density-dependent speed. Shirvani et al. add instability and speed loss in floodwater.
- **Behavioural heterogeneity.** The newest work (2026) uses persona-conditioned LLM agents to generate it; the same paper shows the persona effect is large on perceived urgency but converges after direct threat sightings (99.6% classified as dangerous).

### Defensible simplifications for an indicative demo
1. **No departure-time modelling.** Report route status and an indicative travel-time range, and say nothing about when people leave. This avoids invented behavioural parameters.
2. **Single-agent, no congestion.** State "does not model crowding or queueing". For the stroller, wheelchair and older-adult profiles at township scale this is the dominant omission, so say it in the UI.
3. **Speed bands by profile from literature, shown as ranges.** Keep dry-land only. Wheelchair and older-adult values must be taken from published empirical studies; I did not retrieve those, so treat the numbers as TODO and cite when added. Only anchor I verified: 1.4 m/s mean dry-land adult walking speed (Shirvani et al., citing Wirtz and Ries 1992, Mohler et al. 2007).
4. **Scenario effect is binary at the edge level** (FAIL, UNKNOWN). Do not interpolate speed by depth. This is a deliberate difference from Shirvani et al.
5. **Deterministic, seeded.** Same inputs, same synthetic journeys, reproducible. Matches the honesty promise and keeps LLMs out of the rollout.
6. **LLM only phrases**, never chooses a route. Section 2 of Ma et al. is a legitimate reference for decoupling choice from feasibility.

### Disclaimer wording used in the literature (and what we should say)
- Ma et al. (Sep 2026) do not present predictions as validated: their scope-and-limitations section says transitions need validation against real data [read, paraphrase].
- Shirvani et al. use a synthetic building and describe results relative to model rules, not site predictions [read, paraphrase].
- The AgentSociety paper frames outputs as generative social-science experiments, not forecasts [abstract, paraphrase].
- I did **not** find a standard boilerplate disclaimer in these papers, so I am not quoting one. For TownshipLens keep our existing wording: "Indicative scenario, not a forecast. Based on mapped data that is partly unverified. Follow official MBSA / JPS / NADMA guidance." Add for rollouts: "Synthetic journeys, not residents. Does not model crowding, departure time or warnings."

---

## 5. Value-of-information formulation

### Setup
- J: set of synthetic journeys, each with weight w_j (population weight, or 1), a profile, an origin, a destination and a scenario stage.
- U: set of UNKNOWN claims (and, for re-verification, stale ones).
- For each u in U: a prior q_u = P(u is PASS), with 1 - q_u = P(FAIL). Priors come from config by attribute and source type (for example OSM-derived default, team placeholder evidence lower). They are assumptions, not measurements.
- Status of journey j given a complete assignment x of all unknowns: confirmed, blocked or (never partly_unverified once all unknowns are known).

### Metric A: cheap, exact, what `sim.py` can already do (expected journeys unlocked)
For a single claim u, let C_j(u=PASS) be 1 if journey j is confirmed when only u is flipped to PASS (all other unknowns left unknown), else 0. Then

  Gain_u = sum_j w_j * 1[ status_j(u=PASS) = confirmed AND status_j(now) = partly_unverified ]

This is the optimistic upper bound: the number of journeys u alone can unlock. Expected gain: E_u = q_u * Gain_u.
Cost-normalised ranking: score_u = q_u * Gain_u / c_u, where c_u is the survey cost (minutes or ringgit, per-attribute config).

### Metric B: decision-theoretic (EVSI of verifying u) for a journey with best-route reliability
Let for journey j the best candidate route have unknown set S_j. Under independence, P_j = product over s in S_j of q_s. A resident chooses between "use the route" (gain G if it works, loss L if it does not) or "do not rely on it" (0).
  EU_j(use) = P_j * G - (1 - P_j) * L, so EU_j = max(0, EU_j(use)) today.
If u is in S_j, after verification:
  - with probability q_u it is PASS: P_j^+ = P_j / q_u
  - with probability 1 - q_u it is FAIL: P_j^- = 0, so EU = 0 for this route (the route is dead; fall back to the next best route if any, whose EU is added in)
  EVSI_{u,j} = q_u * max(0, P_j^+ * G - (1 - P_j^+) * L) + (1 - q_u) * EU_j^alt - max(0, EU_j(use))
  EVSI_u = sum_j w_j * EVSI_{u,j}
(EU_j^alt = best alternative-route EU after u is FAIL, or 0.) EVPI over *all* unknowns of j is the same expression with the full assignment enumerated, estimated by Monte Carlo (below).
Ratio form for ranking: EVSI_u / c_u.

### Monte Carlo version (when routes overlap and independence is wrong)
Sample K assignments x^(k) ~ prod_u Bernoulli(q_u). For each, recompute every journey's status (graph search). Then for each candidate u:
  EVSI_u ~ (1/K) * sum_k V(x^(k) with u known) ... practical form: split samples by x_u, compute the average best-decision value within each group, weight by q_u, subtract the no-information value.
At the scale of this graph (seed network, a few dozen unknowns) K = 200 to 500 is cheap.

### Sequential policy
Greedy and myopic: pick top-scoring u, resolve (or simulate resolution in the what-if tool), recompute. Optimal sequential probing is intractable (stochastic CTP is PSPACE-complete, remote-sensing variants are NP-hard; Fried et al. 2012), so greedy is the defensible default. Submodularity is *not* guaranteed here (a fact that matters only together with another fact violates it), so state the heuristic nature.

### Practical notes and honesty
- Show staff the *counts* (Metric A) and the priors as editable config. Show Metric B only if priors are discussed openly. Never show resident-facing probabilities.
- A fact on a bridge-like edge has high Gain_u even with a low q_u. That is why Metric A alone overstates; Metric B (or q_u * Gain_u) corrects.
- Treat the flip-to-FAIL direction as the downside risk: the number of currently confirmed journeys that would become blocked if a PASS claim failed is a re-verification priority (F6, F7).
- The ranking is a work-planning aid. It does not change any route status.

### References
- Howard, R. "Information value theory", IEEE Trans. Syst. Sci. Cybern., 1966 [memory].
- Raiffa and Schlaifer, "Applied Statistical Decision Theory", 1961 [memory].
- Fried, Shimony, Benbassat, Wenner, "Complexity of Canadian Traveler Problem Variants", arXiv 1207.4710 [read abstract, PDF downloaded].
- Bampis, Escoffier, Xefteris, "Canadian Traveller Problem with Predictions", arXiv 2209.11100 [abstract via search, not downloaded].
- Nikolova and Karger, "Route planning under uncertainty: the Canadian traveller problem", AAAI 2008 [memory].
- Krause and Guestrin, "Near-optimal observation selection using submodular functions", AAAI 2007, and Krause et al., "Near-optimal sensor placements in Gaussian processes", JMLR 2008 [memory]. Relevant for the submodularity and "greedy within 1 - 1/e" argument, which applies to *our* problem only if the objective is shown to be monotone submodular. I have not shown that.
- EVPI definition and flood-forecast VOI framing: NOAA review "Economic Value of Flood Forecasts" (repository.library.noaa.gov/view/noaa/66527) [search snippet].

---

## 6. Gaps and caveats of this research
- 2026 arXiv IDs (2609.37009, 2606.14989, 2606.31038, 2607.14542) came from search results. Only 2609.37009 was opened and its text confirmed. Check the others before citing.
- I found no paper combining LLM agents, a 3D urban digital twin and *flood* evacuation with tri-state data confidence. That absence is an observation from a limited search, not proof.
- I did not review UrbanKGent, UrbanGPT, or the full Urban Foundation Models survey text.
- Wheelchair and older-adult speed values and any local calibration are not sourced here.

---

PAPER|world-models|2406.13948_CityGPT-Urban-Spatial-Cognition.pdf|https://arxiv.org/abs/2406.13948
PAPER|world-models|2406.12360_UrbanLLM-Activity-Planning.pdf|https://arxiv.org/abs/2406.12360
PAPER|world-models|2406.13945_CityBench.pdf|https://arxiv.org/abs/2406.13945
PAPER|world-models|2507.00914_Urban-LLM-Agents-Survey.pdf|https://arxiv.org/abs/2507.00914
PAPER|world-models|2502.08691_AgentSociety.pdf|https://arxiv.org/abs/2502.08691
PAPER|world-models|2506.21805_CitySim-LLM-Agent-Simulation.pdf|https://arxiv.org/abs/2506.21805
PAPER|world-models|2410.21286_OpenCity.pdf|https://arxiv.org/abs/2410.21286
PAPER|world-models|2609.37009_LLM-Agent-Evacuation-Moving-Threat.pdf|https://arxiv.org/abs/2609.37009
PAPER|world-models|2004.10589_ABM-Pedestrian-Flood-Mobility.pdf|https://arxiv.org/abs/2004.10589
PAPER|world-models|1207.4710_Canadian-Traveler-Variants-Complexity.pdf|https://arxiv.org/abs/1207.4710
