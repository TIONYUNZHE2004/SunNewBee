# TownshipLens AI: investigation and target design (2026-10-15)

Owner: AI lane. Status: **proposal for team decision**, not yet approved.

Inputs:
- [Question catalogue](../../evals/catalogue/questions.yaml): 97 questions with their coverage today.
- [Research: winners and similar products](../02-research/ai-winners-and-similar-products.md).
- The existing [ai-assistant-design](ai-assistant-design.md) and [evaluation-plan](../03-product/evaluation-plan.md).
- The code on `main` at `fd113e7`.

Labels: **fact** = checked in code, data or a source · **inference** = engineering judgement · **unverified** = not checked.

## 0. Answers in one page

| Question | Answer |
|---|---|
| Is the current AI good enough to win? | **No.** The safety core is sound, but it answers only a narrow set of resident questions, in English, one message at a time, and nobody has measured it on a real model. |
| Should we fine-tune a model, or move to AWS Bedrock? | **No** (inference). We have no training data, and facts must come from the twin anyway. Bedrock is another way to rent the same models; it does not make the AI smarter. Section 6 explains when that would change. |
| What makes an AI agent "mature"? | Five things: **tools** that cover the real questions, **memory** for follow-ups, **honesty checks in every language**, **measurement** on many real questions, and **tracing**. |
| What should we build? | Keep the architecture. Add (1) a planner/staff copilot with what-if tools, (2) session memory, (3) a language-neutral honesty checker, (4) a live evaluation suite, and (5) a visible "how I got this answer" trace. |
| What blocks us now? | No `OPENROUTER_API_KEY`, and this cloud environment's network policy blocks `openrouter.ai`. Without both, we cannot measure the real model. |

**Today's coverage** (fact for the catalogue; inference for the outcome, because nothing was run live):

| Outcome | Questions | Share |
|---|---|---|
| Handled well: answered, or correctly declined | 23 + 15 = 38 | 39% |
| Partly handled: wrong language, or missing detail | 8 + 13 = 21 | 22% |
| Not handled: no tool, no data, no profile or no memory | 18 + 11 + 3 + 6 = 38 | 39% |
| **Of the 33 high-demo questions, handled well** | **13** | **39%** |

Most high-demo failures are **missing tools** (9 of 33), and they are the **planner and staff questions**. The engine already computes most of the answers; the AI just can't reach them.

## 1. AI concepts for a network engineer

| AI term | Network analogy | In TownshipLens |
|---|---|---|
| LLM (the model) | A skilled NOC operator who can't see the network directly | Rented through OpenRouter; a model ID in `.env` |
| System prompt | The operator's runbook | `packages/agent/.../prompts/system.md` |
| Tool | A read-only API or `show` command the operator may run | 10 functions in `packages/spatial/.../tools.py` |
| Agent loop | The operator running show commands until they can answer the ticket | PydanticAI calls tools, then forces `final_answer` |
| Structured output | A ticket template with required fields | `FinalAnswer` in `answer.py` |
| Validator | An egress ACL: drop anything that breaks policy | `validate.py` rejects, the model retries twice, then a template answers |
| Memory | Session state, like a NAT/conntrack table with a timeout | **Missing**; each message starts fresh |
| Evaluation | Regression and SLA tests (ping/iperf suites) after every change | 13 scripted questions; no real-model test |
| Tracing | Packet capture / NetFlow for each request | Tool names stream to the UI; nothing is recorded |
| Fallback model | A redundant uplink with failover | Not used (`FallbackModel` exists in the library) |
| Fine-tuning | Re-flashing the operator's firmware | Not used, and not needed (section 6) |
| Prompt injection | Spoofed control-plane traffic | Tool text is treated as data; staff closure notes are stripped |

Rule of thumb: **change the runbook (prompt) or add show commands (tools) before you touch the firmware (fine-tuning).**

## 2. What exists vs what was planned (fact)

| Item | Planned in the design docs | Built on `main` |
|---|---|---|
| 22 tools + forced `final_answer` | Yes | ✅ |
| Validator + 2 retries + template fallback | Yes | ✅ English only |
| Mock model for CI | Yes | ✅ English only |
| Golden set | ~200 items across slices, including 80 multilingual ([evaluation-plan § 2](../03-product/evaluation-plan.md)) | ⚠️ 13 items, mock only |
| Personal-data redactor before the model | Yes ([ai-assistant-design § 2](ai-assistant-design.md)) | ❌ |
| Escalation to a stronger model | Yes (§ 8) | ❌ setting exists, never used |
| "Numbers in text must appear in tool results" rule | Yes (§ 6) | ❌ |
| Promptfoo / eval in CI with live numbers | Yes (§ 10) | ❌ |
| Session memory | Not planned | ❌ |
| Staff/planner questions through the AI | Partly (advisory draft) | ❌ advisory is a web template |

