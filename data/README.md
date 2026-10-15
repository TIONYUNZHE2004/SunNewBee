# data

Seed data for TownshipLens (City of Elmina, Shah Alam). Contract: see `docs/04-architecture/README.md`.

## Sources and licences

| Source | Use | Licence |
|---|---|---|
| OpenStreetMap via Overpass API | walk network, places, hydrology display | ODbL, "© OpenStreetMap contributors" |
| Copernicus DEM GLO-30 | terrain for the flood lens (REM scenarios, Task 10) | Copernicus licence, © DLR/Airbus, provided under COPERNICUS by the EU and ESA |
| OSM rivers / streams / canals + lakes (same OSM licence) | drainage for the flood REM (Task 10) | ODbL |
| HAND (ASF) | comparison only (`build_flood.py --method hand`), not in the seed | CC0 |

## Licence note

`base/*.geojson` are derived from OpenStreetMap, so the ODbL share-alike applies: a publicly used derived database must be offered under ODbL and keep the attribution "© OpenStreetMap contributors".

OSM `incline` tags are sparse in Elmina, so most segments have no `incline_pct` claim. Unnamed OSM places are named like `Playground (unnamed, OSM)`; steps without `step_count` get a default of 1 with `evidence_type: osm_highway_steps_default`.

## Placeholder facts

**`seed/elmina/access/overlay.geojson` holds demo facts, not survey results.** Every claim in it carries
`evidence_type: "team_survey_placeholder"` until the field visit replaces it. Do not present them as verified in the real world.
The unknown ramp and path lengths are listed in `seed/elmina/access/README.md`.

## Rebuild

```
pnpm data:build        # import_osm.py, build_overlay.py, build_flood.py, build_waste.py. Run import before overlay: the overlay step rewrites `base/places.geojson`
```

`pnpm data:build` runs `build_flood.py` without the flags the committed seed was built with, so from the cache it attempts network lookups. To reproduce the committed seed offline, run:

```bash
uv run python data/scripts/import_osm.py --max-requests 0
uv run python data/scripts/build_overlay.py
uv run --group data python data/scripts/build_flood.py --datum-offset -3.74 --osm-water data/cache/2f7c0c51d14428009f2172835c2108ed9966ae2d.json
uv run --group data python data/scripts/build_waste.py
```

Overpass responses are cached in `data/cache/` (gitignored); delete it to refetch. Node ids (`n-<lat*1e7>_<lon*1e7>`)
are derived from coordinates because the cached `out geom` responses omit OSM node ids.

## Import (2026-10-15)

Envelope bbox (s,w,n,e) = 3.150, 101.460, 3.240, 101.530.

- ways fetched: 7036 (6631 walk + 460 major-road ways, 51 `secondary_link`s in both fetches, 4 `foot=no` dropped); walk segments: 16148, of which 909 `major_road` (`base/walk.geojson`, ~5 MB)
- places: 227 imported; 3 duplicates of hero places removed by `build_overlay.py` (`osm-way-1308938137`, `osm-way-1318133036`, `osm-way-1346154592`) -> 224 in `base/places.geojson`, plus 7 overlay places = 231 total. 210 imported places snap to a walk node within 60 m (any component). Since Task 31 the walk graph has 74 components and the largest holds 95.2% of nodes; before major roads were imported it was 199 components and 32%
- hydrology features: 204 (display only)
- overlay: 18 edges + 7 places (`park-b`, `lakeside-mall`, `playground`, `toilet-urban-park`, `bench-urban-1..3`)
- P1 416 m (via unknown ramp) vs verified detour P2 441 m

## Major roads (Task 31)

`import_osm.py` now also fetches `highway=primary|secondary|trunk` and their `_link`s (motorways stay excluded) in the 2 × 2 `ENVELOPE` tiles, with the NE tile split smaller after 504s (`major_tiles()`: 6 cached Overpass queries; rulings R22–R24). Ways tagged `foot=no` are skipped. They become walk edges of type **`major_road`**, split at shared nodes like every other way. `secondary_link`, which used to come in as `street`, is now `major_road` too (51 ways).

