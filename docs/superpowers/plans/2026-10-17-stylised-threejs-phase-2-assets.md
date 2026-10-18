# Stylised City on Three.js — Phase 2 (assets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Committed, headless Blender 5.2 scripts generate the 12 building archetypes plus the generic, 3 landmarks and 5 prop kits at true scale, with colour variants and three LODs, packed as meshopt-compressed `.glb`. A Three.js loader fits archetypes onto the real footprints as instanced meshes inside the draw-call, triangle and memory budget of the owner's laptop.

**Architecture:** Lane `blender` adds `assets/blender/`. Pure Python modules (`specs.py`, `geo.py`, `glbinfo.py`, `manifest.py`) hold every dimension, budget and palette, and are tested in CI without Blender. `bpy` modules (`core.py`, `kit.py`, `archetypes.py`, `landmarks.py`, `props.py`) build one asset per headless Blender process into `assets/blender/out/raw/` (gitignored). `pack.py` compresses them with gltf-transform meshopt into `apps/web/public/city/` and writes `manifest.json`. The packed glbs are committed. Every vertex carries its material role in `COLOR_0`, so each LOD is one primitive with one material and one draw call. Lane `fe` adds `apps/web/src/features/scene/three/assets/`. It loads the manifest and glbs (GLTFLoader + MeshoptDecoder), fits each archetype to its footprint's oriented box, and draws one `InstancedMesh` per (asset, variant, LOD) with per-instance palettes. Footprints it can't fit stay extruded by `cityMesh.ts`. Lane `data` adds a `front_deg` per building, so porches face the street.

**Tech Stack:** Blender 5.2 (bundled Python 3.13, glTF exporter `io_scene_gltf2`, Cycles for AO bakes); `@gltf-transform/cli` 4.1.1 (MIT); three 0.186.1 (`GLTFLoader`, `three/addons/libs/meshopt_decoder.module.js`); vitest 5, Playwright 1.64; Python 3.13 + uv, shapely, pytest.

**Spec:** `docs/superpowers/specs/2026-10-17-stylised-city-threejs-overhaul-design.md` (§2.2, §2.4, §2.7, §2.8, §5, §6), with ADR 0012 and ADR 0013. Building research: `docs/02-research/elmina-building-types.md`. Previous plan (house style, and the code this builds on): `docs/superpowers/plans/2026-10-17-stylised-threejs-phase-0-1.md`. Read `AGENTS.md` and `CLAUDE.md` first.

**Scope.** This plan covers spec §4 Phase 2 only. Placing props in the world (moving traffic and people, trees on land cover, construction sites, lamps), keyframe lighting, signage text, picking cards and the overlay port belong to Plan P3. Phase 2 does deliver what P3 needs for those: the kits, the per-vertex motion channel, the glow uniforms and a showroom.

**Roadmap (spec §4). This plan is not the end of the overhaul:**

| Phase | Plan | Status when this plan was written (2026-10-17) |
|---|---|---|
| 0, spike | `2026-10-17-stylised-threejs-phase-0-1.md` Tasks 1–8 | Done. Owner measured 40–60 fps at Medium and High. |
| 1, data | the same plan, Tasks 9–15 | Done. No Google heights: tiles over Elmina have no building geometry; heights are OSM tags or archetype storeys. |
| **2, assets** | **this plan** | Next |
| 3, hero district | Plan P3, not written yet. Write it with superpowers:writing-plans after this plan lands. | It must cover: keyframe lighting with Elmina clock and Day-playback blending (Q26); motion and its gating (Q25); signage text rendering with sources; land cover drawing; placing props (trees on land cover, lamps, construction sites, traffic and people); placing the Kanopi and Masjid models once a sourced outline exists; porting the overlays (Access, Gaps, Route, WhatIf, Flood, Waste, Rollout, Day, places); picking and cards; and the spec §5 honesty tests. |
| Gate | The owner reviews (spec §5): screenshots from the fixed bookmarks per keyframe, side by side with the reference, plus ≥ 30 fps at Medium. | After P3 |
| 4, township rollout | Plan P4 | Only after the owner passes the gate. Covers township-wide LODs, instancing, streaming. |
| 5, cleanup | Plan P5 | Flip the `?engine=three` default, retire `cesium/stylised/`, update the docs. Never edit AGENTS.md's Google rule. |

When this plan finishes, tell the owner that P3 comes next, and offer to write it.

**Session handoff: the state at the end of Phase 0–1 (2026-10-17). Read this first in a new session.**

**Branch and code**
- **Branch:** `feat/stylised-threejs`, local only. It is not pushed and not merged to `main`, because the owner pushes only on request. Phase 0–1 ends at the commit "docs: phase 0-1 of the three.js stylised overhaul"; check `git log`.
- **Worktrees:** `../SunNiuBi-wt/fe` (`lane/fe`) and `../SunNiuBi-wt/data` (`lane/data`) still exist, and both are behind or equal to `feat/stylised-threejs`. Fast-forward them, as described in Prerequisites step 3, before reusing them.
- **Data cache:** `data/cache` in each worktree is a Windows junction to the main repo's `data/cache`, which is shared by the Overpass, DEM, WorldCover and gtiles caches. `.env` was copied into each worktree.
- **Three.js engine:** it lives in `apps/web/src/features/scene/three/`. It is opt-in through `?engine=three`, which is persisted as `localStorage tl.engine`. A chip reading "Experimental 3D engine · Switch back" links to `?engine=cesium`.
  - **Rendering:** Neutral tone mapping (not AgX), PCF shadows (three r186 removed PCFSoftShadowMap), GTAO and bloom, plus RoomEnvironment IBL.
  - **Tiers:** `three/quality.ts` `THREE_TIERS`.
  - **Measured performance:** the owner saw 40–60 fps at Medium and High at `hero-mid`, with about 28 draw calls.
  - **Camera framing:** routes are framed with `BOUNDS_RANGE_FACTOR = 4` (30° vertical FOV).

**Buildings data** (`data/seed/elmina/base/buildings.geojson`)
- **Archetypes:** every building has `archetype`, `archetype_method`, `precinct` (where one is known) and an `osm` tag subset.
  - Overall, 63.2% are generic.
  - The rest: link_intermediate 1754, bungalow 478, factory 417, link_long 104, shop_office 61, semi_d 36, school 9, mosque 8, mall 5, highrise 3. superlink and townhouse have none yet.
  - Elmina Valley 1 and 2 are almost all link_intermediate. Valley 3 is generic, because its footprints are whole terrace rows.
  - Coverage per precinct is in `archetype_coverage.json`.
- **Heights:** `height_m` / `height_source` come from OSM height, then OSM levels, then `archetype_storeys`, then a default. The three.js view reads `display_height_m` (which falls back to `height_m`). The Cesium view reads only `height_m`.
- **No Google heights exist.** The hero sampling run found that Google's 3D tiles over Elmina are textured terrain with no building geometry, so `height_samples.json` is absent and the `display_height_*` fields equal `height_m`. The code in `data/scripts/sample_heights.py` (it has `--offline`) is ready if Google ever captures Elmina.
- **Use archetype storey heights for the models**, not samples.

**Other layers**
- `landcover.geojson` has 504 features (OSM plus ESA WorldCover).
- `signage.geojson` has 318 sourced, text-only signs.
- `landmarks.geojson` places only Elmina Lakeside Mall. Kanopi and Masjid Denai Alam have no OSM building footprint and stay unplaced.
- `GET /layers/buildings` also serves `landcover`, `signage` and `landmarks`.

**Known environment limits**
- **Memory:** the machine has 8 GB of RAM. Running vitest, pytest or e2e alongside agents or a dev server has caused OOM failures. Run CI checks alone, and use `--maxWorkers=3` for vitest.
- **Flaky tests:**
  - `StylisedCity.dom.test.tsx` (untouched Cesium code) can time out under memory load, and passes alone.
  - `packages/agent/tests/test_mcp_server.py::test_vr_store_is_the_real_one_only_when_allowed` fails on Windows only, because of a path separator. It is pre-existing.
- **Overpass:** the public servers were at capacity late on 2026-10-17, so `build_buildings.py --parks` could not refresh. `parks.geojson` is committed and unchanged.

**Records**
- **Ledger and rulings:** `.superpowers/sdd/2026-10-17-stylised-threejs-p01/progress.md`. It is gitignored, and it may have been deleted after Phase 0–1. In that case `docs/superpowers/overnight-log.md` carries the summary.
- **Deferred items for P2 and P3:**
  - MapControls panning bypasses the 5000 m centre clamp.
  - Intents that arrive before the engine is ready lose their camera fly-to.
  - The `/layers/buildings` payload carries landcover and signage that the Cesium view never uses (consider `?include=`).
  - Landcover `water` must be styled as decorative and never in the flood palette.
  - Pin a test that the Day sim never reads `height_m`.

**Prerequisites (coordinator, before Task 1):**
1. Phase 0–1 Task 16 is merged into `feat/stylised-threejs`.
2. The P1 Task 12 Step 6 data run has been committed, so `base/buildings.geojson` carries `archetype`, `archetype_method`, `precinct` and the final `height_m` / `height_source`. Done in commit 4340d3c (no Google samples; see the handoff above). If the seed is regenerated later, record which seed commit Tasks 10, 12 and 13 used.
3. Run `git -C ../SunNiuBi-wt/fe merge --ff-only feat/stylised-threejs` and `git -C ../SunNiuBi-wt/data merge --ff-only feat/stylised-threejs`.
4. Run `git worktree add ../SunNiuBi-wt/blender -b lane/blender feat/stylised-threejs`.
5. Create the ledger `.superpowers/sdd/2026-10-17-stylised-threejs-p2/`.

## Global Constraints

- The Realistic style stays on Cesium, and Mapbox lite and List are unchanged. The Three.js view stays opt-in (`?engine=three`) until the gate (P0–1 ruling). The scene contract is unchanged: renderers read `useScene`.
- Local frame: x = east, y = up, z = −north, metres, centred on `site.json` `center` (`three/frame.ts`). glTF is y-up. Blender's exporter maps Blender (x, y, z) to glTF (x, z, −y).
- **Model convention:** each asset's origin is at the centre of its footprint at ground level (y = 0). The frontage (door, porch, shopfront) faces glTF **+z**. The frontage width runs along x and the depth along z.
- **True scale:** archetype sizes are in the Task 1 table. People are 1.6–1.8 m tall (a child variant 1.2–1.45 m). A Myvi-class hatchback is 3.7–4.0 m long. A rain tree canopy is 15–25 m across. These ranges are tested on the committed glbs.
- **Variety:** people, vehicles and trees have 6–10 geometry variants each, plus per-instance colour and size jitter. Archetypes have 1–2 geometry variants plus per-precinct palettes.
- **LOD levels (spec §2.7):** near ≤ 300 m is full detail; mid ≤ 1.5 km is simplified; far (beyond 1.5 km) is a block with the true roof colour and form. Distance is measured from the camera to the instance centre, with 10 % hysteresis.
- **Vertex contract (`COLOR_0`, RGBA):**
  - R is the baked AO (1 = unoccluded).
  - G is the role index / 7.
  - B is a per-class aux value: the window seed for buildings, the sway weight for trees, the limb code for people, and the light code for vehicles.
  - A is 1.
  - The roles, in order, are `primary, secondary, accent, glass, dark, metal, foliage, light`.
  - Every LOD node is **one mesh with one primitive and the single material `tl_role`**.
  - No images in archetypes or kits. A landmark may carry at most 1 image of at most 1024².
