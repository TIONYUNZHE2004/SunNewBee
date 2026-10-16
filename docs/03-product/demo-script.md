# Demo Script

> The demo is the most persuasive 3–4 minutes we have. It shows the platform claim: **one 3D world model of Elmina, two very different lenses** (plus the management console). It is journeys J1, J3, J5, J7 and J8 ([personas-and-journeys](personas-and-journeys.md)) as built. Rehearse it until it's boring. **Always have the recorded backup video ready.**
> Rules for the flood part: say "indicative scenario, not a forecast", never say "safe", never give a water depth, and never present Elmina itself as "going under". Elmina's core is not low-lying; the documented floods are in the downstream neighbours Kampung Kubu Gajah / Paya Jaras ([flood-disaster-lens § 1.3](../02-research/flood-disaster-lens.md)). The story is how a river rise affects **Elmina residents' routes, their neighbours and the evacuation centres**.
> **Stale in places:** the two-screen redesign removed `/manage` (KPIs, briefing, journey tests, closures), the header Manage link, the "Jump to" buttons and `/?demo=hero`. The setup and beats below still describe the earlier UI; re-record the walkthrough against `/` and `/tickets` before pitching.

> **What the demo is:** the real app on the real Elmina seed, with the deterministic **mock** assistant and `DEMO_MODE` replay. Answers are scripted and checked, not a live model; say so if asked. Facts on the access segments are **demo values, not yet surveyed** (`team_survey_placeholder`), and the app labels them that way. Screenshots of every beat: [screenshots/](../06-pitch/screenshots/README.md).

## Setup checklist (T–30 min)

