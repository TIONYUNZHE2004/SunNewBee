# 0007. 3D engine: CesiumJS + Resium with Google Photorealistic 3D Tiles

- Status: **accepted** (confirm with the Day-1 spike: Google tile quality over Elmina + water rendering + a mid-range Android test)
- Date: 2026-10-15
- Supersedes: "R3F + 3d-tiles-renderer primary" ([3d-pipeline](../../04-architecture/3d-pipeline.md), first version) and "Mapbox Standard main view" (scaffold spec draft 1)

## Context
After ADR [0009](0009-township-world-model-platform.md), the hero is a 3D model of the **whole of City of Elmina**. It needs: photoreal buildings, lines and markers draped on the ground and mesh (routes, flooded segments, evacuation centres), a **translucent water surface rising to height h**, AI-driven camera moves, and compliance with Google's display-only tile policy. Research: [township-3d-engine-and-data](../../02-research/township-3d-engine-and-data.md).

## Decision
| Role | Choice |
|---|---|
| **Hero 3D view** | **CesiumJS 1.146 + Resium 1.27**, Google Photorealistic 3D Tiles via `createGooglePhotorealistic3DTileset`, credits on screen |
| Fallback 1 (same app) | Cesium OSM Buildings + Cesium World Terrain (ion Community plan, non-commercial), a config switch |
| Fallback 2 (lite 2.5D) | Mapbox GL JS Standard style (`react-map-gl/mapbox`) using the same GeoJSON layers |
| Always on | Text/list view (screen-reader path) + a recorded demo video |

**Scene intents:** the AI and UI never call the renderer directly. They emit typed **scene intents** (`camera.fly_to`, `place.focus`, `route.highlight`, `flood.set_level`, `layer.toggle`). A thin adapter per renderer (Cesium hero, Mapbox lite, list text) draws them. This keeps the renderer swappable and makes demos replayable.

**Flood water:** one translucent extruded polygon per scenario, with its top face at absolute height `h`, depth-tested against the photoreal mesh. *Which* areas and edges flood is computed by the backend from a DEM (ADR [0010](0010-flood-lens-hand-scenarios.md)), **never** sampled from Google tiles.

## Options considered
| Option | Why not chosen |
|---|---|
| R3F + `3d-tiles-renderer` | Most flexible, but no built-in draping. Clamping lines to the photoreal mesh needs per-vertex raycasts (a grey area under Google's "no derived geometry" clause) and more week-1 work |
| Mapbox GL JS Standard as main | No supported way to load Google photoreal tiles; extruded buildings look plain in Elmina. Kept as the lite view |
| deck.gl + Tile3DLayer | Good draping, less guidance on 3D water, no built-in credits line |
| Google Maps JS `Map3DElement` | Still pre-GA (weekly/beta/alpha) in Oct 2026; too locked down for the flood lens |

## Consequences
- A heavier bundle: lazy-load the Cesium chunk; `requestRenderMode: true`; tune `maximumScreenSpaceError` and `resolutionScale` on mobile; a "Lite view" button.
- Datum: Google tiles are ellipsoidal, the DEM is EGM2008. Calibrate one offset per area against a flat reference (the Elmina lake surface).
- Costs: Google tiles 1,000 free events/month then USD 6 per 1,000; Mapbox 50,000 free loads/month (lite view). Restrict keys by referrer and set budget alerts.
- The FE lane must learn the Cesium Entity/Primitive APIs; the [3d-pipeline](../../04-architecture/3d-pipeline.md) doc is rewritten for Cesium.
