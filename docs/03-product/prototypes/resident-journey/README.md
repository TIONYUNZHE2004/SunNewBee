# Resident journey prototype

> Status: visual prototype, 19 Oct 2026. Standalone page, not part of `apps/web`.
> Concept: [../../resident-journey-simulation.md](../../resident-journey-simulation.md). Read that first.

This page shows the target look and flow of the journey simulation before it is built into the product:
- a clay / toy-diorama Elmina;
- a chibi older resident with a walker, followed from behind;
- event cards, a HUD and a mini-map.

Use it as the visual reference when building the feature.

## Run it

```bash
uv run python docs/03-product/prototypes/resident-journey/build_scene.py   # writes scene.js (only after seed or route changes)
cd docs/03-product/prototypes/resident-journey && python -m http.server 5190 --bind 127.0.0.1
# open http://127.0.0.1:5190/index.html  (file:// does not work in Playwright MCP)
```

Three.js 0.186.1, the same version as `apps/web`, loads from jsDelivr, so the page needs network access.

- **Controls:** play / restart, the timeline scrubber, and three camera modes: Follow, Overview, and Free (orbit).
- **FX toggle:** turns ambient occlusion and depth of field on and off.
- **Test and recording hook:**
  - `window.__journey.seek(seconds)`, `.play()`, `.pause()`, `.setCam("follow"|"overview"|"free")`;
  - `.phases`, the timeline;
  - `.total`, the total length in seconds (about 86 s).

## The demo route

- **Route:** Harmoni 1 @ City of Elmina Show Units (`osm-way-909868201`) → Lakeside Mall Car Park B (`park-b`).
- **Profile:** `older_adult_rest`.
- **Result:** about 966 m, `partly_unverified`, est. 14 min.

It was chosen by scoring the routing engine's results for every clinic and seed place near the hero district.

- **Why not a clinic:**
  - every clinic reachable from the park area is 2.4–5 km away;
  - the routes there pass no verified segment and have no rest points after the start.
- **Why this route:** it is the only short route that has every event type:

| At (m) | Event | Source in the world model |
|---|---|---|
| 0 | Covered walkway | `covered` claim, status `reported` |
| 44 | Crossing Persiaran Elmina, not checked | `major_road` edge, UNKNOWN |
| 100 | No mapped rest stop ahead | `max_gap_between_rest_m` 640 > `max_rest_free_run_m` 100 |
| 193 | Persiaran Tamarind, no mapped sidewalk | street edges, UNKNOWN |
| 573 | Step-free path, verified | overlay claims (`team_survey_placeholder`, so shown as Demo value) |
| 638 / 836 / 888 | Urban Park benches 1–3 | rest points, verified (demo values) |
| 836 | Ramp, not checked | `ramp` edge, UNKNOWN |
| 963 | Arrive, Car Park B | destination place |

The start is a show-unit building used as a stand-in for "home". The route has no clinic. The story becomes "Mum walks to meet me at Lakeside Mall", not the clinic example in the concept doc.

## What is real and what is illustrative

**From the world model:**
- the route geometry, its statuses (green = no known barrier, amber dashes = not checked yet), distances and time estimate;
- the events and their element ids;
- building footprints and heights (OSM, or defaults);
- the walk network, green land and water;
- the zebra stripes, which are drawn only on OSM `crossing` edges.

**Illustrative only:**
- trees, residents, cars, colours and window bands;
- the chat answer's wording (the facts in it come from `scene.js`).

These are labelled on the page. `build_scene.py` derives the events the way the future `journey.py` should: each event points to an element and a claim status, and nothing is invented.

## Gaps against the target look ([reference-target.png](reference-target.png))

- **Hero:**
  - built from primitives;
  - no rigged walk cycle;
  - seen from behind, she reads as a purple ball;
  - needs a modelled head and hijab with a face visible in 3/4 view, plus a real sit pose.
- **Street furniture:** no kerb-side detail yet. Bus stops, signals, planters and lamp posts are missing. Signals and bus stops are facts, so they may only be placed where OSM maps them.
- **Materials:** clay shading only. There are no outlines on people and no colour grade. The tilt-shift is a uniform depth-of-field blur.
- **Ramp shot:** the camera lifts over the mall podium, so the ramp itself is hard to see. The real camera needs a per-event framing rule.
- **Conditions:** no haze, rain or live bus. Conditions are P4 and are out of scope here.