- **Node names** are `<asset>__<variant>__LOD<n>`, for example `link_intermediate__gable__LOD0`.
- **Budgets** live in `specs.py` and are tested on the committed glbs:
  - each archetype glb ≤ 400 KB;
  - each landmark glb ≤ 1.5 MB;
  - each kit glb ≤ 1.5 MB;
  - `apps/web/public/city/` ≤ 12 MB in total.
  - Triangle caps per LOD are in the Task 1 table.
  - At runtime, at `hero-mid` on Medium: ≤ 150 draw calls per frame (all passes), ≤ 2.5 M triangles per frame, and ≤ 150 MB of geometry and instance buffers.
- **Performance gate:** ≥ 30 fps at 1440×900, Medium, `hero-mid`, on the owner's laptop (RTX 2050 4 GB, 8 GB RAM), with assets on.
- **Honesty:**
  - Decorative meshes (all kits, and archetype facade detail) are never pickable. Their `raycast` is a no-op.
  - A landmark is placed only where `landmarks.geojson` has a feature with that `model`. Never invent a footprint. Kanopi and Masjid are modelled but stay unplaced.
  - No text, logos or brand marks in any asset. Shopfront sign bands are blank (role `light`).
  - Vehicles are unbranded.
  - Assets never contain Google pixels or geometry: no textures from Street View or 3D Tiles, no mesh extraction. The owner may *look at* Street View or 3D Tiles as visual reference (spec §2.3). Google data feeds only `height_m` (P1).
  - Reference screenshots stay out of git, in the ledger `refs/` folder.
  - Base water and flood layers are untouched.
- **Third-party assets** (Poly Pizza, Poly Haven, Sketchfab; any licence):
  - Download into a new empty folder.
  - Only `.glb`, `.gltf`, `.fbx` or `.obj`, never `.blend`.
  - Normalise them to `assets/blender/vendor/<kind>/<slug>/source.glb`.
  - Record them in `assets/blender/vendor/vendor.json` and in a "Third-party assets" table in root `CREDITS.md` (URL, author, licence, files, where they now live).
  - Blender always runs with `--factory-startup --disable-autoexec`.
