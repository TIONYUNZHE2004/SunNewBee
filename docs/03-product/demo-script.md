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

## World-model segment: Elmina Day (about 3:00, current two-screen UI, `ai/world-model`)

This segment uses only the current screens. Management mode opens **Simulate a day**. The caches warm themselves: check `GET /api/healthz` → `world_model.state: "warm"` before going on stage. The numbers below are from the Elmina seed on 17 Oct, re-measured after the Cycle 21 calibration fix (only children aged 7-12 go on a school run); they change if the data changes, so read them off the screen.

| Time | On screen | Say (presenter) |
|---|---|---|
| 0:00 | **Management → Simulate a day → Storm at the school run → Play on the map.** The clock runs from 06:00. At 06:45 the river rises to +1 m, then +2 m and +3 m (the flood layer follows the clock). Yellow dots walk, blue dots drive, and red dots wait for a way through | "This is a rehearsal of tomorrow morning in City of Elmina. 5,000 synthetic residents live in real Elmina homes, in proportions from DOSM statistics: the school run, commutes, prayers, the clinic. Then the river rises during the school run. Every dot follows its own path on the real map, and every count is the world model's." |
| 0:45 | **Overview tab:** the groups table (every resident is in one column, data gaps included) and the school line ("818 pupils… 188 couldn't get there") | "It doesn't say 'the town flooded'. It says *who*. 188 pupils couldn't get to school. Teenagers are hit hardest, because they walk to school on their own: 160 of 362 couldn't go or turned back. Households without a car come next: 130 of 442 couldn't go at all. And where the map has no connection, it says 'data gap' instead of guessing. That is the People track: every resident, by group." |
| 1:10 | **Residents tab:** pick a parent with a stroller or a wheelchair user; the camera flies to them; their diary is marked "AI voice, checked" | "Forty of them have a voice. A cheap AI model writes their diary and makes their choices, and only from options the engine offers: wait, stay home, ask a neighbour for a lift, turn back. Every time and number they say is checked against their own simulated day before it's shown." |
| 1:35 | **Feed tab** while the clock plays: the township's river notices, then "I planned to drive to work at 07:07, but there was no way through…" with a "Same here" reply | "This is MiroFish-style social simulation, except these residents walk on real data. The feed fills up as the morning goes on. It is a rehearsal of what people will be dealing with, not a poll and not a forecast." |
| 2:00 | **Test a change → "Imagine the flooded stretch on Jalan Sungai Buloh … raised" → Compare the day.** "820 residents would be better off and 0 worse off"; the town hall; the stretch drawn on the map | "Now the planner's question: what if we raise this one kilometre of road above the flood levels? Same day, same residents, run again: 820 residents would be better off, and nobody worse off. On Persiaran Eserina, it's 105 teenagers and 55 children under 13. A world model lets you test a change *before* you build it." |
| 2:25 | **Resident mode → "Rehearse my trip"** (beside Travelling as; only with `ASSISTANT_SCOPE=all`, hidden under the default scope B): tap a point near home on the map, type "SK Denai Alam", leave at 07:30, Storm. The departure strip appears (✓ 06:30–06:40, ✕ from 06:50, ✓ again from 12:30) and the map plays the trip: the usual route, the flooded street that cuts it, and "You". Tap 06:40 on the strip: the trip is rehearsed again and gets there | "And for the resident it's personal. Same rehearsed storm, *my* school run. It doesn't say 'safe' and it doesn't tell me when to leave: it shows what happened to my trip in the rehearsal, departure by departure, and which street the water cut. My home point is used once and never saved." |
| 2:35 | **Ask the assistant:** "What happens to residents in the storm rehearsal?" → the checked answer (school first, then the groups hit hardest), and the map jumps to the rehearsal at 07:25 with the river at +3 m | "And the assistant answers from the same rehearsal, through the same honesty gate: synthetic residents, not a forecast, only the engine's counts, data gaps named. Then it shows you the moment it's talking about." |
| 2:50 | Slide: the evaluation table from [ai-eval-report-2026-10.md](ai-eval-report-2026-10.md) | "Underneath, the same rule as everywhere in TownshipLens: the AI never invents a fact, and every gap is shown as a gap." |

