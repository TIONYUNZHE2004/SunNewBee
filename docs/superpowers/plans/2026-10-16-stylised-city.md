# Stylised 3D City Implementation Plan (Project 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw Elmina as a stylised low-poly city (real OSM footprints and heights, lit windows at night, bright palette by day, trees and roads) inside the existing Cesium viewer, driven by the Project 1 theme store, with routes/flood/place layers unchanged on top.

**Architecture:** A one-off Python script downloads OSM building footprints/heights/trees into committed GeoJSON; the API serves them at `GET /layers/buildings`; a new `stylised/` Cesium module (pure model + palette + effect-managed `StylisedCity`) draws extruded buildings grouped into a small number of window-density classes (one `Primitive` per class), a flat ground, roads, water and trees; `selectView`, `sceneStore.mapStyle` and a Map style control choose between Stylised and Realistic.

**Tech Stack:** Python 3.13 + uv (`data/scripts`, ruff, pytest), FastAPI 0.143, React 19.3, Cesium 1.146 / Resium 1.27, zustand 5, vitest 5, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-10-16-stylised-city-design.md` (builds on `docs/superpowers/specs/2026-10-16-frontend-redesign-two-screens-design.md`; Project 1 plan: `docs/superpowers/plans/2026-10-16-frontend-redesign-two-screens.md`).

## Global Constraints

- Branch `feat/stylised-city`, cut from the tip of `feat/redesign-two-screens`. Commit per task with explicit `git add <paths>`; Conventional messages (`data: ...` for regenerated data, committed separately from code); end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01VM1udC8anuaV2mPTobj2Zi`. **Do not push.**
- Licence: building data only from OSM (ODbL; attribution already in `site.json` and the footer). **Never derive heights or hydrology from Google 3D tiles** (display only). `height_source` marks inferred heights. Dependencies: only MIT/Apache-2.0/BSD; **add none** (Cesium, Resium already present).
- Honesty: the stylised city is display only; no fact is computed from it; no building is coloured "safe"/flooded; decorative props (trees, cars) are illustrative: `aria-hidden`, never pickable; Settings says "Decorative details are illustrative."; views are named **Stylised** and **Realistic photos (Google)**.
- Overpass is a shared public service: use `data/scripts/overpass.py` (cache in `data/cache/`, tiled sequential requests, backoff); this plan fetches once with `--max-requests 40`; never loop re-fetches.
- Cesium runs with `requestRenderMode`: every scene change calls `viewer.scene.requestRender()`. Stylised makes no billable tile loads (`baseLayer: false`, no Ion imagery). Tests use the tiny fixture; no network in tests.
- Cost: `LLM_PROVIDER=mock` always; Realistic/Google comparison loads at most 2 times in total (log it).
- e2e and golden use the tiny fixture (no buildings) and must stay unchanged: `GET /layers/buildings` is 404 there and the web app then keeps the existing view selection.
- Verify with `set -o pipefail`; report PASS / FAIL / BLOCKED / NOT RUN; say when mock-backed. Windows host: Git Bash/PowerShell; `uv sync --all-packages --all-groups` (never plain `uv sync --all-groups`).
- Rulings go in the ledger as `Ruling: what — why — cost if wrong`.

## Review Focus

1. A building polygon that is invalid (fewer than 3 points, zero area, self-touching) or has no height tags must never crash the data build or the renderer (Task 1, 2).
2. The API must return 404 (not 500) when the seed has no buildings, and the web app must then fall back silently to today's behaviour (Task 4, 7).
3. Theme toggle while the city is still loading/creating primitives must not throw or leave primitives of the old palette (Task 6).
4. Unmount / style switch must remove every primitive and restore the Google tileset and globe state (Task 6, 7).
5. Without WebGL or without buildings data the Stylised option must be absent/disabled with a reason, not silently broken (Task 7).
6. Decorative props must not be reachable by assistive tech or picking (Task 7).

---

## File Structure