- [ ] Laptop + phone charged; phone mirrored or the laptop in a mobile viewport
- [ ] Stop the API, then `pnpm db:reset` (clears the local verification requests, audit log and sim runs in `.data/`), so the queue starts clean
- [ ] Start with the `townshiplens-dev-demo` config (`.claude/launch.json`), which is `LLM_PROVIDER=mock DEMO_MODE=true pnpm dev` (web :5173, API :8000). Set a real `STAFF_TOKEN` in `.env` first: the default `change-me` makes staff actions return 503 by design
- [ ] Map keys present in `.env` (Google, Cesium ion, Mapbox; values never shown). Open the app: the **3D** tab loads Google Photorealistic tiles and the credits are visible
- [ ] **Fallback if Google tiles fail or look poor:** the 3D tab falls back to Cesium OSM Buildings, then use the **Lite map** or **List** tab. The List view needs no keys at all and carries every answer and layer
- [ ] Replay only matches the **chip questions** and the **Where can I go?** button with the exact persona and scenario (`data/demo/*.jsonl`). A typed variation is a cache miss and runs the mock live, so use chips on stage
- [ ] Run the walkthrough once end to end (`/?demo=hero`: Right / Left arrows, Space = auto-play / pause, Esc = exit) and read off the numbers you will quote
- [ ] Second tab: `/tickets` (enter the staff token in a ticket's outcome form); third tab: backup video
- [ ] Browser zoom 125%, notifications off, dark mode off

## Script (about 3:45)

Two ways to run it. **Walkthrough:** open `/?demo=hero` and step through the 8 captioned steps (the bar sets persona, scenario and question for you). **Manual:** the table below, which is the same path by hand and adds the console beats. Wording on screen is quoted from the app; the right-hand column is what the presenter says.

| Time | On screen | Say (presenter) |
|---|---|---|
| 0:00 | Resident page. Click the **Elmina Urban Park + Lakeside Mall frontage** "Jump to" button: the camera flies in over City of Elmina (3D tab) | "This is City of Elmina as a 3D model. Behind it is one world model of the township. Every fact has a status, and 'not checked yet' is a valid answer. Residents ask it; township managers use it. We'll look through two lenses." |
| 0:15 | **Access** lens, persona selector "Travelling as" = **Stroller**. Tap the chip *"Can I get to the lakeside mall with a stroller?"* | "Meet a visitor with a stroller. She asks the way she'd ask a person." |
| 0:25 | Chips under the answer: find place, find place, plan route. The route draws on the map (screenshot 01) | "It doesn't guess. It looks up the real places and runs a route check for a stroller over our map." |
| 0:35 | Answer starts "Route status: partly unverified", then the "Not checked yet" lines and "Asked the township team to check all 7 unchecked items; Segment facts are demo values, not yet surveyed". Legend: green = no known barrier, amber dashed = not checked yet | "It found a route and it's honest: *partly unverified*. It lists what nobody has checked yet, like the incline of a ramp and steps on two footways, and it has asked the township team to check them. Our access facts here are demo values, not yet surveyed, and the app says so on every one." |
| 0:55 | Open a place card or a citation: the status chip reads **"Demo value · not surveyed"**, with no tick and no checked date | "No 'accessible' badge without proof. A placeholder never looks verified." |
| 1:05 | Click the **Sungai Subang corridor + downstream neighbours** "Jump to" button: it turns the Flood lens on and selects **River +3 m (indicative)** (the scenario buttons, Normal to +5 m, also work). The banner ("Indicative only … not a forecast … Follow official MBSA / JPS / NADMA guidance") shows. Set persona = **Wheelchair**. Likely flooded paths red, water blue (screenshot 02) | "Same model, a different lens. If the river rises 3 metres, what happens? This comes from a 30-metre public elevation model, not from the picture. Red means likely flooded; amber means possible, which we treat as not passable. It is an indicative scenario, not a forecast, and Elmina's core sits well above the river; the real flooding was next door in Kampung Kubu Gajah." |
| 1:35 | Click **Where can I go?** (wheelchair, +3 m) | "A wheelchair user at the mall asks where she can go." |
| 1:45 | Answer: "In the River +3 m indicative scenario, the nearest reachable centre from Elmina Lakeside Mall (demo start point) is SJK (C) Ladang Regent, Elmina (its entrance is not mapped; 10 of the 66 unchecked items were sent to the township team); source: candidate, not confirmed as a PPS. This is not a forecast; follow official MBSA / JPS / NADMA guidance." Route drawn; links to JPS and MET Malaysia | "It names the nearest reachable candidate and flags what is unchecked on the way. It never says 'safe'. It calls the place a candidate, because only the district committee decides official evacuation centres, and it points to the official sources." |
| 2:15 | Click **Manage** in the header. Tiles: open verification requests, median hours to resolve, journeys confirmed. **Flood briefing** tab (`/manage?tab=briefing`), scenario *River +3 m*: comparison table normal level vs +3 m (screenshot 03) | "Now the township safety lead. At +3 m, 1,353 paths are likely flooded and 396 possibly, against none at the normal river level. 29 places are affected and, from the mall, the reachable centres fall from 25 to 3 (default profile). These are indicative counts, read from the engine, never invented." *(re-read the numbers on the screen before presenting)* |
| 2:40 | Click **Draft resident advisory**: EN / BM / 中文 tabs, editable text, label "DRAFT – for staff editing; not sent", "This page cannot send messages" | "The assistant drafts a notice, hedged, with the official links. A person edits and sends it. TownshipLens never sends anything by itself." |
| 2:55 | **Verification queue**: the unchecked segments the assistant asked about, with demand counts. Open one: Verify / Correct / Reject, optional photo (JPEG or PNG, location data stripped) | "Every 'not checked yet' became a task, ranked by how many residents hit it. Staff verify on site: a value, a photo, two minutes." |
| 3:10 | Back to **Resident** → click **Gaps** (or "See these gaps on the map" in the queue): the gap map; summary "Most paths are not yet checked: 16,148 of 16,148 for wheelchair travel. 18 of them rest on demo values, not yet surveyed" (screenshot 04) | "This is the honest picture of our data. Of 16,148 mapped paths, none is yet fully checked for a wheelchair, and 18 rest on demo values. That is the case for the field survey, and for SDP's own data." |
| 3:25 | Management → **Closures** (optional, if time): report a closure on a path; it shows to residents as "Reported closure (staff)" and is not passable for everyone while in force | "Staff can close a path for works or an event, with an end date. It only ever blocks a route; it never makes a route look better." |
| 3:40 | Close | "TownshipLens: one township model, asked by residents and managers, with evidence instead of guesswork, and a township that knows what it doesn't know." |

**Not in the live demo** (and not claimed): re-asking after a staff fix, and the journey-test before/after numbers. With `DEMO_MODE` on, a repeated chip replays the cached answer, so a fix does not change it. Journey tests ("Journey tests" tab: simulated residents across profiles and scenarios, with outcome matrix and rest-gap advisories for older adults) take about 90 s to run (measured 15 Oct 2026 on the seed: about 33 s journeys and 58 s evacuation) and need the staff token; the console shows "No run yet" until one is run. Run it before the demo and quote only what the screen shows.

## World-model segment (about 3:00, current two-screen UI, `ai/world-model`)

This segment uses only the current screens (`/` and `/tickets`). The chips are replayed from the demo cache in `DEMO_MODE`.

**Warm the caches first (T–10 min).** The first rising-river simulation on the seed takes about 15 s and the What-if Lab's suggestions about 5 s. Open both once before going on stage; after that they are instant.

| Time | On screen | Say (presenter) |
|---|---|---|
| 0:00 | **Resident.** Chip "Stroller route from Car Park B to the playground". The draft streams in grey ("Draft · checking against the township data…"), then "✓ Answer checked against the township data", then the status line and the answer | "Watch it think honestly. The first sentence appears as a draft, a validator checks every claim against the township's world model, and only then is it final. If the AI guesses or says 'safe', you see it sent back and rewritten." |
| 0:35 | **Resident.** Chip "At which river level does my route from the mall to an evacuation centre break?" | "A resident's real question: not 'is it safe', but 'when does my way out stop working'. The model replays the trip at every modelled river stage and names the level. These are indicative scenarios, not a forecast." |
| 1:00 | **Management.** Open the What-if Lab, set River +3 m, tick a suggested change, Run. The diff draws on the map (grey before, lilac imagined, magenta the change) with before/after bars and "What-if · not real" | "Planning, not guessing. The language model proposes from the engine's legal moves, and the world model simulates every sampled journey on a copy of the township. It shows what the flood alone does and what the change adds. Nothing real changes." |
| 1:45 | **Management.** Rising river, then Play. Stages step from normal level to +5 m; yellow residents walk their routes, and red ones are cut off | "Synthetic residents of each persona head for their nearest evacuation centre as the river rises. Elmina mostly holds: 29 of 30 at normal level, 27 from +2 m. The model shows exactly who loses their route first, and from which level. A simulation, not a forecast. It says so on screen the whole time." |
| 2:20 | **Tickets.** Plan a survey: "If these 15 checks at 5 places pass, 4 of 50 sample journeys would have a confirmed route (today: 0)" | "Honesty becomes a work plan. Every gap is visible, so the model can tell staff exactly where to look next. And it learns: every ticket they resolve updates its belief about what the next survey will find." |
| 2:45 | Slide: the evaluation table from [ai-eval-report-2026-10.md](ai-eval-report-2026-10.md) | "We asked the same AI 30 real questions about Elmina, with and without the world model. Without it, the model mostly couldn't answer and sometimes guessed. With it: 23 checked, cited answers, the rest correct refusals, zero honesty violations, zero invented numbers. It cost cents." |

**If asked "is it a real world model?"** It has an explicit state, a closed set of actions, a transition function, rollouts and planners on top: the functional definition, the same family as AlphaZero's rules or DeepMind's Code World Models. The dynamics are engineered, not learned. What it learns is its uncertainty, from OpenStreetMap tags and staff verifications, and that is used only for planning. See [world-models-2026.md](../02-research/world-models-2026.md) §8.

## What can go wrong → recovery

| Failure | Recovery line + action |
|---|---|
| Wi-Fi or API down | "Let me show you the recorded run" → switch to the video at the same timestamp. `DEMO_MODE` answers need no LLM, but the app still needs its own API running locally |
| Google 3D tiles don't load or look poor | Click **Lite map** or **List**. *"Works on any phone. 3D is a layer, not a dependency."* The List view needs no map keys |
| Water drawn above or below the mesh (datum offset) | Use Lite map, where the flood layer is drawn flat. Say: "we calibrate the water against the elevation model, not the picture". At low stages part of the water is hidden under the 3D surface; the list and 2D layers are authoritative |
| A typed question gets a different answer | It missed the replay cache and ran the live mock. Use the chips. *"This is why every answer shows its evidence."* |
| Scenario answer lacks the banner or says anything like "safe" | Stop: "That's exactly what our validator is there to block." Show the golden-set result, then the video |
| Staff actions return 503 or 401 | `STAFF_TOKEN` is the default or wrong. Enter the token on the console, or show the video |
| Queue empty or oddly full | `pnpm db:reset` with the API stopped, restart, and re-ask the chips (replay files the requests again) |

## Variants
- **60–90 s recorded backup video:** fly-in (0:00), the stroller chip (0:15–0:55), Flood + **+3 m** with the banner and **Where can I go?** (1:05–1:45), the gap map, close. Record it from `/?demo=hero` with auto-play (Space) so the captions are in frame; store the file outside git and keep a copy on the laptop and a phone
- **3-minute slot:** drop the place-card beat (0:55), the Closures beat and the advisory; keep the briefing table and the gap map
- **5-minute version** (final): add the other persona chips (wheelchair, older adult needing rest: the answer names the longest stretch without a rest point), the Closures beat, the Journey tests run, and the waste chip *"Where can I drop off recycling nearby?"* (honest: "No recycling drop-off is mapped yet", nearest waste points all unconfirmed, check with MBSA)
