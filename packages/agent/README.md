# townshiplens-agent

The TownshipLens assistant: a PydanticAI agent (pinned `pydantic-ai-slim[openrouter]==2.56.0`)
that answers only from the deterministic spatial tools in `packages/spatial`, and streams its
work as `ChatEvent`s to the API's `/chat` SSE endpoint.

## Architecture

```
user message ─► Agent (instructions = prompts/system.md + UI context)
                  │
                  ├─ 10 tools ─► townshiplens_spatial.tools.TOOLS   (facts, evidence, VRs)
                  │     └─ agent.call_tool records into TurnRecord ──► queue ─► tool.call /
                  │        (evidence, routes, route status,                      tool.result /
                  │         scenarios used, VRs)                                 verification.requested
                  │
                  └─ final_answer (forced output tool, FinalAnswer)
                        └─ output_validator: validate.repair_answer (fact-free fixes), then
                           validate.validate_answer(answer, TurnRecord) → answer.check event
                              ├─ ok ─────────────► answer
                              └─ errors ─► ModelRetry (LLM_OUTPUT_RETRIES times)
                                                └─ still bad ─► template.template_answer
run.run_turn: streams tool events while the agent runs, answer.draft deltas while the model
writes final_answer (draft.DraftStreamer), one answer.check per attempt, then text.delta, scene.intent
(route geometry attached server-side), citation, uncertainty, disclaimer (whenever a flood
scenario was used), and always ends with done. Provider/network/config errors emit `error`,
then the template answer, then `done`.
```