```
data/scripts/build_buildings.py                         new: Overpass -> buildings.geojson / trees.geojson
data/scripts/tests/test_build_buildings.py              new
data/seed/elmina/base/{buildings,trees}.geojson         new (committed data, Task 3)
data/seed/elmina/site.json                              + "buildings" key (Task 3)
data/README.md                                          + buildings section
apps/api/src/townshiplens_api/routes/core.py            + GET /layers/buildings
apps/api/src/townshiplens_api/state.py                  + data_dir()
apps/api/tests/test_buildings_api.py                    new
packages/api-client/*                                   regenerated (pnpm gen)
apps/web/src/features/scene/cesium/stylised/{palette.ts,model.ts,StylisedCity.tsx,ground.ts,props.ts}  new (+ tests)
apps/web/src/features/scene/{selectView.ts,sceneStore.ts}  modified
apps/web/src/features/map-ui/SettingsPopover.tsx        + Map style radiogroup
apps/web/src/features/scene/cesium/CesiumScene.tsx      mounts StylisedCity / hides tiles
apps/web/src/lib/api.ts                                 + useBuildings()
```

---

### Task 1: Palette and render model (pure TypeScript)

**Files:** Create `apps/web/src/features/scene/cesium/stylised/palette.ts`, `model.ts`, `palette.test.ts`, `model.test.ts`.

**Interfaces — Produces:**
```ts
export type Theme = "day" | "night"; // re-export from ui/theme
export interface Palette { ground:string; road:string; water:string; sky:string; fog:number; tree:[string,string]; wall:{warm:string;cool:string;rose:string}; roof:{warm:string;cool:string;rose:string}; windowLit:[string,string]; windowDark:string; sun:{dir:[number,number,number]; color:string; intensity:number}; ambient:number }
export const paletteFor: (t: Theme) => Palette;
export interface Building { id:string; ring:[number,number][]; height:number; minHeight:number; kind:string; tone:"warm"|"cool"|"rose"; floors:number; perimeterM:number; cols:number; litSeed:number }
export function toBuildings(fc: unknown): { buildings: Building[]; skipped: number };
export function classKey(b: Building): string;            // `${floorsBin}x${colsBin}`
export function groupByClass(bs: Building[]): Map<string, Building[]>;
export const FLOOR_M = 3.2; export const COL_M = 3.5;
export function hashUnit(id: string, salt?: string): number; // deterministic 0..1
export function treesToPoints(fc: unknown): { id:string; lon:number; lat:number; h:number }[];
export function scatterTrees(parks: [number,number][][], seed: string, perHa: number): { lon:number; lat:number; h:number }[];
```
Rules: `toBuildings` skips (and counts) features that are not Polygon, have < 3 distinct points, or non-finite numbers; ring is the outer ring only; `height` from `properties.height_m` (finite > 0) else 9; `minHeight` from `min_height_m` (clamped to < height); `floors = clamp(round(height/FLOOR_M),1,40)`; `perimeterM` by equirectangular metres; `cols = clamp(round(perimeterM/COL_M),4,128)`; `tone` = `warm|cool|rose` by `hashUnit(id,"tone")` (< .45 warm, < .8 cool, else rose); `litSeed = hashUnit(id,"lit")`. `classKey` bins floors to `[1,2,3,4,6,8,12,16,24,40]` and cols to `[8,12,16,24,32,48,64,128]` (smallest bin >= value). `hashUnit` = FNV-1a 32-bit of `${salt}:${id}` divided by 2^32 (no `Math.random`).

