# Task-Based Resident Agents: Research and Design

> Research for TownshipLens, 14 Oct 2026. Companion: [accessibility-and-routing.md](accessibility-and-routing.md). Unverified items are marked. Sources at the end; machine-readable list in [../../reference/notes/access-sources.md](../../reference/notes/access-sources.md).

## TL;DR

- LLM "simulated people" are a hot 2023-2026 topic, but the evidence says they are **plausible, not faithful**, and they are worst exactly where we would be tempted to use them: people with disabilities.
- Therefore TownshipLens's "resident agents" should be **deterministic constraint-checkers** (persona = a machine-readable profile of hard/soft constraints run against the verified graph). The LLM is used only for (a) **generating test cases** (tasks, phrasing, edge cases) and (b) **explaining failures** in plain language. It never decides whether a route is feasible.
- The closest analogy is **property-based testing**: define invariants ("a stroller route never contains a step"), generate many tasks, and shrink failures to minimal counter-examples. Researchers (Maaz et al., 2025) have recently shown LLM agents can write such tests (56% of reports valid across 100 Python packages).
- Output of the agents is a **knowledge-gap report** ranked by impact, which feeds the staff correction queue. They are described as *testing tools, not substitutes for resident consultation*, as in the original idea.

---

## 1. Research landscape (2023-2026)