- **`sidewalk` claim** (`osm_import`, `reported`, raw tags in `notes`): `sidewalk`, `sidewalk:both`, `sidewalk:left`, `sidewalk:right` are normalised to `both | one_side | none | separate`. Tags that do not fix both sides (`sidewalk=yes` on its own, or one side only) give **no claim**. Nothing is guessed. Carriageway `width` and `surface` are not imported as claims on major roads.
- **Evaluation** (walking profiles). The status rules match the hard limits: reported data is never treated as verified for a hard constraint.
  - Stroller, wheelchair and older_adult_rest (`no_sidewalk_is: FAIL` in their profile yaml):
    - a **verified**, fresh `both | one_side | separate` → the normal rules apply;
    - a merely `reported` (OSM-imported) one → UNKNOWN;
    - `none`, even if only reported → FAIL.
  - Default: a fresh `reported` or `verified` sidewalk is enough; `none` → UNKNOWN.
  - Missing, contested or stale claim → UNKNOWN for every walking profile.
  - So a route over a major road is never `confirmed` without sidewalk data, and never `confirmed` for the strict profiles without a verified sidewalk.
  - `drive` allows `major_road`.
- **Rate limit:** `import_osm.py --max-requests N` hard-caps real Overpass HTTP requests (retries included; cache hits are free) and prints `BLOCKED` with the count when the cap is reached, before writing anything.
- **Endpoint:** `import_osm.py --endpoint URL` (repeatable) replaces the default mirror rotation. The next endpoint is tried only after a connection-level failure. Each fresh cache file gets a `<sha1>.meta.json` sidecar recording the endpoint and the fetch time.
- `--allow-missing-major-tiles` builds without major-road tiles that cannot be fetched and lists their bboxes in `site.json` `major_roads_missing_bbox` (`[w, s, e, n]`). **On this seed nothing is missing**, so the field is absent.

**Tile provenance (15 Oct 2026).** 18 Overpass requests in total, retries included:
- The three R22 tiles came through the default rotation, with no endpoint recorded. OSM bases: 2026-07-15, 2026-10-14 and 2026-05-06.
- NE-south `(3.195, 101.495, 3.2175, 101.53)` came through the default rotation (R23). By the rotation, that was `overpass.kumi.systems` on the 2nd attempt, after a 504 from overpass-api.de. OSM base 2026-07-24.
- NE-north-west and NE-north-east came from `overpass.kumi.systems` (R24). OSM bases 2026-07-24 and 2026-05-06.

The vintages are mixed, as they are for the walk cache. Re-running `import_osm.py` from the cache gives byte-identical `base/*.geojson` and `site.json` (checked).

**Before vs after** (stroller unless noted; measured on the rebuilt seed):

| Measure | Before (seed at 64dd224) | After (Task 31) |
|---|---|---|
| Walk graph components | 199 | 74 |
| Largest component, share of nodes | 32.0% (3,653 of 11,418) | 95.2% (11,188 of 11,752) |
| Lakeside Mall → 72 centres, baseline | 23 partly_unverified / 49 no_data | 64 partly_unverified / 8 no_data |
| Lakeside Mall → 72 centres, stage_p3m | 3 partly_unverified / 20 blocked / 49 no_data | 44 partly_unverified / 20 blocked / 8 no_data |
| Wheelchair, same (baseline / +3 m reachable) | 23 / 3 | 64 / 44 |
| Journey tests (300 tasks, 100 per profile; stroller = wheelchair = older_adult_rest) | 99 no_data, 1 success_with_unknowns | 40 no_data, 60 success_with_unknowns |
| Journey I7 (older-adult rest gap > 100 m) | 1 | 60, one per older-adult route found; rest points are sparse |
| Hero `park-b → playground` | confirmed 440.6 m; +1/+3 m partly_unverified 485.7 m | unchanged |
| `major_road` segments / km / with sidewalk claim | – | 909 / 86.7 km / 0 |
| +1 m likely / possible edges, water km² | 404 / 311, 3.24 | 445 / 345, 3.24 |
| +3 m | 1,224 / 355, 10.25 | 1,353 / 396, 10.25 |
| +5 m | 2,263 / 553, 19.06 | 2,468 / 567, 19.06 |
| Edges with no / partial flood coverage | 59 / 193 | 61 / 209 |

