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
| `tl_assets/archetypes.py` | Archetype builders (`BUILDERS`, merged into `build.py`): every archetype in `specs.ARCHETYPES` |
| `tl_assets/landmarks.py` | Landmark builders (mall, mosque, school, ...) |
| `tl_assets/props.py` | Kit builders `trees`, `furniture`, `people`, `vehicles`, `construction` (scripted), and the vendor intake `import_vendor` / `scale_to` |
| `tl_assets/characters/geom.py` | Pure mesh generators (lathe, ellipsoid, swept tube, Catmull-Rom, orientation) for scripted characters |
| `tl_assets/characters/proportions.py` | Hero height, H4 head ratio, display scale and clay palette (pure) |
| `tl_assets/characters/parts.py` | The hero's parts as pure geometry (head, tudung drape, baju, kain, arms, walker, stoop pose) and `measure` (H3/H4 in pytest) |
| `tl_assets/characters/hero.py` | The journey hero (C-T2): chibi older woman, baju kurung, tudung, scripted walker; `build_hero("tpose")` / `build_hero("walker")` |
| `tl_assets/characters/sheet.py` | Renders the hero modelling sheet (EEVEE, 16 samples), stats json and `.blend` |
| `tl_assets/characters/rig.py` | Hero rig (pure): 34 bones, skin weight fields, two-bone IK, the six clip poses, stride and bench constants |
| `tl_assets/characters/props.py` | Scripted stroller and wheelchair (pure geometry) |
| `tl_assets/characters/export_hero.py` | Blender entry: rig, bake clips, export `out/raw/characters/hero_<variant>.glb` + stats json; `--render` acceptance views |
| `tl_assets/characters/turntable.py` | Acceptance renders: walk / sit_idle turntables, bench side view, follow and seam close-ups |
| `tl_assets/characters/manifest.py` | `characters/manifest.json` builder (pure) |
| `tl_assets/characters/crowd.py` | Crowd (C-T6, pure): 6 bodies, 13 outfits, role-coloured parts per LOD, crowd-sized walker/stroller/wheelchair |
| `tl_assets/characters/crowd_rig.py` | Crowd rig (pure): 19 bones, skin weights, `walk`/`idle` (+ per prop) poses, reference skinning |
| `tl_assets/characters/crowd_looks.py` | The 33 looks (body + outfit + prop + palette) and the `characters/crowd.json` builder |
| `tl_assets/characters/export_crowd.py` | Blender entry: `crowd_<body>.glb` + stats; `--sheet <png>` renders the contact sheet of all looks |

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
- Glass aux B is the window seed: the role material lights glass where B < `uLitShare` (the
  web mood ramps it from 0.35 at dusk to 0.58 at night). Seeds are stratified per node over
  0.02-0.98: `kit.finalize_seeds` (run by every `kit.lit_node` builder when it returns) gives
  each seeded glass part the quantile of its cumulative weight (corner count) in the best of
  256 seeded orders, so a node's lit share tracks the threshold (share(t) ~= t) and the
  dusk-to-night ramp lights more windows as it goes. Big openings light by part (shopfront bays
  and transoms, grid panes, mullion halves) to keep the steps small. Glass that never lights:
  balustrades (`kit.UNLIT_AUX` 0.98) and decorative water (`specs.WATER_AUX` 0.995; the role
  contract has no water role, so the Kanopi deck pool is glass with this aux).
- `build_asset` writes `<raw glb>.parts.json` beside each raw glb (raw output only): the part
  names of every node before the join, for the tests' node-name checks (`ac_unit*`,
  `balcony*`, ...).

## Detail pass (P4 Task 7)

LOD0 of every archetype has facade depth: a 0.45 m plinth (`walls(plinth=faces)`, never on a
party wall), 0.15 m window reveals (cut openings: `reveal`; applied panes:
`window_panes(reveal=True)` adds a surround and a sill, `pane_cover(reveal=True)` leaves the
wall out behind them) and sills. Link, semi-D and bungalow: gate pillars and fence posts,
car-porch columns, AC condensers (semi-D and bungalow on a side wall; link houses have party
walls both sides, so theirs sit on the front A/C ledge and the back wall) and a water tank set
into the back roof slope. Shop office: a closed side bay with a roller shutter banded metal and
secondary (`kit.roller_shutter`, also every garage door at LOD0). Highrise: spandrels and piers
round every window, a balcony with a never-lit glass balustrade on every storey of the front
and back faces, an open crown on the parapet. Factory: skylight strips, rooftop units, a loading
bay at the front roller door. Owner gate round 1: the mall archetype is a single-level shop
strip (a blank sign band per unit) under a continuous canopy walkway, a taller glazed entrance
pavilion with a tall blank sign band, two big-box units behind with their own facades and roof
plant, and a landscaped forecourt edge; the shop office has three-tone facade banding, fabric
awnings and an arcade of deep columns with a beam and arch haunches; mall, factory, school and
Lakeside Mall roofs are a light membrane (primary) or terracotta (accent), never grey. The
Lakeside Mall tops out at its 9.0 m manifest size (walls 8.2 m + 0.8 m parapet; roof plant below
the parapet top), the seed's `display_height_m` (B-T2; it used to reach 11.5 m). Kanopi:
planter boxes up the tower and a level-7 deck on the 1 m podium ledge round the slab, which
keeps its traced depth (raised end-ledge pools 1.2 m above the podium roof, a front-ledge
pergola on a timber strip, shrubs, planters); the web dresses the larger OSM podium roof. LOD2
roofs take the same role as LOD0 (`far_block(roof_role=...)`). LOD1 keeps the highrise balconies and crown, and the factory and mall roof units, as
boxes; LOD2 is unchanged. Every LOD0 stays within 2 % of its P3 bounds (pinned in the tests).

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
asset's gate. Only the Kenney Mini Characters (CC0) are vendored, as proportion and rig references for the journey people (`vendor/vendor.json`, `CREDITS.md`); no vendor geometry ships.

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