- **Machine:** 8 GB RAM, and an OOM was seen in Phase 0–1. Run one Blender process at a time. Never run headless Blender alongside the dev server, a browser and vitest together. Use `--maxWorkers=3` for full vitest runs.
- **Cost:** `LLM_PROVIDER=mock`. No Google tile loads (the Three.js view loads none). Sketchfab downloads may need the owner's account. Ask before using it.
- **Dependencies:** pin exactly. `@gltf-transform/cli` goes in the root `devDependencies`. Check with `pnpm view @gltf-transform/cli@4.1.1 version`. If that version is missing, pin the newest 4.x released at least two weeks ago and record a ruling.
- **Commits:** Conventional with scope (`feat(assets): …`, `feat(web): …`, `feat(data): …`, `test(…)`, `docs: …`). Regenerated glbs and seed data are their own `data: …` commit. Stage explicit paths, never `git commit -am`. End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019Xp4Af8HaoKvPwzeVf7zuc
  ```
- **Lanes:**
  - `blender`, Tasks 1–8: `assets/blender/**`, `apps/web/public/city/**`, `CREDITS.md`, root `package.json` (`assets:*` scripts, gltf-transform), `pyproject.toml` (pytest), `biome.json`, `.gitignore`.
  - `fe`, Tasks 9–12: `apps/web/src/features/scene/three/**`, `apps/web/e2e/three.spec.ts`, `apps/web/README.md`.
  - `data`, Task 13: `data/scripts/build_frontage.py`, its test, root `package.json` (`data:city`) and the seed.
  - The lanes share only root `package.json`. The coordinator merges them into `feat/stylised-threejs` with `--no-ff` (Task 14), never into `main`.
  - Owner-gate steps are run by the **coordinator**, not by subagents.
- Done = the AGENTS.md CI checklist, run with `set -o pipefail`, each check reported PASS / FAIL / BLOCKED / NOT RUN. Blender-marked tests are opt-in and are reported separately.

**Rulings (record in the ledger at start):**
- "Compress with meshopt (gltf-transform), not Draco — three's MeshoptDecoder is a bundled JS module with inline wasm, while Draco needs decoder files hosted and copied like Cesium's — cost if wrong: one pack flag and a DRACOLoader."
- "Material roles live in `COLOR_0.g` with one material per asset — one draw call per (asset, variant, LOD) bucket, and per-instance palettes give the precinct colours without texture memory — cost if wrong: re-export with multi-material primitives (more draw calls)."
- "Packed glbs are committed under `apps/web/public/city/` (≤ 12 MB), because Blender isn't in CI and the web build must not need it — cost if wrong: move them to LFS later." The owner asked whether this is good practice (2026-10-17). It is acceptable at this size: plain git handles a few MB of binaries fine, and LFS would add GitHub LFS quotas and CI checkout setup. The risk is **history growth**, because every regenerated glb version stays in the repo forever. So:
  - regenerate and commit glbs only in each task's single "regen and data commit" step, never while iterating;
  - keep `out/raw/` gitignored;
  - report the folder total in each data commit.
- "Third-party models are allowed when they meet the quality bar in the gate protocol; Kenney (CC0) is searched first — owner, 2026-10-17 — cost if wrong: swap a vendor variant for a scripted one."
- "The coordinator gathers the reference images; the owner supplies no photos — owner, 2026-10-17 — cost if wrong: archetype details drift from the real precincts until the visual gate catches them."
- "Generic or irregular footprints, and any footprint an archetype can't fit, stay extruded by `cityMesh.ts` — a stretched model is a confident wrong picture (spec §2.4) — cost if wrong: some areas look plainer until P4."

## Review Focus

1. **A footprint an archetype can't fit** (L-shaped, fill < 0.75, scale outside the archetype's band, a row with too few units) must fall back to extrusion, never to a stretched or overlapping model. Pinned in Task 10.
2. **Assets that fail to load** (manifest 404, malformed manifest, missing glb, decoder failure, an archetype in the seed that has no asset yet) must leave the extruded city fully drawn, with `data-assets="failed"` and a single warning, never a crash or holes. Pinned in Tasks 9, 10 and 12.
3. **Leaving the scene while glbs are still loading** must not call `setAssets` after `dispose`, and must not leak geometries. Pinned in Task 12.
4. **The camera resting on an LOD boundary** must not make instances flicker between LODs or rebuild instance buffers every frame. Pinned in Task 11 (hysteresis, rebuild only on bucket change).
5. **Size jitter breaking true scale** (a person jittered to 1.9 m, a hatchback to 4.3 m) must stay inside the spec ranges. Pinned in Task 10 (`jitterFor`) and Task 1 (the committed-glb range test).

---

## Owner gate protocol (Tasks 2–8)

Each asset task ends with a **stop and ask the owner** gate, run by the coordinator:

1. Ask the owner to open Blender 5.2, press `N`, and confirm that "MCP for Blender" shows "Connected on port 9876". Then call `get_addon_status()` and `get_scene_info()`.
2. **The coordinator gathers the reference images; the owner does not have to supply photos** (owner answer, 2026-10-17). Sources, in this order:
   - the photos and links in `docs/02-research/elmina-building-types.md`;
   - public developer and news pages (Sime Darby Property, Star Property, EdgeProp, iProperty listings);
   - Google Maps Street View, opened in the coordinator's browser tool as *visual reference only*. Spec §2.3 allows this. It is ordinary browsing, not the Map Tiles API, and nothing from Google enters an asset.
   Save the screenshots only in `.superpowers/sdd/2026-10-17-stylised-threejs-p2/refs/<task>/`, never in git. If the owner does share photos, add them to the same folder.
3. Build in the live Blender from the **committed module**, never by hand-editing the scene:
   ```python
   import sys, importlib; sys.path.insert(0, r"C:/Users/shaoxian04/Documents/SunNiuBi-wt/blender/assets/blender")
   import tl_assets.core as core, tl_assets.build as build
   importlib.reload(core); importlib.reload(build); build.preview("<asset>")
   ```
   `build.preview(asset)` rebuilds all variants and LODs side by side, under a sun and sky preview rig, and frames the camera.
4. Call `get_viewport_screenshot()` for each variant at LOD0, and once for the LOD0/1/2 row. Show the owner, next to the reference images.
5. Turn the owner's notes into script edits, rerun step 3, and repeat. The cap is 5 rounds per task. Record what is left as a ledger minor.
6. Record the verdict as a ledger ruling: "<task> assets: owner PASS/notes … — because … — cost if wrong: …". Then run the headless build and pack (the task's regen step) **from the edited script**.

Third-party picks happen at this gate too. The owner allows third-party models, provided the quality is good (2026-10-17). Search sources in this order:
1. **Kenney** (https://kenney.nl/assets, CC0), suggested by the owner. It has a low-poly style that suits the diorama. Useful kits: City Kit (Suburban, Commercial, Roads), Car Kit, Nature Kit, Furniture Kit and Mini Characters.
   - Download the kit zip into a new empty folder outside the repo, and take only the `.glb` / `.fbx` / `.obj` files you need.
   - Many Kenney kits colour their models through one shared palette texture (`colormap.png`). Because our kits carry no images, `import_vendor` must turn that texture into vertex roles. For each face, sample the colormap at the face's UV centroid, then map the colour to the nearest role, or use the palette's role table in `role_map`. Drop the image after that.
   - CC0 needs no attribution, but record each kit in `vendor.json` and `CREDITS.md` anyway, for provenance.
2. Poly Pizza (`search_polypizza_models`; credit the CC-BY creators).
3. Poly Haven (`search_polyhaven_assets`).
4. Sketchfab (`search_sketchfab_models`). It may need the owner's account, so ask first.

**Quality bar for any vendor model:**
- true scale after `scale_to`;
- clean silhouettes at the near LOD;
- no brand marks or text;
- a triangle count that fits the Task 1 caps, or that can be decimated to fit;
- a style that matches the scripted archetypes.

Reject a model that fails any of these rather than lowering the bar. Show previews. On the owner's yes, import the asset, then export the selection with `execute_blender_code` to `assets/blender/vendor/<kind>/<slug>/source.glb`, and add the `vendor.json` and `CREDITS.md` rows.

---

## Part A — lane `blender`

All paths are under `assets/blender/` unless stated otherwise.
- Pure modules (`tl_assets/specs.py`, `geo.py`, `glbinfo.py`, `manifest.py`) never import `bpy`.
- Tests live in `assets/blender/tests/`. A `conftest.py` puts `assets/blender` on `sys.path` and skips `@pytest.mark.blender` tests unless `TL_BLENDER_TESTS=1` and Blender is found.

### Task 1: Pipeline core, specs, budgets and the calibration asset

**Files:**
- Create:
  - `tl_assets/__init__.py`, `tl_assets/specs.py`, `tl_assets/geo.py`, `tl_assets/glbinfo.py`, `tl_assets/manifest.py`;
  - `tl_assets/core.py` (bpy), `tl_assets/build.py` (bpy entry point and `preview`);
  - `run.py`, `pack.py`, `README.md`, `tests/conftest.py`.
- Test: `tests/test_specs.py`, `tests/test_geo.py`, `tests/test_glbinfo.py`, `tests/test_committed_assets.py`, `tests/test_blender_pipeline.py` (marker `blender`)
- Modify:
  - `pyproject.toml`: add `assets/blender/tests` to `testpaths`, and register the marker `blender: runs headless Blender (TL_BLENDER_TESTS=1)`.
  - Root `package.json`: `"assets:build": "uv run python assets/blender/run.py"`, `"assets:pack": "uv run python assets/blender/pack.py"`, and devDependency `@gltf-transform/cli`.
  - `.gitignore`: `assets/blender/out/`.
  - `biome.json`: `!apps/web/public/city`.

**Interfaces:**
- Produces (pure):
  ```python
  # specs.py
  ROLES = ("primary", "secondary", "accent", "glass", "dark", "metal", "foliage", "light")
  ARCHETYPES: tuple[str, ...]          # same 13 names, same order, as data/scripts/build_archetypes.py
  STOREY_HEIGHT_M: dict[str, float]    # copy of build_archetypes.STOREY_HEIGHT_M
  LOD_MAX_M = (300.0, 1500.0, None)    # buildings; kits carry their own per-LOD max_m
  @dataclass(frozen=True)
  class Variant: id: str; size: tuple[float, float, float]  # (w along x, h, d along z) metres
                 tris: tuple[int, ...]; max_m: tuple[float | None, ...]; y_range: tuple[float, float] | None = None
                 x_range: tuple[float, float] | None = None; z_range: tuple[float, float] | None = None
  @dataclass(frozen=True)
  class AssetSpec: id: str; group: str  # "archetype" | "landmark" | "kit"
                   file: str; variants: tuple[Variant, ...]; max_bytes: int
                   repeat: str = "none"      # "frontage": units repeat along the frontage (rows)
                   frontage: str = "short"   # which OBB side is the frontage for a single unit
                   fit_xz: tuple[float, float] = (0.75, 1.35); fit_y: tuple[float, float] = (0.6, 1.6)
                   variant_by_group: dict[str, str] = field(default_factory=dict)
                   decorative: bool = False; placement: str | None = None  # landmarks: "anchor" | "obb" | "deferred"
                   jitter: dict[str, float] = field(default_factory=dict)  # {"scale": 0.04, "hue": 0.05}
  ASSETS: dict[str, AssetSpec]           # every archetype, landmark and kit
  TEST_ASSETS: dict[str, AssetSpec]      # {"calib": …}; never in the manifest
  PRECINCT_GROUPS: tuple[tuple[str, str], ...]  # (group, regex), first match wins; else "default"
  PALETTES: dict[str, dict[str, tuple[tuple[str, str, str], ...]]]  # asset or "residential"/"commercial"/kit -> group -> [(primary, secondary, accent)]
  MAX_TOTAL_BYTES = 12_000_000
  def precinct_group(precinct: str | None) -> str: ...
  # geo.py (the same tangent plane as apps/web/.../three/frame.ts)
  def to_local(lon: float, lat: float, origin: tuple[float, float]) -> tuple[float, float]: ...  # (x east, z = -north)
  def ring_centroid(ring: list[list[float]]) -> tuple[float, float]: ...   # lon/lat area centroid
  # glbinfo.py (stdlib only; reads the JSON chunk, works on meshopt/quantised files)
  @dataclass
  class NodeInfo: tris: int; primitives: int; bounds: tuple[tuple[float, float, float], tuple[float, float, float]]; attributes: frozenset[str]
  @dataclass
  class GlbInfo: nodes: dict[str, NodeInfo]; materials: list[str]; images: int; extensions_used: list[str]; bytes: int
  def read_glb(path: Path) -> GlbInfo: ...
  # manifest.py
  def build_manifest(infos: dict[str, GlbInfo], as_of: str, landmarks_fc: dict) -> dict: ...  # the schema below
  ```
- Produces (bpy, in `core.py`):
  ```python
  def reset_scene() -> None
  def set_role(obj, role: str, aux: float | Callable[[int], float] = 0.0) -> None  # COLOR_0 corner domain: R=1, G=ROLES.index(role)/7, B=aux (callable: per polygon index)
  def join(objs: list, name: str) -> "bpy.types.Object"        # joins and applies modifiers; one object per LOD
  def bake_ao(obj, samples: int = 64) -> None                  # Cycles AO into a temp attribute, then copied into COLOR_0.R only
  def export_glb(objs: list, path: Path) -> None               # selection only, y-up, single material "tl_role", active colour attribute as COLOR_0
  def tri_count(obj) -> int
  # build.py — run as: blender --background --factory-startup --disable-autoexec --python build.py -- --asset <id> --out <dir>
  BUILDERS: dict[str, Callable[[Variant, int], list]]          # (variant, lod) -> objects; filled by archetypes/landmarks/props modules
  def build_asset(asset_id: str, out: Path) -> Path
  def preview(asset_id: str) -> None                            # owner gate: all variants x LODs in a row, sun + sky, camera framed
  ```
- `run.py`: `--asset <id>` (repeatable), `--all`, `--blender <path>` (default `$BLENDER`, else `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`). One subprocess per asset, writing to `assets/blender/out/raw/<file>`. A non-zero exit stops the run and prints the asset id.
- `pack.py`: for each raw glb it runs `pnpm exec gltf-transform meshopt <raw> apps/web/public/city/<file> --level medium`, then writes `apps/web/public/city/manifest.json` from `build_manifest` (stable key order, 2-space indent, trailing newline). Flags: `--only <id>` (repeatable) and `--out <dir>`. When either is given, the manifest is not written. `TEST_ASSETS` are packed only through `--only`.
- **Manifest schema** (version 1; Task 9 consumes it):
  ```json
  {"version": 1, "as_of": "YYYY-MM-DD", "roles": ["primary", "…"], "precinctGroups": [["valley", "elmina valley"], "…"],
   "assets": {"<id>": {"group": "archetype", "file": "archetypes/<id>.glb", "bytes": 0, "repeat": "none", "frontage": "short",
     "fit": {"xz": [0.75, 1.35], "y": [0.6, 1.6]}, "decorative": false, "placement": null, "jitter": {},
     "variantByGroup": {"default": "gable"}, "palettes": {"default": [["#f2efe8", "#3d4147", "#8a8f96"]]},
     "variants": {"<v>": {"size": [6.4, 8.5, 15.5], "lods": [{"node": "<id>__<v>__LOD0", "tris": 0, "maxM": 300}, "…"]}}}},
   "landmarks": {"lakeside_mall": {"anchor": [101.5099, 3.1813]}}}
  ```
  `landmarks` holds anchors only for landmarks whose `placement` is `"anchor"`. Each anchor is computed from the matching `landmarks.geojson` feature's ring centroid.

**Size, LOD and triangle table** (`specs.py`). Sizes are w × h × d in metres; LOD0/1/2 are triangle caps.

| Asset | Variants | Size | LOD0 / LOD1 / LOD2 | Notes |
|---|---|---|---|---|
| link_intermediate | gable, modern | 6.4 × 8.5 × 15.5 | 6000 / 700 / 40 | repeat frontage; OSM built footprints are 5.6–7.3 × 14–17 |
| link_long | gable, modern | 6.7 × 8.5 × 24.0 | 6500 / 750 / 40 | repeat frontage |
| superlink | modern | 11.0 × 9.0 × 21.0 | 7000 / 800 / 40 | rooftop solar (role `metal`) |
| semi_d | gable, modern | 12.5 × 9.0 × 24.0 | 7000 / 800 / 40 | one half of the pair |
| bungalow | hip | 15.0 × 5.5 × 18.0 | 6000 / 700 / 40 | fit_xz (0.7, 1.5) |
| townhouse | flat | 7.0 × 6.0 × 13.0 | 4000 / 500 / 30 | repeat frontage |
| shop_office | row | 6.7 × 11.0 × 22.0 | 8000 / 900 / 40 | repeat frontage, frontage "long" for rows; five-foot way; blank sign band |
| highrise | mid, tall | 25 × 40 × 25; 30 × 100 × 30 | 25000 / 3000 / 120 | fit_y (0.6, 1.5); variant = nearest h |
| school | block | 20.0 × 14.0 × 15.0 | 12000 / 1500 / 60 | repeat frontage (long side) |
| mosque | hall | 30.0 × 15.0 × 30.0 | 20000 / 2500 / 150 | y_range (14, 32) for dome and minaret |
| factory | shed | 30.0 × 10.0 × 40.0 | 4000 / 600 / 40 | fit_xz (0.5, 2.0) |
| mall | box | 60.0 × 9.0 × 60.0 | 15000 / 2000 / 80 | fit_xz (0.4, 3.0) |
| generic | box | 10.0 × 9.0 × 10.0 | 3000 / 400 / 24 | fit_xz (0.3, 4.0); only footprints with fill ≥ 0.85 |
| lakeside_mall (landmark) | osm | from its OSM outline, h 9 | 80000 / 10000 / 1500 | placement "anchor" |
| kanopi (landmark) | tower | 40 × 125 × 30 | 60000 / 8000 / 600 | placement "deferred"; y_range (118, 132) |
| masjid_denai_alam (landmark) | main | 40 × 18 × 40 | 40000 / 5000 / 400 | placement "deferred"; y_range (16, 34) |
| people (kit) | 10 (Task 7) | — | 1500 / 250 (max_m 80 / 300) | y_range (1.6, 1.8); child (1.2, 1.45); jitter scale 0.03 |
| vehicles (kit) | 9 (Task 7) | — | 3000 / 400 (150 / 1500); bus and lorry 5000 / 600 | per-variant z_range (length); jitter scale 0.02 |
| trees (kit) | 8 (Task 6) | — | 4000 / 600 / 60 (300 / 1500 / none); rain tree 6000 | per-variant x_range (canopy) and y_range; jitter scale 0.12 |
| furniture (kit) | 9 (Task 6) | — | 800 / 120 (150 / 300) | street lamps carry role `light` heads |
| construction (kit) | 8 (Task 8) | — | 6000 / 600 / 60 (300 / 1500 / none) | the tower crane keeps LOD2 |

`max_bytes` is 400 KB for archetypes, and 1.5 MB for landmarks and kits. Mark the h values for school, mosque, factory and mall as "[?] starting value" in a comment. These four are the only `STOREY_HEIGHT_M` mirrors, and the test pins them equal to the data module.

**Palettes** (the `[?]` starting values from the research doc, tuned at the owner gates):
- `PRECINCT_GROUPS = (("green", r"elmina green"), ("ridge", r"ridge"), ("valley", r"valley"), ("denai_alam", r"denai alam"), ("city_centre", r"city centre|lakeside|kanopi"), ("business_park", r"business park"))`.
- Residential:
  - default: `("#f2efe8","#3d4147","#8a8f96"), ("#e9e4da","#4a4e55","#a07a55"), ("#dfe2e4","#33373d","#6d737a")`;
  - green: `("#f4f0e6","#3a3d42","#9b7350"), ("#ece6d8","#45484e","#b08a62"), ("#f7f5ef","#2f3236","#7d6a58")`;
  - valley: `("#e6e7e8","#50545a","#a0563f"), ("#f1f1ef","#3e4247","#8c4a36"), ("#d9dbdd","#2e3135","#b06a4f")`;
  - ridge: `("#f5f5f3","#2b2e33","#3f444b"), ("#e4e6e3","#383c41","#6b7b6e")`;
  - denai_alam: `("#efe6d2","#8a4b35","#b9a27f"), ("#e8dcc6","#7a4332","#9e8a6c"), ("#f0ece2","#5b5f66","#a89878")`.
- `variant_by_group` for the link and semi-D archetypes: `{"valley": "modern", "ridge": "modern", "city_centre": "modern", "default": "gable"}`.

- [ ] **Step 1: Add the tool dependency.** Run `pnpm view @gltf-transform/cli@4.1.1 version`, then `pnpm add -Dw @gltf-transform/cli@4.1.1`. Expected: an exact pin in root `package.json`.

- [ ] **Step 2: Write the failing pure tests**

`test_specs.py`:
- `set(ARCHETYPES) == set(build_archetypes.ARCHETYPES)` and the order is equal. Import `data.scripts.build_archetypes` with the repo root on `sys.path`.
- For every archetype with a `STOREY_HEIGHT_M` entry, its first variant's `size[1] == STOREY_HEIGHT_M[a]`.
- Every asset has ≥ 1 variant. Each variant's `len(tris) == len(max_m)`, and its tris are strictly decreasing.
- Every kit has 6–10 variants (furniture and construction included).
- Building assets use `max_m == LOD_MAX_M`.
- People variants' `y_range` ⊂ [1.2, 1.85]. Every adult `y_range` ⊂ [1.6, 1.8].
- The `hatchback` `z_range` ⊂ [3.7, 4.0]. The `rain_tree` `x_range` ⊂ [15, 25].
- `precinct_group("Elmina Valley 2") == "valley"`, `precinct_group(None) == "default"`, `precinct_group("Unknown") == "default"`.
- Every palette entry is three `#rrggbb` strings. Every `variant_by_group` value names an existing variant.
- `TEST_ASSETS.keys().isdisjoint(ASSETS)`.

`test_geo.py`:
- `to_local(101.5099, 3.1913, (101.5099, 3.1813))` ≈ `(0, -1105.8)` (±0.5).
- 0.01° east ≈ `(1111.5, 0)`.
- The `ring_centroid` of a lon/lat rectangle is its centre.

`test_glbinfo.py` uses glbs built in the test with stdlib `struct`:
- An unquantised one-triangle glb with node translation (10, 0, 0) gives `tris == 1` and bounds min x 10.
- An `int16`-normalised POSITION with node scale 2 gives bounds dequantised (`/32767`) and then scaled.
- Two primitives on one node gives `primitives == 2`.
- `images`, `materials` and `extensions_used` are read from the JSON.
- A non-glb file raises `ValueError`.

`test_committed_assets.py` reads `apps/web/public/city/manifest.json` when it exists. With no manifest yet, it asserts that `ASSETS` names files under `archetypes/`, `landmarks/` or `kits/` and stops there. Otherwise, for every asset in the manifest:
- the glb exists and its size is ≤ `max_bytes`, and the folder total is ≤ `MAX_TOTAL_BYTES`;
- every `<id>__<v>__LOD<n>` node exists, with `primitives == 1`, tris ≤ the cap and `COLOR_0` among its attributes;
- `materials == ["tl_role"]`;
- `images == 0`, or ≤ 1 for a landmark;
- `"EXT_meshopt_compression"` is in `extensions_used`;
- LOD0 bounds: the x and z extents are within [size − 0.1, size + 1.2] (eaves may overhang 0.6 m per side), and the y max is within `y_range`, else within size h ± 1.0. Where `x_range`/`z_range` are given they replace the size check;
- the manifest's tris equal the glb's;
- the manifest has no `calib`.

- [ ] **Step 3: Run to verify they fail**

Run: `uv run pytest assets/blender/tests -q`
Expected: FAIL (modules missing). The blender-marked test is SKIPPED.

- [ ] **Step 4: Implement the pure modules.** In `glbinfo.py`, the world matrix is the product of the node TRS from the root. Bounds are the 8 accessor min/max corners, dequantised when `normalized` (int8 /127, uint8 /255, int16 /32767, uint16 /65535), and transformed. Tris are the index count / 3, or the POSITION count / 3 when there are no indices. Only mode 4 counts.

- [ ] **Step 5: Run to verify they pass** (same command; expected PASS, with the blender test SKIPPED)

- [ ] **Step 6: Write the failing Blender pipeline test** (`test_blender_pipeline.py`, `@pytest.mark.blender`)

The test runs `run.py --asset calib`, then packs `calib` into `tmp_path` (`pack.py --only calib --out <tmp>` without writing the manifest), and checks:
- The raw `calib.glb` has nodes `calib__a__LOD0/1/2`, each with 1 primitive and `COLOR_0`. Calib is a 10 × 10 × 10 box with a 2 m porch slab (role `secondary`) on its +z side.
- LOD0 bounds: x within [−5, 5] ± 0.01, y within [0, 10] ± 0.01, and z max ≈ 7 (the porch is on +z, so the frontage faces +z).
- The packed bounds equal the raw bounds within 0.01 m, and the packed file has `EXT_meshopt_compression`.
- The AO channel (R) is varied, with std > 0.02 under the porch, and its mean is within [0.5, 1]. Decode `COLOR_0` from the raw (unquantised) glb with stdlib `struct`.

- [ ] **Step 7: Run to verify it fails**

Run: `TL_BLENDER_TESTS=1 uv run pytest assets/blender/tests/test_blender_pipeline.py -m blender -q`
Expected: FAIL. If Blender is not at the default path, report BLOCKED.

- [ ] **Step 8: Implement `core.py`, `build.py`, `run.py`, `pack.py`** (and the calib builder in `build.py`)

Follow the Blender MCP rules even headless:
- Set the render engine with `try: scene.render.engine = "CYCLES" except TypeError`.
- Read exporter enum values from `bpy.ops.export_scene.gltf.get_rna_type().properties[...]` before setting them (vertex-colour export = active attribute, `export_yup=True`, `use_selection=True`, `export_apply=True`). Don't hard-code an identifier the 5.2 exporter lacks.
- Find nodes by `type`, never by name.
- `bake_ao` bakes on a temporary 40 m ground plane (deleted afterwards) into a temp colour attribute, then copies R into `COLOR_0.R` with `foreach_get`/`foreach_set`.
- Seed `random` per asset (`random.seed(asset_id)`) so rebuilds are stable.

- [ ] **Step 9: Run to verify it passes** (the Step 7 command; expected PASS), then `uv run pytest assets/blender/tests -q` (PASS, blender SKIPPED) and `pnpm lint` (PASS)

- [ ] **Step 10: Commit**

```bash
git add assets/blender package.json pnpm-lock.yaml pyproject.toml .gitignore biome.json
git commit -m "feat(assets): headless blender pipeline, specs, budgets and glb checks"
```

### Task 2: Building kit and link houses (owner gate A)

**Files:**
- Create: `tl_assets/kit.py` (bpy), `tl_assets/archetypes.py` (bpy; registers builders into `build.BUILDERS`)
- Test: extend `tests/test_blender_pipeline.py` with `test_link_houses` (marker `blender`)
- Output (data commit): `apps/web/public/city/archetypes/link_intermediate.glb`, `link_long.glb`, `manifest.json`

**Interfaces:**
- Consumes: `core.*`, `specs.ASSETS` (Task 1).
- Produces:
  ```python
  # kit.py — all sizes metres, origin at footprint centre, frontage +z (glTF) == Blender -y
  def walls(w: float, d: float, h: float, *, openings: list[Opening], lod: int) -> list
  @dataclass
  class Opening: face: str; u: float; v: float; w: float; h: float; kind: str  # face "front|back|left|right"; kind "window|door|garage|shopfront"
  def window(o: Opening, lod: int) -> list            # LOD0: frame (dark) + glass (glass, aux = window seed) + sill; LOD1: inset glass face only
  def gable_roof(w, d, eave_h, pitch_deg, overhang=0.4, ridge_axis="z") -> list
  def hip_roof(w, d, eave_h, pitch_deg, overhang=0.5) -> list
  def flat_roof(w, d, h, parapet=0.6) -> list
  def car_porch(w, depth, h) -> list                  # flat slab on two columns inside the footprint front
  def five_foot_way(length, depth=1.8, h=3.4) -> list # covered walkway with columns
  def balcony(w, depth, y) -> list; def ac_units(n, face) -> list; def solar_panels(w, d, y, tilt_deg) -> list
  def gate_and_fence(w) -> list; def sign_band(w, h, y) -> list  # sign band is role "light", blank, no text
  def far_block(size: tuple[float, float, float], roof: str) -> list  # LOD2: box + roof prism, <= 40 tris, roles primary/secondary
  ```
  The link house builders take `(variant, lod)`. LOD0 has the full detail: door, window frames, sills, porch, gate, AC units and roof eaves. LOD1 is built by the same builder with `lod=1`, so frames, sills, AC, gate and fence are dropped and windows become inset glass faces; it is not a decimate. LOD2 is `far_block`. Window glass gets aux = a seeded random value per window, the same on all of its faces.
  - `gable`: a pitched charcoal tile roof, ridge along z, white walls, and a car porch slab (green / Denai Alam style).
  - `modern`: a flat or low-mono-pitch roof, brick accent panel (role `accent`) and clean lines (Elmina Valley 2: "brick pattern design and minimalist clean lines").

- [ ] **Step 1: Write the failing test.** `test_link_houses` builds `link_intermediate` and `link_long` through `run.py`, packs them into `tmp_path`, and asserts the Task 1 committed-asset checks on those files: nodes, single primitive, tris caps, bounds against the size table, and AO varied on LOD0. It also asserts:
  - LOD0 has ≥ 4 distinct role values, among them `glass` and `dark`;
  - LOD2 has ≤ 40 tris;
  - each glass face's B is in (0, 1).
- [ ] **Step 2: Run to verify it fails:** `TL_BLENDER_TESTS=1 uv run pytest assets/blender/tests/test_blender_pipeline.py -m blender -k link -q` → FAIL.
- [ ] **Step 3: Implement `kit.py` and the two builders in `archetypes.py`.**
- [ ] **Step 4: Run to verify it passes** (same command; PASS).
- [ ] **Step 5: Commit the code** (`kit.py`, `archetypes.py`, the test; message `feat(assets): parametric building kit and link house archetypes`).
- [ ] **Step 6: OWNER GATE A (stop and ask the owner)** per the protocol, with references for Elmina Valley 1/2 (the hero district, about 0.5 % generic, mostly link_intermediate) and Elmina Green. Also tune the `green`, `valley` and `default` palettes in `specs.py` with the owner. Commit the script and palette edits (`fix(assets): link houses after owner review`).
- [ ] **Step 7: Regen and data commit.** Run `uv run python assets/blender/run.py --asset link_intermediate --asset link_long && pnpm assets:pack && uv run pytest assets/blender/tests -q` (PASS). Report the sizes and tris. Then:

```bash
git add apps/web/public/city
git commit -m "data: link house archetype glbs"
```

### Task 3: Other residential archetypes (owner gate B)

**Files:**
- Modify: `tl_assets/archetypes.py`
- Test: `test_residential` in `tests/test_blender_pipeline.py`
- Output (data commit): `archetypes/superlink.glb`, `semi_d.glb`, `bungalow.glb`, `townhouse.glb`, `manifest.json`

**Interfaces:**
- Consumes: `kit.*` (Task 2).
- Produces builders for:
  - `superlink/modern`: a 2-storey flat or mono-pitch roof, rooftop solar panels as standard, and a skylight (Elmina Ridge).
  - `semi_d/gable|modern`: one half of a pair. The party wall is on −x with no openings, and there is a side garden on +x inside the size.
  - `bungalow/hip`: single storey with a hip roof and a wide porch.
  - `townhouse/flat`: a 1-storey twin, or a stacked unit with 2 doors on the front.

- [ ] **Step 1: Write the failing test.** Run the same checks as Task 2 for the four assets. Also check that `superlink` LOD0 has role `metal` faces with a normal y > 0.5 (solar panels), and that the `semi_d` LOD0 has no `glass` faces whose normal points along −x (the party wall).
- [ ] **Step 2: Run to verify it fails** (`-k residential`) → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit the code** (`feat(assets): superlink, semi-d, bungalow and townhouse archetypes`).
- [ ] **Step 6: OWNER GATE B** with references for Elmina Ridge, The Eighth, Denai Alam (Cypress Residences, Opulenia) and Ilham Residence 3. Tune the `ridge` and `denai_alam` palettes. Commit the edits.
- [ ] **Step 7: Regen and data commit** (as in Task 2 Step 7, for these four assets; message `data: residential archetype glbs`).

### Task 4: Non-residential archetypes and the generic (owner gate C)

**Files:**
- Modify: `tl_assets/archetypes.py`
- Test: `test_non_residential` in `tests/test_blender_pipeline.py`
- Output (data commit): `archetypes/shop_office.glb`, `highrise.glb`, `school.glb`, `mosque.glb`, `factory.glb`, `mall.glb`, `generic.glb`, `manifest.json`

**Interfaces:**
- Produces builders for:
  - `shop_office/row`: one 22' unit, 2–3 storeys, with a covered five-foot way along +z, large upper windows, a blank `sign_band` above the five-foot way, and a flat roof with parapet. The loader repeats units along the frontage.
  - `highrise/mid|tall`: a podium, repeated floor bands with balconies (planted balcony boxes in role `foliage`), and a crown with roof equipment.
  - `school/block`: one 20 m bay of a JKR-style block. It is 4 storeys, with a corridor on +z with railings, a pitched roof and stair cores at the ends; the loader repeats it.
  - `mosque/hall`: a prayer hall, a dome (role `accent`) and one minaret. All are generic forms; no specific mosque is copied.
  - `factory/shed`: a portal-frame shed with a metal roof (role `metal`), roller doors and an office annex on +z.
  - `mall/box`: a big-box retail unit with a canopy and a blank sign band.
  - `generic/box`: a neutral facade with a regular window grid, a cornice and no porch. It must read well when scaled by up to `fit_xz`.

- [ ] **Step 1: Write the failing test.** Run the Task 2 checks for the seven assets. Also check:
  - the `shop_office` LOD0 has a role-`light` face (sign band) with an area ≥ 3 m² and normal +z;
  - the glb has `images == 0` (no text texture);
  - the `mosque` LOD0 y max is within (14, 32);
  - the two `highrise` variants' y max values are within 40 ± 1 and 100 ± 1.
- [ ] **Step 2: Run to verify it fails** (`-k non_residential`) → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit the code** (`feat(assets): shop office, high-rise, school, mosque, factory, mall and generic archetypes`).
- [ ] **Step 6: OWNER GATE C** with references for Temu, Jumpa, E-Boulevard, the education hub and the Business Park. Tune the `commercial` and `business_park` palettes. Commit the edits.
- [ ] **Step 7: Regen and data commit** (`data: non-residential archetype glbs`).

### Task 5: Landmarks (owner gate D)

**Files:**
- Create: `tl_assets/landmarks.py` (bpy)
- Test: `test_landmarks` in `tests/test_blender_pipeline.py`, and in `tests/test_specs.py` add `test_landmark_anchor_from_seed` (pure)
- Output (data commit): `apps/web/public/city/landmarks/lakeside_mall.glb`, `kanopi.glb`, `masjid_denai_alam.glb`, `manifest.json`

**Interfaces:**
- Consumes: `geo.to_local`, `geo.ring_centroid` (Task 1); `data/seed/elmina/base/landmarks.geojson` (`model` ∈ {`lakeside_mall`, `kanopi`, `masjid_denai_alam`}).
- Produces:
  - **`lakeside_mall`** is built **from its OSM outline**. The script reads the feature whose `model == "lakeside_mall"`, converts its ring to local metres around `ring_centroid`, and extrudes the shell to 9 m with a parapet. It adds a continuous canopy along the outline edges, roof plant boxes and a blank sign band, and is single storey and open-air in character. The origin is at the centroid. `manifest.landmarks.lakeside_mall.anchor` is that centroid.
  - **`kanopi`** is a 36-storey tower on a 40 × 30 m nominal footprint: a level-7 facilities deck, planted balconies ("afforestation") and Sky Pods. Its height is 118–132 m.
  - **`masjid_denai_alam`** is a hall, a main dome and a minaret on a 40 × 40 m nominal footprint.
  - `kanopi` and `masjid_denai_alam` carry `placement: "deferred"`. No anchor is written for them, and nothing places them until a sourced outline exists (P1 ruling; owner decides in P3).
  - The landmark builders also take `lod` (LOD2 is a simplified massing).

- [ ] **Step 1: Write the failing tests.**
  - `test_landmark_anchor_from_seed`: `build_manifest` with the seed `landmarks.geojson` gives a `lakeside_mall` anchor equal to `ring_centroid` of that feature (±1e-7). It gives no anchor for `kanopi` or `masjid_denai_alam`. A collection with no `lakeside_mall` feature gives no anchor (and logs that the landmark is unplaced).
  - `test_landmarks`: the `lakeside_mall` LOD0 x/z extent equals the outline's local bounding box ± 1.5 m (the canopy overhang), and its y max is within 8–12. The `kanopi` y max is within (118, 132). The `masjid` y max is within (16, 34). The tris caps hold. There is ≤ 1 image per landmark.
- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement** (`landmarks.py`, and the anchor rule in `manifest.py`).
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit the code** (`feat(assets): lakeside mall from its OSM outline, Kanopi and Masjid Denai Alam models`).
- [ ] **Step 6: OWNER GATE D** with references for the mall (Star Property and EdgeProp photos), Kanopi (the SDP page) and Masjid Denai Alam. Kanopi and Masjid staying unplaced in P2 is already agreed with the owner (2026-10-17): they are modelled now and placed in P3 once a sourced outline exists. Record that as a ruling. Then propose the P3 options to the owner:
  - trace the outline from a public site plan or official drawing, and record that source;
  - or wait for an OSM building outline.
- [ ] **Step 7: Regen and data commit** (`data: landmark glbs`).

### Task 6: Vendor intake, trees and street furniture (owner gate E)

**Files:**
- Create: `tl_assets/props.py` (bpy; kit builders and vendor normalisation), `assets/blender/vendor/vendor.json` (starts as `[]`)
- Modify: root `CREDITS.md` (add a "Third-party assets" table: Asset, Source URL, Author, Licence, Files, Lives in)
- Test: `tests/test_vendor.py` (pure); `test_trees_furniture` in `tests/test_blender_pipeline.py`
- Output (data commit): `kits/trees.glb`, `kits/furniture.glb`, `manifest.json`, plus any `vendor/**/source.glb`

**Interfaces:**
- Produces:
  ```python
  # vendor.json entries
  {"slug": str, "kind": "trees|furniture|people|vehicles|construction", "url": str, "author": str, "licence": str,
   "files": ["vendor/<kind>/<slug>/source.glb"], "sha256": {"<file>": "<hex>"}, "role_map": {"<material name>": "<role>"}}
  # props.py
  def import_vendor(slug: str) -> list            # imports source.glb, applies role_map per material, drops textures, applies transforms
  def scale_to(objs, axis: str, target_m: float) -> None   # uniform scale so the extent on axis == target
  ```
  - **Trees** (8 variants): `rain_tree` (canopy 15–25 m, height 12–20 m), `coconut_palm` (height 10–20 m), `royal_palm` (12–20 m), `frangipani` (height and canopy 3–6 m), `flame_tree` (canopy 8–14 m), `oil_palm` (height 6–12 m, canopy 7–10 m), `shrub_round` and `shrub_hedge` (0.6–1.5 m).
    - They are scripted by default: a trunk plus clustered low-poly canopy lobes.
    - Aux B is the sway weight, 0 at the trunk base and rising to 1 at the canopy top.
    - Roles: `foliage` for leaves, `dark` for the trunk, and `accent` for flowers (frangipani, flame tree).
  - **Furniture** (9 variants): `lamp_single`, `lamp_double` (8–10 m pole, heads in role `light`), `bench`, `bus_shelter`, `bollard`, `bin`, `traffic_light` (lamps in role `light`), `sign_post_blank`, `railing_2m`.
  - Every variant is decorative (`decorative: True` in the spec).

- [ ] **Step 1: Write the failing tests.**
  - `test_vendor.py`: every `vendor.json` entry's files exist and match their `sha256`. Every `url` appears in `CREDITS.md`. Every `role_map` value is in `ROLES`. No file ends in `.blend`. No folder under `vendor/` is missing from `vendor.json`. With an empty `vendor.json` and no folders, the test passes.
  - `test_trees_furniture`: the Task 2 checks, plus each tree's x/z extent within its `x_range` and y within its `y_range`. The `rain_tree` canopy is within 15–25. Tree LOD0 B varies (max > 0.8, min < 0.2). Each lamp has role-`light` faces above 7 m.
- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit the code** (`feat(assets): tree and street furniture kits, vendor intake with credits check`).
- [ ] **Step 6: OWNER GATE E.** Show the scripted trees next to the reference photos of Elmina's rain trees and palms that the coordinator gathered. Offer Kenney (Nature Kit), Poly Pizza or Poly Haven alternatives for any variant that fails the quality bar or that the owner rejects. A vendor pick goes through the protocol's intake (vendor.json, CREDITS.md, `role_map`) and replaces that variant's builder with `import_vendor` plus `scale_to`. Commit the edits.
- [ ] **Step 7: Regen and data commit** (`data: tree and furniture kits`; include the `vendor/` files, `vendor.json` and `CREDITS.md` if vendor assets were taken).

### Task 7: People and vehicles (owner gate F)

**Files:**
- Modify: `tl_assets/props.py`
- Test: `test_people_vehicles` in `tests/test_blender_pipeline.py`
- Output (data commit): `kits/people.glb`, `kits/vehicles.glb`, `manifest.json`, and any vendor files

**Interfaces:**
- Produces:
  - **People** (10 variants, a static mid-stride pose):
    - `office_man`, `office_woman`, `tudung_baju_kurung`, `older_adult`, `jogger` and `cyclist` (bike included; height measured to the rider's head);
    - `parent_stroller` (the stroller is included);
    - `school_boy`, `school_girl` (baju kurung uniform with tudung) and `child`.
    - Roles: `primary` for the top, `secondary` for the bottom, `accent` for the skin, `dark` for hair and shoes.
    - Aux B is the limb code: 0.25 for the left leg and right arm, 0.75 for the right leg and left arm, 0.5 for everything else. P3 swings limbs in the vertex shader.
    - Adults are 1.6–1.8 m; `school_*` and `child` are 1.2–1.45 m.
  - **Vehicles** (9 variants, unbranded), with lengths:
    - `hatchback` (Myvi-class, 3.7–4.0 m), `city_car` (Axia-class, 3.6–3.8 m), `sedan` (4.4–4.8 m), `mpv` (4.5–4.9 m), `pickup` (5.1–5.4 m);
    - `motorcycle` (1.8–2.1 m) and `delivery_motorcycle` (rear box, 1.8–2.2 m);
    - `bus` (10.5–12.5 m) and `lorry` (7–9 m).
    - The length runs along z, with the front at +z.
    - Roles: `primary` for the body paint (per-instance colour), `glass`, `dark` for tyres, `metal` for trim, and `light` for the lamps.
    - Aux B on `light` faces is the light code: < 0.5 for a headlight (warm white), ≥ 0.5 for a tail light (red).

- [ ] **Step 1: Write the failing test.** Run the Task 2 checks, plus:
  - each person's LOD0 y max is within its variant's `y_range`;
  - each vehicle's LOD0 z extent is within its `z_range`, and the `hatchback` is within 3.7–4.0;
  - every vehicle has role-`light` faces with B < 0.5 at z > 0 and with B ≥ 0.5 at z < 0;
  - people LOD0 B takes the values {0.25, 0.5, 0.75} (±0.02).
- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement** (scripted or vendor, per the gate).
- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit the code** (`feat(assets): people and vehicle kits at true scale`).
- [ ] **Step 6: OWNER GATE F.** Check dress, ages and vehicle types against the spec §2.4 list. Make sure no brand marks are visible: no logos, grilles copied from a brand, or text on delivery boxes. Commit the edits.
- [ ] **Step 7: Regen and data commit** (`data: people and vehicle kits`).

### Task 8: Construction kit, full regeneration and README (owner gate G)

**Files:**
- Modify: `tl_assets/props.py`, `assets/blender/README.md` (the full regen recipe, conventions, budgets, the vendor intake and the owner-gate protocol pointer)
- Test: `test_construction` in `tests/test_blender_pipeline.py`
- Output (data commit): `kits/construction.glb`, and every glb plus `manifest.json` regenerated from clean

**Interfaces:**
- Produces **construction** (8 variants):
  - `tower_crane` (40–60 m tall, jib 40–50 m; keeps LOD2 for far views);
  - `mobile_crane`, `excavator`, `cement_mixer`;
  - `site_cabin`, `hoarding_6m` (a blank panel segment), `scaffold_bay`, `material_stack`.
  - Roles: `primary` (equipment yellow by palette), `metal`, `dark`, `glass`.

- [ ] **Step 1: Write the failing test.** Run the Task 2 checks, plus: the `tower_crane` y max is within 40–60, and its LOD2 has ≤ 60 tris; the `hoarding_6m` x extent is 6 ± 0.1 and it has no images.
- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit the code and README** (`feat(assets): construction kit and asset pipeline readme`).
- [ ] **Step 6: OWNER GATE G** (the construction kit only). Commit the edits.
- [ ] **Step 7: Full clean regen.** Delete `assets/blender/out/`. Then run `pnpm assets:build -- --all && pnpm assets:pack && uv run pytest assets/blender/tests -q && TL_BLENDER_TESTS=1 uv run pytest assets/blender/tests -m blender -q`. Expected: all PASS. Report the folder total (≤ 12 MB), per-file sizes, the LOD0 tris table and the wall-clock build time.
- [ ] **Step 8: Data commit** (`git add apps/web/public/city`; message `data: full city asset set regenerated from scripts`).

---

## Part B — lane `fe`

All new web files live in `apps/web/src/features/scene/three/assets/`. Tests sit next to their module.

### Task 9: Manifest types and the asset library

**Files:**
- Create: `assets/manifest.ts`, `assets/library.ts`, `apps/web/src/test/glbFixture.ts` (builds tiny uncompressed glbs in memory)
- Test: `assets/manifest.test.ts`, `assets/library.test.ts`

**Interfaces:**
- Consumes: the Task 1 manifest schema (version 1).
- Produces:
  ```ts
  export const ROLES = ["primary","secondary","accent","glass","dark","metal","foliage","light"] as const;
  export interface LodSpec { node: string; tris: number; maxM: number | null }
  export interface VariantSpec { size: [number, number, number]; lods: LodSpec[] }
  export interface AssetSpec {
    group: "archetype" | "landmark" | "kit"; file: string; bytes: number;
    repeat: "none" | "frontage"; frontage: "short" | "long";
    fit: { xz: [number, number]; y: [number, number] };
    decorative: boolean; placement: "anchor" | "obb" | "deferred" | null;
    jitter: { scale?: number; hue?: number };
    variantByGroup: Record<string, string>; palettes: Record<string, [string, string, string][]>;
    variants: Record<string, VariantSpec>;
  }
  export interface Manifest { version: 1; as_of: string; precinctGroups: [string, string][]; assets: Record<string, AssetSpec>;
    landmarks: Record<string, { anchor: [number, number] }> }
  /** Validates shape and version; drops (and reports) malformed assets instead of throwing on one bad entry. */
  export function parseManifest(json: unknown): { manifest: Manifest | null; problems: string[] };
  export const MANIFEST_URL = "/city/manifest.json";
  // library.ts
  export interface AssetLibrary {
    /** World-baked geometry of one LOD node (one primitive), shared, do not dispose. null when absent. */
    geometry(asset: string, variant: string, lod: number): THREE.BufferGeometry | null;
    has(asset: string): boolean;
    gpuBytes(): number;  // sum of attribute and index byteLength
    dispose(): void;
  }
  export function loadAssetLibrary(m: Manifest, opts?: { base?: string; assets?: string[];
    loadGlb?: (url: string) => Promise<ArrayBuffer>; signal?: AbortSignal }): Promise<AssetLibrary>;
  ```
  `loadAssetLibrary` uses `GLTFLoader` with `setMeshoptDecoder(MeshoptDecoder)` (`three/addons/libs/meshopt_decoder.module.js`) and `parse()` on each fetched buffer. It bakes each LOD node's world matrix into its geometry. It keeps `position`, `normal` and `color` only. A failed glb drops that asset with a single `console.warn` naming it; the whole load never rejects for one file. An aborted signal rejects with `AbortError` and disposes what was loaded.

- [ ] **Step 1: Write the failing tests**

`manifest.test.ts`:
- A minimal valid manifest parses with `problems: []`.
- `version: 2` gives `manifest: null`.
- An asset whose LOD0 `tris` is not a number is dropped and named in `problems`, and the others are kept.
- `null` or a string gives `manifest: null`, with no throw.
- A palette colour that isn't `#rrggbb` makes that asset a problem.

