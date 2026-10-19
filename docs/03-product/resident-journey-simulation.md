# Resident journey simulation (third-person follow)

> Status: concept, 18 Oct 2026. Not built. The questions to settle before a spec and a plan are listed under "Open questions".
> Scope: how a resident's question becomes a simulated walk that the 3D map plays from behind one virtual resident. It does not cover the demo story or the pitch.

## The idea

When a resident asks for a route, the map doesn't just draw a line. It **plays the trip**:
1. A virtual resident with the asker's constraints walks the route.
2. The camera follows from behind.
3. Everything the world model knows about the trip happens on screen, at the place and time it applies: verified kerbs, unchecked segments, rest stops, the current air quality, a forecast storm.

A chat answer tells the resident what the trip is like. The simulated walk shows them. It also makes the world model visible: it brings in conditions the resident never mentioned, such as haze or a storm, and marks every gap where the answer is unsure.

## How it plays

### Camera

| Beat | Camera | Purpose |
|---|---|---|
| 1. Dive | Flies from the township view down to the start point | Places the trip in the real Elmina |
| 2. Follow | Behind and above the virtual resident, moving with them | The viewer sees the trip at the resident's pace |
| 3. Pull-back | Rises back to the township view at the destination | Returns from one person to the whole community |

Time is compressed during the follow beat (about 1 minute of trip per 3 seconds on screen). It drops to real time at each event.

### What is on screen

- **The virtual resident:** a person model that matches the profile (older adult with a walker, parent with a stroller, wheelchair user), with a highlight ring so it stands out from decorative people.
- **HUD:** simulated clock, distance walked, minutes outdoors, and rests taken.
- **Mini-map:** the whole route, coloured by segment status (`confirmed`, `partly_unverified`, `blocked`).
- **Event cards:** short cards that appear at the place they apply. Each card carries its source and opens its evidence.
- **The "Simulation" label:** always visible.

### Events

**Every event comes from a world-model fact or a sourced external reading.** Nothing on the trip is invented. Decorative cars and people may still pass by, but they never cause an event.

| Event | Trigger (source) | On screen |
|---|---|---|
| Verified feature | A `verified` claim on the segment (kerb ramp, step-free entrance) | Green tick and an evidence card |
| Unchecked segment | An UNKNOWN edge for this profile | The resident pauses with a "?". The card says "Not checked yet" and that a verification request was filed |
| Rest stop | The profile's rest rule (`older_adult_rest`: `max_rest_free_run_m: 100`) and a seating place on the route | The resident sits; the clock keeps running and the rest counter goes up |
| Covered walkway | A segment with a `covered` claim | Camera passes under the roof; minutes outdoors stop counting |
| Air quality | APIMS hourly reading above the unhealthy band (101+) | The city tints grey-yellow; a card shows station, hour and reading |
| Forecast storm | MetMalaysia forecast or warning for the district during the trip window | The sky darkens and rain falls; the card shows the forecast window, not a minute |
| Live bus (optional) | GTFS-Realtime vehicle position on a feeder route | A real bus, drawn differently from decorative vehicles and labelled "Live" |
| Destination | The place's entrance claim | The step-free entrance lights up |

## Example

Aisyah types:

> *"My mum has a 4pm appointment at the klinik. She uses a walker. How should she go?"*

The assistant answers in chat: the route, about how long it takes, the rest stops, and one segment no one has checked. At the same time the map plays the trip:

1. **Dive.** The camera drops from the township view to the mother's front door. She sets off with her walker at 15:20.
2. **Verified kerb ramp.** At the first crossing a green tick appears, with a card: "Kerb ramp · verified · team survey, 12 Oct".
3. **Haze.** The city turns grey-yellow, and a card appears: "APIMS · Shah Alam (CA20B) · 15:00 · API 156 (unhealthy)". Aisyah never mentioned haze. The world model brings it in because the trip is outdoors and the traveller is an older adult.
4. **Rest.** After about 100 m she sits on a bench for a minute. The HUD rest counter goes to 1.
5. **Unchecked segment.** Before a side path she stops with a "?". The card says: "No one has checked whether this crossing has a ramp. A verification request was sent to the township team."
6. **Storm window.** The sky darkens, and a card says: "MetMalaysia · Petaling · thunderstorms in places this afternoon". She turns onto the covered walkway, and the minutes-outdoors counter stops.
7. **Arrival and pull-back.** The clinic's step-free entrance lights up at 15:41. The camera rises back over Elmina.