The streamed text always starts with a `Route status: <status>` line (from the tool's status for
the answer's route, else the first route returned this turn) when a route was planned. The
summary and numbered steps follow (answer first). Then the caveats, as a `Worth knowing:` list
with one `•` line each (`run.answer_text`). A repeated "Route status: …" sentence written by the
model is dropped, because the label line already says it.

**Drafts and checks (Cycle 0, `ai/world-model`):**
- `answer.draft {attempt, delta}` streams the summary while the model is still writing it. The UI
  shows it muted as "Draft · checking against the township data…".
- A draft stops at the first forbidden word, water depth or raw id, and never ends in a half
  word.
- `answer.check {attempt, ok, issues, repairs}` is the validator's verdict. `issues` are short
  readable reasons (`validate.issue_labels`). A rejected attempt clears the draft, and the
  rewrite starts a new one.
- The validated `text.delta` stream replaces the draft.
- With the mock, drafts stream too (`mock._stream_script`), so tests and e2e exercise them
  without a key.

**What-ifs and memory (Cycle 1):**

- **Tools.** The agent exposes all 12 engine tools. The two world-model tools are:
  - `suggest_interventions`, which returns legal candidate actions with readable labels;
  - `simulate_what_if`, which runs a Township World Model diff (`townshiplens_spatial.twm`).

  `call_tool` keeps each what-if in `TurnRecord.what_ifs`, including `diff_geojson` for the `whatif.diff` scene intent, which is added automatically. Geometry never goes to the model.
- **Validator (`validate.whatif_errors`).** A what-if answer must:
  - say "what-if";
  - quote only numbers from the result: summary and counts, the change of each measure, and total minus a count;
  - keep imagined outcomes conditional ("would be confirmed", never "is confirmed");
  - never call a what-if a real plan ("will be built").
- **Shared wording.** `template.whatif_answer` is shared by the mock (`_whatif` flow, triggered by "what if / imagine / if we build…") and the template fallback.
- **Rendering.** `run.py` adds an uncertainty note and a `Disclaimer(lens="whatif")`, which comes before any flood disclaimer.
- **Multi-turn memory (`memory.py`).**
  - `ChatRequest.session_id` (8–64 chars `[A-Za-z0-9_-]`; the web client mints one per page load) keys an in-process store: at most 6 turns, 200 sessions and 30 min idle.
  - It is never written to disk and never put in a verification request (PDPA).
  - Evidence rules stay per turn, so follow-ups re-run their tools.
  - The mock reads only the current turn (`mock._current`).
  - `evals/run_followups.py` runs a two-turn live smoke.

**Verify-next, tipping points and the rising river (Cycles 2–3):**
- **Tools:** `plan_verifications`, `river_tipping_point` and `rising_river_rollout`.
- **Validator:**
  - `plan_errors`: the answer is conditional ("if … pass") and uses the plan's numbers only.
  - `rollout_errors`: the answer says "not a forecast", names only modelled stages, names the breaking stage, and uses only rollout counts.
- **Shared wording:** `template.plan_answer`, `tipping_answer` and `rollout_answer` are shared by the mock and the template.
- **Scene intent:** a rollout adds `river.rollout`, so the map plays it. The geometry stays out of the prompt.
- **Repair:** it fills `scenario_id` for river-stage simulations.

**Elmina Day rehearsals (Cycles 14–16):**
- **Tool:** `day_rehearsal(day)`, one of weekday | storm | event | friday. It returns trips by outcome, residents by group, school, busiest places and `show_at` (a clock time).
- **Validator (`day_errors`):**
  - the answer says "rehearsal of synthetic residents" and "not a forecast";
  - it names the data gap when there is one;
  - it gives counts as digits, from the rehearsal only (sums and differences of two are allowed; times, ages and durations are not counts);
  - it makes no predictions about real people.
- **Shared wording:** `template.day_answer` (school first, then groups by share hit).
- **Scene intents (server-built):** `flood.set_level` for a storm's peak stage, plus `day.show` (the day, `t_min`, its stage), so the map opens the rehearsal at the moment the answer is about. A rehearsal's stage is filled in by the server; the model is never asked for `scenario_id`.

**Fix-it search and MCP (Cycle 4):**
- **`find_fixes`:** beam search over imagined fixes on the world model (`townshiplens_spatial.fixit`).
  - The best set is recorded as a what-if, so every what-if validator rule applies.
  - A "no change helps" result may not be spun as a fix.
- **MCP server:** `mcp_server.py` serves every engine tool over the Model Context Protocol (FastMCP 4.0.9, Apache-2.0).
  - Run it with `uv run python -m townshiplens_agent.mcp_server`, over stdio.
  - Verification requests from MCP clients stay in memory, and `create_verification_request` is hidden unless `MCP_ALLOW_VR=true`.
  - `TL_DATA_DIR` picks the world.
  - Claude Desktop config:

  ```json
  {"mcpServers": {"townshiplens": {"command": "uv",
    "args": ["--directory", "/path/to/SunNiuBi", "run", "python", "-m", "townshiplens_agent.mcp_server"]}}}
  ```

**Live cost and latency:**
- OpenRouter prompt caching is on (system prompt, tool schemas and the last message).
- On the 13 golden turns this cut spend from about US$0.035 to about US$0.006.
- The median first visible text went from 12.0 s to 5.7 s (Haiku 5.5; `evals/results/`).

| Module | Role |
| --- | --- |
| `agent.py` | `build_agent(model)`, `model_for(settings, escalate=False)`, `Deps`, `call_tool` |
| `run.py` | `run_turn(ctx, req, settings=None) -> AsyncIterator[ChatEvent]` |
| `answer.py` | `FinalAnswer` / `Claim` (the forced `final_answer` schema) |
| `record.py` | `TurnRecord`: what the tools returned this turn (the validator's ground truth) |
| `validate.py` | The ground-truth gate over `TurnRecord`. Rejects: a claim with no evidence id (unless `cannot_answer`) or an id not returned this turn; any non-`cannot_answer` answer when no tool was called; unknown route ids; "answered" on blocked/no-data routes; a summary/steps that names a different route status than the tool returned (status contradiction); missing partly-unverified caveats; a flooded route endpoint without a caveat naming it; placeholder evidence (`team_survey_placeholder`) described as "verified" / "surveyed on" / "staff checked", or without the caveat "demo values, not yet surveyed" when a route was planned or a placeholder id is cited; a confirmed route over demo values (`demo_evidence`) named as a bare "confirmed" instead of "confirmed (on demo values, not yet surveyed)"; a flood tool used without `scenario_id`; and, for every answer, "safe"/"selamat"/"安全" and water depths |
| Flooded endpoints | Routing may start or end inside a flooded place (you evacuate from where you are). When a scenario is active (plan_route's `scenario_id`, else the UI scenario) and the origin or destination is `likely_flooded`/`possible` in `world.flood.place_classes`, `call_tool` adds evidence `ev-scn-<scenario>.<place_id>`, a warning and `data.endpoint_flood`; the mock and template state it as the first caveat |
| `template.py` | Deterministic fallback answer that always validates |
| `mock.py` | Scripted `FunctionModel` for CI and keyless development |
| `events.py` | SSE event models (`ChatEvent` union), `SceneIntent`, `ChatRequest`. `Citation` carries `source_type` and `photo_url` (the newest staff-uploaded photo on the cited claim, if any) |
| `demo.py` | `DEMO_MODE=true` replay of recorded turns from `data/demo/*.jsonl` (only when `meta.world` equals the loaded world) |
| `prompts/system.md` | System prompt |

The API (`apps/api`) imports `townshiplens_agent.run.run_turn` lazily and sends each event as
`event: <ev.type>` / `data: <ev.model_dump_json()>`.

## Configuration (`.env` at the repo root, server-only)

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | empty | Never logged or printed; scrubbed from `error` events |
| `LLM_PROVIDER` | `mock` without a key, else `openrouter` | Set `mock` to force the scripted model |
| `LLM_MODEL_DEFAULT` | `anthropic/claude-haiku-5.5` | OpenRouter model id |
| `LLM_MODEL_ESCALATE` | `anthropic/claude-sonnet-5.5` | Used by `model_for(..., escalate=True)` |
| `LLM_OUTPUT_RETRIES` | `2` | Validator retries before the template fallback |
| `TURN_TIMEOUT_S` | `60` | Whole-turn budget; on expiry: `error` (`agent_timeout`), template answer, `done` |
| `DEMO_MODE` | `false` | Replay recorded turns from `DEMO_DIR` (default `data/demo`) |

**Switching models is a `.env` change only.** No model names live in code.

## The mock

`mock.mock_model()` is a deterministic script over the real tools that mirrors the hero
flows:

- **Access**: `find_place("car park b")`, `find_place(<destination>)`, `plan_route(profile)`.
  The destination is the first of `lakeside mall | mall | playground | kiosk | toilet` in the
  prompt (default `playground`), so the "mall" persona chip routes to `lakeside-mall`. On the tiny fixture, the playground is `confirmed`; the kiosk is
  `partly_unverified` and files a VR for `seg-cf.incline_pct`. For `older_adult_rest`
  (`labels.rest_caveats`, also used by the template): a route over the rest limit gets
  "Longest stretch without a rest point is about N m (limit 100 m)." and a route that keeps the
  limit only through unverified rest points names them ("Rest point not checked yet: ...").
  "Some segments are still unverified" is only said when the route has unknown segments. The
  validator requires the rest-gap caveat whenever the answered route has `rest_limit_met: false`.
- **Flood resident** (flood words, no "cut off"/"briefing"): `find_place(<origin>)`,
  `list_evacuation_centres(stage_p3m)`, `plan_route` to the nearest reachable centre as
  `__centre__<centre_id>`. Names the centre's source. Always says "not a forecast".
- **Flood management** ("cut off", "affected", "briefing"): `list_flood_scenarios`,
  `affected_places(stage_p3m)`, a count summary and `flood.set_level`.
- **Waste** ("recycl", "e-waste", "waste", "battery", "bin"): `find_waste_points` near
  `lakeside-mall`. If nothing of the asked type is mapped (as with recycling on the Elmina seed),
  it lists the nearest unconfirmed waste points, says "No recycling drop-off is mapped yet", points
  to MBSA for official locations, answers `partial` and files no VR.
- **Anything else**: `find_place(<prompt>)`. If nothing matches, it files a `missing_place`
  VR with `target_id="unknown_place"` and a generic summary (never the user's words), and
  answers `cannot_answer`.

Verification requests never store model-written text. `safe_vr_args(world, kwargs, source="chat")`
(also used by the API's staff `POST /verification-requests` with `source="staff"`) keeps
`target_id` only if it is an existing edge/place/centre/waste id (and never for `missing_place`,
which becomes `unknown_place`), constrains `attribute` to `^[a-z_]{1,40}$` and `reason` to the
known set, and replaces `question_summary` with a fixed `"<source>: <reason> <attribute> on
<target>"` (max 120). The VRs that `plan_route` files get `route_summary(...)` instead:
`"<profile> route <place or centre name> -> <place or centre name>"`, never ids or user words.

The active UI scenario (`ChatRequest.scenario_id`, constrained to `baseline|stage_p1m…p5m` and
only used when it exists in the world) is injected into `plan_route`, `list_evacuation_centres`
and `affected_places` when the model omits it, so routes avoid flooded paths and the disclaimer
follows.

The profile comes from the prompt ("wheelchair", "stroller") or else from the UI profile in the
dynamic instructions.

## CLI

```bash
uv run python -m townshiplens_agent.cli "Can I push a stroller from Car Park B to the kiosk?"
```

Prints one line per event. It uses `data/seed/elmina` when that has been built, else the tiny
fixture, with a VR store at `.data/cli.db`. The model comes from `.env`; put `LLM_PROVIDER=mock`
in front to force the mock.

## Golden questions

```bash
pnpm golden                  # mock, runs in CI
GOLDEN_REAL=1 pnpm golden    # OpenRouter with the .env model (costs money; manual only)
```

`evals/run_golden.py` runs `evals/golden/hero.yaml` against the tiny fixture with a temporary
VR database. It checks `tools_include`, `events_include`, `done_status_in`, `text_includes`, `text_excludes`
and `first_line` (required prefix of the first text line, e.g. `Route status: `), prints a table
and the metric `answered_without_citations` (turns that were answered/partial but emitted no
`citation` event), and exits 1 on any failed case. In mock mode a non-zero
`answered_without_citations` also fails the run; with `GOLDEN_REAL=1` it is only printed.

## Tests

`uv run pytest packages/agent`. The `test_run.py` tests drive `run_turn` with the mock over the
real spatial tools on the tiny fixture. They make no network calls.

## What to build next (AI lane)

- **Escalation on retries**: rerun with `model_for(settings, escalate=True)` when the validator
  exhausts its retries on the default model, before the template fallback.
- **Multilingual aliases**: BM and Chinese place aliases and nicknames in the seed, plus
  language-aware answer templates.
- **Promptfoo suite**: a wider red-team and regression set (prompt injection in tool data,
  "safe" phrasing, depth questions, emergencies) run against real models on a budget.
- **Resident-agent tester runner**: simulated resident personas (stroller, wheelchair,
  older adult) that ask multi-turn questions and score the answers.
- **OpenCellID connectivity layer**: a coverage tool for "will I have signal there?" during
  floods (`OPENCELLID_TOKEN` is reserved).
- **MCP**: expose the 10 spatial tools as an MCP server so other agents can use the same
  grounded facts.