**No major-road segment has a `sidewalk` claim.** The OSM sidewalk tags in Elmina only describe one side (`sidewalk:left` or `sidewalk:right=separate` on 3 ways), which leaves the other side unknown. So every major road is UNKNOWN for walking. Trips that were `no_data` become `partly_unverified`, never `confirmed`. The journey-test gap ranking now includes `sidewalk`, but on this seed it is **structurally empty**. A gap counts only if one flip makes the trip `confirmed`, and major roads carry no `width_m`, `step_count` or `incline_pct` claims, so a sidewalk flip alone never makes the edge PASS. Sidewalk gaps can appear only once those attributes are surveyed.

**Segment renumbering.** 101+ existing `seg-<way>-<k>` ids now carry new geometry, because their ways are re-split at major-road junctions. None of the ids referenced in this README, `access/README.md`, `data/demo/*.jsonl`, e2e tests or golden changed. The overlay (P1/P2, ramp `seg-1306543755-2`) is identical. The 4 Elmina demo-cache entries were re-recorded with the mock.

## Flood lens (Task 10: `data/scripts/build_flood.py`)

**Indicative scenarios from a 30 m elevation model, not a forecast.** The app never gives a water depth on a path. Every scenario carries its disclaimer and the official links (JPS Public InfoBanjir, MET Malaysia). See [ADR 0010](../docs/00-overview/decisions/0010-flood-lens-hand-scenarios.md); the method changed from HAND to REM as described below.

### Method: Relative Elevation Model over OSM drainage

This replaced ASF HAND on 15 Oct 2026, by coordinator ruling.

**Why HAND was dropped.** ASF GLO-30 HAND's channel network is very dense: every gully, graded flat and pond counts as drainage, and 16% of the window had HAND ≈ 0. On the walk graph it flagged 39% of segments `likely_flooded` at +1 m. That contradicts the verified local story: Elmina's core is high, and the documented floods are downstream along Sungai Subang (Kampung Kubu Gajah / Paya Jaras). HAND remains available as a comparison (`--method hand`); write it to a scratch `--data-dir`.

**The pipeline:**

1. **DEM.** A Copernicus GLO-30 window, read as a COG via GDAL `/vsicurl/` and cached in `data/cache/*.npy`. `AREA = (101.460, 3.150, 101.560, 3.240)` (w, s, e, n): the Elmina envelope plus the downstream Sungai Subang corridor. The window is 361 × 325 cells, about 111 km².
2. **Drainage.**
   - OSM `waterway=river|stream|canal` lines, rasterised to all touched cells. Waterways tagged `tunnel=*` (culverts) are skipped: the surface model there is the road above.
   - OSM `natural=water` / `water=*` polygons count **only where they touch the channel network**. On-line lakes such as the Central Park lakes stay. Perched or off-line ponds keep their own level when the river rises; as nearest-drainage references they made fans of lower ground look "below the river".
   - Sources, in order: `--osm-water FILE…` (Overpass JSON or GeoJSON), one cached Overpass query over `AREA`, then `base/hydrology.geojson` if Overpass is down.
3. **REM.**
   - **Channel elevation** per drainage cell = the lowest DEM within a **3 × 3** window. That is the valley floor, because OSM lines sit up to one cell off the DEM's valley. It is then median-smoothed over the drainage cells in a 5 × 5 window along the channel.
   - `REM = DEM − channel elevation at the nearest drainage cell`, computed with `scipy.ndimage.distance_transform_edt(~drain, return_indices=True)`. REM is 0 on the drainage itself.