The chat answer and the walk always say the same thing. The walk is the answer shown in place.

## Honesty rules

All the existing honesty invariants apply. On top of them:

- **It is a simulation.** The "Simulation" label stays on screen. Times and distances are indicative. The walk shows the route model, not a prediction of what the person will meet.
- **Forecasts are windows.** Rain is shown as "forecast for this afternoon in Petaling", never as rain starting at a set minute.
- **Readings have a scope.** An APIMS reading is the station's value for the area, never the air on that street. Wording never says "safe" or "clean air". It points to the official KKM / DOE advice.
- **Only sourced facts cause events.** Decorative detail stays decorative. It is never the reason the resident stops, turns or waits.
- **Demo values are labelled.** Facts that come from `team_survey_placeholder` show "Demo value · not surveyed" on their cards, as they do everywhere else.
- **The world model surfaces conditions, not the LLM.** A condition appears because the conditions layer reported it for that place and time. It never appears because the model guessed.

## Architecture fit

The flow stays the same: the agent calls tools, the validator checks the answer, and renderers adapt scene intents.

- **New tool `get_conditions(time, place)`** in `packages/spatial`:
  - It returns the current APIMS reading, the MetMalaysia forecast and warnings, each with an Evidence record.
  - The agent must call it for every outdoor-trip question.
- **New validator rule:** when the conditions pass a threshold and the trip is outdoors, the answer must mention them and cite them. This is the same mechanism as the flood disclaimer. The mock and the template change together with the validator.
- **New scene intent `journey.play`:**
  - It carries the route geometry, the profile, the start time and the ordered events (each with its `evidence_id`).
  - The agent still never touches the scene; renderers adapt the intent.
  - Three.js plays the full walk. Mapbox lite and the List view show the same events as a step list.
- **Renderer pieces (Three.js):**
  - follow camera modes in `cameraRig.ts`;
  - a walk along the route polyline, reusing `poseAt` and the smoothed yaw from `motion/agents.ts`;
  - a haze tint and rain particles;
  - the event cards.

External sources checked on 18 Oct 2026:

| Source | Endpoint | Status |
|---|---|---|
| APIMS (DOE) | `eqms.doe.gov.my/api3/publicportalapims/apitablehourly` | Works. 68 stations × 24 h. Undocumented; terms of use to confirm with DOE |
| MetMalaysia forecast and warnings | `api.data.gov.my/weather/forecast`, `/weather/warning` | Works. Official open API. Petaling district is `Ds057` |
| GTFS-Realtime | `api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder` | Works. Feeder buses run 2–5 km from Elmina |
| JPS river levels | publicinfobanjir.water.gov.my | No public API found |

## What exists today

| Part | Exists today | New work |
|---|---|---|
| Follow camera | `tweenPose` in `cameraRig.ts` | Per-frame follow, three beats, keep clear of buildings |
| Walk along route | `poseAt`, smoothed yaw, route geometry | Slow-downs, pauses, rest stops |
| `journey.play` intent | Intent pipeline | API, agent, mock, validator, `pnpm gen` |
| Haze and rain | Three.js fog | Tint, particles, darker sky |
| Conditions layer | Endpoints verified | Ingest, `get_conditions`, validator rule |
| Hero person model | Low-poly people (`older_adult`, `parent_stroller`, …), shader limb swing, sized for 80–300 m | Rigged model with a real walk cycle, plus a walker variant |
| Street-level look | P4 facades, ground and verges (tuned for aerial views) | Kerbs, footpaths, benches and shelters that hold up at 3–5 m |
| Route data | Seed has only 6 seating places, 3 benches and 1 covered segment | Pick a route; add facts (demo values, labelled) or survey them |

## Visual style: cartoon (proposed)

