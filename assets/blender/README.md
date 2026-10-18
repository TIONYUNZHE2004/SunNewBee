# assets/blender — stylised-city models

Headless Blender 5.2 builds the archetype, landmark and kit models for the Three.js stylised
view. gltf-transform packs them with meshopt into `apps/web/public/city/`, next to a
`manifest.json` that the web loader reads. Blender is not in CI: the packed glbs are committed,
and CI only checks them (`tests/test_committed_assets.py`).

## Commands

```bash
pnpm assets:build -- --asset link_intermediate  # or -- --all; --preview also renders out/preview/<id>.png
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
- `pnpm` hands the script a literal `--` (`pnpm assets:build -- --all` runs `run.py -- --all`);
  `run.py` and `pack.py` drop that leading `--`, so both spellings work.

## Full regeneration

Run from the repo root, after deleting `assets/blender/out/`:

```bash
rm -rf assets/blender/out
pnpm assets:build -- --all          # every asset, one Blender process each
pnpm assets:pack                    # out/raw -> apps/web/public/city/ + manifest.json
uv run pytest assets/blender/tests -q
TL_BLENDER_TESTS=1 uv run pytest assets/blender/tests -m blender -q
```

Then stage `apps/web/public/city` and commit it alone as `data: full city asset set regenerated
from scripts`.

**Always pack after a full build.** `pack.py` writes `manifest.json` only from the raw glbs
that exist in `out/raw`: after a partial build (a single `--asset`) the manifest lists only
those assets and silently drops the rest. Pack right after `--all`, never after a partial
build, and check that the manifest lists every id in `specs.ASSETS` before committing.

The committed glbs are shipped data; the scripts are the source. A rebuild reproduces the same
geometry (each builder seeds `random` from the asset id).

## Layout

| File | What |
|---|---|
| `tl_assets/specs.py` | Sizes, LOD triangle caps and distances, byte budgets, palettes, precinct groups (pure) |
| `tl_assets/geo.py` | The local tangent plane of `three/frame.ts` and ring centroids (pure) |
| `tl_assets/glbinfo.py` | Reads a glb's JSON: per-node tris, primitives, world bounds, attributes (stdlib) |
| `tl_assets/manifest.py` | `build_manifest` (schema version 1) (pure) |
| `tl_assets/core.py` | bpy helpers: `reset_scene`, `box`, `set_role`, `join`, `bake_ao`, `export_glb`, `tri_count` |
| `tl_assets/build.py` | Blender entry point, `BUILDERS`, `build_asset`, `preview`, and the `calib` builder |
| `tl_assets/kit.py` | The parametric building kit: `walls` with `Opening`s (optional window `grid`, `covered` areas), `window`, gable/hip/flat roofs, porch, five-foot way, balcony, AC, solar, gate, sign band, `panel`, `screen_block` (breeze-block screen), `far_block` (LOD2), `place` |
| `tl_assets/archetypes.py` | Archetype builders (`BUILDERS`, merged into `build.py`): `link_intermediate`, `link_long` |
| `tl_assets/landmarks.py` | Landmark builders (mall, mosque, school, ...) |
| `tl_assets/props.py` | Kit builders `trees`, `furniture`, `people`, `vehicles`, `construction` (scripted), and the vendor intake `import_vendor` / `scale_to` |

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

## Kits and LODs

| Kit | Variants | LOD triangle caps | Distances (m) |
|---|---|---|---|
| `trees` | 8 | 4000 / 600 / 60 | 300 / 1500 / any |
| `furniture` | 9 | 800 / 120 | 150 / 300 |
| `people` | 10 | 1500 / 250 | 80 / 300 |
| `vehicles` | 9 | cars 3000 / 400; bus and lorry 5000 / 600 | 150 / 1500 |
| `construction` | 8 | 6000 / 600 / 60 | 300 / 1500 / any |

Every LOD of a variant spans the same x/z extent and top height, so the bounds hold at every
distance. `construction` keeps all three LODs on every variant (a tower crane must stay visible
from far away): LOD2 is a few boxes (<= 60 tris). `tower_crane` is 40-60 m tall with a ~40 m
span (spec x extent 39.9-41.2); `hoarding_6m` is a blank 6 m panel (x extent 6 +- 0.1, no text,
no images). Aux B per kit: trees = sway weight; people = limb code (0.25 left leg and right
arm, 0.75 right leg and left arm, 0.5 the rest); vehicles = lamp code (0.25 headlights at +z,
0.75 tail lights at -z); everything else 0.

## Budgets

| What | Budget |
|---|---|
| Whole `apps/web/public/city/` folder | 12 MB (`specs.MAX_TOTAL_BYTES`) |
| One archetype glb (packed) | 400 KB |
| One landmark glb (packed) | 1.5 MB |
| One kit glb (packed) | 1.5 MB |
| Triangles | the per-variant, per-LOD caps in `specs.py`; `build.py` refuses a build over any cap |
| Images | none (a landmark may carry one image <= 1024 px square) |

`tests/test_specs.py` and `tests/test_committed_assets.py` (pure, run in CI) check the specs
and the committed glbs; `tests/test_blender_pipeline.py` builds and packs for real (opt-in).

## Third-party models (vendor intake)

A scripted variant can be replaced by a downloaded model, only after owner approval at the
asset's gate. Nothing is vendored yet (`vendor/vendor.json` is `[]`).

1. Put the **`.glb` source only** (never `.blend`) in `assets/blender/vendor/<kind>/<slug>/`
   (`<kind>`: trees, furniture, people, vehicles or construction) and record it in
   `vendor/vendor.json`: `slug, kind, url, author, licence, files, sha256` (one per file) and
   `role_map`. Prefer CC0, MIT, Apache-2.0 or BSD; any licence is acceptable for the hackathon
   (ruling W1), but note it for a later pilot review.
2. Credit it in `CREDITS.md` under "Third-party assets" (URL, author, licence, files, where it
   lives). `tests/test_vendor.py` fails when a URL is missing from `CREDITS.md`, a sha256
   differs, a role is unknown, a folder is not recorded, or a `.blend` exists.
3. `role_map` maps a source material name to a role. A textured material (a Kenney `colormap`)
   is sampled at each polygon's UV centroid and matched to the nearest role: add `"#rrggbb":
   role` entries to `role_map` as the palette's role table, else the display palette is used.
4. The builder calls `props.import_vendor(slug)` then `props.scale_to(objs, axis, metres)`.
   Materials, images and UVs are dropped, the hierarchy is flattened, transforms are applied
   and the model is seated on the ground at the footprint centre. It then goes through the
   normal join, AO bake and caps like any scripted variant.
5. Blender always runs with `--factory-startup --disable-autoexec`, so a downloaded file cannot
   run scripts and no add-on state leaks in. Treat downloads as untrusted data.

## Owner gates

Each asset task ends with a stop-and-ask gate where the owner reviews the model in a live
Blender (`build.preview("<asset>")` renders all variants and LODs side by side). The full
protocol (connecting the Blender MCP, how reference images are gathered, the 5-round cap, how
the verdict is recorded) is in
`docs/superpowers/plans/2026-10-17-stylised-threejs-phase-2-assets.md`, section "Owner gate
protocol"; it is not repeated here. Headless preview: `pnpm assets:build -- --asset <id>
--preview` writes `out/preview/<id>.png`.

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
