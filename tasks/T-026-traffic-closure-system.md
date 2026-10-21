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

## Log
- 2026-10-21 00:52 UTC · control · Created from Yunzhe's request.
