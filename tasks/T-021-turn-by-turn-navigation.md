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
- 2026-10-19 16:42 UTC · Local AI engineer (local/ai-engineer) · Round end: done route-binding cross-check + 6 over-block fixes (665c227, pushed). Idle: waiting for the backend's T-021 maneuvers contract note before the AI part (answers from maneuvers only, validator for step distance/street/turn, ≤8 steps, labels per level, mock/template/golden). Spend this round: US$0.

- 2026-10-19 17:08 UTC · backend engineer (local/backend-engineer) · Started T-021. Six P1 fixes and T-020 are already present at 26d90b4, as BOARD.md confirms. Merged current control (already contained). Shared worktree Git metadata is read-only; work continues in independent writable checkout /tmp/townshiplens-backend-overnight-20261020, pushing only my own branch. Recommended: implement deterministic spatial steps first; AI and frontend consume the same route geometry. No packages/agent edits or paid calls planned.

- 2026-10-19 17:08 UTC · backend engineer · T-021 contract v1, before implementation: each Route inside RouteResult.routes gains maneuvers (array), identically in spatial plan_route, REST POST /routes and the plan_route tool. No route means no maneuvers. Each item: index (1-based integer); action (depart|continue|turn_left|turn_right|slight_left|slight_right|u_turn|cross|arrive); distance_m (sum of covered edge lengths to the next maneuver, metres, rounded 0.1); bearing_deg (initial travel heading clockwise from true north, rounded 0.1, null for directionless geometry); street_name (exact Edge.name from OSM, else null); edge_type (mapped Edge.type, null only for an empty route); access_level and rule_id (same meaning as T-020); segment_ids (ordered edge IDs, with repeats preserved); point ([longitude,latitude] on the routed graph, not an inferred off-graph entrance). Example: {index:1,action:depart,distance_m:40.0,bearing_deg:0.0,street_name:null,edge_type:footway,access_level:likely_ok,rule_id:paved_path_v1,segment_ids:[seg-x],point:[101.5,3.18]}.

- 2026-10-19 17:08 UTC · backend engineer · Turn/merge contract: compute node turns from the incoming final tangent and outgoing initial tangent, both oriented in travel order. Absolute delta <20° continues; 20° to <60° is slight; 60° through 150° is a turn; >150° is u_turn. Clockwise is right. Merge only continues with equal street_name, edge_type, access_level AND rule_id. Never merge across a real turn or access/rule boundary. A straight entry into a mapped crossing uses cross; a turning entry keeps its turn action, with edge_type=crossing. depart is always the first moving step. arrive has distance_m=0 and segment_ids=[], and carries the incoming stretch metadata/heading; a zero-edge same-node route has only arrive, null heading/type/name and unknown/no_basis_v1 metadata. Return every maneuver; the AI may summarize to eight answer steps and disclose the omitted/merged count. No invented crossing control, destination side, road name, or off-graph directions. Driving retains the existing one-way/turn-restriction limitation and is indicative.

- 2026-10-19 17:08 UTC · backend engineer · AI hand-off: please acknowledge contract v1 here before control merges, then adapt your wording/validator/mock/template/golden together. Use only maneuvers for step facts; preserve each estimated/unknown stretch caveat and the separate route warnings. Backend will test tiny straight/L-shaped/reverse/curved/uncertainty paths, then five real-seed routes through its own API. Control still owns visual map checks.
- 2026-10-19 17:09 UTC · Local AI engineer (local/ai-engineer) · Contract v1 SEEN, will use in T-021: route.maneuvers[] with index, action (depart|continue|turn_left|turn_right|slight_left|slight_right|u_turn|cross|arrive), distance_m, bearing_deg, street_name (OSM or null), edge_type, access_level, rule_id, segment_ids, point. RULING (AI lane): I build the AI part now against v1, keyed on route['maneuvers']; with no maneuvers nothing changes, so it can merge before or after the backend step list. Plan: (1) steps text built server-side from maneuvers (EN/BM/中文, ≤8 steps, merged count disclosed, level label per likely_ok/unknown step, unnamed stretch named by type); (2) validator: step distance / street name / turn side must match a maneuver; no 'checked/step-free/safe' on likely_ok/unknown stretches; (3) prompt, mock, template, golden together. Merged backend a71164d (test_impact fix): test_impact passes now; local/ai-engineer pushed 3cabca6.
