# Source-node cache readiness

The original-OSM-node rebuild remains blocked. `readiness.json` checks the exact current
`import_osm.py` query keys without network calls: three of nine walk queries are present,
and none of six major-road queries are present. Twelve required answers are missing.
These are query counts, not a measure of route coverage. Older geometry-only caches do not
establish the missing node identities.

The available 1,754-way subset passes the importer's node-ID/geometry consistency check and
splits into 3,566 segments. That proves consistency within this subset only. It cannot replace
the full legacy seed or prove its junctions. The cached DEM does not close this source gap.

`recovery-probe.json` records one request for the first missing walk tile at 22:52 UTC,
through `data/scripts/overpass.py`. It used the primary mirror, a one-request hard cap and
5/18-second connect/read limits. The read timed out after 18.43 seconds. No cache entry or
seed file was written, and no further source request followed.

Recommended: retain the committed seed and its stated limitations. Resume the missing source
queries when the service recovers; require complete way node IDs and consistent geometry
before rebuilding in importer → overlay → flood → waste order. Compare connectivity, route
choices and flood results, then refresh mock recordings. The saved first missing cache key is
`cefd5bcc773b8e364cf283fe6abe14d7cd75c9d9.json`; its exact query is in both JSON files.
A successful first request alone would leave eleven required road-query answers missing;
other pipeline inputs must also be checked before any seed write.

This round changes audit records only. Runtime code, the seed and demo recordings are unchanged.
No CI rerun is needed under the board's docs-only rule; artifact formatting and diff checks
are performed. Own app remains stopped. No PR, e2e or live model calls. Spend: US$0.00.
The AI canonical route renderer, rest-availability acknowledgement, legal-turn source data and
ordinary-destination closure ruling remain separate dependencies.

Source: cached OpenStreetMap contributor data via the existing Overpass pipeline, ODbL.
