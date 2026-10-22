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
