# 0012. Stylised city on Three.js, with assets made in Blender

- Status: accepted
- Date: 2026-10-17
- Deciders: owner, with Claude Code
- Amends: [0007](0007-3d-engine-cesium.md) (the Stylised map style only)

## Context
The owner wants the Stylised map to look like a hand-made SimCity diorama of the real Elmina, in every time of day: varied building types at true scale, soft shadows, ambient occlusion, glowing windows and signs, lamp light, and a busy, moving township. The Cesium version hit hard limits:
- HBAO streaked, so AO was off at every tier.
- There was no tone mapping or image-based lighting.
- Facades were drawn in one shader with two window styles in practice (98% of buildings used the same one).
- Props were ellipsoids, cylinders and boxes.

Elmina is a few kilometres across, so the Stylised view needs nothing from a globe engine. The target machine is the owner's laptop (RTX 2050 4 GB, 8 GB RAM).

## Decision
- The Stylised map style is rendered by a new Three.js renderer.
- Building archetypes, landmarks and props are authored in Blender 5.2, driven through Blender MCP while iterating. Final assets are produced by committed Blender Python scripts that run headless, so they can be regenerated. Lighting such as AO is baked where it pays off and exported as glTF.
- The Realistic map style (Google Photorealistic 3D Tiles) stays on Cesium unchanged.
- The Mapbox lite and List fallbacks stay as they are.
- Every renderer still reads scene intents from `sceneStore`. The agent never touches the scene.

## Options considered
- **Keep improving Cesium:** no new engine, but the lighting, material and AO ceiling stays.
- **Unreal Engine 5 (Lumen):** the best image quality. But it can't run inside the web app without Pixel Streaming (a cloud GPU per viewer), and the editor needs about 32 GB of RAM against our 8 GB.
- **Blender offline render:** matches the reference exactly but gives images or video, not an interactive map.
- **Babylon.js / PlayCanvas:** as capable as Three.js, with a smaller ecosystem.
- **Move Realistic to Three.js as well (3DTilesRendererJS):** one engine, but Realistic would have to be rebuilt. Deferred until Stylised passes its gate.

## Consequences
- Two 3D engines live side by side. Routes, flood overlays and place markers are implemented once per renderer.
- Buildings use one archetype per real Elmina building type, at true scale. Heights are sampled per footprint, falling back to the archetype's storey count.
- Flood stays a tinted, hatched ground overlay, never a realistic water surface, so no water depth is implied.
- Quality tiers stay. The gate is the owner's side-by-side screenshot review against the reference, plus 30 fps or more at the default view on Medium on the owner's laptop.
- The work is done in phases: first the hero district (Elmina City Centre), and only after it passes, the whole township.
- Decorative details keep the label "Decorative details are illustrative."