`library.test.ts` (node, with glbs from `glbFixture.ts` passed via `loadGlb`):
- `geometry("a","v",0)` exists and has `position`, `normal` and `color`.
- A node translation of (10, 0, 0) is baked: the geometry bounding box min x is 10.
- A missing LOD gives `null`.
- A `loadGlb` that rejects for one asset leaves `has()` false for that asset and true for the other, with exactly one warn.
- `gpuBytes()` equals the sum of the attribute array byte lengths.
- Aborting before resolution rejects with `AbortError` and disposes geometries (spy on `dispose`).
- `dispose()` disposes every geometry once.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/three/assets`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement** `manifest.ts`, `library.ts` and `glbFixture.ts`.
- [ ] **Step 4: Run to verify they pass** (same command; PASS).
- [ ] **Step 5: Commit** (four files plus the fixture helper; message `feat(web): city asset manifest and meshopt glb library`).

### Task 10: Footprint fitting and the city plan

**Files:**
- Create: `assets/fit.ts`, `assets/plan.ts`
- Test: `assets/fit.test.ts`, `assets/plan.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `AssetSpec` (Task 9); `LocalFrame` (`../frame`); `BuildingsLayer` (`lib/api`); building properties `id`, `archetype`, `precinct`, `height_m`, `front_deg` (Task 13; optional); landmark features (`model`, `building_id`).
- Produces:
  ```ts
  export interface Obb { cx: number; cz: number; w: number; l: number; angle: number; fill: number } // w <= l; angle = direction of the l axis from +x toward -z (radians)
  export function footprintObb(ring: [number, number][]): Obb | null;  // local xz; min-area rectangle over the convex hull
  /** Yaw about +y that turns model +z (frontage) toward a front azimuth (deg clockwise from north): θ = π − a. */
  export function yawForFront(frontDeg: number): number;
  export interface Placement { id: string; asset: string; variant: string; x: number; z: number; yaw: number;
    sx: number; sy: number; sz: number; palette: [string, string, string] }
  /** One or more instances (row units) for a footprint, or null when it cannot fit inside spec.fit. */
  export function fitArchetype(obb: Obb, spec: AssetSpec, variant: string, heightM: number, frontDeg: number | null, id: string): Placement[] | null;
  export function precinctGroupOf(precinct: string | undefined, groups: [string, string][]): string;
  export function variantFor(spec: AssetSpec, group: string, heightM: number): string;  // variantByGroup[group] ?? [default] ?? first; highrise: nearest size h
  export function paletteFor(spec: AssetSpec, group: string, id: string): [string, string, string]; // deterministic by hash01(id)
  export function hash01(id: string, salt?: string): number;  // FNV-1a -> [0, 1)
  export function jitterFor(spec: AssetSpec, id: string): { scale: number; hueShift: number }; // scale in [1 - j, 1 + j]
  // plan.ts
  export interface CityPlan { placements: Map<string, Placement[]>; /* key `${asset}/${variant}` */ extrude: Set<string>; landmarks: Placement[];
    stats: { placed: number; units: number; fallback: Record<string, number> } }
  export function planCity(layer: BuildingsLayer | null | undefined, frame: LocalFrame, m: Manifest, has: (asset: string) => boolean): CityPlan;
  ```
  `fitArchetype` rules (first decision wins):
  1. If `fill < 0.75`, return null. For `generic`, return null when `fill < 0.85`.
  2. Find the frontage axis. With `frontDeg`, it is the OBB axis most perpendicular to the front direction. Otherwise, for `repeat === "frontage"` with `l ≥ 1.8 × size.w` and `w ≥ 0.75 × size.d` (a row), it is the `l` side. Otherwise it is the side named by `spec.frontage`.
  3. With `F` = frontage length and `D` = depth: for a repeating archetype, `n = max(1, round(F / size.w))`, else `n = 1`. Then `sx = F / (n × size.w)`, `sz = D / size.d` and `sy = heightM / size.h`. If any of these is outside `fit.xz` / `fit.y`, return null.
  4. Units sit at equal steps along the frontage axis.
  5. Yaw: with `frontDeg`, `yawForFront(frontDeg)`. Otherwise use the frontage axis normal, and of the two choices pick the one with `hash01(id, "front") < 0.5`. This is deterministic and recorded as unknown.
  6. Each unit's palette is `paletteFor(spec, group, `${id}#${i}`)`, so the houses in a row differ.

  `planCity`:
  - A building goes to `extrude` when its archetype is missing, is `generic` with a fill below 0.85, has no asset (`!has(asset)`), or fails `fitArchetype`. `stats.fallback` counts each reason.
  - A building that is a landmark's `building_id` is excluded from both placements and `extrude`, but only when that landmark is placed.
  - A landmark is placed only when the layer has a landmark feature with that `model`, the manifest asset exists, and its `placement` is not `"deferred"` and is either `"anchor"` (position = `frame.toLocal(anchor)`, yaw 0, scale 1) or `"obb"` (fitted to the feature's OBB with `fit` (0.5, 2)).

- [ ] **Step 1: Write the failing tests**

`fit.test.ts` (the spec is the `link_intermediate` row from the Task 1 table, `repeat: "frontage"`, fit xz (0.75, 1.35), y (0.6, 1.6)):
- `footprintObb` of a 6.4 × 15.5 rectangle rotated 30° gives w 6.4 ± 0.01, l 15.5 ± 0.01, fill ≈ 1, and the angle maps to 30° (mod 180).
- The OBB of an L-shape has fill < 0.75, and `fitArchetype` returns null (Review Focus 1).
- A single 6.4 × 15.5 footprint at `heightM` 8.5 gives one placement with sx = sz = sy = 1.
- A 64 × 15.5 row gives 10 units with sx = 1, centred at equal 6.4 m steps.
- A 20 × 15.5 footprint (a ragged row) gives 3 units with sx ≈ 1.04.
- A 6.4 × 40 footprint (sz 2.6) gives null.
- `heightM` 30 (sy 3.5) gives null.
- `yawForFront(180) === 0`. `yawForFront(0) ≈ π`. `yawForFront(90)` turns +z to +x: `R(yaw)·(0,0,1) ≈ (1,0,0)`.
- With `frontDeg` null, the same id gives the same yaw on every call.
- `precinctGroupOf("Elmina Valley 1", groups) === "valley"`; `undefined` gives `"default"`.
- `paletteFor` is deterministic and returns entries from the group list, falling back to `default` when the group has no palettes.
- `variantFor(highrise, "default", 95) === "tall"` and `(…, 45) === "mid"`.
- For a people spec with jitter scale 0.03 and variant y_range (1.6, 1.8), `jitterFor` over 1,000 ids keeps 1.65 × scale within [1.6, 1.7]. For every id it keeps the scale within [0.97, 1.03] (Review Focus 5).

`plan.test.ts` (3 to 6 synthetic buildings through `frame.toLonLat`):
- A link footprint with an archetype is placed under the key `link_intermediate/gable`.
- A precinct of "Elmina Valley 2" gives variant `modern` and a valley palette.
- An archetype absent from the manifest goes to `extrude` with the fallback reason `no_asset`.
- `generic` with fill 0.9 is placed; `generic` with fill 0.7 is extruded.
- A building with no archetype property is extruded.
- A `lakeside_mall` landmark feature with `building_id` b1 gives one landmark placement at `toLocal(anchor)`, and b1 is in neither placements nor `extrude`.
- A `kanopi` landmark feature with placement `"deferred"` gives no landmark, and its building stays in the normal flow.
- No landmark features means no landmarks (Global Constraints: never invent a footprint).
- An empty or null layer gives an empty plan, with no throw.

- [ ] **Step 2: Run to verify they fail** (`pnpm --filter @tl/web exec vitest run src/features/scene/three/assets/fit.test.ts src/features/scene/three/assets/plan.test.ts`) → FAIL.
- [ ] **Step 3: Implement.** Rings come from `toBuildings` (`../../cesium/stylised/model`) through `frame.toLocal`. Use rotating calipers over a monotone-chain hull for the OBB.
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit** (four files; message `feat(web): fit archetypes to footprints and plan the instanced city`).

### Task 11: Role material and the instanced city

**Files:**
- Create: `assets/roleMaterial.ts`, `assets/cityInstances.ts`
- Test: `assets/roleMaterial.test.ts`, `assets/cityInstances.test.ts`

**Interfaces:**
- Consumes: `AssetLibrary` (Task 9), `CityPlan`, `Placement` (Task 10).
- Produces:
  ```ts
  export interface RoleUniforms { uWindowGlow: { value: number }; uLitShare: { value: number }; uLightGlow: { value: number }; uAoStrength: { value: number } }
  export const FIXED_ROLE_COLOURS: Record<"glass" | "dark" | "metal" | "foliage" | "light", string>;
  /** MeshStandardMaterial whose base colour comes from COLOR_0.g (role) × AO (COLOR_0.r), with palette from
   * instance attributes iPal0..2 (instanced) or uniforms uPal0..2 (single mesh). Glass glows by uWindowGlow when COLOR_0.b < uLitShare;
   * role light glows by uLightGlow. Shared uniforms let P3 drive glow from the time of day. */
  export function createRoleMaterial(opts: { instanced: boolean; uniforms: RoleUniforms; palette?: [string, string, string] }): THREE.MeshStandardMaterial;
  export function createRoleUniforms(): RoleUniforms; // glow 0, litShare 0.6, lightGlow 0, aoStrength 1
  // cityInstances.ts
  export type LodBucket = 0 | 1 | 2 | -1;  // -1 = hidden (beyond the last maxM)
  /** LOD for a distance with hysteresis: switching outward needs d > maxM × (1 + h), inward d < maxM × (1 − h). */
  export function lodFor(d: number, lods: { maxM: number | null }[], prev: LodBucket | undefined, h?: number): LodBucket;
  export interface CityInstances {
    group: THREE.Group;
    /** Re-bucket by camera position; rebuilds only the InstancedMeshes whose membership changed. Returns how many it rebuilt. */
    update(camera: THREE.Vector3): number;
    stats(): { instances: number; meshes: number; visibleMeshes: number; gpuBytes: number };
    dispose(): void;
  }
  export function createCityInstances(lib: AssetLibrary, plan: CityPlan, m: Manifest, uniforms: RoleUniforms): CityInstances;
  ```
  - There is one `InstancedMesh` per (asset, variant, LOD), created with capacity = the placement count for that key. Membership is updated by rewriting `instanceMatrix` and the `iPal0..2` instanced attributes for the members, then setting `count`. A mesh with `count === 0` is `visible = false`.
  - Archetype meshes `castShadow` and `receiveShadow` at every LOD. Kits cast shadows at LOD0 only.
  - Landmarks are single meshes using `createRoleMaterial({instanced: false, palette})`, with `userData.pick = { kind: "landmark", id }`.
  - Every mesh from an asset with `decorative: true` gets `raycast = () => {}` and `userData.decorative = true`. Archetype instances get `userData.pick = { kind: "building" }`, and the instance id maps to the placement id through `userData.ids`. P3 builds the pick card on that.

- [ ] **Step 1: Write the failing tests**

`roleMaterial.test.ts`:
- Call `material.onBeforeCompile` on a shader stub built from `THREE.ShaderLib.standard` (vertex and fragment source, empty uniforms), with `instanced: true`. The vertex source then declares `attribute vec3 iPal0`, and the fragment source no longer contains the untouched `#include <color_fragment>`.
- The stub's uniforms then include `uWindowGlow`, `uLitShare`, `uLightGlow` and `uAoStrength`, sharing the same objects as `createRoleUniforms()` (so mutating one is seen by every material).
- With `instanced: false`, the shader uses uniforms `uPal0..2` and no instanced palette attributes.
- `material.vertexColors === true`.

`cityInstances.test.ts` (a fake `AssetLibrary` returning small box geometries, and a plan of 10 placements on one key, laid out along +x every 200 m):
- `lodFor(299, L, undefined) === 0`. `lodFor(320, L, 0) === 0` (hysteresis). `lodFor(331, L, 0) === 1`. `lodFor(280, L, 1) === 1`. `lodFor(269, L, 1) === 0`. `lodFor(5000, L, 1) === 2`. For a kit with lods `[80, 300]`, `lodFor(400, …) === -1` (Review Focus 4).
- With the camera at the origin: the LOD0 mesh count is 2 (0 m and 200 m), LOD1 has the 400–1400 m instances, and LOD2 the rest. The counts sum to 10.
- Calling `update` twice with the same camera rebuilds 0 the second time. Moving the camera by 1 m rebuilds 0.
- Instance palette attributes match each placement's palette (read back from `iPal0`).
- `meshes === 3`, and `visibleMeshes` equals the non-empty buckets.
- Raycasting a decorative kit mesh returns no hits. Raycasting the archetype mesh hits, and `userData.ids[instanceId]` is the placement id.
- A plan with a landmark adds one mesh with `userData.pick.kind === "landmark"`.
- `gpuBytes` includes the instance attribute buffers.
- `dispose()` disposes every InstancedMesh and material, and leaves the shared library geometries alone (that's the library's job).

- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement.** Store the role colours as linear sRGB (`Color.convertSRGBToLinear`). Read the role as `floor(vColor.g * 7.0 + 0.5)`. `FIXED_ROLE_COLOURS` start as glass `#6f8aa0`, dark `#2b2d31`, metal `#9aa1a8`, foliage `#5f8f4e` and light `#fff1c9`; the owner tunes them in P3.
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit** (four files; message `feat(web): role material and LOD-bucketed instanced city`).

### Task 12: Engine integration, showroom and the 3D smoke test

**Files:**
- Modify:
  - `three/engine.ts` (`setAssets`, LOD update on camera move, triangle stats);
  - `three/cityMesh.ts` (`buildCityGeometry(layer, frame, opts?: { only?: Set<string> })`: when `only` is given, extrude only those ids);
  - `three/ThreeScene.tsx` (manifest, library, plan and DOM contract);
  - `three/ThreeScene.dom.test.tsx`, `three/cityMesh.test.ts`, `apps/web/e2e/three.spec.ts`, `apps/web/README.md`.
- Create: `assets/showroom.ts` (`showroomPlan(m: Manifest, centre: [number, number]): CityPlan`), `assets/showroom.test.ts`

**Interfaces:**
- Consumes: Tasks 9–11; the `Engine` from Phase 0 (`engine.ts`).
- Produces:
  ```ts
  // Engine additions
  setAssets(a: CityInstances | null): void;   // replaces and disposes the previous; null removes
  // FrameInfo gains: tris: number
  ```
  - `ThreeScene` flow: fetch `MANIFEST_URL`, then `parseManifest`, then `loadAssetLibrary` (with an `AbortController` aborted on unmount), then `planCity`, then `engine.setCity(buildCityGeometry(layer, frame, { only: plan.extrude }))`, then `engine.setAssets(createCityInstances(...))`.
  - Until the assets are ready (and whenever they fail), the full extruded city is shown, so there are never holes.
  - `?assets=0` skips the assets.
  - `?showroom=1` replaces the plan with `showroomPlan`: every asset variant at LOD0, in rows 30 m apart, centred on `HERO_CENTRE`, for owner review.
  - The engine calls `assets.update(camera.position)` from `tick` at most every 250 ms while the camera moves, plus once after it stops.
  - `usePerfStats` gains `tris` and `gpuMB`.
  - DOM contract additions on the section: `data-assets="off|loading|ready|failed"` and `data-instances={n}`.

- [ ] **Step 1: Write the failing tests**
  - `cityMesh.test.ts`: `only: new Set(["b1"])` with two buildings gives only b1's 30 vertices. `only` undefined keeps today's behaviour.
  - `showroom.test.ts`: every manifest asset variant appears exactly once at LOD0, the positions are 30 m apart, and decorative kits stay decorative.
  - `ThreeScene.dom.test.tsx` uses the fake engine and mocks `fetch` for `/city/manifest.json` and the glbs (via `glbFixture.ts`):
    - `assets load → setCity called with an extrusion of only plan.extrude, then setAssets once, data-assets="ready"`.
    - `manifest 404 → data-assets="failed", setCity with the full city, setAssets never called, one console.warn` (Review Focus 2).
    - `malformed manifest → same as 404`.
    - `unmount while glbs are pending → setAssets never called after dispose, and library geometries disposed` (Review Focus 3).
    - `?assets=0 → data-assets="off", no manifest fetch`.
    - `data-instances equals the placed unit count`.
- [ ] **Step 2: Run to verify they fail** (`pnpm --filter @tl/web exec vitest run src/features/scene/three`) → FAIL.
- [ ] **Step 3: Implement.** Count the engine's `tris` from `renderer.info.render.triangles`, accumulated over the frame like `calls`.
- [ ] **Step 4: Run to verify they pass**, then `pnpm --filter @tl/web typecheck && pnpm --filter @tl/web build`. Expected: PASS. The build copies `public/city/` into `dist/city/`; check with `ls apps/web/dist/city/manifest.json`.
- [ ] **Step 5: Extend the e2e test.** Add a test to `three.spec.ts` that stubs `/api/layers/buildings` with three adjacent 6.4 × 15.5 m `link_intermediate` footprints (`precinct: "Elmina Valley 2"`, `height_m: 8.5`) and serves the real `public/city/` files. It expects `data-assets` to be `"ready"`, `data-instances` to be `3`, and `data-frames` > 0. If the lane `blender` glbs aren't merged yet, mark this test `test.fixme` with a ledger note. The coordinator unfixmes it in Task 14.
- [ ] **Step 6: Run the e2e** (`pnpm --filter @tl/web exec playwright test three.spec.ts`; PASS, or the fixme is reported as such), then the full `pnpm --filter @tl/web e2e`.
- [ ] **Step 7: Commit** (the files above plus a README section, "City assets": `?assets=0`, `?showroom=1`, the perf fields; message `feat(web): instanced archetype city in the three.js engine`).

---

## Part C — lane `data`

### Task 13: Building frontage from streets

**Files:**
- Create: `data/scripts/build_frontage.py`
- Test: `data/scripts/tests/test_build_frontage.py`
- Modify: root `package.json` (`data:city`: append it after `build_archetypes.py`), `data/README.md`
- Output (data commit): `data/seed/elmina/base/buildings.geojson` (adds `front_deg`, `front_source`)

**Interfaces:**
- Consumes: `base/buildings.geojson` (with `archetype`), `base/walk.geojson` (`type` ∈ `street|major_road|pedestrian`; footways are excluded), `build_archetypes.shape_metrics` helpers.
- Produces:
  ```python
  STREET_TYPES = {"street", "major_road", "pedestrian"}
  MAX_STREET_M = 40.0
  def obb_sides(ring_xy) -> list[tuple[tuple[float, float], tuple[float, float]]]: ...  # 4 (midpoint, outward unit normal), metres
  def front_of(ring_lonlat, streets: STRtree, geoms) -> tuple[float, str] | None: ...
      # candidate sides = all four; pick the side whose midpoint is nearest a street within MAX_STREET_M, ties -> longer side;
      # returns (azimuth deg clockwise from north of that side's outward normal, "street")
  def main(argv) -> None  # --dry-run; only buildings with a non-generic archetype; idempotent
  ```
  A building with no street within 40 m gets no `front_deg` and no `front_source`. The loader treats it as unknown and never guesses a street.

- [ ] **Step 1: Write the failing tests:**
  - A 6.4 × 15.5 m footprint with a street 8 m south of its short side gives `front_deg` 180 ± 1.
  - With the street to the east of a long side, it gives 90 ± 1.
  - Streets 50 m away give `None`.
  - Footways are ignored.
  - A rotated footprint gives a rotated azimuth.
  - Running `main`'s transform twice gives identical output.
  - Generic buildings are untouched.
- [ ] **Step 2: Run to verify they fail**: `uv run pytest data/scripts/tests/test_build_frontage.py -q` → FAIL.
- [ ] **Step 3: Implement** (shapely `STRtree`, metres through `bb.M_PER_DEG`, as in `build_archetypes.py`).
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit the code** (`feat(data): building frontage azimuth from mapped streets`).
- [ ] **Step 6: Run and data-commit.** Run: `uv run python data/scripts/build_frontage.py`. Report the share of non-generic buildings that got a frontage, per precinct. Commit `data/seed/elmina/base/buildings.geojson` (`data: building frontage for archetype placement`).

---

## Integration

### Task 14: Merge, verify, and the Phase 2 owner gate

**Files:**
- Modify: `docs/superpowers/overnight-log.md`, and the ledger

- [ ] **Step 1: Merge.** On `feat/stylised-threejs`, run `git merge --no-ff lane/data`, then `lane/blender`, then `lane/fe`. The only expected conflict is root `package.json`; keep both sides. Unfixme the Task 12 e2e test if it was marked.
- [ ] **Step 2: Asset checks.** Run `uv sync --all-packages --all-groups && pnpm install`, then `uv run pytest assets/blender/tests -q`. Expected: PASS (budgets, scale ranges and the credits check on the committed glbs). Optionally, on the owner's machine with Blender closed, run `TL_BLENDER_TESTS=1 uv run pytest assets/blender/tests -m blender -q` and report it separately.
- [ ] **Step 3: CI checklist.** Run each with `set -o pipefail` and report PASS / FAIL / BLOCKED / NOT RUN, noting the mock-backed ones (golden, e2e):
  1. `pnpm lint`
  2. `uv run pytest -q`
  3. `pnpm -r --if-present typecheck`
  4. `pnpm -r --if-present test` (map keys blanked, per the local-CI memory)
  5. `pnpm gen && git diff --exit-code packages/api-client` (no API change is expected)
  6. `pnpm golden`
  7. `pnpm --filter @tl/web e2e`
- [ ] **Step 4: Browser check (coordinator).** Start `townshiplens-dev-mock` and open `/?engine=three&perf=1&bookmark=hero-mid`. Check:
  - `data-assets="ready"`, and the console is clean after a reload;
  - the hero district shows link-house rows with porches facing their streets;
  - the Lakeside Mall sits on its outline;
  - no instance overlaps an extruded fallback.

  Read `calls`, `tris` and `gpuMB` from the perf readout at `hero-near`, `hero-mid` and `township`, and compare them with the Global Constraints budgets. Open `/?engine=three&showroom=1&bookmark=hero-near` and take one screenshot per asset group for the ledger.
- [ ] **Step 5: OWNER GATE (stop and ask the owner): performance and look.**
  - On the laptop at 1440×900, the owner opens `/?engine=three&perf=1&bookmark=hero-mid` with Medium pinned, then High, and orbits for 10 s at each.
  - Record the median fps and draw calls, plus `hero-near` and `township` at Medium.
  - **Pass is ≥ 30 fps at Medium at hero-mid.**
  - If it fails, pull these levers in order and remeasure: lower LOD1 tris (rebuild that archetype), lower `LOD_MAX_M[0]` to 200 m, stop LOD2 casting shadows, and drop GTAO at Medium (the P0–1 ruling). Record each change as a ruling.
  - The owner also reviews the showroom and the `hero-near` / `hero-mid` Day screenshots next to the reference image. This is an asset check, not the §5 gate; keyframe lighting is P3. Record the notes as P3 inputs.
- [ ] **Step 6: Log and hand over.** Write an overnight-log entry (with real `date` timestamps) covering:
  - the asset table (files, sizes, LOD0 tris);
  - the fps table;
  - the fallback counts from `planCity` stats (how many footprints were extruded, and why);
  - frontage coverage;
  - vendor assets taken;
  - the open owner decisions (Kanopi and Masjid placement).

  Commit it (`docs: phase 2 assets of the three.js stylised overhaul`). Push only if the owner asks. Next comes Plan P3 (hero district).
