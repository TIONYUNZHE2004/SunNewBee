# T-021 Turn-by-turn navigation for route answers (like Waze)

- **Status:** assigned
- **Owner:** Local backend engineer (step list) + Local AI engineer (answer wording, validator)
- **Branch:** `local/backend-engineer` and `local/ai-engineer`
- **Priority:** P1, after the six P1 audit fixes (AUD-001 to AUD-006)
- **Lane:** Backend + AI. Frontend is shaoxian04's lane: see "Frontend" below.
- **Source:** Yunzhe, 19 Oct: "when a route question is asked it should direct you like Waze; only a line on the map is boring"

## Goal

A route answer gives numbered steps a resident can follow, and the map can step through them:

1. "Start at Car Park B. Walk north 40 m along the footway."
2. "Turn left onto Persiaran Elmina. Continue 120 m. *Likely OK, estimated from map data.*"
3. "Cross at the zebra crossing. *Not checked yet.*"
4. "The playground is on your right."

## Backend engineer: the step list (contract first)

1. Add `maneuvers` to every route result (`plan_route`, `/routes`, the route tool). Each maneuver has:
   - `index`, `action` (`depart|continue|turn_left|turn_right|slight_left|slight_right|u_turn|cross|arrive`);
   - `distance_m` (to the next maneuver, rounded to 0.1 m), `bearing_deg`;
   - `street_name` (OSM `name` or null; about 34% of seed edges have one) and `edge_type` (footway, sidewalk, crossing, …);
   - `access_level` and `rule_id` of the stretch (T-020 levels), `segment_ids` covered;
   - `point` (lon, lat) where the maneuver happens, for the map camera.
2. Compute turns from the bearing change at each node: under 20° = continue, 20–60° = slight, 60–150° = turn, over 150° = u-turn. Merge consecutive edges with the same name, type and level into one step. Put the thresholds in one place with tests.
3. Deterministic and tested on the tiny fixture: a straight path yields `depart` + `arrive` only; a known L-shaped path yields one turn on the correct side.
4. Write a contract note in this log before the AI engineer starts.

## AI engineer: the answer

1. Route answers list the steps from `maneuvers` only. The LLM never invents a turn, a distance or a street name.
2. The validator rejects:
   - a step distance or street name not in this turn's `maneuvers`;
   - a turn direction that differs from the maneuver's `action`;
   - a stretch called checked, step-free or safe when its level is `likely_ok` or `unknown`.
3. Each step with level `likely_ok` or `unknown` carries its short label (EN/BM/中文).
4. Long routes: at most 8 steps in the answer; merge small steps and say how many steps were merged.
5. Update the mock, the template and the golden cases together.

## Frontend (shaoxian04's lane: ask first)

shaoxian04 is building a "resident journey simulation" with a third-person follow camera on `main`. That is the natural place to show the steps. Our engineers do **not** build a follow camera. Control asks Yunzhe to agree the `maneuvers` contract with shaoxian04. At most a plain step list under the route card, if Yunzhe approves.

## Honesty rules

- No "safe" or "selamat" or "安全". No promise that a turn is step-free unless the stretch is `verified`.
- Street names come from OSM; an unnamed stretch is called by its type ("the footway"), never given an invented name.
- A route with `no_data` gives no steps.

## Acceptance

- Unit tests for turn detection and step merging; the validator rejects a wrong turn side, a wrong distance and an invented street name.
- On the real seed, 5 deep-spot routes give between 2 and 8 steps each, and each step is checked against the map by eye (control).
- One live round of at most 10 route questions, within SPEND.md limits.

## Log

- 2026-10-19 16:18 UTC · control (claude/sweet-davinci-29v7ne) · Created from Yunzhe's request. Starts after the six P1 audit fixes. The backend writes the contract first.