## 3. Target architecture

```
                 ┌──────────── Web (Shaoxian) ─────────────┐
                 │ chat · "How I got this answer" panel     │
                 │ sends session_id + role (resident/staff) │
                 └───────────────┬──────────────────────────┘
                                 │ POST /chat (SSE)
┌────────────────────────────────▼─────────────────────────────────────────┐
│ apps/api  /chat                                                           │
│   1. Redactor: strip IC / phone / email before anything leaves the server │
│   2. Session store: last N turns + conversation state, 30-min TTL (SQLite) │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────────────┐
│ packages/agent   ONE agent core, role-based toolsets (not multi-agent)    │
│   model: FallbackModel(primary, backup)   escalate on retry exhaustion    │
│   toolsets: resident (10 today)  +  staff/planner (new, STAFF_TOKEN only) │
│   output: FinalAnswer + language-neutral honesty flags                    │
│   validator: structural checks + per-language banned-term lists           │
│   tracing: OpenTelemetry spans per turn (tools, retries, tokens, latency) │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │ deterministic calls only
┌────────────────────────────────▼─────────────────────────────────────────┐
│ packages/spatial  the digital twin engine                                 │
│   existing: routing · flood · closures · VRs · sim gap ranking            │
│   new tool wrappers: rank_gaps · coverage_stats · what_if_closure ·       │
│                      what_if_fix · compare_scenarios · centre_thresholds  │
└──────────────────────────────────────────────────────────────────────────┘
        evals/catalogue → evals runner (mock in CI, live on demand) → scorecard in the deck
```

