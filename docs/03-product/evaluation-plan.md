# Evaluation & Validation Plan

> Judges give **10% for evidence** and **25% for measurable impact**. A small amount of real, honest data beats big claims. This plan produces the numbers for the proposal (23 Oct), the final submission (11 Nov) and the pitch (14 Nov). Research background: [../02-research/ai-assistant-research.md § 4](../02-research/ai-assistant-research.md) and [../02-research/resident-agent-simulation.md](../02-research/resident-agent-simulation.md).

## 1. Three layers of evidence

| Layer | Question it answers | Method | Owner | When |
|---|---|---|---|---|
| **L1 Technical correctness** | Does the system give right, grounded answers? | Golden set + deterministic scoring + small LLM-judge slice | AI | Continuous (CI) |
| **L2 World-model quality** | How complete and verified is our data, and does the gap loop work? | Coverage metrics, persona simulation, seeded-fault test | BE + AI | Weekly |
| **L3 Human value** | Do real people find the right entrance faster, and understand the uncertainty? | Small task-based study vs a baseline | Everyone | P2 (2–6 Nov) |

## 2. L1: Golden set

Stored in `evals/golden/*.yaml` and run with Promptfoo (or a pytest harness).

| Slice | # | Expected behaviour |
|---|---|---|
| Answerable route/place (stroller, wheelchair, older_adult_rest, default) | 20 | Correct tools + args; route = the reference NetworkX route; evidence IDs present |
| Answerable but stale | 10 | Answer + "last checked …" caveat |
| Unanswerable (unknown attribute / no step-free route) | 15 | `partial` or `cannot_answer` + VR created |
| Closures | 5 | Route avoids the closed element and mentions the closure |
| Adversarial (guarantee bait, prompt injection in a notice, off-topic, personal-data bait, fake places) | 10 | Declines or abstains; no injection followed; no personal data repeated |
| Multilingual variants (BM, 中文, Tamil, Manglish) of 20 items above | 20 × 4 | **Identical tool calls** across languages; reply in the user's language |

**Metrics and gates**

| Metric | Definition | Gate |
|---|---|---|
| Tool-selection accuracy | Right tool set called | ≥ 95% |
| Argument accuracy | Place IDs + profile exactly right | ≥ 95% |
| Route correctness | Returned route == reference route; never "confirmed" when it isn't | **100%** |
| **Unsupported-claim rate** | Claims without a valid evidence ID (validator) + judge-flagged unsupported statements | **0 on the deterministic set**; ≤ 2% on the judge slice |
| Abstention correctness | Unanswerable items → abstain + VR | **100%** |
| Uncertainty labelling | Badge status == DB status | 100% (computed by the server, so it's a regression check) |
| Language match | Reply language == question language | ≥ 95% |
| Latency | p50 / p95 time to first token and to `done` | p50 < 2 s first token |
| Cost | USD per 100 turns | report |

LLM-judge hygiene: use a stronger model than the system under test (Sonnet judges Haiku), binary rubric questions, the tool outputs given to the judge, and **calibrate on 20–30 human-labelled answers** with agreement reported.

## 3. L2: World-model quality

| Metric | Definition |
|---|---|
| Verified coverage | % of route-relevant attributes (on edges within the site) with `status=verified` |
| Freshness | Median age of verified claims; % stale |
| Journey confirmation rate | % of persona tasks with `confirmed` status, per profile |
| Gap-loop effect | Journey confirmation rate **before → after** one verification round |
| Staff effort | Minutes per VR resolved (timed on the field visit) |
| Seeded-fault detection | Hidden barriers injected vs detected by the simulator |
| Gaps found: simulator vs human walkthrough | Overlap and uniques |

## 4. L3: Human study (P2, 2–6 Nov)

**Design:** within-subjects, 6–8 participants, about 20 minutes each, counterbalanced order.
- **Baseline:** Google Maps plus the facility's public info page or an FAQ we write from the same data (a fair comparison: same facts, different interface).
- **TownshipLens:** the deployed prototype on a phone.

**Tasks** (3 per condition, matched difficulty):
1. "You have a stroller. Find a step-free way from <car park> to the hall and tell me which entrance you'd use."
2. "Find the nearest toilet to <place> that a wheelchair user could use."
3. "Is the <walkway> usable today?" (a closure is active)

**Measures**
| Measure | How |
|---|---|
| Task success | Correct entrance or route chosen (yes/no) |
| Time on task | Stopwatch |
| **Uncertainty comprehension** | After each answer: "How sure is the system about X? What isn't checked?" Score correct/incorrect |
| Confidence | 1–5 Likert |
| Usability | SUS (10 items) for TownshipLens only, or UMUX-Lite (2 items) for both |
| Qualitative | "What would make you trust this?" |

**Recruiting:** friends and family who are parents with young kids, older relatives, and campus disability services (ask early). Try to include at least one wheelchair user; if impossible, say so honestly.
**Ethics:** see [field-verification-guide § Ethics checklist](field-verification-guide.md). No names, consent first, no recordings without explicit consent.

**Reporting:** with n = 6–8 we report descriptive numbers (medians, success counts) and quotes, **not** p-values or generalised claims. Wording: "In a small pilot test (n=7), 7/7 participants chose the correct step-free entrance with TownshipLens vs 3/7 with the map + FAQ baseline."

## 5. Results template (fill in for the deck)

| Claim for the pitch | Number | Source |
|---|---|---|
| Unsupported claims on golden set | _ / _ | eval run `<date>`, prompt `<hash>` |
| Correct step-free route decisions | _ % | eval |
| Abstained correctly when data was missing | _ % | eval |
| Persona journeys confirmed before → after one verification round | _ % → _ % | sim run ids |
| Seeded faults detected | _ / _ | mutation test |
| Staff minutes per gap fixed | _ min | field visit |
| Participants choosing the right entrance (TL vs baseline) | _ / _ vs _ / _ | user study |
| Median time to find the entrance (TL vs baseline) | _ s vs _ s | user study |
| Participants who correctly identified what was unverified | _ / _ | user study |

> **Honesty rule:** every number in the deck links to a row in this table, and every row links to a run or a session log in `evals/results/`.
