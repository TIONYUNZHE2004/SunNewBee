# Rising-river population rollout and tipping points (Cycle 3 design)

Status: design, 16–17 Oct 2026, branch `ai/world-model`.
- Research: [world-models-2026.md](../../02-research/world-models-2026.md) §6, features #3 and #9.
- Evacuation design notes: [reference/notes/world-models-urban.md §4](../../../reference/notes/world-models-urban.md).
- Cesium animation pattern: [reference/notes/world-models-repos.md §7](../../../reference/notes/world-models-repos.md).

## Intent

This is the world model's most visible moment. Synthetic residents of each persona head for their nearest reachable evacuation centre while the river rises stage by stage (normal level → +1 m … +5 m). The 3D map animates them along engine-computed routes:

- residents whose route still works keep moving;
- residents whose route is cut off stop and turn red;
- per-stage counts show where each persona's access breaks.

The resident version is the **tipping point**: "At which river level does my route to the centre break?"

It must look like a simulation and say it is one. Every route is the engine's (`plan_route` / `centres_reachability`), and the LLM never moves anyone.

## Goals

1. **`twm.river_rollout(world, profiles, stages, n)`.** It uses the same seeded origin sample as `sim.evacuation_origins` and, for each profile × origin × stage, the nearest reachable centre (`twm._evac_state`). It returns:
   - per-stage counts per profile (reaches, of which confirmed, cut off, no mapped connection);
   - per resident: origin, profile, a status per stage, the **tipping stage** (the first stage at which they no longer reach a centre, or none) and a route reference per stage;
   - distinct route geometries, deduplicated by route id, so the payload stays small;
   - a disclaimer and an evidence id.
2. **`twm.tipping_point(world, from_id, profile, to_id=None)`.** One journey across every stage, to a place or to the nearest centre: the status per stage, and the first stage where the route degrades (confirmed → partly unverified) or breaks (no longer reached).
3. **Agent tools `river_tipping_point` and `rising_river_rollout`.**
   - Validator: stage names must exist in the result, counts must come from the result, the answer must say "not a forecast", and it must never give a depth or say "safe".
   - The mock and template share the wording.
   - Prompt rule 15.
4. **API `GET /river-rollout?profiles=&n=`.** It is cached by world version and runs under the world-model slot semaphore.
5. **Web: "Rising river" panel (Management mode).**
   - Play, pause and a stage scrubber from the normal level to +5 m, with per-stage counts per persona as small bars.
   - The Cesium layer (`PointPrimitiveCollection` plus one `clock.onTick`) draws synthetic residents moving along their current-stage route in a loop. Cut-off residents sit red at their origin.
   - A persistent banner: "Synthetic residents · simulation, not a forecast · no crowding, departure times or warnings modelled · animation speed is illustrative".
   - The flood layer follows the scrubber's stage.
   - A resident-mode starter: "At which river level does my route to the evacuation centre break?"

## Non-goals

- Departure-time or warning-time models, crowding or queues, speeds by depth, and real travel times. The animation speed is a display choice; minutes are never stated.
- Drive profiles.
- Mapbox and List animation. The List view shows the per-stage table only.

## Anti-goals

- Anything that reads as a forecast of who will be stranded.
- A water depth.
- "Safe".
- An animated resident moving on a path the engine did not route.
- Demo-value confirmations shown as checked. The demo flag is carried, so "confirmed" in counts shows "(demo values)" when it applies.

## Decisions

- **n = 30 origins by default.** Each profile × stage is one rollout. The cost is 3 profiles × 6 stages × 30 origins of about 1 s each; the endpoint is cached, the first call takes about 15 s and later calls are instant.
- **The tipping stage is computed over the precomputed stage list.** Stages are discrete scenarios, so the answer is a stage label ("+3 m"), never an interpolated level.
- **Monotonicity is asserted in tests.** A higher stage never lets more residents reach a centre, per profile, the same E1 invariant as `sim.run_evacuation`.

## Acceptance

- Spatial tests: counts add up, monotonicity across stages, the tipping stage matches the per-stage statuses, determinism, and geometry deduplicated.
- Agent tests: the mock tipping-point and rollout flows pass the validator, and the validator rejects a stage or count not in the result and a missing "not a forecast".
- API test (cached second call), vitest for the playback model (stage scrubber to statuses, colours), and an e2e test for the panel on the tiny world.
- Golden: one case. A live smoke. A browser check on Stylised with a screenshot of the animation.
