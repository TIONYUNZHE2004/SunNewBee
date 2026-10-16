# Township World Model core and the What-if Lab (Cycle 1 design)

Status: design, 16 Oct 2026, branch `ai/world-model`. Research: [world-models-2026.md](../../02-research/world-models-2026.md) §4 and §6 (feature #1, plus #7 multi-turn).

## Intent

Make "world model" a mechanism, not a pitch word. The township gets an explicit **state**, a closed vocabulary of **actions**, a pure **transition** `apply(world, actions)`, **rollouts** over journeys, and a **diff** between the real state and an imagined one. The first user of it is the **What-if Lab**, which answers questions like:

> "If the river rises 3 m and we build a ramp at the steps by the kiosk, how many wheelchair journeys still work?"

It answers in chat and on the 3D map (a before/after diff), and on a staff panel.

**The LLM proposes, the world model disposes.**
- The LLM turns a question into typed actions.
- The engine applies them on a copy of the world, rolls out the journeys and diffs them.
- The LLM narrates only the diff.
- The validator checks every number it says.

## Goals

1. `packages/spatial/.../twm.py` holds these pure functions, with no I/O and no mutation of the live `World`:
   - `Action` models;
   - `legal(world, action) -> str | None`, which returns the reason an action is illegal;
   - `apply(world, actions) -> Imagined`, which is the world copy plus the scenario plus the applied actions and notes;
   - `rollout(world, scenario_id, journeys) -> list[JourneyOutcome]`;
   - `compare(base, imagined, journeys) -> WhatIfResult`.
2. Actions (v1, topology-preserving):

   | kind | args | effect on the imagined state |
   |---|---|---|
   | `set_river_stage` | `scenario_id` (`baseline` · `stage_p1m`…`stage_p5m`) | flood classes of that stage apply to every edge and place |
   | `close_path` | `element_id` (edge or place) | an imagined closure, so FAIL for every profile |
   | `build_ramp` | `element_id` (edge) | an imagined capital work. A `steps` edge becomes `ramp`; `step_count=0`; incline, width and kerb get the passing values for the strictest profile. Claims are tagged `evidence_type="whatif"` |
   | `assume_fact` | `element_id`, `attribute`, `value` | an imagined claim with the catalogue type checked (`attributes.ATTRIBUTE_TYPES`), tagged `whatif` |
   | `verify_fact` | `element_id`, `attribute`, `outcome: pass\|fail` | an imagined verification result (pass = the profile's passing value; fail = a violating value) |

3. **Journeys** to roll out:
   - one asked journey (`from_id`, `to_id`, `profile`);
   - or the standard journey suite (`sim.default_tasks`) for one or all profiles;
   - or evacuation (sampled origins × profiles → nearest centre, as in `sim.run_evacuation`).
4. **`WhatIfResult`** contains:
   - per-profile counts before and after for each route status (`confirmed`, `partly_unverified`, `blocked`, `no_data`);
   - the journeys that changed (`from`, `to`, `profile`, before → after status, route ids and geometry for both);
   - the elements the actions touched (for highlight);
   - an evidence id `ev-whatif-<hash>`, with status `indicative` and `source_type="whatif"`;
   - `disclaimer`: "What-if simulation of the township model, not a forecast or a plan. Imagined changes are not real."
5. **Agent tool `simulate_what_if`.** Its arguments are `actions`, `profile`, an optional `from_id`/`to_id`, `scope` (`journey` | `suite` | `evacuation`) and an optional `scenario_id`.
   - It records the result in `TurnRecord.what_ifs`.
   - The validator checks that:
     - (a) the answer says "what-if" or "if" plus "simulation" (the label);
     - (b) every number next to a status word in the summary matches a count in the result;
     - (c) "confirmed" for an imagined route is always qualified as "would be confirmed (what-if)";
     - (d) a what-if answer never claims a change is real or planned.
   - The mock scripts one what-if hero flow, and the template renders the result. Validator, mock and template change together.
6. **Multi-turn memory, so follow-ups work** ("and if it rises another metre?").
   - `ChatRequest.session_id` keys an in-memory, size- and time-capped store of PydanticAI messages (`result.new_messages()`), held in the API process only and never written to disk.
   - Per-turn `TurnRecord` rules are unchanged: evidence must come from tools called this turn, so follow-ups re-run tools.
   - The UI sends a stable `session_id` per tab.
7. **API `POST /what-if`** takes the same arguments as the tool and returns `WhatIfResult` with geometries. It gives the staff panel what it needs without an LLM. Then `pnpm gen`.
8. **Web.**
   - **Scene intent `whatif.diff`.** Changed routes are drawn before (dashed, grey) and after (solid, by status). Touched elements get a "what-if" marker. The legend says "What-if · not real".
   - **What-if Lab panel**, as a self-contained component under the Management view. It has:
     - a river stage selector and a profile selector;
     - a list of **suggested interventions** from the engine: the most-blocking barriers and unknowns on suite journeys (from the existing gap ranking);
     - toggles for those interventions and a Run button;
     - before/after bars per status;
     - "Show on map", which fires `whatif.diff`.

## Non-goals (v1)

- Adding new graph edges, such as a new footbridge. That would be a topology change and needs a component-cache rewrite, so it is a later cycle.
- Time-stepped population animation (Cycle 3).
- The value-of-information planner (Cycle 2). It will reuse `apply` and `rollout`.
- Probabilities of any kind.

## Anti-goals (would make it a failure even if it works)

- An imagined change leaks into real state: SQLite, the overlay file, resident answers without the what-if label, or the evaluator outside the call.
- An imagined route is described as "confirmed" or a place as "reachable" without the what-if qualifier.
- The LLM computes counts. Every number comes from `WhatIfResult`.
- A flood stage action upgrades anything: a stage only adds FAIL or UNKNOWN, as today.

## Decisions (the AI owner's calls, recorded as rulings in the log)

- **Copy-on-write overlay.** Use `dataclasses.replace(world, edges={...})`, the same pattern as `sim._flipped`. The graph object is shared, which is safe because v1 actions never change topology. A test asserts `apply` leaves the live world equal before and after (`version`, claims, closures).
- **The imagined claims' status is `verified`**, so the evaluator treats them as facts inside the imagined world. Their `evidence_type="whatif"` marks every resulting route `whatif=True`, and labels and validator rules key on that.
- **Imagined closures** are `Closure` rows with `source="whatif"`, never stored.
- **Suggested interventions** come from the engine only:
  - steps edges on suite journeys that block a profile → `build_ramp`;
  - top gap-ranked unknowns → `verify_fact pass`.

  The LLM may also propose actions, but `legal()` gates them.

## Left to the builder

The exact CSS of the diff styles; the panel layout inside Management; the in-memory session cap (suggested: 200 sessions, 20 turns, 30 min).

## Acceptance

- Spatial unit tests:
  - purity;
  - each action's effect on `evaluate_edge`;
  - a stage only adds FAIL/UNKNOWN;
  - `build_ramp` on the tiny fixture's steps edge flips the wheelchair journey from blocked to "would be confirmed";
  - diff counts add up.
- Agent tests: the mock what-if hero flow passes the validator; the validator rejects an unlabelled what-if, a wrong count and a bare "confirmed".
- API test for `/what-if`, and the generated client is regenerated.
- vitest: reducer and scene intent handling, panel model.
- An e2e what-if hero on the tiny fixture.
- One golden what-if case, mock and live.
- A live smoke of 3–4 what-if turns within budget.
- A browser check on Stylised.