## Hero modelling sheet (C-T2)

Not part of `run.py`/`specs.ASSETS` yet (no glb until the C-T3 rig). Render the owner sheet with:

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python-exit-code 1     -P assets/blender/tl_assets/characters/sheet.py -- --out <dir>
```

It writes `hero_sheet.png` (T-pose and walker pose: front, side, back, 3/4), `hero_cameras.png`
(follow, behind, side, 3/4 face, 3/4 front, 30 m and 80 m), `hero_vs_prototype.png`, `tiles/`, `hero_stats.json`
and `hero.blend` (about 30 s). The hero is modelled at true scale (1.55 m, facing -y); the web
draws her at 1.5x (R-J3). Body parts are separate closed shells with vertex groups named for the
rig (`head`, `face`, `tudung_cape`, `torso`, `kain` plus soft `kain_L`/`kain_R`, `arm_L/R`,
`hand_L/R`, `shoe_L/R`). H4 is measured on the T-pose; the script fails if it is out of range.

## Hero rig and export (C-T3)

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --disable-autoexec     --python-exit-code 1 -P assets/blender/tl_assets/characters/export_hero.py -- [--variant walker] [--render <dir>]
uv run python assets/blender/pack.py --heroes   # meshopt (same settings as the kits) -> apps/web/public/city/characters/
```

About 25 s for all four variants (walker, stroller, wheelchair, none) without renders. Each glb holds
one skinned body per LOD (`hero__LOD0`, `hero__LOD1`), the prop meshes bone-parented to `prop` (and
`wheels` for the wheelchair's rear wheels), and the clips `walk`, `idle`, `sit_down`, `sit_idle`,
`stand_up`, `look`, baked at 30 fps from `rig.clip_pose` (FK plus analytic two-bone IK in mathutils;
no constraints ship). The bind pose is the C-T2 T-pose; the hero is drawn at 1.55x (R-J3). Clips
are in place and the root never moves: the runtime moves the object and sets the walk rate from
`stride` and `walkDuration` in `characters/manifest.json` (`heroManifest.ts: walkRate`). Palms
ride the `grip_L/R` bones (prop children) in `walk`, `idle` and `look`. In `sit_down` she parks the
prop beside her right leg (hands on it) and moves her hips up and back onto the reference bench in
the manifest (`bench.seat`/`bench.back` boxes: seat top 0.45 m true, front edge 0.21 m behind the
root); the runtime places that bench relative to the root. `contact_FL/FR/RL/RR` (prop children)
mark the prop's ground contacts. Do not call `skeleton.pose()` on the packed glbs (meshopt folds
a scale into the inverse bind matrices). The manifest has no date, so a repack is byte-stable. The checks are
`tests/test_hero_rig.py` (pure) and `apps/web/src/features/scene/three/assets/heroGlb.test.ts`
(the shipped glbs: H1-H4, palm-to-grip, sit height, foot slide, loop seams). The rebuild is
deterministic (same bytes).

### Crowd kit (C-T6)

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --disable-autoexec --python-exit-code 1   -P assets/blender/tl_assets/characters/export_crowd.py -- [--body adult_man] [--sheet <contact-sheet.png>]
uv run python assets/blender/pack.py --crowd   # -> apps/web/public/city/characters/crowd_<body>.glb + crowd.json
```

- Built by the same scripted chibi pipeline as the hero (`geom.py`), simplified to the crowd budget
  (P4: LOD0 <= 1,500 and LOD1 <= 400 triangles per person including the prop). The Kenney Mini
  Characters were only a proportion reference; no vendor geometry ships, so `CREDITS.md` is unchanged.
- Six bodies (child, school_age, adult_man, adult_woman, older_man, older_woman: height, head ratio,
  stoop), 3-4 local outfits each (baju kurung + tudung, baju melayu + songkok + samping, school shirt
  and trousers, pinafore + white tudung, office, casual), 33 looks with stroller/walker/wheelchair.
- One glb per body: a 19-bone skeleton (same names everywhere), `<outfit>__LOD0/1` skinned meshes,
  `prop_<prop>__LOD0/1` on the `prop` bone (`prop_wheelchair_wheels__*` on `wheels`), clips `walk`,
  `idle`, `walk_<prop>`, `idle_<prop>` (in place; walks keyed at 30 fps, idles at 10 fps).
- Colour: every face has a palette role; TEXCOORD_0.x = (role index + 0.5) / roles. A look is
  body + outfit (+ prop) + palette (`crowd.json` `looks[].palette`, role -> clay pastel hex), so C-T7
  can recolour instances from a palette texture and B-T1 can map role names to clay tokens. COLOR_0
  holds the first look's colours for plain viewers.
- Checks: `tests/test_crowd.py` (pure: P1/P2 coverage, tudung and sleeve coverage, budgets, rig,
  loops, IK reach, stance foot rate) and `apps/web/.../crowdManifest.test.ts`, `crowdGlb.test.ts`
  (the shipped glbs). A repack is byte-stable.
