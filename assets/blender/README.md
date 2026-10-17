# assets/blender — stylised-city models

Headless Blender 5.2 builds the archetype, landmark and kit models for the Three.js stylised
view. gltf-transform packs them with meshopt into `apps/web/public/city/`, next to a
`manifest.json` that the web loader reads. Blender is not in CI: the packed glbs are committed,
and CI only checks them (`tests/test_committed_assets.py`).

## Commands

```bash
pnpm assets:build --asset link_intermediate     # or --all; --preview also renders out/preview/<id>.png
pnpm assets:pack                                # all built assets -> apps/web/public/city/ + manifest.json
uv run python assets/blender/pack.py --only calib --out /tmp/x   # pack only; no manifest
uv run pytest assets/blender/tests -q           # pure tests (Blender tests skipped)
TL_BLENDER_TESTS=1 uv run pytest assets/blender/tests -m blender -q   # builds and packs `calib`
```

- `run.py` starts one Blender process per asset (`--background --factory-startup
  --disable-autoexec --python-exit-code 1`). Blender is `--blender`, else `$BLENDER`, else
  `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`. A failing asset stops the run.
- Raw exports go to `out/raw/<file>`, previews to `out/preview/` (both gitignored).
- `pack.py` runs `pnpm exec gltf-transform meshopt <raw> <dest> --level medium`
  (`@gltf-transform/cli` 4.1.1, a root devDependency). The manifest lists only assets whose raw
  glb exists. `--only` or `--out` skips the manifest. The test asset `calib` packs only via `--only`.
- One Blender process at a time: the owner's machine has 8 GB RAM.
- Regenerate and commit glbs only in a task's single `data: …` commit; report the folder total.

## Layout

| File | What |
|---|---|
| `tl_assets/specs.py` | Sizes, LOD triangle caps and distances, byte budgets, palettes, precinct groups (pure) |
| `tl_assets/geo.py` | The local tangent plane of `three/frame.ts` and ring centroids (pure) |
| `tl_assets/glbinfo.py` | Reads a glb's JSON: per-node tris, primitives, world bounds, attributes (stdlib) |
| `tl_assets/manifest.py` | `build_manifest` (schema version 1) (pure) |
| `tl_assets/core.py` | bpy helpers: `reset_scene`, `box`, `set_role`, `join`, `bake_ao`, `export_glb`, `tri_count` |
| `tl_assets/build.py` | Blender entry point, `BUILDERS`, `build_asset`, `preview`, and the `calib` builder |

## Conventions

- Origin at the footprint centre on the ground. The frontage faces glTF **+z**; width runs
  along x and depth along z. Builders use `core.box`/`core.to_blender`, which take glTF
  coordinates (Blender is z-up; the exporter maps Blender (x, y, z) to glTF (x, z, −y)).
- Node names: `<asset>__<variant>__LOD<n>`. Each LOD is one mesh, one primitive, the single
  material `tl_role`, no images (a landmark may carry one ≤ 1024² image).
- `COLOR_0` (RGBA, corner domain): R = baked AO (1 = open), G = role index / 7, B = per-class
  aux, A = 1. Roles: `primary, secondary, accent, glass, dark, metal, foliage, light`.
  Blender exports it as normalised uint16; meshopt packing quantises colours to 8 bits.
- `bake_ao` bakes Cycles AO (distance 4 m) with a temporary 40 m ground plane, every other
  mesh hidden, into a temp colour attribute and copies only R into `COLOR_0`.
- `random.seed(asset_id)` before each build, so rebuilds are stable.
- Exporter enums are read from `bpy.ops.export_scene.gltf.get_rna_type()` before use; shader
  nodes are found by `type`; the render engine is set inside `try/except TypeError`.
- Decorative: every kit, plus archetype facade detail. No text, logos or brand marks; sign
  bands are blank (role `light`). No Google pixels or geometry in any asset.

## Manifest (version 1)

```json
{"version": 1, "as_of": "YYYY-MM-DD", "roles": ["primary", "…"],
 "precinctGroups": [["green", "elmina green"], "…"],
 "assets": {"<id>": {"group": "archetype", "file": "archetypes/<id>.glb", "bytes": 0,
   "repeat": "none", "frontage": "short", "fit": {"xz": [0.75, 1.35], "y": [0.6, 1.6]},
   "decorative": false, "placement": null, "jitter": {}, "variantByGroup": {"default": "gable"},
   "palettes": {"default": [["#f2efe8", "#3d4147", "#8a8f96"]]},
   "variants": {"<v>": {"size": [6.4, 8.5, 15.5],
     "lods": [{"node": "<id>__<v>__LOD0", "tris": 0, "maxM": 300}, "…"]}}}},
 "landmarks": {"lakeside_mall": {"anchor": [101.5099, 3.1813]}}}
```

`maxM: null` means the last LOD is drawn to any distance; a numeric last `maxM` hides
instances beyond it. `landmarks` holds anchors (the `landmarks.geojson` ring centroid) only for
landmarks placed by `"anchor"`.