4. **Connected inundation.** A cell is wet at stage `s` when REM < `s` *and* it is 8-connected, through wet cells, to drainage. A hollow behind a ridge stays dry even when it is lower than the river; a test checks this.
   - **Connected REM** = the lowest stage at which a cell joins that water (a minimax/priority flood). It equals the wet mask at every stage (tested).
5. **Water polygons** `flood/stage_pNm.geojson`.
   - Polygonise the wet mask, simplify it (0.0002°, about 22 m) and union it with the lower stage's water, so stages nest. Clip to `AREA`, cut into 0.01° (~1.1 km) tiles, drop slivers under half a cell, and round coordinates to 5 dp.
   - **`surface_height_m` = the tile's stage-independent reference + stage.** The reference is the median channel elevation (DEM − REM) over the tile's cells that are wet at +5 m. So at any point the drawn surface rises exactly 1 m per stage (tested).
   - The heights are EGM2008 orthometric; the API adds `scene.datum_offset_m`. `baseline.geojson` is empty.
6. **Edge and place classes** (vector stage).
   - Includes the `access/overlay.geojson` edges and places, because `load_world()` applies them.
   - **Edges:** the minimum connected REM over samples every 10 m. **Places:** the value at the point.
   - Classes with margin 0.5 m: `likely_flooded` if `min < stage − 0.5`, `possible` if `< stage + 0.5`, otherwise `unlikely`.
   - **Monotonic by construction and enforced:** for each element, the class at a stage is the max over all lower stages. Only `likely_flooded` and `possible` are stored in `scenarios.json` (`method: "REM"`).
7. **Evacuation centres** `flood/evac_centres.geojson`.
   - Base places of type `community_centre | school | place_of_worship | townhall` inside `AREA` become `osm_candidate` (`evc-<place_id>`).
   - **Duplicates are dropped:** the same normalised name within 100 m, keeping the copy snapped to a walk node. On this seed:
     - Dewan Refelsia ×2: `osm-way-910422251` dropped;
     - Dewan Serbaguna Rentak Perdana ×2: `osm-way-1184185924` dropped;
     - Surau Rentak Perdana ×2: `osm-way-1184185923` dropped;
     - Al-Amin Darul Musthopa ×2: `osm-node-12041425250` dropped.

     That leaves 72 candidates.
   - **`official_pps` (with `evidence_url`) only on an exact name match** with a news-reported PPS. Today the list has one entry: "Dewan MBSA Matahari", 4 Oct 2024, [F8] RTM article.
   - **A fuzzy match (difflib ≥ 0.6) only adds a note** containing the article URL; it never sets `evidence_url`.
   - On this seed there is **no exact or fuzzy match**: the best is "Dewan Saujana Utama" at 0.58. The research's candidate "Dewan Bunga Matahari" (3.1799, 101.5414) lies east of the OSM import envelope (lon ≤ 101.530), so it is not in `base/places.geojson`.
8. **Coverage** `flood/coverage.json`.
   - The walk graph extends past `AREA` (lon 101.434–101.542, lat 3.138–3.248). Widening `AREA` needs a new DEM read, which this review round did without network.
   - **61 edges and 3 places lie wholly outside the raster.** They get no flood class, so they read as "unlikely". **209 edges are only partly covered** and are classified on their covered samples.
   - The ids are listed in `coverage.json`. The 3 places are `osm-way-377999794`, `osm-way-691513797` and `osm-way-691513809`.
   - Follow-up: widen `AREA` to `(101.430, 3.135, 101.560, 3.250)` (still DEM tile N03E101) and re-run.

### Datum and attribution (written to `site.json`)

