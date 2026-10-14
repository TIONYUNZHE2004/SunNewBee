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

Overpass responses are cached in `data/cache/` (gitignored); delete it to refetch. Node ids (`n-<lat*1e7>_<lon*1e7>`)
are derived from coordinates because the cached `out geom` responses omit OSM node ids.

## Import (2026-10-15)

Envelope bbox (s,w,n,e) = 3.150, 101.460, 3.240, 101.530.

- ways fetched: 6631; walk segments: 15252 (`base/walk.geojson`, ~5 MB)
- places: 227 imported; 3 duplicates of hero places removed by `build_overlay.py` (`osm-way-1308938137`, `osm-way-1318133036`, `osm-way-1346154592`) -> 224 in `base/places.geojson`, plus 7 overlay places = 231 total. 210 imported places snap to a walk node within 60 m (any component; the walk graph is fragmented into ~199 components because primary roads are excluded)
- hydrology features: 204 (display only)
- overlay: 18 edges + 7 places (`park-b`, `lakeside-mall`, `playground`, `toilet-urban-park`, `bench-urban-1..3`)
- P1 416 m (via unknown ramp) vs verified detour P2 441 m

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
   - **59 edges and 3 places lie wholly outside the raster.** They get no flood class, so they read as "unlikely". **193 edges are only partly covered** and are classified on their covered samples.
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

### Results (15 Oct 2026)

Drainage covers 1,508 cells (1.3% of the window).

| Scenario | Polygons | Water km² | `likely_flooded` edges | `possible` edges | `likely_flooded` places |
|---|---|---|---|---|---|
| stage_p1m | 71 | 3.24 | 404 | 311 | 15 |
| stage_p2m | 129 | 6.15 | 715 | 509 | 18 |
| stage_p3m | 140 | 10.25 | 1,224 | 355 | 23 |
| stage_p4m | 152 | 14.95 | 1,579 | 684 | 29 |
| stage_p5m | 133 | 19.06 | 2,263 | 553 | 35 |

`flood/*.geojson` total 0.5 MB. Edge and place classes are monotonic (checked), and the water nests.

**Wet cells whose ground is above the drawn surface.** The 3D view hides these under the terrain.

| Stage | +1 | +2 | +3 | +4 | +5 |
|---|---|---|---|---|---|
| All wet cells | 33.9% | 19.8% | 14.1% | 9.0% | 7.5% |

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
| Overall (15,252) | 2.6% | 4.7% | 8.0% | 10.4% | 14.8% |

Near the mall, the flagged segments are the Urban Park / Central Park lake-edge footways and the park paths beside the on-line lake.

**Hero routes** (Step 5 of the brief):
- **Stroller `park-b → playground`:**
  - Baseline: `confirmed`, 441 m.
  - At +1 m: three lake-side footways are `likely_flooded` (`seg-1346147882-0/1`, `seg-1318133037-1`). These are shared by P1 and P2. The router finds a 486 m alternative, `partly_unverified`. The same holds at +3 m.
- **`affected` (likely / possible / isolated components):**
  - +1 m: 419 / 314 / 11
  - +3 m: 1,247 / 361 / 15
  - +5 m: 2,298 / 562 / 22
- **Wheelchair, reachable evacuation candidates from `lakeside-mall`:** 23 of 72 at baseline, 3 of 72 at +3 m. Nearest at +3 m: Masjid Jamiul Ehsan, 4.1 km, `partly_unverified`.

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
