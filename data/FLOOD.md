# Flood and waste layers (Task 10)

> To be merged into `data/README.md` (owned by Task 3) as its "Flood" and "Waste" sections.

**Indicative scenarios from a 30 m elevation model, not a forecast.** They never give a water depth on a path. Every scenario carries the disclaimer and the official links (JPS Public InfoBanjir, MET Malaysia). Method: [ADR 0010](../docs/00-overview/decisions/0010-flood-lens-hand-scenarios.md), amended by the method change below. Background: [flood-disaster-lens](../docs/02-research/flood-disaster-lens.md).

## Method change: HAND → REM (coordinator ruling, 15 Oct 2026)

**Default method: `rem`, a Relative Elevation Model.**
- The drainage is OSM `waterway=river|stream|canal` lines plus `natural=water` / `water=*` lakes and ponds that are connected to them.
- `REM = DEM − channel elevation at the nearest drainage cell`.

**Why we changed.** The first build used ASF GLO-30 HAND, whose channel network is very dense. Every gully, graded flat and pond counted as "river", and 16% of the window had HAND ≈ 0. Bridges and culverts read about 0 as well.
- On a provisional walk graph, HAND put **39% of all segments `likely_flooded` at +1 m**, and 24% of the segments within 300 m of Lakeside Mall.
- That contradicts the verified local story. Elmina's core is high ground; the documented floods are on the downstream Sungai Subang corridor (Kampung Kubu Gajah / Paya Jaras).

**HAND is kept as a comparison** (`--method hand`). Write it to a scratch `--data-dir`, not the seed.

## Sources and licences

| Layer | Source | Licence / attribution string (for `site.json`) |
|---|---|---|
| DEM | Copernicus DEM GLO-30, tile `N03_00_E101_00` (COG on AWS open data) | "Copernicus DEM GLO-30 © DLR/Airbus, provided under COPERNICUS by the EU and ESA" |
| Drainage for the REM (default) | OpenStreetMap rivers, streams, canals and water bodies | "© OpenStreetMap contributors (ODbL)" |
| HAND (comparison only, `--method hand`) | ASF GLO-30 HAND v1 (2021), the same tile | "HAND: ASF (CC0)" |
| Evacuation candidates, waste points | `base/places.geojson` (OSM import, Task 3) | "© OpenStreetMap contributors (ODbL)" |
| Official PPS evidence | RTM, 4 Oct 2024 ([F8] in the research doc) | link only |

The scripts never create `site.json` (Task 3 owns it). When `site.json` exists, `build_flood.py` appends the attribution strings for the method it ran (idempotent) and sets `scene.datum_offset_m`. With the default `rem`, those strings are Copernicus and OSM.

## Datum: set `scene.datum_offset_m = -3.74` in `site.json`

Task 3 owns `site.json`, so this is guidance for whoever merges it.
- The DEM and the water `surface_height_m` are **EGM2008 orthometric** heights (H). Google Photorealistic 3D Tiles are **WGS84 ellipsoidal** (h = H + N).
- At Elmina, **N = −3.74 m**: −3.74 m at (101.5099, 3.1813) and −3.72 m at Kubu Gajah. The API adds `datum_offset_m` to `surface_height_m`, so set **`"scene": {"datum_offset_m": -3.74}`**.
- How N was computed: rasterio's bundled PROJ, with `PROJ_NETWORK=ON`, transforming `EPSG:4326+3855 → EPSG:4979` with the EGM2008 grid from the PROJ CDN. The check value at (0, 0) came out at 17.23 m.
- `build_flood.py` repeats this lookup, trusts it only when the (0, 0) check passes, and writes it once `site.json` exists. `--no-datum` skips the lookup.
- Without the grid, PROJ silently returns 0. The script detects that and does not guess.
- Still to do: a visual check against the Central Park lakes on the Google tiles.

## Method (`data/scripts/build_flood.py`)

1. **DEM window.** The script reads a window of the GLO-30 COG over HTTP (GDAL `/vsicurl/`), clipped to `AREA = (101.460, 3.150, 101.560, 3.240)` (w, s, e, n): the Elmina envelope plus the downstream Sungai Subang corridor. The window is 361 × 325 cells, and the array is cached in `data/cache/*.npy` (gitignored).
2. **OSM drainage.**
   - Source: one Overpass query over `AREA` (`way[waterway~"^(river|stream|canal)$"]`, `way|relation[natural=water]`, `way|relation[water]`), cached in `data/cache/osm_water_*.json`. Alternatively, `--osm-water FILE…` (Overpass JSON or GeoJSON). If Overpass is unavailable, the fallback is `base/hydrology.geojson` from the OSM import.
   - **Culverted or tunnelled waterways are skipped.** The surface model there is the road or ground above.
   - Channels are rasterised with all touched cells. Lakes and ponds are kept **only if they touch the channel network**. On-line lakes such as the Central Park lakes stay; perched or off-line ponds keep their own level when the river rises. In a test, including them turned large fans of lower ground around them into "below the river" (Voronoi artefacts of the nearest-cell REM).
