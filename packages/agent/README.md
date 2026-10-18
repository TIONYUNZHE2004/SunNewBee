# townshiplens-agent

The TownshipLens assistant: a PydanticAI agent (pinned `pydantic-ai-slim[openrouter]==2.56.0`)
that answers only from the deterministic spatial tools in `packages/spatial`, and streams its
work as `ChatEvent`s to the API's `/chat` SSE endpoint.

Demo place existence is retained on tool evidence as `team_survey_placeholder`, including
search names, amenity results and route endpoints/rest points. Existing citation badges show
"Demo value · not surveyed". A provider-failure template also retains the demo caveat when
only place facts were obtained. This labels provenance; it does not certify that a place exists.

## Resident scope B (T-011)

`ASSISTANT_SCOPE=access_flood` is the default. The resident assistant covers access and
indicative flood evacuation anywhere in Elmina; Elmina Urban Park + Elmina Lakeside Mall
frontage is the detailed study area (the accuracy target).
It registers only `find_place`, `get_place_details`, `plan_route`, `nearby_amenities`,
`get_closures`, `create_verification_request`, `list_flood_scenarios`, `affected_places`
and `list_evacuation_centres`. Spatial calculations and staff screens remain unchanged.

**Scope B+ (T-013).** Routes and places anywhere in Elmina are answered, however the question is
worded: there is no "access keyword" rule. Only clearly removed features (waste and recycling,
what-if changes, tipping points, stage-by-stage rollouts, fix-it, verify-next, Elmina Day,
recipes) get a short EN/BM/中文 refusal (`scope.REMOVED`), before model construction, tool
execution, memory retrieval by the model, or demo replay. A cached legacy answer cannot bypass
this policy. Removed phrases are kept narrow so real questions pass ("the town hall", "what
happens to residents if the river rises 2 m?", "what if the path is closed, how do I get to the
mall?"). A bare greeting or thanks ("Hi", "Selamat pagi", "谢谢") gets a fixed hello listing what
the assistant can do (`scope.greeting_text`), also without the model or a tool. Other off-topic
questions reach the model, which declines them (prompt rule 10).

Outside the access deep spot (`site.json` `deep_spots`, lens `access`), the answer gets one
server-added caveat after the validator: "Outside the detailed study area (Elmina Urban Park +
Lakeside Mall frontage), path and place facts come from OpenStreetMap only" (EN/BM/中文,
`run.outside_note`). It is triggered by the answered route's geometry (else every route this
turn) or a cited place lying outside the box; evacuation centres alone do not trigger it. The
deep spot is called the "detailed study area", not "surveyed", because its facts are still demo
values, not yet surveyed. The registry restricts MCP too; its existing verification-write opt-in
(`MCP_ALLOW_VR`) still applies, so it exposes eight tools by default and nine when writes are
explicitly enabled.

`ASSISTANT_SCOPE=all` opts into the legacy features documented below. Legacy engine/pipeline
tests and removed-feature golden cases opt in explicitly; `tests/test_scope.py` tests the
default separately. The existing browser hero suite opts into `all` because it includes
what-if, rollout and day-assistant turns. This setting does not gate staff REST endpoints.
`validate.py` and `draft.py` are unchanged by T-011; the deterministic refusal is a
`cannot_answer` with no unsupported factual content and passes the existing validator.

**Fact binding (T-001, `facts.py`).** Every number an answer states must match a tool value of the
same kind (length, width, stage, time, slope, steps, count), with rounding only under "about". A
fact is also bound to what it is about: a count of a noun ("two toilets") must match a count of
that thing this turn (distinct rows of that category, a route's `crossings`, "2 road crossings"
in tool text), and a length or time whose clause names place categories ("the toilet is 440.6 m
from the mall") must match a value tagged with all of them (routes are tagged with both
endpoints' types and names in `call_tool`, amenity rows with the amenity and its origin, centre
rows as centres). Place names are replaced by their category words before the check, so a name
cannot hide the subject. A feature ("baby changing room", "lift") is hedged only by a negation in
its own clause or after it ("No steps, so the toilet has a changing room" is rejected). Chinese
counts read only the classifiers 个间张处级座条部 ("两段…的台阶" counts segments, not steps).

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
- A draft streams one whole sentence at a time. Each sentence must pass the final answer's
  content checks (`validate.draft_errors`): wording, promises, numbers and facts bound to tool
  results, recorded features and route status. The draft stops before the first sentence that
  fails, so rejected text never reaches the screen or a screen reader (audit A3).
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
  - it gives counts as digits, from the rehearsal only: no percentages or number words; a sum or difference only where it is written out ("464 - 400 = 64"); clock times, ages under 100 with no count noun, and hours are not counts;
  - it makes no predictions about real people.
