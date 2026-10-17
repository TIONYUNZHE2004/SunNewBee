# AI audit, handoff and plan (17 Oct 2026)

Owner: Yunzhe (AI lane). Written by the Claude worker session on `claude/kind-cannon-mormhi`.
State as of the fetch at **2026-10-17 06:54 UTC** (14:54 Malaysia time). Control branch `claude/sweet-davinci-29v7ne` at `086a925`; `main` at `d381c23`.

Purpose: one place for any agent that continues this work, and for the **external auditor** who checks it afterwards. Read the workflow first: [yunzhe-branch-workflow.md](../05-team/yunzhe-branch-workflow.md), then [AGENTS.md](../../AGENTS.md).

Labels: **fact** = checked in code, data or a command run in this session · **inference** = engineering judgement · **unverified** = not checked.

---

## 1. Summary

1. **The AI design is sound** (fact). The LLM only calls deterministic tools in `packages/spatial`, a validator (`packages/agent/.../validate.py`) checks every answer against what the tools returned, and a template answers when the model fails twice.
2. **Two honesty holes remain** (fact, reproduced):
   - **F1:** a toilet and 3 benches that a script invented are served as real places.
   - **F2:** the validator accepts invented route numbers.
3. **The data under the twin is mostly unchecked** (fact):
   - OSM gives 0 slope and 0 width facts.
   - The 18 demo-route segments carry invented "verified" values (`team_survey_placeholder`).
4. **Plan:**
   - **A** (validator) and **B** (privacy + cost guard) are in Yunzhe's lane. This session starts them now.
   - **C** (fake places) needs Jun Quan (Backend).
   - **D** (live model comparison) needs an OpenRouter key and network access.

## 2. What is verified (fact)

### 2.1 Branches and team

| Item | State |
|---|---|
| Lanes | Jun Quan = Backend (also active in AI), shaoxian04 = Frontend, Yunzhe = AI + docs/pitch/research ([workflow, "My scope"](../05-team/yunzhe-branch-workflow.md)) |
| Flow | Workers branch from control and open PRs **into `claude/sweet-davinci-29v7ne`**, never `main` |
| This worker | `claude/kind-cannon-mormhi`, restarted on control at `d583d37`, now at control `086a925` |
| Git identity | `TIONYUNZHE2004 <23004941@siswa.um.edu.my>` |
| Shallow clones | Cloud sessions clone shallow. Run `git fetch --unshallow origin` before any history comparison. A shallow clone caused the wrong "main was restarted" claim on 17 Oct. |

### 2.2 The digital twin data (`data/seed/elmina`)

| Fact | Value | How it was made |
|---|---|---|
| Path segments | 16,148 (about 1,190 km) | `data/scripts/import_osm.py`: OSM roads and footpaths in bbox 101.46–101.53 E, 3.15–3.24 N, split at junctions |
| Places | 231 | OSM amenities + `build_overlay.py` |
| OSM accessibility facts on segments | steps 3, **slope 0, width 0**, surface 783, wheelchair tag 516 (not used by routing) | OSM tags only |
| Segments with a width fact | 18 of 16,148 | All invented by `build_overlay.py` (0 steps, 3 %, 1.5 m, status `verified`, `evidence_type: team_survey_placeholder`) |
| Demo places invented by `build_overlay.py` | "Urban Park toilet", "Urban Park bench 1–3": placed at 90 %, 20 %, 50 % and 80 % along the demo route. "Lakeside Mall Car Park B" is the OSM car park nearest a typed coordinate. | See F1 |
| Crossing segments | 132; crossing type recorded on 0 (the type attribute was added on 17 Oct; the seed is not rebuilt) | OSM street crossings drawn as *nodes* are not imported at all |
| Buildings (stylised city) | 7,803; **94 % default heights**; display only | `build_buildings.py` |
| Flood scenarios | River +1 to +5 m, REM on Copernicus GLO-30 (30 m) | `build_flood.py`, indicative only |

Data that **cannot** be used: Google Maps, Street View or Waze content as data. Their terms forbid scraping and building databases. View them by eye only.

### 2.3 The AI (`packages/agent`)

