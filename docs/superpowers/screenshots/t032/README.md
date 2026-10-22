# T-032 · first rendering checkpoint

22 Oct 2026. Stylised 3D, real Elmina seed, 1440 × 900, installed Chromium with SwiftShader.
These are software-rendered captures, not a hardware performance measurement.

| Shot | Light | Dark |
| --- | --- | --- |
| River surface / reflections | [river-day](river-day.png) | [river-night](river-night.png) |
| Rounded low-lying terrain | [terrain-day](terrain-day.png) | [terrain-night](terrain-night.png) |

[Three-frame ripple strip](waves-strip.jpg). The source frames are `waves-0..2.png`.
River +3 m is the scenario stage, never a local depth. The water notice and official guidance
stay visible. Terrain remains `possible`, with roads/buildings above its soft fill.

Validation at the first rendering checkpoint: lint, typecheck, 2,952 web tests, generated-client
drift, 26 mock golden questions, and production build pass. Full Python and the installed-Chromium
E2E run are in progress; the pinned Playwright download was blocked by the cloud network policy.
The full cinematic, building tags, resident journey, and Claude's pending ambient-traffic switch
are still to come. No live model calls and no data regeneration.

## Cinematic checkpoint

The story runs for about 73 screen seconds on this seed. Four river stages lead to a building
shot, one wheelchair resident and an overview with the model limits. All captions remain
indicative. The source camera, hero, ribbon, mini-map, HUD and tags reuse the journey code.

| Shot | Light | Dark |
| --- | --- | --- |
| Normal river | [light](story-normal-day.jpg) | [dark](story-normal-night.jpg) |
| River +1 m | [light](story-river-p1-day.jpg) | [dark](story-river-p1-night.jpg) |
| River +2 m | [light](story-river-p2-day.jpg) | [dark](story-river-p2-night.jpg) |
| River +3 m | [light](story-river-p3-day.jpg) | [dark](story-river-p3-night.jpg) |
| Building bands and tag | [light](story-buildings-day.jpg) | [dark](story-buildings-night.jpg) |
| Resident, 40 s | [light](story-resident-early-day.jpg) | [dark](story-resident-early-night.jpg) |
| Resident, 45 s | [light](story-resident-day.jpg) | [dark](story-resident-night.jpg) |
| Resident, 49 s | [light](story-resident-mid-day.jpg) | [dark](story-resident-mid-night.jpg) |
| Resident, 58 s | [light](story-resident-late-day.jpg) | [dark](story-resident-late-night.jpg) |
| Overview and limits | [light](story-end-day.jpg) | [dark](story-end-night.jpg) |

Four-frame river strips: [light](story-river-strip-day.jpg) / [dark](story-river-strip-night.jpg).
Three-frame resident strips: [light](story-resident-strip-day.jpg) / [dark](story-resident-strip-night.jpg).
Both themes were captured at 1440 × 900 in the built Stylised app, Chromium/SwiftShader,
with the real Elmina API and no live LLM. Pause/seek and Exit worked in both themes;
there were no page or shader errors. The external font was blocked deliberately in the capture.

Actual `/scenarios/{id}/affected?profile=wheelchair` values used by the HUD:

| Scenario | Places likely flooded | Places cut off | Path metres likely flooded |
| --- | ---: | ---: | ---: |
| baseline | 0 | 4 | 0.00 |
| stage_p1m | 15 | 6 | 58604.23 |
| stage_p2m | 16 | 9 | 91596.99 |
| stage_p3m | 19 | 9 | 141598.68 |

The normal cut-off count includes existing mapped disconnections; it does not mean the river
caused four new closures. Path length is formatted as metres or kilometres on screen.

Resident source calls: `/places?q=Pangsapuri%20Cendana`, `/evacuation-centres` with
`near=osm-way-910378225`, `profile=wheelchair`, `scenario_id=stage_p3m`, then `/routes` and
`/journeys` to `__centre__evc-osm-way-910378231`. The nearest returned mapped candidate is
Surau At Taqwa (`osm_candidate`). Route: 358.7 m, estimated 5.1 min, `partly_unverified`.
Two returned centres have `no_data`; these are labelled as data gaps.

The baseline and +3 m routes have exactly these five edges:
`seg-598711924-0`, `seg-885027020-0`, `seg-240136676-1`, `seg-240136713-0`,
`seg-1346147888-1`. None is in the +3 m likely-flooded edge set. Therefore the UI states that
the mapped route is unchanged and does not show the requested flood-detour tag for this seed.
No route evaluation or data was altered to manufacture a detour.

Dependency still pending: Claude's `setAmbientTraffic` is absent from DaVinci (683210bc) and
his current worker branch (5b309d06). These captures therefore still contain ambient cars.
The PR stays draft until his shared switch lands and the flood calls it. No independent switch
is implemented here.

Checks: the first rendering checkpoint passed GitHub CI (run 39796301546). The cinematic has
passed lint, workspace typecheck, 2,965 web tests, generated-client drift, 26 mock golden
questions and production build. Final CI results are recorded on PR #40.
Python is unchanged: 3,191 passed / 37 skipped. Installed Chromium E2E: 39 passed, two failures
also reproduced on unchanged DaVinci 449171b9: external-font `ERR_TUNNEL_CONNECTION_FAILED`
and the phone composer-height assertion (111.1875 px versus >150 px). No unrelated UI fix was made.

## Route-limit review

The current captures show the API's two specific route limits: about 347 m follows road centre
lines without a mapped sidewalk, and the home entrance is not mapped. The mini-map is separate
from the warning card. The wheelchair distance label is Travelled; the shared HUD's other
callers keep their existing label. Five API contract probes also cover a failed place lookup,
mismatched journey/route ids, a missing connection and a missing river stage, beside an honest
candidate control. Ten built-app browser probes pass for the four API counters, route labels,
pause, repeatable camera seeks, honest failure states and Exit.

All twenty cinematic captures and both theme strips were refreshed after this review. The
cinematic checkpoint at 86006f95 passed all seven GitHub CI gates (run 39803286030). The latest
checks and the pending shared-traffic requirement are reported on PR #40.