- **Shared wording:** `template.day_answer` (school first, then groups by share hit).
- **Scene intent (server-built):** `day.show` (the day, `t_min`, the day's own peak stage). The map opens the rehearsal at the moment the answer is about, and the client restores what was on screen when the day closes. In Resident mode only the stage is shown. A model-written `day.show` or `flood.set_level` is dropped for a rehearsal turn, and the model is never asked for `scenario_id`.

**Testing a change on a rehearsal (Cycle 17):**
- **Tool:** `day_test_change(day, option)`. It runs one of the day's own suggested changes, so the model never writes an action: option 1 is the top suggestion, and `options` lists the rest by number. The same day is run again with the change and compared trip by trip, giving residents better and worse off by group.
- **What the model sees:** `changed_geojson` is dropped; it is for the map only.
- **Validator (`day_change_errors`):**
  - the answer says "imagined", "synthetic" and "not a forecast";
  - no plan wording ("will be built") and no forecasts;
  - counts only from the result, under the same digit rules as `day_errors`.
- **Shared wording:** `template.day_change_answer`.
- **Scene intents:** `day.show` plus `whatif.diff` (the stretch drawn as an imagined change), and the what-if disclaimer.

**Rehearse my trip (Cycles 19–21):**
- **Tool:** `rehearse_my_trip(from_id, to_id, leave_at, day, profile?)` uses place ids from `find_place`; the profile defaults to the resident's "Travelling as". The map geometry (`track`, `normal_route`, `cut_lines`) is dropped for the model and for MCP.
- **Validator (`my_trip_errors`):**
  - the answer says rehearsal and not a forecast;
  - **no advice** ("you should", "leave by", "best time", "aim to", "better to set off", "will get there", "bertolak sebelum", 早点/提前) and no reassurance ("no risk", "fine to go");
  - the sentence about the asked time names its outcome and never says a cut trip arrived;
  - clock times, minutes and hours come from the rehearsal;
  - unchecked stretches are mentioned;
  - no connection is called a data gap.
- **Shared wording:** `template.my_trip_answer`; prompt rule 19.
- **Scene intent:** `day.trip` (day, leave minute, stage, and geojson with meta for the departure strip).

### Journey playback (`journey.play`, spec 2026-10-19 §6.2)

- The model (D-T3: also the mock and template) writes `{kind: "journey.play", route_id, start_time}` with a `route_id` from this turn's `plan_route` and a local `HH:MM` start time.
- `run.py` attaches `journey`: `build_journey(world, route, route.profile, start_time)` from the route recorded in `TurnRecord.routes`, the same way `route.highlight` gets its geometry. A model-written `journey` is discarded.
- The intent is dropped when the route was not returned this turn, when `start_time` is missing, or when the plan cannot be built (`JourneyEvidenceError`). Every drop is logged. The turn continues. The validator does not reject these yet (D-T3, AC-D5).
- The plan equals `POST /journeys` for the same endpoints, profile, scenario and start time (AC-D4, `apps/api/tests/test_journeys_api.py`).

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
| `events.py` | SSE event models (`ChatEvent` union), `SceneIntent`, `ChatRequest`. `Citation` carries `source_type` and `photo_url` (the newest staff-uploaded photo on the cited claim, if any). `FinalAnswer.scene_intents` uses `AnswerSceneIntent` (what the model may write); `SceneIntent` adds the server-attached `journey` so the `JourneyPlan` schema never enters the model's output schema |
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
| `LLM_ESCALATE_ON_REWRITE` | `false` | After the validator sends an answer back, the rewrite (and the rest of the turn) runs on `LLM_MODEL_ESCALATE` (`agent.escalation`, a `SelectModel` capability). Costs more per rewrite; `done.model` names the escalation model |
| `LLM_MODEL_FALLBACK` | empty | Backup OpenRouter model: on a provider error (`ModelAPIError`) the default model fails over to it (`FallbackModel`). `done.model` names the model that answered |
| `LLM_OUTPUT_RETRIES` | `2` | Validator retries before the template fallback |
| `LLM_REQUEST_LIMIT` | `12` | Most model requests per turn (`UsageLimits`); past it: `error` (`agent_limit`), template answer, `done` |
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

## Privacy

`redact.redact` removes MyKad numbers, Malaysian phone numbers and emails from the question before it reaches the model, session memory, the template or a recorded demo (`run.run_turn`, `demo.make_meta`). Tickets were already sanitised by `agent.safe_vr_args`.

## What to build next (AI lane)

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