**Backup beats:**
- type "Which change would help most residents in the storm rehearsal?". The assistant runs the same before/after comparison as Test a change ("820 residents would be better off and 0 worse off"). The map flies to the stretch, drawn as an imagined change. Then ask for option 2 (Persiaran Eserina: 262 better off and 2 worse off, among them 105 teenagers and 55 children);
- the night event at the park: up to 449 residents at once, and 400 met a neighbour from another household;
- the rising-river and tipping-point views;
- the ticket impact card on `/tickets`, now with "Whose rehearsed trips use this": how many synthetic residents' trips on a normal weekday use that unchecked path, on foot or by car, and what for (e.g. the busiest Persiaran Eserina segment: 255 residents, 183 on foot and 72 by car, 113 of them teenagers, 179 school trips).

**If asked "is it a real world model?"** Yes, in the functional sense:
- **an explicit state:** the township's paths, places, flood scenarios and facts;
- **a closed set of actions:** close a path, build a ramp, raise a flooded stretch, verify a fact;
- **a transition function** that applies them to a copy;
- **simulation and planning on top:** 5,000 agents living a day, comparisons before and after, survey and fix-it planners.

The township dynamics are engineered from open data, not learned. What is learned or generated is kept separate and checked:
- the model's belief about unchecked facts (from OpenStreetMap tags and staff checks);
- the spotlight residents' words and choices (an LLM, limited to what the engine offers).

See [world-models-2026.md](../02-research/world-models-2026.md) §8 and the [Elmina Day design](../superpowers/specs/2026-10-17-elmina-day-design.md).

## What can go wrong → recovery

| Failure | Recovery line + action |
|---|---|
| Wi-Fi or API down | "Let me show you the recorded run" → switch to the video at the same timestamp. `DEMO_MODE` answers need no LLM, but the app still needs its own API running locally |
| Google 3D tiles don't load or look poor | **Map settings → Map view → Lite map** or **List (text)**. *"Works on any phone. 3D is a layer, not a dependency."* The List view needs no map keys and spells out what-ifs as text |
| Water drawn above or below the mesh (datum offset) | Use Lite map, where the flood layer is drawn flat. Say: "we calibrate the water against the elevation model, not the picture". At low stages part of the water is hidden under the 3D surface; the list and 2D layers are authoritative |
| A typed question gets a different answer | It missed the replay cache and ran the live mock. Use the chips. *"This is why every answer shows its evidence."* |
| Scenario answer lacks the banner or says anything like "safe" | Stop: "That's exactly what our validator is there to block." Show the golden-set result, then the video |
| Staff actions return 503 or 401 | `STAFF_TOKEN` is the default or wrong. Enter the token on the console, or show the video |
| Queue empty or oddly full | `pnpm db:reset` with the API stopped, restart, and re-ask the chips (replay files the requests again) |

## Variants
- **60–90 s recorded backup video:** fly-in (0:00), the stroller chip (0:15–0:55), Flood + **+3 m** with the banner and **Where can I go?** (1:05–1:45), the gap map, close. Record it from `/?demo=hero` with auto-play (Space) so the captions are in frame; store the file outside git and keep a copy on the laptop and a phone
- **3-minute slot:** drop the place-card beat (0:55), the Closures beat and the advisory; keep the briefing table and the gap map
- **5-minute version** (final): add the other persona chips (wheelchair, older adult needing rest: the answer names the longest stretch without a rest point), the Closures beat, the Journey tests run, and the waste chip *"Where can I drop off recycling nearby?"* (honest: "No recycling drop-off is mapped yet", nearest waste points all unconfirmed, check with MBSA)
