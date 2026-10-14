# 3D sources: repos and papers (verified 14 Oct 2026)

Priority: 1 = must, 2 = useful, 3 = nice. Sizes are unknown unless stated. Repos marked "(not fetched)" exist per general knowledge but were not opened this session.

## Repos
- https://github.com/NASA-AMMOS/3DTilesRendererJS | 3D Tiles renderer for three.js + R3F, Google tiles examples, Apache-2.0, v0.5.3 (2026-09-18); our primary renderer | 1 | size unknown
- https://github.com/pmndrs/react-three-fiber | React Three Fiber v9.8.1 (React 19), v10 alpha adds WebGPU; team baseline | 1 | size unknown
- https://github.com/pmndrs/drei | R3F helpers (Html labels, controls, Line); (not fetched) | 1 | size unknown
- https://github.com/CesiumGS/cesium | CesiumJS 1.146 (2026-10-01), fallback renderer, splat 3D Tiles support | 2 | large (~MBs bundle)
- https://github.com/reearth/resium | MIT React wrapper for CesiumJS | 2 | size unknown
- https://github.com/maplibre/maplibre-gl-js | v6.14.0, 2D/2.5D accessible fallback map, extruded buildings, globe | 1 | size unknown
- https://github.com/visgl/deck.gl | v9.4.0, Tile3DLayer with Google tiles, PathLayer overlays, WebGPU port | 2 | size unknown
- https://github.com/tordanik/OSM2World | MIT; OSM to 3D (glTF/OBJ/3D Tiles) for procedural fallback scene | 2 | size unknown
- https://github.com/vvoovv/blosm | Blender add-on: OSM, terrain, Google 3D import (GPL; Pro paid) | 3 | ~2.1k stars
- https://github.com/sparkjsdev/spark | MIT three.js Gaussian-splat renderer, LoD + .RAD streaming (v2.3.x); post-MVP splat path | 3 | size unknown
- https://github.com/mkkellogg/GaussianSplats3D | Earlier splat viewer, no longer actively developed (author recommends Spark); reference only | 3 | 576 commits
- https://github.com/playcanvas/supersplat | MIT browser editor to clean/optimise splats | 3 | ~10.4k stars
- https://github.com/ThatOpen/engine_components | `@thatopen/components` IFC/BIM viewer (MIT, v3.x) if SDP gives IFC; (not fetched) | 2 | size unknown
- https://github.com/ThatOpen/engine_web-ifc | web-ifc WASM IFC parser; (not fetched) | 2 | size unknown
- https://github.com/facebookresearch/vggt | VGGT / VGGT-Omega feed-forward reconstruction; COLMAP export; commercial use needs VGGT-1B-Commercial checkpoint | 3 | 1B-param checkpoint
- https://github.com/OvertureMaps/overturemaps-py | CLI to download Overture buildings/places/transport by bbox; (not fetched) | 2 | small

## Papers
- VGGT: Visual Geometry Grounded Transformer | 2025 | https://arxiv.org/abs/2503.11651 | feed-forward camera/depth/point maps from photos; pilot-phase capture idea | 3
- MapAnything: Universal Feed-Forward Metric 3D Reconstruction | 2025 (v3 Jan 2026, 3DV 2026) | https://arxiv.org/abs/2509.13414 | metric-scale feed-forward reconstruction, accepts optional geometry inputs | 3
- Grounding Image Matching in 3D with MASt3R | 2024 | https://arxiv.org/abs/2406.09756 | image matching/reconstruction building block | 3
- DUSt3R: Geometric 3D Vision Made Easy | 2023 | https://arxiv.org/abs/2312.14132 | origin of pose-free feed-forward reconstruction | 3
- 3D Gaussian Splatting for Real-Time Radiance Field Rendering | 2023 | https://arxiv.org/abs/2308.04079 | the splat baseline everyone cites | 2
- CityGaussian: Real-time High-quality Large-Scale Scene Rendering with Gaussians | 2024 | https://arxiv.org/abs/2404.01133 | city-scale splat LOD (ECCV 2024) | 2
- Octree-GS: Towards Consistent Real-time Rendering with LOD-Structured 3D Gaussians | 2024 | https://arxiv.org/abs/2403.17898 | LOD-structured splats for large scenes | 3
- A Hierarchical 3D Gaussian Representation for Real-Time Rendering of Very Large Datasets | 2024 | https://arxiv.org/abs/2406.12080 | hierarchical LOD for very large splat scenes | 2
- Compact 3D Scene Representation via Self-Organizing Gaussian Grids (SOG) | 2023 | https://arxiv.org/abs/2312.13299 | splat compression behind the .sog web format | 3
- ConceptGraphs: Open-Vocabulary 3D Scene Graphs for Perception and Planning | 2023 | https://arxiv.org/abs/2309.16650 | supports "structured scene graph, not raw 3D, grounds the LLM" argument | 2

## Added 2026-10-14 (township pivot)

