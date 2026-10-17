# Elmina Day: a living rehearsal of the township (design)

Status: approved in chat, 17 Oct 2026 ("Start the overnight build on this plan"). Branch `ai/world-model`. This is the world model we pitch for the People track.

## Intent

The People track asks how every resident can live a healthier, safer, more connected and more fulfilling life. Elmina Day lets SDP *rehearse* a day of the township before it happens:

- 5,000 synthetic residents live a day on the real Elmina map: the school run, commutes, prayers, errands and the park;
- the day can include a storm, a river rise, a closure, an event or a planned change;
- the world model shows who it works for and who it fails, by group.

A MiroFish-style layer then gives about 40 "spotlight" residents an AI mind and a voice:
- each keeps a diary;
- they decide at key moments, choosing among options the engine offers;
- they post to a simulated community feed;
- staff can interview them afterwards.

Unlike MiroFish, every resident walks on real data. Every number comes from the engine, and the AI only gives voice to outcomes the engine produced.

## Goals

1. **A deterministic day engine.** It covers a synthetic population, daily plans, time-stepped travel on the township state (river stage by minute, imagined changes, staff closures), rerouting, waiting and cancelling. The outputs are counts by group, a timeline, busy places, neighbours met, minutes walked and map tracks.
2. **Four recorded hero days:** a normal weekday, a storm at the school run, a night event at the park, and Friday prayers. A fifth is a planner before/after comparison of an imagined change (Cycle 13).
3. **Spotlight residents** (Cycle 11). They have personas, memory and decisions limited to legal options, plus a diary, a feed and interviews. They run on a cheap OpenRouter model chosen in the environment, and the demo replays recordings.
4. **A Simulate panel and map playback** in Management mode (Cycle 12). It adds controls only, with no design changes.
5. **The assistant can answer from a rehearsal** (Cycle 14), with validator rules for it.

## Non-goals and anti-goals

- **Not a forecast of real people or real floods.** It is a rehearsal on synthetic residents with indicative river scenarios.
- **No invented numbers.** The report and feed may quote only engine counts and the resident's own trip.
- **No per-agent LLM for the crowd.** That is the AgentSociety/MiroFish cost model, and it doesn't fit a US$3 cap.
- **Not copying what the reference repos get wrong:**
  - random durations;
  - "arrived" before arrival;
  - forced trip lengths;
  - simulated chatter mixed into facts;
  - reports with made-up statistics.

## Design (Cycle 10, built)

### `day/router.py`
- **Rules:** the same rules as `routing.make_weight`, which are the edge evaluator, the UNKNOWN penalty and the steps multiplier.
- **Fields:** cost arrays are built once per persona and river stage. scipy's multi-source Dijkstra then computes one "field" per destination, which takes about 1.5 ms on the seed.
- **Tested:** path lengths are checked against `routing._search`'s lenient pass.

### `day/population.py`
- **Homes:** synthetic households live in real OSM residential buildings, weighted by floor area.
- **Statistics (DOSM):**
  - ages 21.2% / 70.4% / 8.4% (2026);
  - 3.8 people per household (Census 2020);
  - 92.3% of households own a car (2024);
  - 2.4% OKU, 35.6% of them physical (2024).
- **Assumptions,** listed in `SOURCES`:
  - commuters;
  - surau attendance;
  - the wheelchair share.

### `day/schedule.py`
- **Plan shape:** AgentSociety-style day plans.
- **Destinations:** a gravity choice among the 3 nearest places of the right type.
- **Typical times:** the school run, commutes, approximate prayer times, errands, a morning walk, the evening park.
- **Children:** under 13 they travel with a carer.

### `day/engine.py`
- **Trips:** each trip is routed on the state at its minute.
- **River changes mid-trip:** when the river changes on the way, the rest of the path is re-checked. The resident carries on, reroutes, or waits where they are.
- **No way open at departure:** essential trips wait up to 90 minutes and are then cancelled; optional trips are cancelled at once.
- **Delays:** measured against the same trip on a normal day in the real township.
- **Data gaps:** a trip with no mapped way even on a normal day is a `data_gap`, never "blocked".

### `day/summary.py`
- **Counts:** headline counts, groups (children, teenagers, older, wheelchair, stroller, no car), school outcomes, minutes walked, and the busiest places with their peak and neighbours met.
- **Timeline:** a 15-minute timeline.
- **Tracks:** a sample of 1,500 residents.

### API and caching
- **API:** `GET /day/scenarios` and `GET /day/{id}`, cached per world version.
- **Warm-up:** the API warms all four days in the background.

## Left to the builder

- Spotlight personas and prompts.
- The feed ranking: the OASIS hot score.
- The panel layout, inside the existing visual language.
