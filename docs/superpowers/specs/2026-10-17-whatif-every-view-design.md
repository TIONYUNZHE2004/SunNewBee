# What-if in every view (Cycle 8 design)

Status: design, 17 Oct 2026, branch `ai/world-model`.

## Intent

A what-if diff was drawn only on the 3D Cesium map. The lite map (Mapbox) and the List view showed a tag saying the diff is "drawn on the 3D map". So a resident without WebGL, a keyless setup or a screen-reader user lost the world model's main result.

The List view is the accessible fallback, and e2e runs in it. It should spell out the same diff as text, with the same numbers.

## Design

1. **Engine: the diff carries what a renderer needs.** `simulate_what_if`'s `diff_geojson` gains a `meta` foreign member (allowed by RFC 7946 §6.1) holding:
   - the engine summary;
   - the readable action labels;
   - the profile, scope and imagined flag;
   - the base and imagined stages;
   - `changed_shown`.

   Features gain names:
   - before/after lines get `from_name` and `to_name`;
   - touched paths get `label` (`twm.path_label`).

   The browser recomputes nothing.
2. **Web model.** `diffMeta`, `diffJourneys` and `touchedLabels` in `whatifModel.ts` are pure and tested. They ignore any feature not tagged `whatif: true`, the same rule `diffLines` uses.
3. **List view.** `WhatIfListSection` is a region named "What-if · not real". It shows:
   - the imagined changes;
   - today vs what-if counts, from `summaryBars`;
   - the imagined paths;
   - the journeys that change ("before → would be after"), with "Showing N of M" when capped;
   - a Clear button.
4. **Lite map.** A `whatif` GeoJSON source with before/after/touched line layers. The filter requires `whatif == true`, and the styles are the 3D ones (`WHATIF_STYLE`).
5. **Tag.** `WhatIfTag` shows the legend whenever a map draws the diff, and "Listed below" in the List view.

## Honesty

- Every line and row is labelled imagined.
- Outcomes are "would be".
- Counts are the engine's summary.
- "No sampled journey changes status" is said plainly.
