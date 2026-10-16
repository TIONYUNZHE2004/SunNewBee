# 0011. Time-of-day theme and decorative motion in the stylised city

- Status: accepted
- Date: 2026-10-16
- Deciders: owner, with Claude Code

## Context
The owner wants the stylised 3D city to follow the Elmina clock (Day / Dusk / Night) with a manual override, and to show gentle motion (birds, clouds, ambient) so the map feels alive. The product's promise is honesty, so nothing that moves or changes mood may read as data.

## Decision
- The mood is display-only lighting from `themeAt()` (Asia/Kuala_Lumpur): Day 07:00-18:00, Dusk 18:00-19:30, Night 19:30-07:00. It never changes a fact. UI chrome has two skins (`data-skin` light for Day and Dusk, dark for Night); `data-theme` carries `day|dusk|night`.
- All motion is decorative, seeded and deterministic, never tied to data: birds, clouds and cloud shadows, leaf shimmer, base-water ripple, lamp fade, night window flicker.
- No moving traffic (it could read as live traffic data). No invented landmarks or signage.
- Water animation is confined to decorative base water and never touches flood-scenario layers (tested).
- Motion runs from one capped (30 fps) loop that stops when hidden, off-screen, disabled or under `prefers-reduced-motion`.
- Pavements, kerbs, markings and parks are drawn flat (ClassificationPrimitives) so they can never hide route or path-status lines. Water is a GroundPrimitive with a shimmer material.
- Parks are display-only, and the seed currently has no `parks.geojson` (Overpass was blocked). Fetch with `uv run python data/scripts/build_buildings.py --parks --max-requests 40`.

## Options considered
- Moving traffic: rejected, it can be mistaken for live traffic data.
- Cesium ambient occlusion: tried and disabled at every tier. HBAO produced streak artifacts over this flat-ellipsoid scene on a real GPU. Contact darkening comes from shadows plus a bounce term.
- Buildings with `ShadowMode.ENABLED`: replaced by `CAST_ONLY`, which removes self-shadow acne while buildings still cast onto the ground (the ground receives shadows). Trees, cars and lamps, which are built by one shared loop in `props.ts`, are also `CAST_ONLY`; birds and clouds use `DISABLED`.

## Consequences
- Extra GPU load, bounded by quality tiers (High / Medium / Low, auto-detected, auto-lowered). Pixel ratio is capped per tier (2 / 1.5 / 1) through `useBrowserRecommendedResolution = false` and `resolutionScale`.
- Bloom is tuned so only bright windows glow (contrast 119, brightness -0.85, delta 1.0, sigma 2.0, step size 1.0).
- Props are lifted toward white (`mix(tl_light, 1, 0.35)`) so they are never black at Dusk or Night.
- Camera bounds clamp the camera position (5 km margin), not the view centre. At low pitch the look target can sit 1-2 km past the margin; Home always recovers.
- Picking uses Cesium's built-in 5 px click tolerance.
- The "Decorative details are illustrative." label covers every addition.
