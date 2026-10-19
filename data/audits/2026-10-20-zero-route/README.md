# Backend overnight follow-up, 20 October

Own API/web ports: 8021/5191. World: committed Elmina seed. All chat calls use the mock; model spend is US$0. Crafted tiny-world cases are labelled separately below.

## Backend fixes

- `aab8d18`: zero-edge route geometry contains two identical positions at the graph point, preserving the LineString contract and camera target. It does not draw an invented entrance connection. Reproduced through the real API for Urban Park → bench 3 and park-b → park-b.
- `f9b459d`: Urban Park → bench 3 changes from `confirmed` to `partly_unverified`, still zero mapped metres. An explicitly inferred entrance without a mapped entry or usable staff access-point check cannot establish a checked connection. Same-place and 416.4 m park-b → playground controls retain their behavior. `api-comparison.json` contains the before/after responses.
- `8a885f9`: a linked evacuation centre honors the place's explicit entrances. Crafted tiny fixture: kiosk and linked centre both end at n-d, 222.4 m; previously only the centre ended at the old n-c, 111.2 m. Missing graph nodes produce `no_data`. The current seed has no explicit entrance lists, and all 72 centre fallbacks are unchanged. Do not describe this as a repaired seed entrance.
- `58734d7`: driving gap warnings follow the first returned route's actual endpoints. Crafted fixture: an unused road-touching entrance no longer hides the selected entrance's off-graph gap. Tested in both directions, with a control selecting the road-touching entrance itself.

## AI cross-check

AI `c8f276d` (data `1622461`) is merged through `19a0f09`. The original seven saved maneuver probes now pass. The legitimate closure test passes. Real drive chat preserves the ~120 m road-end gap and standing legal-turn warning, and says “Reach the end of the mapped route.” See `drive-chat-after-ai.json`.

AI c586d46 is now integrated through ab97315 and rejects those earlier lowercase/unnamed/repeated-street cases by a no-model-turns policy. The controls explicitly reflect that policy, with descriptive controls retained. **Merge hold remains:** the expanded `probe_remaining_navigation.py` / `.json` still demonstrate four accepted wrong-turn paraphrases (take a right, make a right turn, Malay simpang and Chinese right-turn wording), while nine expected results pass. These are crafted offline validator cases, not demonstrated model responses or real seed routes. See the [latest verification/flood follow-up](../2026-10-20-special-verification/README.md) for the current 1,163-test compatibility result and complete handoff.

Recommended correction: keep model-authored navigation out of every free-text answer field and render directions from selected maneuvers, or bind each direction assertion to one maneuver occurrence, action, street and distance together. Independent sets of allowed facts permit invalid combinations. Do not patch each bait in isolation.

The additional real mock zero-route chat abstains and requests endpoint clarification (`zero-chat.json`). It neither selects a wrong path nor verifies the new zero-route caveat wording; the deterministic tool/API tests provide that contract check.

## Source limitation

`source-identity-probe.json` records one original OSM way and its node IDs matching the seed segment. This proves only that way, not whole-seed junction topology. Both Overpass services failed bounded probes. No seed was rebuilt, and the editing API was not used for bulk extraction. Source: OpenStreetMap contributors, ODbL; diagnostic URL is included in the JSON.

The source-backed topology rebuild, legal turn relations and Yunzhe's ordinary-destination closure policy remain blocked as logged on the board. Full CI and visual map review remain control-owned. No local e2e or paid model calls were run.

## Checks and end state

- 61 geometry/routing/API tests PASS; 177 zero-edge/routing/flood/tool/API tests PASS; 181 centre/routing/maneuver/flood/tool/API tests PASS.
- Final selected-entrance warning change: 74 affected routing tests PASS.
- Integrated AI step/closure check: 46 tests PASS.
- Golden 23/23 PASS (mock; zero fallbacks and rejected attempts); lint PASS; typecheck PASS; API regeneration has zero client drift.
- All 22 demo event bodies are byte-preserved from the passing body comparison; their headers are rebound to the final code/world/day signature, with 22/22 successful replay loads.
- `final-api-controls.json`: inferred zero-edge journey partly_unverified, same-place journey confirmed, walking control 416.4 m, forward drive 113.3 m, reverse drive 113.2 m.
- Own app is stopped; sockets 8021 and 5191 are verified closed.
- Final integrated agent/API after the last source change: **1,152 PASS** in 237.88 s, including all 23 demo-cache body checks. Existing tests are green; the three saved wrong-navigation probes still justify the merge hold.