- `scene.datum_offset_m = -3.74`. This is the EGM2008 geoid height N at (101.5099, 3.1813), from PROJ's EGM2008 grid on the PROJ CDN; the check value at (0, 0) came out at 17.23 m. Google 3D Tiles are ellipsoidal: h = H + N.
- Rebuilds set it with `--datum-offset -3.74`, or with a network lookup that is trusted only when the (0, 0) check passes.
- Attribution added to `site.json`: "Copernicus DEM GLO-30 © DLR/Airbus, provided under COPERNICUS by the EU and ESA" and "Flood scenarios: relative elevation above mapped OSM drainage (indicative)". The OSM attribution is kept.

### Rebuild

```bash
uv sync --all-groups                                     # rasterio/scipy live in the `data` group
uv run --group data python data/scripts/build_flood.py --datum-offset -3.74 [--osm-water FILE...]
#   --stage all|raster|vector  --method rem|hand  --refresh  --no-datum  --data-dir DIR
uv run --group data python data/scripts/build_waste.py
uv run pytest data/scripts/tests -q                      # synthetic arrays/vectors, no network
```

The seed was built on 15 Oct 2026 with `--osm-water` pointing at the OSM import's cached hydrology Overpass response: 204 elements, of which 23 channel lines and 80 water polygons are used. My own Overpass requests over `AREA` had failed (504 / timeout / 504).

### Results (15 Oct 2026; edge counts re-measured after Task 31 added major roads)

Drainage covers 1,508 cells (1.3% of the window).

| Scenario | Polygons | Water km² | `likely_flooded` edges | `possible` edges | `likely_flooded` places |
|---|---|---|---|---|---|
| stage_p1m | 71 | 3.24 | 445 | 345 | 15 |
| stage_p2m | 129 | 6.15 | 790 | 563 | 18 |
| stage_p3m | 140 | 10.25 | 1,353 | 396 | 23 |
| stage_p4m | 152 | 14.95 | 1,749 | 719 | 29 |
| stage_p5m | 133 | 19.06 | 2,468 | 567 | 35 |

`flood/*.geojson` total 0.5 MB. Edge and place classes are monotonic (checked), and the water nests.

**Wet cells whose ground is above the drawn surface.** The 3D view hides these under the terrain.

| Stage | +1 | +2 | +3 | +4 | +5 |
|---|---|---|---|---|---|
| All wet cells | 33.9% | 19.8% | 14.1% | 9.0% | 7.5% |

At +1 m about a third of the wet area is hidden under the 3D surface; the list view and 2D layers are authoritative.

At +1 m, drainage cells make up 44% of the wet cells, and 54.8% of them read above the surface (canopy, banks and bridges in the surface model over rasterised channel cells). For non-drainage cells the figure is 17.7%. Smaller tiles barely help: 0.005° gives 29.5% and 0.0025° gives 27.5% at +1 m.

### Sanity check

**Lakeside Mall** (3.1813, 101.5099): connected REM **15.78 m**, so `unlikely` at +1 m and at +3 m.
- The 3 nearest segments are 9–16 m away, with a minimum of 12.1–15.8 m. All `unlikely`.
- One segment 25 m away is on the lake edge, with a minimum of 1.97 m: `unlikely` at +1, `likely_flooded` at +3.

**Jalan Kubu Gajah point** (3.1955, 101.5202): connected REM **7.03 m**, so `unlikely` at +1 and +3. The water at +3 to +5 m sits on the lower ground just east of it, towards Paya Jaras.

**Share of segments `likely_flooded`:**

| Area | +1 | +2 | +3 | +4 | +5 |
|---|---|---|---|---|---|
| Within 300 m of the mall (169) | 18.9% | 23.7% | 24.9% | 28.4% | 29.6% |
| Within 1 km of the mall (924) | 15.7% | 19.8% | 23.9% | 30.6% | 33.1% |
| Kubu Gajah street grid (710) | 3.0% | 15.8% | 35.5% | 42.7% | 51.7% |
| Overall (15,252, before Task 31) | 2.6% | 4.7% | 8.0% | 10.4% | 14.8% |
| Overall (16,148, after Task 31) | 2.8% | 4.9% | 8.4% | 10.8% | 15.3% |