| Part | State |
|---|---|
| Harness | PydanticAI `pydantic-ai-slim[openrouter]==2.56.0`, OpenRouter, model from `.env` (`LLM_MODEL_DEFAULT=anthropic/claude-haiku-5.5`) |
| Tools | 10 base tools plus Jun Quan's world-model tools (what-if, verify-next, fix-it, rising river, tipping point, Elmina Day), with an MCP server |
| Answer gate | Forced `final_answer` → `validate.repair_answer` + `validate_answer` → up to 2 rewrites → template |
| Memory | `memory.py`: per `session_id`, max 6 turns, 200 sessions, 30 min idle, 6,000 chars |
| Languages | EN/BM/中文 checks for "safe", verified-on-demo and depth (Jun Quan, `test_validate_multilingual.py`) |
| Live test (Jun Quan, 17 Oct) | 36 questions on Haiku 5.5: 0 honesty violations, 0 template fallbacks, 25/36 first-attempt, median 7.0 s to first text, about US$0.87 for all live runs. One run, one model; the scorer reuses the validator's rules ([eval report](../03-product/ai-eval-report-2026-10.md)) |

### 2.4 Work from this session, now on control as commit `1d3e118`

| Change | Files | Notes |
|---|---|---|
| Model comparison: `evals/compare_models.py` + `evals/model_prices.yaml` | evals | Ranks by honesty gate, then fallbacks, first-attempt, expected tool, speed, cost. Prices are dated search snapshots. |
| Backup model `LLM_MODEL_FALLBACK` (`FallbackModel`) and opt-in `LLM_ESCALATE_ON_REWRITE` (`SelectModel`) | agent.py, run.py, settings.py | Both off by default; tests in `test_failover.py` |
| Engine time vs model time per turn | record.py, agent.py, run_eval.py | Mock run: median engine time 0.035 s; the first what-if, rollout or fix-it call in a cold process takes 16–32 s (cache warm-up) |
| Compact `list_evacuation_centres` for the model | agent.py | About 15.7k → 6.6k tokens per call |
| Road crossings: `crossing` attribute, `Route.crossings`, `crossing_note`, traffic-light claim check | spatial (Backend), api-client, web catalogue, agent | Informative only; routing unchanged |

Checklist on that code (`79eb6ef`): lint PASS, pytest 1,274 PASS, typecheck PASS, vitest 789 PASS, gen PASS, golden 22/22 PASS, e2e 19 PASS. e2e needed `launchOptions.executablePath=/opt/pw-browsers/chromium` in a temporary config, because this container's Playwright browser build differs. All mock-backed.

### 2.5 Environment limits (this cloud container)

| Limit | Effect | Remedy |
|---|---|---|
| No `OPENROUTER_API_KEY`; `openrouter.ai` blocked by the network policy | No live model runs | Environment settings: add the secret `OPENROUTER_API_KEY` and allow `openrouter.ai`; set a US$10 spend cap on OpenRouter |
| Overpass (OSM) blocked | No seed rebuild here | Rebuild on a laptop or after allowing `overpass-api.de` |
| Node 22 (repo wants 24) | Works so far | Watch for engine errors |
| `uv sync` needed after dependency changes (e.g. `fastmcp`) | `ModuleNotFoundError` in tests | `uv sync --all-packages --all-groups` |
| Playwright browser mismatch | e2e fails in 3 ms per test | Temporary config with `executablePath: "/opt/pw-browsers/chromium"`; do not commit it |

## 3. Audit findings (17 Oct)

Reproduce F2 and F3 with `uv run python evals/audit_probes.py`. Baseline before the fixes: **6 of 10 dishonest probes accepted**; the honest control is accepted.

| # | Severity | Finding | Reproduce | Lane |
|---|---|---|---|---|
| **F1** | High | Invented toilet and benches are served as real places. `nearby_amenities(playground, toilet)` returns "Urban Park toilet, 58.5 m" with evidence `world_model / reported`, not placeholder. A live model would send a wheelchair user there. | Python: `tools.TOOLS["nearby_amenities"](ctx, origin_id="playground", amenity="toilet", max_walk_m=500, profile="wheelchair")` on the seed | Backend (data) |
| **F2** | High | Invented route numbers pass. The number-faithfulness rule covers only what-if and simulation answers. | `audit_probes.py`: "It is 950 m long and takes 2 minutes" is ACCEPTED (route is 440.6 m) | AI |
| **F3** | Medium | Overconfident wording passes outside flood answers: "totally accessible", "I guarantee", "no risk", "tiada risiko", "没有危险" | `audit_probes.py` | AI |
| **F4** | Medium | No personal-data redaction in chat. IC, phone or email in a question goes to OpenRouter and into session memory. Tickets are already sanitised (`safe_vr_args`). | `grep -rn redact packages/agent apps/api` finds nothing | AI (+ API) |
| **F5** | Medium | Cost exposure. `/chat` is public with no rate limit, and one turn may make up to 50 model requests (`UsageLimits()` default) within the 60 s turn timeout. | `routes/chat.py`, `run.py` | AI (request cap) + Backend (rate limit) |
| **F6** | Low | Evaluation is not independent. CI is mock-only, the live scorer reuses validator rules, and there is a single run of one model. | Eval report §6 | AI |
| **F7** | Low | Cold-start latency of 16–32 s on the first what-if, rollout or fix-it. `apps/api/.../warm.py` pre-warms at startup and re-warms after the world changes (e.g. a resolved ticket). | Mock timing run (§2.4) | Backend |

