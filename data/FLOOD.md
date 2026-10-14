# Flood and waste layers (Task 10)

> To be merged into `data/README.md` (owned by Task 3) as its "Flood" and "Waste" sections.

**Indicative scenarios from a 30 m elevation model, not a forecast.** They never give a water depth on a path. Every scenario carries the disclaimer and the official links (JPS Public InfoBanjir, MET Malaysia). Method: [ADR 0010](../docs/00-overview/decisions/0010-flood-lens-hand-scenarios.md). Background: [flood-disaster-lens](../docs/02-research/flood-disaster-lens.md).

## Sources and licences

| Layer | Source | Licence / attribution string (for `site.json`) |
|---|---|---|
| DEM | Copernicus DEM GLO-30, tile `N03_00_E101_00` (COG on AWS open data) | "Copernicus DEM GLO-30 © DLR/Airbus, provided under COPERNICUS by the EU and ESA" |
| HAND | ASF GLO-30 HAND v1 (2021), the same tile | "HAND: ASF (CC0)" |
| Evacuation candidates, waste points | `base/places.geojson` (OSM import, Task 3) | "© OpenStreetMap contributors (ODbL)" |
| Official PPS evidence | RTM, 4 Oct 2024 ([F8] in the research doc) | link only |

The scripts never create `site.json` (Task 3 owns it). When `site.json` exists, `build_flood.py` appends the two strings above to `attribution` (idempotent) and sets `scene.datum_offset_m` (see Datum below).

## Method (`data/scripts/build_flood.py`)

1. **Raster stage** (runs without OSM data). The script reads windows of the two public COGs over HTTP (GDAL `/vsicurl/`), clipped to `AREA = (101.460, 3.150, 101.560, 3.240)` (w, s, e, n). That is the Elmina envelope plus the downstream Sungai Subang corridor, and the window is 361 × 325 cells. Both rasters are on the same grid, and the clipped arrays are cached in `data/cache/*.npy` (gitignored).
2. **Connected inundation.** A cell is wet at stage `s` when HAND < `s` *and* it is 8-connected, through wet cells, to a drainage cell. Isolated hollows are dropped. A drainage cell has HAND ≤ 1 cm: HAND is 0 on drainage by definition, and 1 cm absorbs float noise. (The brief said 0.5 m, but then its own test's 0.4 m hollow would count as drainage.)
3. **Water polygons** `flood/stage_pNm.geojson`. The script polygonises the wet mask, simplifies it (0.0002°, about 22 m) and unions it with the lower stage's water, so stages nest exactly before the coordinates are rounded. It then clips to `AREA` and cuts the water into 0.01° tiles (about 1.1 km). Without the tiles, a single flat surface for the whole river network would sit under the ground upstream. Tile-cut slivers smaller than half a cell are dropped.
   - `surface_height_m` for each piece = the 5th percentile of the DEM inside the piece's wet cells + the stage. This is EGM2008 orthometric height; the API adds `scene.datum_offset_m`.
   - `baseline.geojson` is empty: normal river level means no scenario water. Rivers and ponds are drawn from OSM hydrology.
4. **Vector stage** (needs `base/walk.geojson` + `base/places.geojson`; otherwise it prints "base layers missing; run import_osm.py first" and skips):
   - **Connected HAND** per cell = the lowest stage at which the cell joins the drainage-connected water (a minimax/priority flood). It equals the connected mask at every stage, and a test checks this.
   - **Edges.** The script samples connected HAND every 10 m along each LineString and takes `hand_min` = min. It classifies per stage with margin 0.5 m: `likely_flooded` if `hand_min < stage − 0.5`, `possible` if `< stage + 0.5`, otherwise `unlikely`. Monotonicity is enforced explicitly: rank likely=2 > possible=1 > unlikely=0, taking the max over lower stages. Only `likely_flooded` and `possible` are stored. Edges outside the raster get no class.
   - **Places.** Same rule, using HAND at the place point.
   - **Evacuation centres** `flood/evac_centres.geojson`. Places of type `community_centre | school | place_of_worship | townhall` inside `AREA` become `osm_candidate` (`evc-<place_id>`). A place becomes `official_pps` (`pps-<place_id>`, with `evidence_url`) **only on an exact OSM name match** with a news-reported PPS, compared case- and whitespace-insensitively. Today the list has one entry: "Dewan MBSA Matahari", 4 Oct 2024, [F8]. If no exact match exists, the closest-named candidate (difflib ratio ≥ 0.6) gets a note: "news reports a PPS named 'Dewan MBSA Matahari' on 4 Oct 2024; match to this hall unverified". OSM has "Dewan Bunga Matahari" (ratio 0.87).
   - `scenarios.json` holds the `baseline` + `stage_p1m..p5m` scenarios, `edge_classes` and `place_classes`. It is validated against `models.FloodBundle` before writing.
5. **Datum.** The script looks up the EGM2008 geoid height N at the site centre through PROJ's EGM2008 grid from the PROJ CDN (`PROJ_NETWORK=ON`, rasterio's bundled PROJ). The value is trusted only when the check value at (0, 0) comes out at about 17.2 m. Without the grid, PROJ silently returns 0, and then the script sets nothing.
   - Result on 15 Oct 2026: **N = −3.74 m** at (101.5099, 3.1813) and −3.72 m at Kubu Gajah. The (0, 0) check gave 17.23 m.
   - Ellipsoidal h = H + N, so **`scene.datum_offset_m = −3.74`**. It is written automatically once `site.json` exists; `--no-datum` skips the lookup.
   - Still to do: a visual check against ponds on the Google tiles (DSM vs water level).

