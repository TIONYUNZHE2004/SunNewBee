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
