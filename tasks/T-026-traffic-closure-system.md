# T-026 General traffic and closure simulation (not only marathons)

- **Status:** assigned (start after davinci → main merges) · **Owner:** cloud backend worker + cloud AI worker · **Priority:** P1
- **Source:** Yunzhe, 21 Oct: "marathon is only one example; we need a mature traffic system, so when a route is closed traffic is still maintained"

## Goal
One closure engine for any reason (event, road works, accident, flooding, fallen tree), one or many closures at once, each with a time window. It answers, for walking, wheelchair and driving:
1. which sample trips lose or change their route;
2. which roads take the detours and how much **detour pressure** they get;
3. what staff can do to keep traffic moving.
Residents get the detour automatically while a closure is active.

## Backend (extend T-025's events.py, keep its API working)
1. `ClosureScenario {name, reason: event|works|accident|flooding|other, closures: [{segment_ids | road stretch, starts_at, ends_at}]}`. `POST /closures/simulate` (public, no state); `POST /events` stays as a thin alias.
2. **Detour pressure:** for each road that gains rerouted sample trips, pressure = rerouted trips ÷ a capacity weight from its OSM class (`highway` tag: secondary > tertiary > unclassified > residential > service). Bands: low / medium / high. Label: "Detour pressure, estimated from mapped road class and sample trips, not traffic counts." Never minutes of delay, never vehicle counts.
3. **Keep traffic moving** (rule-based, each with its number): high pressure on a residential road → "signpost the detour via <higher-class road> instead"; a place cut off → "keep one crossing point open at <junction>"; one-way roads on the detour → "temporary two-way or marshal at <road>"; many affected trips in one window → "split the closure into stretches / shift the time".
4. Speed: the simulation now takes about 20 s. Target under 5 s for the seed (cache the baseline per profile; reuse journeys). Report timings in the PR.
5. Tests on the tiny fixture: two overlapping closures; pressure bands; a suggestion per rule; data gaps never blamed on a closure.

## AI
Management questions about any closure ("road works on Persiaran X next week", "an accident at Y") call the simulate tool with the right reason and window, and report pressure bands and suggestions with their numbers. Residents: active closures are named in route answers with the detour.

## Honesty
No jam minutes, queue lengths, vehicle counts or crowd sizes. Every number comes from the engine. Trips with no route before the closure are data gaps.

## Decisions (Yunzhe, 21 Oct) and API contract — fixed, so backend, AI and UI work in parallel

- Level **B** (closure impact + detour pressure); no real traffic model.
- **Reasons:** event, works, accident, flooding, other (all five).
- **Detour pressure: managers only.** Residents see the closure name, its window and their detour, never the pressure.
- **Peak weights: yes**, from one config file `config/traffic/peak_weights.yaml`, weekday unless stated. Default: school/kindergarten x3 at 07:00-08:00 and 13:00-14:00; mall/shops/work x2 at 17:00-19:00; park/playground x2 at 17:00-19:00 and weekend 07:00-10:00; clinic x2 at 09:00-12:00; place of worship x2 Friday 12:30-14:00; everything else x1. Every result carries "Peak weights are an assumed travel pattern, not measured."
- **Demo:** marathon on Persiaran Garcinia (7-11 am) + road works on one residential street (backend picks one with at least 3 affected sample trips and names it in the PR).

**Request** `POST /closures/simulate` (public, no state): `{name, reason, closures: [{road_names? | segment_ids?, starts_at, ends_at}], profiles?: ["default","wheelchair","drive"], at?: ISO datetime}`. `at` (default: the first closure's start) picks the peak weights. `road_names` accepts "<road> between <A> and <B>". `POST /events` stays as an alias.

**Response** `ClosureImpact` = today's EventImpact fields, plus:
- `detour_roads[]`: `{name, segment_ids, trips, weighted_trips, road_class, pressure: "low"|"medium"|"high"}`, sorted by weighted_trips.
- `suggestions[]`: `{kind: "signpost"|"marshal"|"crossing_point"|"two_way"|"split"|"reschedule", text, basis}`; every `basis` names the number it comes from.
- `weights_note`, `disclaimer` ("Detour pressure, estimated from mapped road class and sample trips, not traffic counts."), `timing_ms`.

**Pressure** = weighted rerouted trips ÷ class capacity (secondary 4, tertiary 3, unclassified 2, residential 1, service 0.5; others 1). Bands: < 1 low, 1-3 medium, > 3 high. Both tables live in the same config file.

**Agent tool** `simulate_closure` (management only; `simulate_event` stays as an alias). **Resident routes** avoid active closures (staff `POST /closures` or `POST /events`) and name them.

## Log
- 2026-10-21 00:52 UTC · control · Created from Yunzhe's request.
- 2026-10-21 07:38 UTC · control · Decisions recorded; contract fixed for parallel work.