The three area rows were measured before Task 31 and were not recomputed.

Near the mall, the flagged segments are the Urban Park / Central Park lake-edge footways and the park paths beside the on-line lake.

**Hero routes** (Step 5 of the brief):
- **Stroller `park-b → playground`:**
  - Baseline: `confirmed`, 441 m.
  - At +1 m: three lake-side footways are `likely_flooded` (`seg-1346147882-0/1`, `seg-1318133037-1`). These are shared by P1 and P2. The router finds a 486 m alternative, `partly_unverified`. The same holds at +3 m.
- **`affected` (likely / possible / isolated components):**
  - +1 m: 460 / 348 / 11 (before Task 31: 419 / 314 / 11)
  - +3 m: 1,376 / 402 / 18 (1,247 / 361 / 15)
  - +5 m: 2,503 / 576 / 24 (2,298 / 562 / 22)
- **Wheelchair, reachable evacuation candidates from `lakeside-mall`:** 64 of 72 at baseline, 44 of 72 at +3 m (before Task 31: 23 and 3). Nearest at baseline: Sri Maha Mariamman Temple Bukit Subang, 1.1 km. Nearest at +3 m: Masjid Jamiul Ehsan, 4.1 km. Both `partly_unverified`.

### Limits

- **Indicative, 30 m, not a forecast.** GLO-30 is a *surface* model (buildings and trees), with vertical error < 4 m. There are no culverts, bridges, embankments, drains or rainfall, and flash floods from local drainage are not modelled. The same "+N m" applies everywhere, with no water-surface slope or flood wave.
- **Drainage-elevation bias.** The channel elevation comes from a surface model over narrow, often tree-lined channels. It reads high, which makes nearby REM low and so over-states flooding. The valley-floor correction pulls it down, which under-states flooding if it overshoots.
- **Floor-window sensitivity** (reviewer's table, recomputed on this seed):

  | Valley-floor window | Wet share of window +1 / +3 / +5 | `likely_flooded` edges +1 / +3 / +5 |
  |---|---|---|
  | none | 7.8% / 14.8% / 26.0% | 6.6% / 13.0% / 21.5% |
  | **3 × 3 (used)** | **2.9% / 9.0% / 16.9%** | **2.6% / 8.0% / 14.8%** |
  | 5 × 5 | 2.0% / 7.6% / 14.9% | 1.7% / 6.1% / 12.4% |

  The floor correction **biases the scenarios towards under-stating flooding**. 3 × 3 is the smallest window that absorbs a one-cell offset in the OSM lines.
- **Straight-line nearest drainage.** The REM uses Euclidean nearest; across a ridge, the "nearest" channel can belong to another valley. The connected-inundation rule stops such cells from flooding unless water can reach them.
- **Only as good as OSM.** Unmapped streams make their valleys look high. Culverted streams are skipped. East of lon 101.53 only the river ways that cross the envelope are present.
- **Bridges** over mapped rivers read low, so crossings can be flagged from low stages.
- **Water surfaces are flat per ~1.1 km tile**, so the 3D view hides some wet cells; see the table above.
- **Official PPS status** is set per event by the district disaster committee. OSM halls are only candidates.

### Waste (`data/scripts/build_waste.py`)

`waste/points.geojson` holds 7 **placeholder** points: 2 SDP programme sites and 5 OSM waste baskets. There is no OSM `amenity=recycling` in the envelope.
- **Programme sites** are placed only when an exact OSM name exists:
  - "Central Park community garden (programme site)" → OSM "Elmina Valley Central Park" (park centroid);
  - "Elmina Rainforest Knowledge Centre (programme site)".
- Every point is `status: "unknown"`, because the import carries no `check_date`. `source_url` points to the OSM element.
- **The field survey replaces these points.**