## Waste (`data/scripts/build_waste.py`)

The script writes `waste/points.geojson` with at most 10 **placeholder** points:
- hand-listed SDP programme sites (`programme_site`), placed **only** when an exact OSM name exists. "Central Park community garden (programme site)" uses `Elmina Central Park` / `Central Park`; "Elmina Rainforest Knowledge Centre (programme site)" uses the exact name;
- then OSM `recycling` (→ `recycling_drop_off`) and `waste_basket` (→ `bin`) inside `AREA`.

All points have `status: "unknown"`, because the OSM import does not carry `check_date`, and `source_url` points to the OSM element. **The field survey replaces these points.**

## Rebuild

```bash
uv sync --all-groups                                   # rasterio/scipy live in the `data` group
uv run --group data python data/scripts/build_flood.py # all stages; --stage raster|vector, --refresh, --data-dir
uv run --group data python data/scripts/build_waste.py # --data-dir
uv run pytest data/scripts/tests -q                    # synthetic rasters/vectors, no network
```

After Task 3's `base/*.geojson` and `site.json` are merged, re-run both scripts. That fills `edge_classes`/`place_classes`, `evac_centres.geojson`, `waste/points.geojson`, the `site.json` attribution and `datum_offset_m`. It also prints the summary and sanity tables.

## Raster-stage run (15 Oct 2026, committed outputs)

Window: 361 × 325 cells, about 111 km². Drainage cells (HAND ≤ 1 cm): 19,169 cells, 18.2 km².

| Scenario | Polygons | Water area km² |
|---|---|---|
| stage_p1m | 999 | 26.61 |
| stage_p2m | 667 | 36.19 |
| stage_p3m | 503 | 43.70 |
| stage_p4m | 421 | 49.71 |
| stage_p5m | 330 | 54.94 |

Total `flood/*.geojson` = 1.89 MB. Water area grows with stage. Stages nest exactly before rounding; after 5-dp rounding, the residue is ≤ 0.004 km² per stage pair.

## Sanity check (provisional)

These are **provisional** numbers. They come from the vector stage run on a scratch walk graph that was built from the data lane's cached Overpass highway tiles: 6,631 ways split at shared vertices into 15,221 segments. That graph only approximates Task 3's split. Re-run after the merge; the script prints the same table.

- **Lakeside Mall** (3.1813, 101.5099): connected HAND at the point is **14.99 m**, so it is `unlikely` at +3 m (and at +5 m). DEM (DSM) at the point is 50.7 m.
  - The 3 nearest segments (9–16 m away) have `hand_min` 11.3–15.0 m and are `unlikely` at +3 m.
  - One segment 25 m away reaches the lake edge (`hand_min` 1.1 m) and is `likely_flooded` at +3 m.
- **Kampung Kubu Gajah** (Jalan Kubu Gajah, 3.1955, 101.5202): connected HAND **1.86 m**. The 5 nearest segments have `hand_min` 1.10–1.55 m and are `likely_flooded` at +3 m.
  - Across the Kubu Gajah street grid (101.51–101.535, 3.193–3.205; 708 segments), `likely_flooded` covers 43% of segments at +1 m, 73% at +3 m and 82% at +5 m. This matches the documented floods (Apr 2024, Oct 2024, Apr 2025).
- **Elmina core.** The mall and the residential platforms stay dry at +1 m. The +1 m water follows Sungai Subang, the Central Park / Urban Park lakes and the stream valleys. This is not "Elmina goes under", and HAND is relative, so there can be no datum error in it.
- **However, edge classes are aggressive.**
  - Within 300 m of the mall, 24% of segments are `likely_flooded` at +1 m: lakeside promenade and park paths, and stream crossings. Within 1 km the figure is 26%.
  - Across all 15,221 segments it is 39% at +1 m and 59% at +3 m.
  - Likely edges by stage: 5,946 / 7,615 / 8,930 / 9,916 / 10,660. Possible: 1,669 / 1,315 / 986 / 744 / 528. Monotonic.

## Limits and follow-ups

- **Indicative, 30 m, not a forecast.** GLO-30 is a *surface* model (buildings and trees), with vertical error < 4 m. There are no culverts, bridges, embankments, drains or rainfall.
- **The ASF HAND drainage network is very dense**: every gully, pond and graded flat counts as "drainage", and 16% of the window has HAND ≈ 0. So "River +N m" really means "+N m above the nearest drainage line", not "Sungai Subang rises N m".
  - Bridges and culverts read HAND ≈ 0, so stream crossings become `likely_flooded` from +1 m.
  - **Follow-up (ADR 0010 step 2):** recompute HAND locally (pysheds) with a higher flow-accumulation threshold, or with OSM `waterway=river` / water bodies burned in as the only drainage. Optionally exempt `bridge=yes` edges.
- The scenario water surface is flat per piece (about 1.1 km tiles), so 3D water may show steps of a few metres between tiles.
- Official PPS status is set per event by the district disaster committee. OSM halls are only candidates.
- Waste points are placeholders until the field survey.