3. **REM.**
   - **Channel elevation** per drainage cell = the lowest DEM within 5 × 5 cells (the valley floor), then the median of that over the drainage cells in a 5 × 5 window along the channel.
   - The valley floor is needed because OSM lines sit up to a cell off the DEM's valley, and the surface model reads tree canopy and bridge decks over a narrow river. With the median alone, 43% of segments were likely at +1 m.
   - `REM = DEM − channel elevation at the nearest drainage cell` (`scipy.ndimage.distance_transform_edt(~drain, return_indices=True)`), and it is 0 on the drainage itself.
4. **Connected inundation**, the same rule as before. A cell is wet at stage `s` when REM < `s` *and* it is 8-connected, through wet cells, to a drainage cell. A hollow behind a ridge stays dry even when it is lower than the river; a test checks this. **Connected relative height** = the lowest stage at which a cell joins the connected water (a minimax/priority flood). It equals the connected mask at every stage (tested). For HAND, drainage = HAND ≤ 1 cm.
5. **Water polygons** `flood/stage_pNm.geojson`.
   - The script polygonises the wet mask, simplifies it (0.0002°, about 22 m) and unions it with the lower stage's water, so stages nest exactly before rounding. It clips to `AREA`, cuts the water into 0.01° (~1.1 km) tiles so each piece has a local flat surface, and drops slivers under half a cell. Coordinates are rounded to 5 dp (about 1 m).
   - `surface_height_m` for each piece = the 5th-percentile DEM of its wet cells + the stage, in EGM2008 metres. The API adds `datum_offset_m`.
   - `baseline.geojson` is empty.
6. **Vector stage.** It needs `base/walk.geojson` + `base/places.geojson`; otherwise it prints "base layers missing; run import_osm.py first" and skips.
   - **Edges.** The script samples the connected relative height every 10 m along each edge and takes `min`. It classifies with margin 0.5 m: `likely_flooded` if `min < stage − 0.5`, `possible` if `< stage + 0.5`, otherwise `unlikely`.
   - Monotonicity is enforced explicitly (rank likely=2 > possible=1 > unlikely=0, max over lower stages). Only `likely_flooded` and `possible` are stored.
   - **Places.** Same rule, using the place point.
   - **Evacuation centres** `flood/evac_centres.geojson`. Places of type `community_centre | school | place_of_worship | townhall` inside `AREA` become `osm_candidate` (`evc-<place_id>`).
   - A place becomes `official_pps` (`pps-<place_id>`, with `evidence_url`) **only on an exact OSM name match** with a news-reported PPS. Today the list has one entry: "Dewan MBSA Matahari", 4 Oct 2024, [F8], using the exact RTM article URL.
   - Otherwise the closest-named candidate (difflib ratio ≥ 0.6) gets the note "news reports a PPS named 'Dewan MBSA Matahari' on 4 Oct 2024; match to this hall unverified". OSM has "Dewan Bunga Matahari" (ratio 0.87).
   - `scenarios.json` (`method: "REM"`, the disclaimer and the links, plus the classes) is validated against `models.FloodBundle` before writing.

## Waste (`data/scripts/build_waste.py`)

The script writes `waste/points.geojson` with at most 10 **placeholder** points:
- hand-listed SDP programme sites (`programme_site`), placed **only** when an exact OSM name exists. "Central Park community garden (programme site)" uses `Elmina Central Park` / `Central Park`; "Elmina Rainforest Knowledge Centre (programme site)" uses the exact name;
- then OSM `recycling` (→ `recycling_drop_off`) and `waste_basket` (→ `bin`) inside `AREA`.

All points have `status: "unknown"`, because the OSM import does not carry `check_date`, and `source_url` points to the OSM element. **The field survey replaces these points.**

## Rebuild

```bash
uv sync --all-groups                                     # rasterio/scipy live in the `data` group
uv run --group data python data/scripts/build_flood.py   # REM, all stages
#   --stage raster|vector  --method rem|hand  --osm-water FILE...  --refresh  --no-datum  --data-dir DIR
uv run --group data python data/scripts/build_waste.py   # --data-dir
uv run pytest data/scripts/tests -q                      # synthetic rasters/vectors, no network
```

