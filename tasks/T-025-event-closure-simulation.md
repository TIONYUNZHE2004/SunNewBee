# T-025 Event simulation (e.g. Elmina Marathon): affected routes, detours, suggestions

- **Status:** assigned · **Owner:** cloud backend worker (engine, API) + cloud AI worker (answers) + shaoxian04 (manager screen) · **Priority:** P1
- **Method:** scenario comparison (A = no event, B = event). The routing engine computes everything; no LLM tokens.

## Backend
1. An **event** = name + time window + list of road/path segment ids (closed). Reuse `twm.ClosePath` and the closures store.
2. `POST /events/simulate {name, segment_ids, starts_at, ends_at, profiles}` runs the same sample journeys (profiles' everyday trips: walk, wheelchair, drive) with and without the event and returns: trips affected, extra metres/minutes per trip, trips with no route, places cut off, and **detour roads ranked by how many rerouted trips use them**.
3. Rule-based suggestions, each tied to a number above: top detour roads → "marshals / signs on X"; places cut off → "keep a crossing point at Y"; many affected trips in the window → "shift the start time or split the course".
4. Residents: during the window, route answers avoid the course; the event is a staff closure with its name.
5. Honesty: no traffic counts exist, so never predict jam minutes. Say "N sample trips reroute onto X (estimate from mapped roads, not traffic counts)".

## AI
Resident route answers name the event and the detour; management questions about the event call the simulate tool.

## Frontend (shaoxian04)
Manager: pick segments on the map (or a named road), set the time, see the course in red, the detour roads highlighted and the suggestion list.

## Demo
One prepared event: "Elmina Marathon, Sun 7-11 am" on a named loop.

## Log
- 2026-10-20 16:05 UTC · control · Created.