- [ ] **Step 1: Failing tests** `model.test.ts` and `palette.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classKey, groupByClass, hashUnit, toBuildings } from "./model";

const sq = (x: number, y: number, d = 0.0003) => [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]];
const f = (id: string, coords: unknown, props: Record<string, unknown> = {}) => ({
  type: "Feature", geometry: { type: "Polygon", coordinates: coords }, properties: { id, ...props },
});

describe("toBuildings", () => {
  it("parses height, floors, perimeter and is deterministic", () => {
    const fc = { features: [f("b1", sq(101.5, 3.18), { height_m: 12.8 })] };
    const a = toBuildings(fc).buildings[0]!;
    const b = toBuildings(fc).buildings[0]!;
    expect(a).toEqual(b);
    expect(a.height).toBe(12.8);
    expect(a.floors).toBe(4);
    expect(a.perimeterM).toBeGreaterThan(100);
    expect(a.cols).toBeGreaterThanOrEqual(4);
  });
  it("skips and counts invalid features instead of throwing", () => {
    const fc = { features: [
      f("p", [[[101.5, 3.18], [101.5, 3.18], [101.5, 3.18]]]),
      { type: "Feature", geometry: { type: "Point", coordinates: [101.5, 3.18] }, properties: { id: "pt" } },
      f("nan", [[[Number.NaN, 3.18], [101.5, 3.18], [101.5, 3.19], [Number.NaN, 3.18]]]),
      f("ok", sq(101.5, 3.18)),
      null,
    ] };
    const r = toBuildings(fc as never);
    expect(r.buildings.map((b) => b.id)).toEqual(["ok"]);
    expect(r.skipped).toBe(4);
    expect(toBuildings(null).buildings).toEqual([]);
  });
  it("defaults a missing/invalid height and clamps minHeight below height", () => {
    const r = toBuildings({ features: [f("a", sq(101.5, 3.18)), f("b", sq(101.5, 3.18), { height_m: -3, min_height_m: 99 })] });
    expect(r.buildings[0]!.height).toBe(9);
    expect(r.buildings[1]!.height).toBe(9);
    expect(r.buildings[1]!.minHeight).toBeLessThan(r.buildings[1]!.height);
  });
});

describe("grouping and hashing", () => {
  it("hashUnit is stable, in [0,1) and salt-sensitive", () => {
    expect(hashUnit("x")).toBe(hashUnit("x"));
    expect(hashUnit("x", "a")).not.toBe(hashUnit("x", "b"));
    for (const id of ["a", "b", "c", "building-123"]) { const u = hashUnit(id); expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThan(1); }
  });
  it("classKey bins up and groupByClass keeps every building once", () => {
    const bs = toBuildings({ features: [f("a", sq(101.5, 3.18), { height_m: 6 }), f("b", sq(101.51, 3.18), { height_m: 40 })] }).buildings;
    const g = groupByClass(bs);
    expect([...g.values()].flat().length).toBe(2);
    expect(classKey(bs[0]!)).not.toBe(classKey(bs[1]!));
  });
});
```
`palette.test.ts`: `paletteFor("night").sky` is darker than day (compare relative luminance via a helper), day/night differ on `ground`, `windowLit` has 2 colours, ambient night < day, every colour matches `/^#[0-9a-f]{6}$/i`, WCAG contrast between `windowLit[0]` and night wall `warm` >= 3.

- [ ] **Step 2: Run** `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/stylised` — expect FAIL (modules missing).
- [ ] **Step 3: Implement** `palette.ts` (night: ground `#1a1430`, road `#2a2147`, water `#2c3f78`, sky `#1f1838`, walls warm `#4a3b82` cool `#4f4590` rose `#6a4377`, roofs `#8c76c6` `#a98bd0` `#d98ca8`, windowLit `#f6be64` `#fdf0ea`, windowDark `#0c081e`, tree `#2f8c7e`/`#1d5a5f`, sun dir low and cool, ambient 0.35; day: ground `#e8dccf`, road `#9a8fb0`, water `#7fb0ec`, sky `#9bc4e8`, walls warm `#e9c9a8` cool `#c9c4ea` rose `#f0b8c4`, roofs `#c08a6a` `#8f86c4` `#d9788f`, windowLit `#fff3c4` `#cfe7ff`, windowDark `#5a5280`, tree `#5fb88a`/`#3b8c66`, warm sun, ambient 0.8) and `model.ts` per the rules above (`scatterTrees` = seeded scatter inside each park ring bounding box using `hashUnit`, accept points inside the ring by ray casting, at most `perHa` per hectare).
- [ ] **Step 4: Run tests + `pnpm --filter @tl/web typecheck` + biome (`pnpm exec biome check --write <files>`), expect PASS.**
- [ ] **Step 5: Commit** `feat(web): stylised city palette and render model`.

---

### Task 2: Buildings data script (Python, stubbed Overpass)

**Files:** Create `data/scripts/build_buildings.py`, `data/scripts/tests/test_build_buildings.py`.

**Interfaces — Produces:** `bbox_around(lon, lat, radius_m) -> (s, w, n, e)`; `tiles(bbox, step_deg) -> list[tuple]`; `query_for(tile) -> str`; `infer_height(tags, id) -> tuple[float, str, float]` (height_m, source, min_height_m); `kind_of(tags) -> str`; `simplify_ring(coords) -> list[list[float]] | None`; `build_features(elements) -> tuple[list[dict], list[dict], dict]` (buildings, trees, stats); `main(argv)` writing `data/seed/elmina/base/buildings.geojson`, `trees.geojson` and updating `site.json` `buildings` key; `MAX_BYTES = 6_000_000`; `--max-requests`, `--radius-m` (default 3500), `--step` (default 0.02), `--dry-run`.

