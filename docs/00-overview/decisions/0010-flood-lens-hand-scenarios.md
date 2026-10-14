# 0010. Flood lens: precomputed HAND river-stage scenarios, labelled indicative

- Status: **accepted** (method); thresholds are **proposed** engineering defaults
- Date: 2026-10-15
- Research: [flood-disaster-lens](../../02-research/flood-disaster-lens.md)

## Context
Lens 2 must show "what if the river rises?" in 3D for management and residents, re-route people, and identify reachable evacuation centres, with honest uncertainty. Local facts: Elmina's built-up core is **not low-lying** (SRTM sample median 38 m; Lakeside Mall about 45 m; Sungai Subang at about 20–34 m). The documented recent floods are **downstream neighbours, Kampung Kubu Gajah / Paya Jaras** (Apr 2024, 4 Oct 2024 with relief centres opened, Apr 2025). The only licence-safe open DEM is Copernicus GLO-30 (30 m surface model, vertical error < 4 m). Google tiles may not be used to derive heights.

## Decision
1. **Method:** **HAND (Height Above Nearest Drainage)** from Copernicus GLO-30. Start from the ASF global HAND raster (CC0), then recompute locally with pysheds. Precompute **river-stage scenarios** `stage_p1m … stage_p5m` (+ `baseline`), using a connected-inundation rule.
2. **Coverage:** the **Elmina envelope plus the downstream Sungai Subang / Sungai Buloh corridor** including Kampung Kubu Gajah and Paya Jaras (exact analysis bbox fixed in week 1). Story: "how a river rise affects Elmina residents' routes, their neighbours, and evacuation centres", **not** "Elmina goes under".
3. **Per-edge classes per scenario:** `likely_flooded | possible | unlikely` (with a margin, default 0.5–1.0 m) → evaluation `FAIL | UNKNOWN | (normal rules)`. A scenario can only *add* FAIL/UNKNOWN; it never turns UNKNOWN into PASS.
4. **Profiles:** existing profiles + `drive` (township road graph via OSMnx). Depth thresholds are versioned YAML parameters shown to users. Wheelchair/stroller thresholds are **our engineering default (no published source)**; pedestrian bands follow UK FD2320-style danger bands; car about 0.3 m.
5. **Evacuation centres:** OSM candidates (halls, schools, mosques, community centres) are labelled `osm_candidate`; centres confirmed from official PPS lists or news are labelled `official_pps` with evidence. Reachability, isolated "islands" and isochrones are computed per scenario.
6. **Language rules:** always "indicative scenario, not a forecast"; never "safe"; never exact depths on paths; official links (MBSA, JPS, NADMA) are always shown. The MET Malaysia warnings API (`api.data.gov.my`) is an optional live banner. No scraping of JPS InfoBanjir without permission.

## Options considered
| Method | Verdict |
|---|---|
| Plain bathtub on DEM | Floods unconnected hollows; misleading |
| **HAND scenarios** | Honest about limits, cheap, deterministic, tool-callable |
| SCS-CN rainfall-runoff + ponding | Later add-on (pluvial layer) |
| Official hazard maps | Use if JPS/SDP supply them |
| 2D hydrodynamic (SFINCS, LISFLOOD-FP, HEC-RAS 2D) | Pilot phase with SDP LiDAR and drainage data |

## Consequences
- Data pipeline work for BE (DEM, HAND, scenarios, OSMnx road graph) in week 1–2.
- The FE draws water as extruded polygons at absolute height (ADR [0007](0007-3d-engine-cesium.md)), so a datum calibration is needed.
- Ask SDP/JPS/MBSA for LiDAR, drainage GIS, the PPS list and flood photos (Oct 2024 / Apr 2025) for sanity checks.

## Amendment (2026-10-15, overnight build)
**Observed:** the ASF global HAND raster uses a very dense drainage network (minor channels, and bridges counted as drainage). In the walking-skeleton build, +1 m classified about 39% of all Elmina walk/road segments as `likely_flooded`, including high ground near Lakeside Mall. That contradicts the verified local facts (core about 38–45 m; documented floods are downstream on the Sungai Subang corridor), so presenting it would be dishonest.

**Decision:** the default scenario method becomes a **Relative Elevation Model (REM)**: the height of each Copernicus GLO-30 cell above the nearest *mapped* drainage cell. Mapped drainage means OSM `waterway=river|stream|canal` plus water polygons. The connected-inundation rule, the margin and monotonicity are unchanged. ASF HAND stays available as a comparison (`build_flood.py --method hand`).

**Consequence:** accuracy now depends on OSM waterway completeness (drains are under-mapped), and this is stated in `data/FLOOD.md` and the UI disclaimer. Upgrade path unchanged: SDP LiDAR and drainage GIS, then SFINCS.