The committed outputs were built with `--osm-water <data-lane cache>/2f7c0c51….json`. That file is Task 3's hydrology Overpass response for the envelope; my own three Overpass requests over `AREA` returned 504 / timeout / 504.

After Task 3 merges, re-run both scripts. That fills `edge_classes`/`place_classes`, `evac_centres.geojson`, `waste/points.geojson`, the `site.json` attribution and `datum_offset_m`, and prints the summary and sanity tables.

## Raster-stage run (REM, 15 Oct 2026, committed outputs)

Drainage: 23 channel lines and 80 water polygons, of which those connected to channels give 1,508 drainage cells (1.3% of the ~111 km² window).

| Scenario | Polygons | Water area km² |
|---|---|---|
| stage_p1m | 81 | 2.18 |
| stage_p2m | 119 | 4.64 |
| stage_p3m | 137 | 8.67 |
| stage_p4m | 131 | 12.83 |
| stage_p5m | 136 | 16.82 |

Total `flood/*.geojson` = 0.45 MB. Water area grows with stage. After 5-dp rounding, ≤ 0.002 km² per stage pair falls outside the next stage. For comparison, HAND gave 26.6 → 54.9 km².

## Sanity check (provisional)

These numbers come from the vector stage run on a scratch walk graph built from the data lane's cached Overpass highway tiles: 6,631 ways split at shared vertices into 15,221 segments. That graph approximates Task 3's split. Re-run after the merge; the script prints the same table.

- **Lakeside Mall** (3.1813, 101.5099): connected REM **15.78 m**, `unlikely` at +1 m and +3 m.
  - The 3 nearest segments (9–16 m away) have a minimum of 12.1–15.8 m and are `unlikely` at +1 and +3.
  - One lake-edge segment 25 m away has a minimum of 1.97 m: `unlikely` at +1, `likely_flooded` at +3.
- **Kampung Kubu Gajah**, Jalan Kubu Gajah point (3.1955, 101.5202): connected REM **7.78 m**, `unlikely` at +1 and +3. The 5 nearest segments have a minimum of 5.9–7.5 m and are `unlikely` at +3.
  - The water at +3 to +5 m spreads over the low ground just east of it, along Sungai Subang towards Paya Jaras.
  - Across the Kubu Gajah street grid (101.51–101.535, 3.193–3.205; 708 segments), `likely_flooded` covers 2.5% at +1, 24.0% at +3 and 46.8% at +5.
- **`likely_flooded` share of segments:**

  | Area | +1 | +2 | +3 | +4 | +5 |
  |---|---|---|---|---|---|
  | Within 300 m of the mall (169) | 1.8% | 21.9% | 23.7% | 24.9% | 29.6% |
  | Within 1 km of the mall (923) | 7.8% | 14.7% | 17.2% | 24.7% | 28.2% |
  | Overall (15,221) | 1.7% | 3.5% | 6.1% | 9.3% | 12.4% |

  - Near the mall, the flagged segments are the Central Park lake promenade and park paths beside the on-line lake.
  - Overall counts: likely 266 / 537 / 931 / 1,414 / 1,884; possible 271 / 394 / 483 / 470 / 719.
- **Monotonicity holds.** For every stage pair, the flooded edge set at the lower stage is a subset of the set at the higher stage, and no class drops. Water area grows with stage.

## Limits and follow-ups

- **Indicative, 30 m, not a forecast.** GLO-30 is a *surface* model (buildings and trees), with vertical error < 4 m. There are no culverts, bridges, embankments, drains or rainfall, and flash floods from local drainage are not modelled.
- **The REM measures height above the nearest mapped river or lake cell, using straight-line nearest.** Across a ridge, the "nearest" channel can belong to another valley. The connected-inundation rule stops such cells from flooding unless water can reach them.
- **The drainage is only as good as OSM.** Unmapped streams make their valleys look high. Mapped streams in culverts are skipped. The east strip (101.53–101.56) has only the river ways that cross the envelope when built from Task 3's hydrology. With a successful Overpass query over `AREA`, it is complete.
- **A flat river stage with the same "+N m" everywhere** ignores the real water-surface slope along the river and the flood wave.
- **Bridges over the mapped river** still read low, so crossings of Sungai Subang are flagged from low stages. Exempting `bridge=yes` edges is a possible follow-up.
- **Water surfaces are flat per ~1.1 km piece**, so the 3D water may show steps of a few metres between tiles.
- **Official PPS status** is set per event by the district disaster committee. OSM halls are only candidates.
- **Waste points** are placeholders until the field survey.
- **Possible upgrade** (ADR 0010 step 2): burn OSM rivers into the DEM and compute a proper HAND with pysheds, so the drainage follows flow paths instead of straight-line nearest.
