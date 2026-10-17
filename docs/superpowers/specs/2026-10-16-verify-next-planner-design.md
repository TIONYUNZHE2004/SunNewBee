# Verify-next planner: value of information on the Township World Model (Cycle 2 design)

Status: design, 16 Oct 2026, branch `ai/world-model`.
- Research: [world-models-2026.md](../../02-research/world-models-2026.md) §4 and §6 (#2 and #5).
- Value-of-information formulation: [reference/notes/world-models-urban.md §5](../../../reference/notes/world-models-urban.md).

## Intent

Staff have a limited survey budget. The planner answers:

> "Which facts should we check next to give the most residents a confirmed route?"

It also answers the developer's version, "where do we spend 2 hours of survey time?". It turns honest gaps into a plan.

Every number comes from rollouts on the world model (`twm.compare` with `VerifyFact` actions). The language model only explains the plan.

## Why not one fact at a time

On the Elmina seed almost every route crosses many unchecked items: one evacuation route had 66. Flipping a single fact almost never changes a journey's status. This is the classic failure of myopic value of information when the objective needs *all* the facts on a route (an AND), and it is not submodular.

So the unit of planning is a **route bundle**: the unknown facts on a journey's best lenient route. The planner is a greedy **budgeted coverage over bundles**:

1. For each sample journey that is `partly_unverified`, take its route's unknown facts, `U_j`.
2. Repeatedly pick the journey with the best ratio. The ratio is the journeys this pick would newly confirm (including others whose `U` becomes covered) divided by the new facts it needs. Stop when the budget of k facts or m minutes runs out.
3. **Verify with the engine.**
   - Simulate `VerifyFact(pass)` on every selected fact. Then `compare` gives the exact number of journeys that *would be confirmed if all selected facts pass*. Routes can shift once facts change, so the engine number, not the greedy estimate, is what is reported.
   - Also simulate the **downside**: for each selected fact, the journeys that would become `blocked` if it fails. That tells staff what matters most to recheck.
4. **Expected value.** P(journey confirmed) = ∏ q_u over its bundle, under independence. That gives the expected confirmed journeys of the plan, shown as a planning estimate for staff only.

Greedy is the defensible default. Optimal probing is PSPACE-complete (Canadian Traveller variants, 1207.4710), and no approximation guarantee is claimed.

## Belief over unknown facts (the learned part, kept honest)

q_u = P(fact u passes the profile's limit) comes from a **Beta-Bernoulli empirical-Bayes belief** per (path type × attribute):

- **Prior** Beta(α₀, β₀). Pseudo-counts come from regional OSM tag frequencies: one cached Overpass query over the Klang Valley for footways and crossings carrying `wheelchair`, `incline`, `kerb`, `width` or `surface` tags, through `data/scripts/overpass.py` (cached, ≤1 request). If the query is unavailable, a transparent config prior is used (`config/belief.yaml`) and the panel says so.
- **Update:** every **real** verified claim in the world, so staff verifications count. Demo values (`team_survey_placeholder`) and what-if claims are excluded. Each pass adds 1 to α and each fail adds 1 to β.
- **Use:** planning only (ranking and expected value). The belief never changes an edge's evaluation, never reaches resident answers, and is never shown as "probably fine". The validator forbids likelihood words in resident answers, as it already does.
- **Data finding (16 Oct):**
  - The seed's 516 OSM `wheelchair` tags are all "yes", concrete footways tagged by what looks like one mapping campaign.
  - A classifier on this would be meaningless, so none is trained.
  - The log records this as a result: we checked for learnable signal and found a single-class label.

## Deliverables

1. **`twm.plan_verifications(world, profile, scope, budget_facts, minutes_per_fact?) -> VerificationPlan`.** The plan contains:
   - an ordered fact list, each with a readable label, the journeys it helps, a downside count and the open ticket id if one exists;
   - per-step cumulative confirmed journeys (engine-verified at the end);
   - the expected confirmed journeys from the belief;
   - an evidence id;
   - a disclaimer.
2. **`twm.belief(world) -> Belief`**, with per-(type, attribute) α and β and their sources (OSM prior, staff verifications). Exposed at `GET /belief` for transparency.
3. **Agent tool `plan_verifications`.**
   - Validator: numbers must come from the plan, "if they pass" wording is required, and no likelihood words appear in resident mode.
   - The mock and template get a "which facts should staff verify first" flow.
4. **API `GET /verify-next?profile=&scope=&budget=`.**
5. **Web: "Verify next" board on `/tickets`.**
   - Ranked facts with "helps N journeys", linking to the existing ticket when there is one.
   - A cumulative "journeys confirmed if these pass" bar.
   - "Show on map" draws the facts through `whatif.diff`, with the facts as `touched`.
6. **Evals.**
   - **Planner regret:** greedy against exhaustive search over small budgets on the tiny fixture.
   - **Plan value against a random plan** with the same budget, on the seed.
   - A live golden case.

## Anti-goals

- Probabilities shown to residents.
- A plan whose numbers the LLM computed.
- Demo values counted as verifications in the belief.
- A plan that claims journeys "will be" confirmed. They would be, if the facts pass.

## Acceptance

- Unit tests:
  - bundle greedy against brute force on the tiny world;
  - the engine-verified count equals compare();
  - the belief excludes placeholder and what-if claims;
  - Beta updates.
- An API test, a vitest model test, and an e2e test for the board.
- Golden mock plus a live smoke.
- A browser check on `/tickets` (Stylised).
