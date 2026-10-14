# data

Seed data for TownshipLens (City of Elmina, Shah Alam). Contract: see `docs/04-architecture/README.md`.

## Sources and licences

| Source | Use | Licence |
|---|---|---|
| OpenStreetMap via Overpass API | walk network, places, hydrology display | ODbL, "© OpenStreetMap contributors" |
| Copernicus DEM GLO-30 | terrain for flood lens (Task 4+) | Copernicus licence, © DLR/Airbus, provided under COPERNICUS by the EU and ESA |
| HAND (ASF) | height above nearest drainage (Task 4+) | CC0 |

## Placeholder facts

**`seed/elmina/access/overlay.geojson` holds demo facts, not survey results.** Every claim in it carries
`evidence_type: "team_survey_placeholder"` until the field visit replaces it. Do not present them as verified in the real world.
The unknown ramp and path lengths are listed in `seed/elmina/access/README.md`.

## Rebuild

```
pnpm data:build        # import_osm.py, build_overlay.py (then flood/waste scripts when present)
```

Overpass responses are cached in `data/cache/` (gitignored); delete it to refetch. Node ids (`n-<lat*1e7>_<lon*1e7>`)
are derived from coordinates because the cached `out geom` responses omit OSM node ids.

## Import (2026-10-15)

Envelope bbox (s,w,n,e) = 3.150, 101.460, 3.240, 101.530.

- ways fetched: 6631; walk segments: 15252 (`base/walk.geojson`, ~5 MB)
- places: 227 (210 with a node within 60 m)
- hydrology features: 204 (display only)
- overlay: 18 edges + 7 places (`park-b`, `lakeside-mall`, `playground`, `toilet-urban-park`, `bench-urban-1..3`)
- P1 416 m (via unknown ramp) vs verified detour P2 441 m
