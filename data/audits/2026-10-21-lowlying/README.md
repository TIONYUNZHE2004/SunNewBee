T-029 validation, 21 Oct 2026 UTC

Real Elmina low-lying output is **not generated**. The DEM cache is absent. The normal
`build_flood.read_window` call to the public Copernicus DEM returned proxy CONNECT 403.
The build stopped before writing any scenario or polygon into the seed. Existing
river-stage files are unchanged. No synthetic DEM was used as seed data.

Two public-report searches were attempted: City of Elmina / Denai Alam floods in
December 2021, and flooded locations in Shah Alam in December 2021. Both failed at
the proxy with CONNECT 403. `validation.json` records the queries and errors. There
are zero usable reports in this audit. There are no verified location hits or misses.
This is an access failure, not evidence that floods or public reports did not exist.
No threshold was tuned to a report.

Local tests cover a closed basin, an open diagonal outlet, NoData outlets, tiny pits,
known-water exclusion, idempotence, threshold nesting, possible-only output, and
fixture generation through the scenario API. These are algorithm checks. They do
not establish real flood accuracy at Elmina.

To finish: apply the saved network additions in environment settings, run
`uv run python data/scripts/build_lowlying.py`, inspect the generated polygon/area
and affected-place counts, and commit the real seed outputs separately. Search the
public reports again. Record each source URL/date, the reported location and its
mapped match, and both overlaps and misses. Check several reports; do not tune to
one report. Preserve the DSM, 30 m, drains/culverts and rainfall limitations.

The driving profile still maps river “possible” to FAIL. Its rule is unchanged.
Yunzhe has been asked whether terrain-only marks should be UNKNOWN for driving.
The new terrain classes themselves contain only `possible`.