| Work | What it shows | Relevance |
|---|---|---|
| **Generative Agents** (Park et al., 2023). 25 agents with memory, reflection, planning in a sandbox ([arXiv 2304.03442](https://arxiv.org/abs/2304.03442)) | Believable emergent social behaviour from an LLM + memory architecture | Inspiration only; we need no memory or social simulation |
| **Generative Agent Simulations of 1,000 People** (Park et al., 2024; revised Apr and Jun 2026) ([arXiv 2411.10109](https://arxiv.org/abs/2411.10109)) | 1,052 people interviewed for 2 hours; agents reproduced held-out survey answers at 83% (interview), 82% (survey), 86% (combined) of participants' own test-retest consistency; demographics-only 74% | Shows grounding in *real self-reports* matters; **we have no real interviews, so we should not claim persona fidelity** |
| **UXAgent** (Lu et al., 2025) ([arXiv 2504.09407](https://arxiv.org/abs/2504.09407)) | Persona generator + LLM agent + browser connector to run thousands of simulated usability sessions; aims to help researchers debug their *study design* before real participants | Frames simulation as pre-test, not replacement; matches our stance |
| **AXNav** (Apple, CHI 2024) ([arXiv 2310.02424](https://arxiv.org/abs/2310.02424)) | Natural-language accessibility test instructions executed by an LLM+UI agent; QA professionals rated it useful | Precedent for NL test case in, structured replayable result out |
| **GATSim** (Liu et al., 2025) ([arXiv 2506.23306](https://arxiv.org/abs/2506.23306)) | Generative agents for urban mobility simulation with memory and tools | Mobility-scale simulation; overkill for one facility |
| **LLM urban agents survey** (2025) ([arXiv 2507.00914](https://arxiv.org/abs/2507.00914)) | Taxonomy: human mobility, socio-economic activity, public surveys | Context for judges |
| **When Plausible Is Not Realistic** (2026) ([arXiv 2606.13835](https://arxiv.org/pdf/2606.13835)) | Asks whether LLM mobility agents match empirical mobility laws or just look plausible (abstract only, via search; unverified) | Supports the "plausible is not valid" critique |
| **Agentic Property-Based Testing** (Maaz, DeVoe, Hatfield-Dodds, Carlini, 2025) ([arXiv 2510.09907](https://arxiv.org/abs/2510.09907)) | LLM agent infers properties, writes and runs property-based tests; 56% of reports valid over 100 packages | Direct template: LLM proposes, deterministic harness verifies |

A 2025 *Cities* systematic review of agent-based mobility modelling found comparatively little attention to accessibility ([Deusto record](https://deustoteka.deusto.es/items/0209a053-9925-4650-8214-0b9c23ca5165)); this is a modest gap argument, not a strong one.

## 2. Critique and limits of synthetic users

1. **Homogenisation and stereotype triggering.** Auditing LLM-generated personas, Bombieri and Rospocher (Information, 2025) report homogenised outputs that under-represent demographic diversity and stereotypical shifts when conditioned on attributes such as disability ([MDPI Information 16(931)](https://www.mdpi.com/2078-2489/16/11/931)).
2. **Idealisation of disability.** Comparing LLM-simulated posts with real posts by disabled Reddit users, Bombieri et al. (2026) find LLMs produce overly positive portrayals and associate topics like career and entertainment with non-disabled people ([arXiv 2605.20191](https://arxiv.org/abs/2605.20191)).
3. **Stereotypes in disability personas.** Persona-L-style tools for people with Down syndrome raise the open question of whether the persona interface reinforces stereotypes ([arXiv 2512.02275](https://arxiv.org/abs/2512.02275)).
4. **Calibration needs real data.** The 1,000-people study's strong result depended on two-hour real interviews; demographics-only agents were noticeably worse (74% vs 86%) ([arXiv 2411.10109](https://arxiv.org/abs/2411.10109)).
5. **Evaluation trap.** Plausible trajectories are not evidence of realistic behaviour ([arXiv 2606.13835](https://arxiv.org/pdf/2606.13835)).

**Implication for TownshipLens:** an LLM role-playing "a wheelchair user" would produce confident, possibly sanitised, opinions about what is hard. That is exactly what we must not present. Constraint profiles are different: "needs step-free, width >= 0.9 m" is a *requirement specification*, not a simulation of a person. It has no stereotype problem beyond whether the thresholds are right, and thresholds are reviewable, citable and adjustable.

**Wording for the pitch and the UI:** "Resident test profiles", not "resident simulations". State that profiles encode access requirements, were reviewed by [a named expert/NGO, to be obtained], and do not replace consulting residents. Plan at least 3-5 real user checks (an older resident, a parent with stroller, a wheelchair user if reachable) as the validation arm.

## 3. Recommended design

### 3.1 Architecture

```
Profile (YAML, hand-written, versioned)  ──┐
                                           ▼
Task generator (LLM + templates) ──► Task = (profile, origin, destination, question)
                                           ▼
Deterministic checker (routing + invariants over verified graph)
                                           ▼
Result: CONFIRMED | PARTIAL(unverified edges) | IMPOSSIBLE(blocking edge) | AMBIGUOUS(missing place)
                                           ▼
Failure explainer (LLM, constrained to checker output)  +  Gap ledger (deterministic)
                                           ▼
Staff queue ranked by impact  ──► verify ──► graph updated ──► re-run suite
```

### 3.2 Profile spec (deterministic)

```yaml
id: older_resident
version: 1
hard:
  max_step_count: 0
  max_incline_pct: 8.3        # engineering default; MS 1184 value unverified
  max_rest_free_run_m: 100    # frail variant: 50
  require_toilet_within_m: 200   # optional per task
soft:
  prefer_shelter: 0.86        # distance multiplier for covered segments
  prefer_lit: true
unknown_policy: strict_then_lenient
sources: [ms1184:2014 (unverified numbers), activetravelengland, melnikov2022]
```
Three profiles for the MVP, as the original idea specifies: **stroller (step-free)**, **older resident (rest points)**, **wheelchair user (verified accessible connections)**. A fourth, **first-time visitor** (entrance finding, signage), needs no physical constraints and exercises information gaps.

### 3.3 Invariants (the "properties")

Checked on every route and on the graph itself:

1. **No hard-constraint violation:** no returned route contains an edge failing the profile's hard constraints.
2. **No unverified claim stated as verified:** every edge with status != verified in the route appears in the answer's "unverified" list.
3. **Symmetry/reachability:** every facility entrance reachable from at least one parking or drop-off node for each profile, or flagged.
4. **Monotonicity:** relaxing a constraint never removes a route; adding a verified blocker never creates one.
5. **Evidence completeness:** every attribute used in a decision has `source` and `verified_at` not older than TTL.
6. **Place coverage:** each facility has a main accessible entrance defined; toilets and seating have `wheelchair`/`seating` attributes.

Violations are findings, not exceptions. Each is a typed gap (`missing_attr`, `stale_attr`, `dead_end`, `no_accessible_entrance`, `contradiction`, `rest_gap_exceeds_limit`).

### 3.4 Where the LLM helps (and is fenced)

- **Test generation:** given the place list and profile list, produce diverse tasks: natural-language questions ("Can I get my mum from the drop-off to the clinic without stairs?"), alternate names/misspellings (including Malay and Mandarin variants), ambiguous requests, and "trap" queries about places we do not model. These become fixtures. This is the part where LLM diversity is valuable and where hallucination is harmless, because the checker validates outcomes.
- **Property suggestion:** have an LLM propose additional invariants from the schema and past failures; humans accept or reject (agentic-PBT pattern).
- **Failure explanation:** pass only the structured result (blocking edge, missing attribute, evidence) and require the output to quote edge IDs. Reject outputs with IDs or numbers not in the input (simple regex check).
- **Never:** deciding feasibility, inventing attributes, estimating how "difficult" a route feels, or voicing a persona's opinions.

### 3.5 Shrinking and reporting

Like property-based testing, when a profile fails to reach a destination, **minimise** the explanation to the smallest cut: the single edge (or small set) whose repair would make a route exist. Compute by trying to flip each UNKNOWN/FAIL edge to PASS and re-routing; rank edges by how many tasks they would unblock. This gives staff the "verify these 5 edges first" list, the project's main differentiator.

### 3.5.1 Metrics for the pitch (measured, not claimed)

- Tasks generated; % CONFIRMED / PARTIAL / IMPOSSIBLE per profile before vs after staff verification.
- Verified-edge coverage (%), median age of verified facts.
- Number of gaps found by the suite vs. found by a human walkthrough (baseline), and staff minutes per gap closed.
- Rate of unsupported claims in assistant answers (LLM-as-assistant evaluated against checker output), the metric named in the original idea.

### 3.6 Evaluation and honesty

- Regression suite: ~30-60 fixed tasks run on every graph change (CI).
- **Seeded-fault test:** deliberately corrupt a few edges (add a hidden step, remove a bench) and confirm the suite detects them (mutation testing). A cheap, convincing demo.
- **Human check:** compare checker verdicts with 3-5 real people walking 2-3 routes; report disagreements openly.
- Reporting: keep LLM-generated text visibly labelled; keep persona definitions in the repo with changelog.

### 3.7 What we deliberately do not build

Generative-agent memory/reflection, crowd simulation, behaviour prediction, "resident opinion" generation. These add risk and consume the 4-week budget with no judging upside, and the 1,000-people evidence shows fidelity requires real interview data we do not have.

## 4. Open questions

- Who can review the profile thresholds (an OKU NGO, SDP accessibility consultant, or a university lecturer)? Ask mentors.
- Whether to report LLM test-generation coverage (a measurable claim) or keep it internal.
- Whether to use an LLM-based "visitor" agent over the staff-facing UI to test usability (UXAgent-style). Optional stretch; label as pre-test only.

## Sources

- Park et al., Generative Agents: https://arxiv.org/abs/2304.03442
- Park et al., 1,000 People: https://arxiv.org/abs/2411.10109
- UXAgent: https://arxiv.org/abs/2504.09407 (earlier version https://arxiv.org/abs/2502.12561)
- AXNav: https://arxiv.org/abs/2310.02424
- GATSim: https://arxiv.org/abs/2506.23306
- LLM urban agents survey: https://arxiv.org/abs/2507.00914
- When Plausible Is Not Realistic: https://arxiv.org/pdf/2606.13835 (abstract only; unverified)
- Agentic PBT: https://arxiv.org/abs/2510.09907
- Bombieri and Rospocher, impersonification bias: https://www.mdpi.com/2078-2489/16/11/931
- Shiny Stories, Hidden Struggles: https://arxiv.org/abs/2605.20191
- Down syndrome personas: https://arxiv.org/abs/2512.02275
- Agent-based mobility review: https://deustoteka.deusto.es/items/0209a053-9925-4650-8214-0b9c23ca5165
- Thresholds and routing context: see [accessibility-and-routing.md](accessibility-and-routing.md)
