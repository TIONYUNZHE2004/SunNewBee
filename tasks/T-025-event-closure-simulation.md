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
- 2026-10-20 17:52 UTC · control · Backend done by cloud Codex in PR #17 (events.py, POST /events/simulate, POST /events, simulate_event tool). Lands together with the AI worker's next PR.
- 2026-10-20 19:09 UTC · control · Backend (cloud Codex, #17) and AI (cloud AI worker) merged into davinci via PR #19 (794e9bc), CI green incl. e2e. Live round about US$0.03 (Persiaran Garcinia marathon: 7 of 63 sample trips affected, 3 newly without a route, top detour Persiaran Tamarind). Open: shaoxian04 UI (markers, manager event screen); event cap 40 segments (Persiaran Elmina has 51); demo-cache date time bomb from 21 Oct (follow-up PR by the AI worker).
- 2026-10-20 21:18 UTC · control · Follow-up PR #20 merged into davinci (3e04ae3), CI green: demo fingerprint no longer hashes the date (only verified claims past their TTL), so recordings replay on 21-23 Oct; event cap stays 40 (simulation takes about 20 s at any size), and a too-long road suggests a stretch "<road> between A and B". Demo note: closing all of Persiaran Elmina affects 0 of 63 sample trips; Persiaran Garcinia affects 7.