The proposal is for the simulation, and the Stylised map it plays on, to move to a cartoon look:
- It looks better, and it matches the reference diorama.
- Viewers no longer judge it against photographs, so the work can go into the simulation and the data.

**The rendering becomes cartoon; the facts do not.** These stay true:
- building positions, footprints and heights;
- the walk network;
- every world-model fact.

It is still a digital twin of Elmina, drawn in a friendly style. Flood and haze stay sober: no cartoon water, and no depth implied.

### Which cartoon

| Style | Examples | Fit |
|---|---|---|
| **Toy / miniature diorama** (recommended) | Townscaper, Mini Motorways, the reference image | Soft shadows, saturated colours, rounded forms, tilt-shift. Suits a top-down city |
| Cel-shaded with outlines | Breath of the Wild, Borderlands | Use only as an accent: thin outlines on people so they read |
| Flat low-poly | Many mobile games | Too bare up close |

Buildings don't need new models for this. The work is:
- a material change: banded toon light, soft AO and a colour grade in `roleMaterial` and the facade and roof layers;
- a tilt-shift post pass;
- outlines on people.

### Problem 1: people are too small

At true scale a 1.7 m person is tiny next to the city. That follows the overhaul spec's true-scale rule, which the owner set. Cartoon style gives three remedies:
- **Chibi proportions:** a big head and a short body (about 1:3) read as a person even at a few pixels.
- **Moderate enlargement:** people at 1.3–1.5× true scale, with buildings and roads kept true. `displayScale` in `motion/agents.ts` already scales people by distance.
- **The follow camera:** it keeps the hero large in frame anyway. The size problem is mostly the background crowd, and bright colours plus thin outlines make them visible.

Enlarging people needs the owner to override the true-scale rule **for people only**. People are decorative, so enlarging them changes no fact.

### Problem 2: too much empty space

Elmina really does have a lot of open land. It is a township still being built, with development plots, wide roads, large car parks and large parks. **No invented buildings fill it.** Instead:
- **Dress the land by its real class:**
  - grass gets tone variation and flower clumps;
  - wooded land gets massed trees (from ESA WorldCover classes);
  - development land gets construction dressing (P4);
  - car parks get stalls and cars (P4).

  Cartoon style helps here: the same grass that reads as empty in a realistic style reads as a park once it has flowers, rocks and patterns.
- **A diorama base:** the township sits on a floating slab whose edges show a cut soil section, so the map ends on a finished edge instead of endless flat ground.
- **Framing:** the follow camera has a narrow view, and the example route can run through a denser area.
- **Tilt-shift and distance haze:** these soften far-away open land.
- **Decorative life:** birds, kites and butterflies, all labelled illustrative.

### Problem 3: people need new models

Cartoon people are much easier to make than realistic ones: no realistic faces, no cloth folds.
- **Base characters from free packs:**
  - Quaternius and Kenney publish cartoon character packs, released as CC0, so they are allowed for this project.
  - Some come rigged with walk animations.
  - Record them in `CREDITS.md`.
- **Localised in Blender:**
  - dress: tudung, baju kurung, songkok, school uniforms;
  - props: walker, stroller, wheelchair.
- **Variety by combination:** body types × heads × outfits × props give dozens of looks, so no two neighbours match (ADR 0013).
- **Two tiers:**
  - **Hero:** more detail and a full skeletal walk, for the follow camera close-up.
  - **Crowd:** the walk baked into a vertex animation texture, so thousands can walk without a performance cost. Today's crowd swings limbs in the shader, which is the same idea.

## Open questions

- Which real route to use for the example: a home in or near the hero district to a real clinic, with enough verified, unknown, rest and covered segments along it.
- What threshold makes a condition worth mentioning, per profile (for example API 101+ for children, older adults and people with asthma).
- Whether to ask DOE for permission before using the APIMS endpoint, or only replay recorded readings.
- Whether the walk needs a skip or scrub control for real users, or only playback for the demo.
- Whether the owner overrides the true-scale rule for people only (chibi proportions, 1.3–1.5×).
- Which cartoon variant to use (plain toy, toy with outlines, or more saturated).