Rules: `kind_of`: `building` value or amenity/shop mapped to `residential | commercial | industrial | civic | other`. `infer_height`: `height` tag (parse `12`, `12 m`, `12.5`), else `building:levels` x 3.2, else deterministic default by kind from `sha1(id)` (residential 7-12, commercial 12-30, industrial 8-14, civic 10-18, other 6-10), sources `osm_height | osm_levels | default`; `min_height` from `min_height` tag (else 0, clamped below height). `simplify_ring`: drop closing duplicate, drop duplicate and collinear vertices (cross product < 1e-12), round to 6 d.p., return None when fewer than 3 vertices or planar area below 4 m². Only closed `way` elements with `geometry` are used (relations/multipolygons are counted in `stats["skipped_relations"]` when seen). Trees from `node[natural=tree]`. Dedupe by OSM id. Output properties: `{id, height_m, min_height_m, kind, name?, height_source}` where `id = "w<osm id>"`. Size guard: after serialising, if the file exceeds `MAX_BYTES` exit code 3 with a message to lower `--radius-m`. Output JSON compact (`separators=(",", ":")`, no indent) with a trailing newline.

- [ ] **Step 1: Failing tests** `test_build_buildings.py`:

```python
import json
import pytest

from data.scripts import build_buildings as bb


def way(i, pts, **tags):
    return {"type": "way", "id": i, "tags": tags, "geometry": [{"lon": x, "lat": y} for x, y in pts]}


SQ = [(101.5, 3.18), (101.5003, 3.18), (101.5003, 3.1803), (101.5, 3.1803), (101.5, 3.18)]


def test_bbox_and_tiles_cover_the_area():
    s, w, n, e = bb.bbox_around(101.5099, 3.1813, 3500)
    assert s < 3.1813 < n and w < 101.5099 < e
    ts = bb.tiles((s, w, n, e), 0.02)
    assert 9 <= len(ts) <= 25
    assert min(t[0] for t in ts) <= s and max(t[2] for t in ts) >= n


def test_height_rules_and_determinism():
    assert bb.infer_height({"height": "12.5 m"}, "w1")[:2] == (12.5, "osm_height")
    assert bb.infer_height({"building:levels": "4"}, "w1")[:2] == (12.8, "osm_levels")
    h, src, mn = bb.infer_height({"building": "retail"}, "w1")
    assert src == "default" and 6 <= h <= 30 and mn == 0
    assert bb.infer_height({"building": "retail"}, "w1") == bb.infer_height({"building": "retail"}, "w1")
    assert bb.infer_height({"height": "-3", "min_height": "99"}, "w2")[2] < bb.infer_height({"height": "-3"}, "w2")[0]


def test_kind_of():
    assert bb.kind_of({"building": "apartments"}) == "residential"
    assert bb.kind_of({"building": "yes", "shop": "mall"}) == "commercial"
    assert bb.kind_of({"building": "warehouse"}) == "industrial"
    assert bb.kind_of({"building": "school"}) == "civic"
    assert bb.kind_of({"building": "yes"}) == "other"


def test_simplify_ring_drops_degenerate_and_collinear():
    ring = [[101.5, 3.18], [101.5001, 3.18], [101.5003, 3.18], [101.5003, 3.1803], [101.5, 3.1803], [101.5, 3.18]]
    out = bb.simplify_ring(ring)
    assert out is not None and len(out) == 5 and out[0] == out[-1]  # closed, collinear vertex removed
    assert bb.simplify_ring([[101.5, 3.18], [101.5, 3.18], [101.5, 3.18]]) is None
    assert bb.simplify_ring([[101.5, 3.18], [101.50001, 3.18], [101.50001, 3.180001], [101.5, 3.180001], [101.5, 3.18]]) is None  # < 4 m2


def test_build_features_dedupes_skips_and_counts():
    els = [
        way(1, SQ, building="yes", name="Block C"),
        way(1, SQ, building="yes"),                     # duplicate id
        way(2, SQ[:2], building="yes"),                 # not a polygon
        {"type": "relation", "id": 9, "tags": {"building": "yes"}},
        {"type": "node", "id": 5, "lat": 3.181, "lon": 101.501, "tags": {"natural": "tree"}},
    ]
    b, t, stats = bb.build_features(els)
    assert [x["properties"]["id"] for x in b] == ["w1"]
    assert b[0]["properties"]["name"] == "Block C" and b[0]["geometry"]["type"] == "Polygon"
    assert len(t) == 1 and t[0]["geometry"]["coordinates"] == [101.501, 3.181]
    assert stats["skipped_relations"] == 1 and stats["skipped_invalid"] == 1


def test_main_dry_run_makes_no_request_and_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(bb, "OUT", tmp_path)
    (tmp_path / "site.json").write_text(json.dumps({"scene": {"home": {"lon": 101.5099, "lat": 3.1813}}}))
    with pytest.raises(SystemExit) as e:
        bb.main(["--dry-run"])
    assert e.value.code == 0
    assert not (tmp_path / "base" / "buildings.geojson").exists()


def test_size_guard(tmp_path, monkeypatch):
    monkeypatch.setattr(bb, "OUT", tmp_path)
    monkeypatch.setattr(bb, "MAX_BYTES", 10)
    monkeypatch.setattr(bb, "fetch_all", lambda *a, **k: [way(1, SQ, building="yes")])
    (tmp_path / "site.json").write_text(json.dumps({"scene": {"home": {"lon": 101.5099, "lat": 3.1813}}}))
    with pytest.raises(SystemExit) as e:
        bb.main([])
    assert e.value.code == 3
```
- [ ] **Step 2: Run** `uv run pytest data/scripts/tests/test_build_buildings.py -q` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `build_buildings.py` (imports `from data.scripts import overpass` like the sibling scripts; `fetch_all(bbox, step, max_requests)` loops `overpass.query(query_for(tile))` for each tile and returns the concatenated `elements`; `OUT = Path(__file__).resolve().parents[1] / "seed" / "elmina"`; `main` reads `site.json`'s `scene.home` for the centre, BLOCKED exit code 2 on `overpass.OverpassError` like `import_osm.py`, writes `base/buildings.geojson`, `base/trees.geojson`, adds `"buildings": {"file":"base/buildings.geojson","trees":"base/trees.geojson","radius_m":..,"count":..,"as_of":"<today>"}` to `site.json` preserving its formatting style (`json.dumps(..., ensure_ascii=False, indent=2) + "\n"`)).
- [ ] **Step 4: Run tests, `uv run ruff check --fix data/scripts && uv run ruff format data/scripts`, expect PASS.**
- [ ] **Step 5: Commit** `feat(data): OSM buildings and trees import script`.

---

### Task 3: Fetch and commit the real buildings seed (network, budgeted)

**Files:** Modify `data/seed/elmina/site.json`; create `data/seed/elmina/base/buildings.geojson`, `trees.geojson`; modify `data/README.md`.

- [ ] **Step 1: Dry run.** `uv run python data/scripts/build_buildings.py --dry-run` — prints bbox, tiles, expected request count (<= 25).
- [ ] **Step 2: Fetch (shared service, polite).** `uv run python data/scripts/build_buildings.py --max-requests 40`. If it exits 2 (BLOCKED) wait and retry once with `--endpoint https://overpass.kumi.systems/api/interpreter`; if still blocked, ledger `BLOCKED: overpass` and continue Tasks 4-7 against a synthetic fixture (Task 5 builds one), leaving this task `BLOCKED`. If it exits 3 (size), re-run with `--radius-m 3000`, then `2500` (cache hits are free).
- [ ] **Step 3: Sanity check** with a short Python/jq summary: count, share by `height_source`, min/max height, bbox extents, file size. Ledger these numbers. Spot-check that the Lakeside Mall footprint exists (name match) and that no height exceeds 200 m or is NaN.
- [ ] **Step 4: README.** Add a "Buildings (display only)" section to `data/README.md`: source, licence (ODbL), `height_source` meanings, radius, how to rebuild, that relations/multipolygons are skipped with the count, and that nothing in routing/flood uses it.
- [ ] **Step 5: Commit data separately:** `git add data/seed/elmina/base/buildings.geojson data/seed/elmina/base/trees.geojson data/seed/elmina/site.json` then `git commit -m "data: OSM buildings and trees for the stylised city"`; commit the README as `docs(data): describe the buildings seed`.

---

### Task 4: API `GET /layers/buildings`

**Files:** Modify `apps/api/src/townshiplens_api/state.py`, `routes/core.py`; create `apps/api/tests/test_buildings_api.py`; regenerate `packages/api-client/*`; modify `apps/web/src/lib/api.ts`.

**Interfaces — Produces:** `state.data_dir() -> Path` (the dir `get_ctx` loads: `tl_data_dir` if it has `site.json`, else the tiny fixture); `GET /layers/buildings` -> `{"buildings": FeatureCollection, "trees": FeatureCollection, "as_of": str | None, "attribution": list[str]}` with `ETag` + `Cache-Control` like other layers; `404` when `base/buildings.geojson` is absent; in-memory cache keyed by file mtime. Declared **before** `/layers/{lens}`. Web: `useBuildings()` = `useQuery(["buildings"], ...)` returning `null` on 404 (never throwing for 404), `staleTime: Infinity`.

- [ ] **Step 1: Failing tests** `test_buildings_api.py` (use `monkeypatch.setenv("TL_DATA_DIR", ...)` and reset `state._ctx = None` as other API tests do — read `conftest.py`): (a) with a tmp copy of the tiny fixture plus a 2-feature `base/buildings.geojson` and `trees.geojson`, `GET /layers/buildings` returns 200 with both collections and a conditional `If-None-Match` request returns 304; (b) with the plain tiny fixture it returns 404 and `GET /layers/access` still works; (c) a corrupt `buildings.geojson` returns 404 or 502-style JSON error without a 500 stack (assert `status_code in (404, 502)`), never an unhandled exception.
- [ ] **Step 2: Run** `uv run pytest apps/api/tests/test_buildings_api.py -q` — FAIL.
- [ ] **Step 3: Implement** route + `state.data_dir()`; keep it dependency-free (stdlib `json`).
- [ ] **Step 4:** `pnpm gen`, then `git diff --stat packages/api-client` shows the new path/schema; add `useBuildings` and a vitest in `apps/web/src/lib` or next to it using `qc.setQueryData`/a stubbed fetch for 200 and 404.
- [ ] **Step 5: Run** `uv run pytest apps/api -q`, `pnpm gen && git diff --exit-code packages/api-client` after committing the regenerated client, `pnpm --filter @tl/web typecheck`, biome/ruff. **Commit** `feat(api): serve OSM buildings and trees for the stylised city` (client regeneration in the same commit).

---

### Task 5: Renderer spike and core buildings (ground + extruded buildings + windows)

**Files:** Create `apps/web/src/features/scene/cesium/stylised/StylisedCity.tsx`, `buildingsPrimitive.ts` (+ `buildingsPrimitive.test.ts` using fakes), `spike.md` notes in the ledger.

This task proves the window approach under a frame-time budget. Start with approach **A** and fall down the ladder only on measured failure.

- **A. Class primitives with an st-based window Material.** For each class from `groupByClass`, one `Cesium.Primitive` with `GeometryInstance`s of `Cesium.PolygonGeometry({ polygonHierarchy, height: b.minHeight, extrudedHeight: b.height, vertexFormat: Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat })` (all instances of a class share a `Cesium.MaterialAppearance({ material, materialSupport: TEXTURED, translucent: false, closed: true })`; a per-class `Material` with `fabric.uniforms { cols, floors, lit, litColorA, litColorB, wall, dark, seed }` and a `czm_getMaterial` that reads `materialInput.st`: `vec2 cell = vec2(st.s * cols, st.t * floors)`; window rect inside each cell (about 55% x 55%), hash(cell) < lit decides lit vs dark, emit lit colours via `material.emission` at Night and diffuse at Day; roof (flat top faces) detected by `abs(normalEC·up)` or by `st` degeneracy: use a second per-class primitive of roofs with `PerInstanceColorAppearance` if the top cannot be told apart). `asynchronous: true`, `releaseGeometryInstances: true`, `allowPicking: false`. **First verify in a scratch test page how Cesium 1.146 generates `st` for extruded polygon walls** (whether `s` spans the whole perimeter 0..1 and `t` the extrusion height 0..1); if `s` is per-wall instead, `cols` must be the mean per-wall column count — record the finding in the ledger.
- **B (fallback).** Same primitives, but windows from a canvas-generated texture (`Cesium.Material.fromType("Image", {image: canvas, repeat})`) per class.
- **C (fallback).** `PerInstanceColorAppearance` flat colours, floor banding via two instances per building (a darker lower band and light upper band) and an emissive-looking roof-edge outline (`Cesium.GroundPolylinePrimitive` is **not** to be used; use `PolylineGeometry` at roof level); Night then reads through roof glow only.

**Interfaces — Produces:** `buildBuildingPrimitives(Cesium, classes: Map<string, Building[]>, palette: Palette, theme: Theme): { primitives: Cesium.Primitive[]; setTheme(theme): void; destroy(): void }` where `setTheme` updates the Material uniforms / appearance colours **in place** (no geometry rebuild); `<StylisedCity />` (a Resium child using `useCesium()`) that, given `useBuildings().data` and the theme, hides `globe` imagery (`viewer.scene.globe.baseColor = palette.ground`, `viewer.scene.skyAtmosphere`, `viewer.scene.backgroundColor = palette.sky`), adds the primitives, calls `viewer.scene.requestRender()`, and cleans everything on unmount.

- [ ] **Step 1: Failing unit test** `buildingsPrimitive.test.ts` with fake `Cesium` object (like Task 15 of Project 1's `timeOfDay.test.ts`): `buildBuildingPrimitives` creates one primitive per non-empty class, `setTheme("night")` then `("day")` calls the material uniform setters and never creates new primitives, `destroy()` removes and destroys every primitive and is idempotent, an empty class map yields no primitives and no throw (Review Focus 1, 3, 4).
- [ ] **Step 2: Implement** per approach A. **Measure** (real browser, keyless dev server so no billable tiles: set the env as `playwright.config.ts` does — `$env:GOOGLE_MAPS_API_KEY=''` etc. plus `TL_DATA_DIR` pointing at a temp copy of the seed containing the real buildings file — and check the network list shows no tile.googleapis.com): time to first frame of the city, a 10 s orbit frame-time sample via `performance.now()` between `scene.postRender`, at the full building count and at 5k. Budget: first frame <= 3 s, >= 30 fps. Ledger the numbers and which approach shipped. If the budget is missed, apply in order: lower `RADIUS_M` in the data (re-run Task 3 from cache), drop roofs/second primitive, fall down the ladder.
- [ ] **Step 3: Visual check** (screenshots allowed here, they are the artifact under test): Night and Day at home range and at ~300 m street level; windows visible at <= 400 m at Night; Day not black; compare by eye with `C:\Users\shaoxian04\AppData\Local\Temp\h\townshiplens-frontend-redesign\project\uploads\pasted-1792082929712-0.png`. Save the final shots under `docs/03-product/stylised-city/` (PNG, small) for the quality report.
- [ ] **Step 4:** biome, typecheck, `pnpm --filter @tl/web test`. **Commit** `feat(web): stylised buildings with lit windows`.

---

### Task 6: Ground details (roads, water, trees, cars) and Day/Night re-skin

**Files:** Create `ground.ts`, `props.ts` (+ tests); modify `StylisedCity.tsx`.

**Interfaces — Produces:** `roadsFromWalk(layer: unknown): { id:string; coords:[number,number][]; widthM:number }[]` (width by segment `type`: `major_road` 10, `residential/service` 6, footway/path 2.5, unknown 3; drops non-LineString), `buildGround(Cesium, viewer, {roads, water, palette}): { destroy(): void; setTheme(t): void }` (roads as `Cesium.GroundPolylinePrimitive`-free `PolylineGeometry`? **use `Cesium.GroundPrimitive` with `CorridorGeometry`**, water as `GroundPrimitive` of `PolygonGeometry` from the existing hydrology polygons / `useScenarioWater` polygons), `buildProps(Cesium, {trees, cars, palette}): { destroy(): void; setTheme(t): void }` (trees as one `Primitive` of low-poly cone+sphere-ish `EllipsoidGeometry`/`CylinderGeometry` instances; cars as small box instances parked along residential kerbs at seeded positions, **static**), props `allowPicking: false`.

- [ ] **Step 1: Failing tests:** `roadsFromWalk` widths and skipped features; `buildGround`/`buildProps` with fakes: `setTheme` mutates in place, `destroy` idempotent, props never created with picking enabled; `scatterTrees` (Task 1) determinism reused for park scatter; Day/Night: toggling the theme while the buildings are still being created (call `setTheme` before `ready`) results in the final palette being the latest theme (Review Focus 3).
- [ ] **Step 2: Implement**, integrate into `StylisedCity` (one `useEffect` per layer family, each cleaning up; theme effect calls every `setTheme` and `viewer.scene.requestRender()`; a `DirectionalLight` per palette `sun` assigned to `viewer.scene.light`, restored on cleanup).
- [ ] **Step 3: Visual re-check** (Day, Night; street level; routes/flood lines/place markers from Project 1 layers still legible on top and clamped to ground — `heightReference` must be `CLAMP_TO_GROUND` when stylised: update `heightRef()` in `layers.tsx` to take the active map style). Console free of GL/shader errors.
- [ ] **Step 4:** biome, typecheck, tests. **Commit** `feat(web): stylised roads, water, trees and day/night re-skin`.

---

### Task 7: Integration — selectView, mapStyle default, Settings control, a11y/honesty

**Files:** Modify `features/scene/selectView.ts` (+ test), `sceneStore.ts` (+ test), `features/map-ui/SettingsPopover.tsx` (+ test), `features/scene/cesium/CesiumScene.tsx`, `features/map-ui/MapStage.tsx`; create `features/scene/cesium/stylised/stylised.dom.test.tsx`.

**Interfaces:** `selectView(env, webglOk, preferred?, hasBuildings?: boolean)` and `availableViews(env, webglOk, hasBuildings?)`: `cesium` is available when `webglOk && (googleKey || cesiumToken || hasBuildings)`. `useScene`: `mapStyle: "realistic" | "stylised"`, `mapStyleChosen: boolean` (set by `setMapStyle` called from the UI), and `defaultMapStyle(hasBuildings: boolean, hasGoogle: boolean): MapStyle` pure helper (`stylised` when buildings exist, else `realistic`); the default applies once buildings load unless `mapStyleChosen`. `CesiumScene`: when `mapStyle === "stylised"` and buildings exist, **do not** create the Google/OSM tileset, show the globe base colour, mount `<StylisedCity />`; when switching back, restore (globe, tileset). `SettingsPopover`: **Map style** radiogroup `Stylised` / `Realistic photos (Google)`; Stylised disabled with the reason "Needs building data" when none; Realistic disabled with "Needs a Google Maps key" when no key; plus the note "Decorative details are illustrative." when Stylised is active.

- [ ] **Step 1: Failing tests:** selectView with `hasBuildings` true/false and webgl false (list); store default-style rule and `mapStyleChosen` precedence; SettingsPopover radiogroup labels, disabled reasons, selecting writes the store; `stylised.dom.test.tsx`: with seeded `["buildings"]` cache null (404) the view stays unchanged and no Stylised option is enabled (Review Focus 2, 5); decorative props note present; no element with a `button` role / pick id is created for props (Review Focus 6).
- [ ] **Step 2: Implement.** Keep e2e unchanged: the tiny fixture has no buildings so `hasBuildings` stays false.
- [ ] **Step 3: Switch test (browser, keyless):** Stylised -> Realistic -> Stylised leaves no stale primitives (count `viewer.scene.primitives.length` via a dev-only `window.__cesiumViewer` guard? **no**; instead assert through the unit tests with fakes, and visually in the browser). Ledger.
- [ ] **Step 4:** biome, typecheck, `pnpm --filter @tl/web test`, `pnpm --filter @tl/web e2e` (must stay 9/9). **Commit** `feat(web): choose Stylised or Realistic map style`.

---

### Task 8: Quality pass, evaluator, docs, final checklist

**Files:** Create `docs/03-product/stylised-city-quality-report.md`; modify `apps/web/README.md`, `AGENTS.md` (architecture + data pipeline + honesty bullets for the stylised view), `docs/03-product/mvp-spec.md` status; append `docs/superpowers/overnight-log.md`.

- [ ] **Step 1: Real-browser pass (keyless, no billable tiles):** Lighthouse accessibility on `/` in both themes with Stylised active (target >= 95), keyboard (settings popover Map style radios), responsive 390/820/1440, console clean, frame-time sample (record numbers), Day and Night screenshots saved under `docs/03-product/stylised-city/`. **Realistic comparison:** at most 2 Google loads total (log).
- [ ] **Step 2: Independent evaluator:** spawn the `evaluator` agent against `docs/superpowers/specs/2026-10-16-stylised-city-design.md` (read-only; same keyless server rules as Project 1's evaluation), fix Critical/Major findings with tests, re-run affected checks, record the score.
- [ ] **Step 3: Docs** per the files above. Data README already updated in Task 3.
- [ ] **Step 4: Full checklist**, each result reported honestly: `pnpm lint`, `uv run pytest -q`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `pnpm gen && git diff --exit-code packages/api-client`, `pnpm golden`, `pnpm --filter @tl/web build`, `pnpm --filter @tl/web e2e`.
- [ ] **Step 5: Commit** `docs: stylised city quality report and architecture notes`. Do not push either branch.