Verified OK in the audit:
- Staff token compared with `hmac.compare_digest`.
- `ChatRequest.message` is 1–2,000 chars; `session_id` must match `^[A-Za-z0-9_-]{8,64}$`.
- Memory is bounded.
- BM/中文 verified-on-demo and depth wording are rejected.
- CORS uses `ApiSettings().cors_origins`.

## 4. Plan

| WP | Fixes | Scope (files) | Acceptance (all mock, no key) | Owner | Status |
|---|---|---|---|---|---|
| **A. Honesty gate** | F2, F3 | `validate.py` (+ `test_validate*.py`), `evals/audit_probes.py` as a pytest test | `audit_probes.py` exits 0: 0/10 dishonest accepted, honest control accepted. Golden 22/22. Mock eval suite still has 0 template fallbacks. Mock, template and validator stay consistent. | This session | **Done** (`ed21fff`): probes 0/10 accepted; mock eval 36/36 first attempt, 0 fallbacks |
| **B. Privacy + cost guard** | F4, F5 (request cap) | New `packages/agent/.../redact.py`, `run.py` (redact before the model and before memory), `settings.py` (`LLM_REQUEST_LIMIT`, default 12), tests | An IC `123456-12-1234`, a phone `012-345 6789` and an email never reach the model's messages or `memory`. A turn that exceeds the request cap ends with the template + `done`. Existing tests pass. | This session | **Done** (`ba48375`): `redact.py`, `LLM_REQUEST_LIMIT=12` |
| B2. Rate limit on `/chat` | F5 | `apps/api/.../routes/chat.py` | Per-IP limit (e.g. 20 per minute, in memory) returns 429 | Backend (Jun Quan) or this session with "Touches Backend" | Ask first |
| **C. Fake places** | F1 | `data/scripts/build_overlay.py` (mark invented places' existence as `team_survey_placeholder`, or remove them), seed regeneration, demo cache re-record | The tool result for the toilet carries placeholder evidence; the answer says "demo values, not yet surveyed"; or the places are gone | **Jun Quan** (Backend); needs his OK | Not started |
| **D. Live comparison** | F6 | `evals/compare_models.py --models anthropic/claude-haiku-5.5,deepseek/deepseek-v4.1-flash` | Comparison table committed under `evals/results/`; cost under US$1 | Yunzhe (key + network), then any agent | Blocked (§2.5) |
| E. Human-judged set | F6 | 20–30 questions written by people, judged pass/fail by Yunzhe | Score with date, model and prompt hash | Yunzhe + team | Not started |
| F. Corridor mapping | Data | OSM editor (iD) over permitted imagery: footpaths, crossings with type, traffic lights, kerb ramps on Car Park B → mall → park | Re-import shows non-zero crossing types on the demo corridor | Yunzhe (mapping) + Backend (re-import) | Not started |

Rules that apply to every WP: AGENTS.md honesty invariants; the validator, mock and template change together; mock only (`LLM_PROVIDER=mock`); run the 7-step checklist; open a PR into `claude/sweet-davinci-29v7ne` and list any Backend or Frontend file under "Touches Backend/Frontend".

### 4.1 Results of A and B (17 Oct, mock-backed)

| Check | Result |
|---|---|
| `evals/audit_probes.py` | 0/10 dishonest probes accepted (was 6/10); honest control accepted |
| Mock eval suite (36 questions) | 36/36 first attempt, 0 template fallbacks, 0 rewrites (unchanged, so no over-blocking on the mock) |
| Checklist on `3c06390` | lint PASS · pytest 1,319 PASS · typecheck PASS · vitest 789 PASS · gen PASS · golden 22/22 PASS · e2e 19 PASS (system Chromium workaround, §2.5) |
| Live model | NOT RUN (no key, network blocked). A live model may now be sent back more often for numbers it rounds unusually; check `answers_rewritten` and `template_fallbacks` in the first live run (auditor items 12–14). |

Design notes for the auditor:
- **Measurements (F2).** `validate.measurement_errors` reads "N m / km / min / %" (also 米, 公里, 分钟). Each must match a tool number **in the same unit** (keys `*_m`, `*minutes*`, `*_pct`), with rounding: fewer decimals, or a round number within 15 %. Untyped numbers (evidence values, numbers in text) must match exactly. "+3 m" is a stage label and is skipped.
- **Promises (F3).** `validate.overclaim_errors` rejects guarantees, "no risk / no danger", and intensified accessibility words in EN/BM/中文, unless a negation sits in the 25 characters before the word.
- **Redaction (F4).** `redact.redact` runs once at the start of `run_turn`. The demo cache key still uses the original question, which is never stored.

## 5. For the helper agent (continuing the work)

1. Read the workflow doc, `AGENTS.md`, `CLAUDE.md`, `packages/agent/README.md` and this file.
2. `git fetch --unshallow origin` (if shallow); `git fetch origin`.
3. Branch: continue on `claude/kind-cannon-mormhi` only if this session handed it over. Otherwise create `<agent>/<task>` from `origin/claude/sweet-davinci-29v7ne`.
4. Setup: `pnpm install && uv sync --all-packages --all-groups`.
5. Check the §4 status column and `git log --oneline origin/claude/kind-cannon-mormhi` for what is already done. Do not redo a WP marked done.
6. When done: the checklist, push, a PR into control, and the PR link to Yunzhe.

## 6. External auditor checklist

Run each check after A and B (and later C, D) are merged into control. Report PASS / FAIL / BLOCKED / NOT RUN with the command output.

**Process and scope**
1. The PR targets `claude/sweet-davinci-29v7ne`, not `main`. Its commits are Conventional, with scopes.
2. Every file outside `packages/agent/**`, `evals/**` and the AI docs is listed under "Touches Backend/Frontend" and is the smallest change possible.
3. No `.env` value, key or token appears in the diff, logs or results files (`git grep -nE "sk-or-|OPENROUTER_API_KEY=.+"`).

**CI-equivalent checklist** (from the repo root, `set -o pipefail`)

4. `pnpm lint`
5. `uv run pytest -q`
6. `pnpm -r --if-present typecheck`
7. `pnpm -r --if-present test`
8. `pnpm gen && git diff --exit-code packages/api-client`
9. `pnpm golden`: expect 22/22 or more
10. `pnpm --filter @tl/web e2e`: see §2.5 for the browser workaround

**Honesty gate (WP A)**

11. `uv run python evals/audit_probes.py` exits 0: 0 dishonest probes accepted, honest control accepted.
12. **No over-blocking.** `uv run python evals/run_eval.py` (mock) gives 0 template fallbacks and the same first-attempt count as before the change (36/36 on the mock).
13. Write 3 new dishonest answers of your own that the probes do not cover (a new phrasing of a guarantee, a wrong walking time, a made-up count) and check that the validator rejects them. Report any it accepts.
14. Check that an honest answer with an **engine number rounded** to a coarser unit (440.6 m → "about 440 m") is still accepted.

**Privacy and cost (WP B)**

15. Unit tests prove that an IC, a phone number and an email in the question appear neither in the messages sent to the model nor in `memory` (inspect the `FunctionModel` messages).
16. A turn that makes more requests than `LLM_REQUEST_LIMIT` ends with the template answer and `done`, never a hang or a 500.
17. Tickets (VRs) still contain no user words (`safe_vr_args` tests pass).

**Data honesty (WP C, when done)**

18. `nearby_amenities(playground, toilet)` no longer returns an invented place as real: either the place is gone, or its evidence is `team_survey_placeholder` and the answer says "demo values, not yet surveyed".
19. The demo cache is re-recorded with the mock and `test_demo_cache_current` passes.

**Claims in docs**

20. Every number in this file and in `docs/03-product/ai-eval-report-2026-10.md` can be reproduced by a command or a results file. List any that cannot be.

## 7. Open decisions

| Decision | Who | Options |
|---|---|---|
| Fix F1 by removing the invented places, or by labelling them as demo data | Jun Quan + Yunzhe | Remove (most honest) · label (keeps the demo story) |
| Rate limit on `/chat` (B2) | Jun Quan | He does it · this session does it with "Touches Backend" |
| Live budget for D | Yunzhe | US$10 cap (recommended in §2.5) |
| Default model after D | Yunzhe | Decided by the comparison table, not by price alone |