### Repos
- https://github.com/CesiumGS/cesium | CesiumJS 1.146.0 (npm 2026-10-01); recommended primary engine for township twin: `createGooglePhotorealistic3DTileset`, polygon `extrudedHeight`, `classificationType` draping, `camera.flyTo` (API checked via ctx7) | 1 | large bundle
- https://github.com/reearth/resium | Resium 1.27.0 (npm 2026-10-06); React wrapper for CesiumJS (`Viewer`, `Entity`, `Cesium3DTileset`, `useCesium`); ctx7 getting-started still shows legacy `createWorldTerrain()`, use `createWorldTerrainAsync` | 1 | size unknown
- https://github.com/visgl/react-google-maps | `@vis.gl/react-google-maps` 1.10.1 (2026-09-21); has `<Map3D>` component for Google Maps JS 3D (`Map3DElement`); fast ToS-safe prototype path | 2 | size unknown
- https://github.com/mapbox/mapbox-gl-js | mapbox-gl 3.33.0 (2026-10-13); Standard style slots, terrain, fill-extrusion, `model` layer, custom 3D layers; cannot load Google 3D Tiles; mobile-friendly 2.5D fallback/skeleton map | 2 | size unknown
- https://github.com/visgl/react-map-gl | React wrapper for Mapbox/MapLibre (`react-map-gl/mapbox`); (not fetched) | 2 | size unknown
- https://github.com/visgl/deck.gl | deck.gl 9.4.0; documented pattern: `Tile3DLayer` (Google tiles, `operation: 'terrain+draw'`) + `TerrainExtension` to drape GeoJSON onto photoreal tiles, credits via `onTraversalComplete`; declarative React alternative to Cesium | 2 | size unknown
- https://github.com/protomaps/PMTiles | PMTiles single-file tile archive + `pmtiles` JS 4.5.0 (2026-08-10); serve per-lens vector tiles from static storage, no tile server | 2 | small
- https://github.com/maplibre/martin | Martin tile server (PostGIS/PMTiles/MBTiles to MVT); only if layers need live edits; (not fetched) | 3 | small
- https://github.com/felt/tippecanoe | build MVT/PMTiles from GeoJSON; (not fetched) | 2 | small
- https://github.com/opengeospatial/geoparquet | GeoParquet spec for versioned analytical snapshots queried with DuckDB; (not fetched) | 2 | small
- https://github.com/OpenSidewalks/OpenSidewalks-Schema | OpenSidewalks network schema (nodes/edges/zones, GeoJSON); borrow field names for the accessibility lens; status draft | 2 | small
- https://github.com/cityjson/specs | CityJSON 2.0 (OGC community standard 20-072r5), JSON encoding of CityGML 3.0 subset; interchange format if SDP ever supplies city models; (not fetched) | 3 | small
- https://github.com/CesiumGS/3d-tiles | 3D Tiles 1.1 spec (OGC 22-025r4): glTF content, structural metadata, implicit tiling; (not fetched) | 3 | small
- https://github.com/geopython/pygeoapi | OGC API Features server incl. draft Part 4 transactions; optional, no need for MVP; (not fetched) | 3 | small

### Datasets
- Overture Maps release 2026-09-23.1 (buildings, transportation, places, base) | https://docs.overturemaps.org | ODbL for buildings/transport/base; places mostly CDLA-Permissive | global; Malaysia filterable by bbox; building height coverage near Elmina see township-3d-engine-and-data.md | 1
- OpenStreetMap via Overpass API | https://overpass-api.de/api/interpreter | ODbL | Elmina envelope bbox 3.150,101.460,3.240,101.530; ~6.9k buildings, 1.4k footway+path ways (counts 14 Oct 2026; public instance often times out, retry or use a Geofabrik extract) | 1
- Copernicus DEM GLO-30 | https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM | free licence with attribution notice; DOI 10.5270/ESA-c5d3d65 | global 30 m DSM (buildings and trees included), EGM2008 heights, vertical accuracy <4 m (90%); coarse for flood depth, use for illustrative scenarios only | 1
- Google Photorealistic 3D Tiles | https://developers.google.com/maps/documentation/tile/3d-tiles-overview | Google Map Tiles API ToS (visualisation only, attribution, no caching or extraction); 1,000 free events/month then $6.00 per 1,000 | Malaysia listed at country level; Elmina quality unverified | 1
- Cesium ion Community plan | https://cesium.com/platform/cesium-ion/pricing/ | free for personal and non-commercial use; 1,000 Google root tiles/month, 15 GB streaming, 10 GB storage | global (Cesium World Terrain, OSM Buildings) | 2
- Mapbox GL JS map loads | https://www.mapbox.com/pricing | 50,000 web map loads/month free, then $5.00 per 1,000 (50k to 100k) | global | 2
- DID InfoBanjir (river levels, flood warnings) | https://publicinfobanjir.water.gov.my | web portal only; no documented bulk API found; check terms | Malaysia river stations (Sungai Damansara, Sungai Buloh nearby) | 2
- MBSA domestic collection schedule PDFs | https://mbsa.gov.my/ms-my/mbsa/perkhidmatan/perkhidmatanperbandaran/Documents/Collection%20Schedule%20for%20MBSA%20(Fasa%203)-%20Rev.-3.0.pdf | council PDF, reuse terms unstated | Seksyen 31, 32, 33, Alam Budiman only (door-to-door recycling programme); Elmina not covered | 3
- Zero Waste Malaysia map (malaysia4u.com) | https://malaysia4u.com/tools/zero-waste | none stated; no download/API | 1,764 recycling/buy-back/RVM places and 545 e-waste points nationally, 613 in Selangor (self-reported, updated 8 Oct 2026); aggregates SWCorp, DOE, MCMC KITAR, Tzu Chi lists | 2
- DOE e-waste collection centre list and JKM InfoBencana (evacuation centres) | URL not verified this session | unstated | Malaysia; PPS snapshot Nov 2025 showed 19 centres open in Selangor | 2
