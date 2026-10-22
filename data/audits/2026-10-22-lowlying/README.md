T-029 low-lying layer on the real DEM, 22 Oct 2026 UTC (cloud Claude; Codex audits)

The layer is now generated for the Elmina seed from the cached Copernicus GLO-30 window
(this environment reaches the public DEM; the 21 Oct attempt in `../2026-10-21-lowlying/` was
blocked). Output: 235 polygons, 2.84 km², 515 of 16,120 path segments and 6 places marked
`possible` (UNKNOWN). No depth, no FAIL, no "safe".

Thresholds (`config/flood/lowlying.yaml`), from `sensitivity.json`:
- Fill contrast ≥ 2.0 m. GLO-30's relative vertical accuracy is < 2 m (LE90) for slopes
  ≤ 20% (Copernicus DEM product handbook; Copernicus Data Space COP-DEM page). The first draft's
  1 m marked 6.1% of the window, much of it inside that noise; 2 m marks 3.5% before exclusions.
- At least 4 connected 30 m cells (~3,600 m²); outer 2 cells ignored.
- Not screened, stated as a gap: mapped hydrology, land-cover water (one 985-cell lake was
  missing from hydrology.geojson) and forest or scrub (GLO-30 is a canopy surface; tree gaps
  read as pits). 15,304 cells are not screened.

Validation (`validation.json`): no public report found names a flooded place inside the
township. Neighbouring Kampung Melayu Subang and Paya Jaras report repeated flash floods
(2022, 2024, 2026). Reports could not be geocoded here (Overpass and the article pages were
unreachable), so no hit or miss is scored. No threshold was tuned to a report.

Limits (kept in the disclaimer): GLO-30 is a 30 m surface model (buildings and trees raise
it); drains and culverts are not modelled; rainfall amounts are not modelled; unmarked areas
are not proof of absence.
