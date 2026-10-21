# T-028 Marathon engine: AI proposes a course, manager edits, simulation on the map

- **Status:** assigned · **Owner:** cloud Codex (backend: packages/spatial, apps/api, data) + cloud Claude (agent + web) · **Priority:** P1 (demo 23 Oct)
- **Source:** Yunzhe, 22 Oct 00:50 MYT: "focus on the marathon engine … management asks: I want to host a marathon, on which road? which part is affected? … see the simulation … show the road names on the map … frontend like shaoxian's". Decisions: AI proposes the course and the manager edits it; no form card to fill in.

## Demo story
Manager (Management chat): "I want to host a 5 km marathon starting at Elmina Valley Central Park on Sunday 6–10 am. Which roads should we use and what is affected?"
→ The AI proposes a course on mapped roads, lists the roads in order with lengths, shows it on the map with road names, and simulates the closure: trips affected, places cut off, detour roads with pressure, suggestions.
→ Manager: "Avoid Persiaran Elmina" / "make it 10 km" / "finish at Elmina Lakeside Mall" → re-plan and re-simulate.
→ "Watch the marathon" plays an illustrative simulation (runners on the course, closed roads red, sample cars detouring), in shaoxian04's journey/devsim style.

## Engine bugs found 21 Oct (live answer, Persiaran Garcinia works, Tue 09–17) — fix first
1. "42 trips newly without a mapped route": all 42 start at one place, `osm-way-…` "Parking (unnamed, OSM)", whose node is on the closed road. Report trips that start or end on the closed course separately ("start or end on the course: access during the event"), not as "newly without a route". Keep the sample diverse: no single origin or destination above 10% of the sample.
2. "Unnamed paths · high pressure": all unnamed detour segments (78 segments) are summed as one road, so pressure and "marshal at Unnamed paths" are meaningless. Group unnamed segments into connected stretches, name each "unnamed path near <nearest named road>", compute pressure per stretch.
3. Warnings repeat ("Detour pressure, estimated from …" twice). Dedupe.
4. Cold run 7.6 s on the seed. Target: ≤5 s warm, ≤8 s cold for a 5 km course; warm the baseline caches when the API starts.
5. Answer formatting (agent/web): "1. 11.Suggestion 1:" numbering three times; no space before "("; the "Not verified" box repeats every Worth-knowing note. Only real unverified facts (e.g. demo values) belong in "Not verified".

## Backend (Codex)
1. `plan_course(world, start, distance_km, shape="loop"|"point_to_point", finish=None, avoid_roads=[], prefer_roads=[])` → `Course{segment_ids (ordered), length_m, roads:[{name, length_m, order}], start, finish, warnings}`. Deterministic. Named mapped roads first; no `major_road` unless asked; length within ±10% of the target or a warning that says why; no road used twice unless needed; prefer courses that cut off the fewest places. Label: "Proposed course on mapped roads, not an approved route."
2. Segment limit: a 5 km course is about 70 segments (mean edge ≈ 74 m). Allow courses up to 400 segments; keep 40 for ad-hoc closures if you must, but say so.
3. `simulate_marathon` = `plan_course` + the closure engine for the window. Tool for management; `POST /marathon/plan` (public, read-only, like `/closures/simulate`).
4. `GET /layers/road-labels`: named roads inside the township boundary: `name, road_class, length_m, anchor [lon,lat], bearing_deg` (anchor on the longest segment), so the map can label roads.
5. Animation data in the result (`animation`): ordered course coordinates; up to 5 rerouted sample trips with before/after coordinate lines. Labelled "Simulation · illustrative". No crowd sizes, no vehicle counts, no jam minutes.
6. Tests (pytest + hypothesis), `pnpm gen`, demo cache re-recorded with the mock only.

## Agent + web (cloud Claude)
1. Bind the marathon tool for management; chat-driven edits ("avoid …", "10 km", "finish at …"). Validator, mock and template change together.
2. Management: remove the Road closures form card from the panel (chat replaces it); keep the closure result card for answers.
3. Road-name labels on the map (Stylised 3D first, List view lists them), toggle in map settings; course roads highlighted with their names.
4. "Watch the marathon": illustrative playback in shaoxian04's style (reuse journey follow camera / devsim HUD patterns): runners along the course, closed roads red, sample cars on before/after detours, simulated clock, "Simulation · illustrative".
5. Fix the formatting bugs in item 5 above.
6. Screenshot gate (light + dark): course with road names, result card, a playback frame.

## Honesty
Course is a proposal, not approved. Pressure is from mapped road class and sample trips, not traffic counts; peak weights are assumed. Residents never see pressure.

## Log
- 2026-10-21 17:10 UTC · control · Created from Yunzhe's decisions (AI proposes + manager edits; @codex PR comments wake Codex; Codex builds, Claude judges).