### 3.1 One agent with role-based toolsets, not a team of agents
- **Decision (proposed):** keep one agent. Give it a resident toolset and, for staff sessions, an extra staff/planner toolset.
- **Why** (inference, following [Anthropic's guidance](https://www.anthropic.com/research/building-effective-agents) to start simple):
  - Multi-agent setups add latency, cost and new failure points.
  - Our questions need 2–6 tool calls, not long autonomous work.
  - Choose the role deterministically from the UI and the staff token, never by asking the LLM. That keeps staff tools away from anonymous users.
- **When to revisit:** if planner questions regularly need more than 8 tool calls, add a "planner" workflow with fixed steps, not free agents.

### 3.2 New tools (the biggest win)
Each tool is a deterministic function in `packages/spatial`. The LLM only picks it and phrases the result, as today.

| Tool | Answers (catalogue IDs) | Built from | Effort (inference) |
|---|---|---|---|
| `rank_gaps(profile, scenario_id?, limit)` | S02, H06, P01, P10 | `sim.run_suite` gap impact (exists) | S |
| `coverage_stats(profile)` | S04, P09 | gap-map logic in `apps/api/.../core.py::gaps_layer` | S |
| `what_if_closure(element_ids, profile, scenario_id?)` | P02 | Re-run the sim tasks on a **snapshot** with a temporary FAIL; never writes | M |
| `what_if_fix(element_id, attribute, value)` | P03 | Same snapshot pattern; flips one unknown to PASS, as gap impact already does | M |
| `compare_scenarios(a, b, profile)` | H04, P07 | `flood.affected` twice + set diff | S |
| `centre_thresholds(profile)` | H10, P07 | `centres_reachability` per stage | S |
| `get_kpis()`, `question_clusters()` | S03, S01 | `/kpis` exists; clusters wait for Task 63 | S |
| `plan_route(..., alternatives=2)` and a per-route attribute summary (covered, lit, seats) | A08, A29, A34, M02 | `routing.py` | M |
| `layer.toggle` for the gap layer as a scene intent | P06 | Web already has the layer | S (with FE) |

The what-if tools must never change the real twin. They run on `sim.snapshot_world`, which already exists. Answers must say "what-if, not a real closure".

### 3.3 Memory (session only)
- **Store:** the last 6 turns (PydanticAI `message_history`) plus a small **conversation state**: last places, profile, scenario and route ID. Key it by `session_id`, kept in SQLite with a 30-minute TTL.
- **Honesty rule:** memory is for *context*, never for *facts*. A follow-up such as "what about a wheelchair?" must call `plan_route` again in this turn. The validator keeps checking evidence IDs from this turn only.
- **Privacy:** no accounts and no long-term memory (PDPA). The redactor runs before storage. Sessions expire and nothing is shared across users.
- **Needs from the web (Shaoxian):** send a random `session_id` per browser tab. Today the web sends none (fact).

### 3.4 Honesty checks that work in every language
Problem (fact, reproduced 2026-10-15):
- An honest BM answer is rejected.
- Dishonest BM and Chinese answers pass: "disahkan oleh kakitangan" ("verified by staff") and "水深30厘米" ("water 30 cm deep").

Design:
1. **Structured flags instead of English phrases.** The model sets fields such as `uses_demo_values`, `route_status` and `closures_named[]`. The validator checks the flags against `TurnRecord`. The **server** renders fixed, human-reviewed labels per language, like "demo values, not yet surveyed" in EN/BM/中文, so the model never has to write them.
2. **Banned-term lists per language**, as data files in `packages/agent/.../lexicon/{en,ms,zh}.yaml`, each with tests:
   - safe: safe / selamat / 安全;
   - verified-on-demo-data: verified / disahkan / 已核实 / 已验证;
   - depth patterns: cm, m, 厘米, 米, sedalam, 水深.
3. **Place names:** BM/中文 aliases in `find_place` (plan item C-08 #14).
4. **Mock:** language detection plus BM/中文 templates, so CI covers all three languages.
5. **Native-speaker review** of the label table and 20 sample answers: you plus teammates (BM, 中文).

### 3.5 Evaluation (how we prove it)

| Tier | What | Runs | Gate |
|---|---|---|---|
| T1 unit | Validator, lexicon, tools (exists: 317 agent tests) | Every commit | 100% pass |
| T2 scripted | Golden set with the mock, growing from 13 to about 40 | Every commit (CI) | 100% pass |
| T3 live | Catalogue cases with expected outcomes, in EN/BM/中文, on the real model | Before each demo milestone; nightly when the budget allows | Scorecard below |

**T3 scorecard** (these numbers go in the deck):

| Metric | How it is measured | Target |
|---|---|---|
| Tool-selection accuracy | Expected tool set ⊆ called tools (deterministic) | ≥ 95% |
| Argument accuracy | Place IDs, profile and scenario exactly right (deterministic) | ≥ 95% |
| Engine agreement | Route status and centre lists equal a direct engine call | 100% |
| Honesty violations | Validator plus lexicon on the final text, in all languages | 0 |
| Correct abstention | Out-of-scope, no-data and adversarial items decline or file a VR | 100% |
| Language match | Reply language = question language | ≥ 95% |
| Template fallback rate | Turns where the model failed validation twice | report (< 5% goal) |
| Latency p50 / p95 | Time to first text and to `done` | report (p50 first text < 2 s goal) |
| Cost per 100 turns | Token usage × price | report |

- **Tooling:** extend `evals/run_golden.py`, or adopt `pydantic-evals` (MIT, same version line as our pinned `pydantic-ai-slim`). Fact: the licence and dependencies were checked from the wheel. I recommend `pydantic-evals`, because it records spans and supports case datasets in YAML.
- **LLM judge:** only for tone and clarity, from a different model family, calibrated on 20–30 human-labelled answers.

### 3.6 Tracing and transparency
- Turn on PydanticAI's `Instrumentation` capability (OpenTelemetry).
  - **Fact:** the capability exists in 2.56.0.
  - **Unverified:** which collector we use. A local Jaeger or OTLP file export is free; Logfire is a hosted service whose licence and cost need checking.
- Record per turn: tools and arguments, evidence IDs, retries, fallback used, tokens, latency and model.
- **"How I got this answer" panel** (with Shaoxian): show the tool steps (chips exist today), the evidence used and the gaps found. It is the honesty story made visible in a live demo.

### 3.7 Reliability
- `FallbackModel(primary, backup)`: a second model or provider when the first errors or times out. Both IDs come from `.env`.
- Implement the dead `LLM_MODEL_ESCALATE` path: retry on the stronger model before using the template.
- Keep `DEMO_MODE` replay as the last line of defence on pitch day.

### 3.8 Privacy
- Build the planned redactor (MyKad `\d{6}-\d{2}-\d{4}`, phone numbers, emails) before the model call and before session storage. Catalogue item X08 shows today's gap.
- Keep the existing rules: no user text in VRs or logs; staff notes stay off the model.

## 4. Model and provider choice

| Option | Verdict | Why |
|---|---|---|
| Keep OpenRouter, pick the model by T3 eval | **Recommended** | One key, any model, model in `.env`. Prices in [ai-assistant-research § 1.4](../02-research/ai-assistant-research.md): Haiku-class ≈ $0.0006 per turn, Sonnet-class ≈ $0.012 per turn. |
| AWS Bedrock | Only if sponsor credits or a Malaysian data-residency story matter to judges | Same model families. Bedrock fine-tuning is irrelevant without data (inference). Malaysian-region Bedrock availability unverified. |
| Malaysian models (ILMU, MaLLaM) | Experiment only, if an API is available | Possibly stronger Malay. Tool-calling quality, API access and pricing unverified. Test on the BM slice of T3 before any switch. |
| Fine-tuning | Not now | No labelled data; facts must stay in tools; costly. Revisit only if T3 shows a stable failure, such as BM phrasing, that prompts and tools cannot fix, *and* we have hundreds of reviewed examples. |

## 5. Roadmap to the final submission (11 Nov)

| Phase | Dates | Deliverable | Acceptance |
|---|---|---|---|
| **0 Baseline** | 16–18 Oct | Live T3 runner over catalogue items with expected outcomes; first scorecard | Needs the key and network access (section 0). The scorecard is committed with its date, model and prompt hash. |
| **1 Honest in 3 languages + memory** | 19–23 Oct (proposal due 23 Oct) | Section 3.4 checker, BM/中文 mock, redactor, session memory (API side) | A01–A04, F01–F03, X09–X11 and M01 pass in T2; the proposal quotes the baseline and the plan |
| **2 Planner copilot** | 24 Oct – 1 Nov | Staff toolset: `rank_gaps`, `coverage_stats`, `compare_scenarios`, `centre_thresholds`, then `what_if_closure` and `what_if_fix` | S02, S04, H04, H10, P01–P03 and P09 pass in T2 and T3 |
| **3 Visible and reliable** | 2–8 Nov | Trace panel (with FE), fallback and escalation, T3 at about 150 cases × 3 languages, model chosen by score | Scorecard meets the targets, or the gaps are stated honestly |
| **4 Freeze** | 9–11 Nov | Final numbers in the deck; demo cache re-recorded | Every deck number links to an eval run |

Handoff Task 62 (waste goldens, early status line, sim explanations, seed invariants) fits inside phases 1–2.

## 6. Work split for several agents

One lane branch, `ai`, plus one branch per agent. Each agent owns files, so merges don't collide. A file listed under two agents means the second waits for the first to merge.

| Agent | Work | Owns |
|---|---|---|
| A: eval | Phase 0 runner, catalogue → cases, scorecard | `evals/**` |
| B: honesty | Section 3.4 checker, lexicon, BM/中文 mock and template | `packages/agent/.../validate.py`, `lexicon/`, `mock.py`, `template.py`, `labels.py` |
| C: memory + privacy | Session store, redactor, `run.py` history | `packages/agent/.../run.py`, `events.py`, `apps/api/.../routes/chat.py`, new `session.py`, `redact.py` |
| D: planner tools | Section 3.2 tools + agent wrappers | `packages/spatial/.../tools.py` (new functions only), new `whatif.py`, `packages/agent/.../agent.py` (toolset registration) |
| Shaoxian (FE) | `session_id`, role, trace panel, gap-layer intent | `apps/web/**` |

## 7. Decisions needed

1. **Planner/staff copilot in scope?** A: yes (recommended above) · B: residents only.
2. **Live model access:** A: get an OpenRouter key with a spend limit (e.g. USD 20) and allow `openrouter.ai` in the environment's network settings · B: mock only until later.
3. **Multilingual priority:** the handoff ranks C-08 last (team-lead ruling). A: raise the honesty part (section 3.4) to phase 1 · B: keep it last.
4. **Memory TTL:** A: 30 minutes · B: per browser tab only, no server storage.

## 8. What you can own as a network engineer

| Task | Why it fits |
|---|---|
| OpenRouter key, spend limit, provider allow-list (zero data retention) | Access control and policy |
| Network allow-list for `openrouter.ai` in the cloud environment | Egress rules |
| Tracing setup: an OpenTelemetry collector and a dashboard of latency, errors and fallback rate | Like NetFlow and SNMP monitoring |
| Failover design: primary/backup model, timeouts, demo cache | Like redundant links and timers |
| Load and latency test of `/chat` before pitch day | Like iperf / SLA testing |
| Running T3 and reading the scorecard | Like regression testing after a config change |

## Sources

Research details and links: [ai-winners-and-similar-products.md](../02-research/ai-winners-and-similar-products.md). Code facts refer to `main` at `fd113e7`.
