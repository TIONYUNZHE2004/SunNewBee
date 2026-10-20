# T-022 Clean the place data: township scope, types, duplicates

- **Status:** assigned (after the PR #15 fix-forward)
- **Owner:** Local backend engineer (data lane; Overpass through data/scripts/overpass.py)
- **Priority:** P1 (answers and evacuation candidates depend on it)
- **Source:** Yunzhe, 20 Oct: "the type of the locations is incorrect, verify the database"

## Control's offline audit (2026-10-20 07:26 UTC, seed at 2484218)

Full table: `tasks/data/T-022-places-audit.csv` (id, name, type, inside boundary, issue). Live OSM tags were not re-checked: Overpass is blocked in the control container.

1. **52% of places are outside City of Elmina:** 117 of 225 places sit outside `base/boundary.geojson` (owner master plan; RMS 24 m), e.g. Saujana Utama, Merbau Sempak, Bukit Subang, Sungai Buloh. **41 of 72 evacuation candidates are outside.**
2. **A prison surau is an evacuation candidate:** "Surau An Nur, Penjara Sungai Buloh" is in `flood/evac_centres.geojson`.
3. **Wrong or vague types (11):** Tadika Fasa B8 (kindergarten, typed school); Pusat Tuition Denai Alam Utama (tuition centre, typed school); Pangsapuri Cendana (apartment name, typed parking); Padang Bola (football field, typed park); Taman Permainan (playground, typed park); Plaza Tol Elmina (toll plaza, typed building); 5 more typed only "building" because the importer matched a name containing "Elmina" (Harmoni 1 show units, Rainforest Knowledge Centre, Pavilion, Sales Gallery, NakNak Elmina).
4. **Duplicates (same feature mapped as node + area):** Surau Rentak Perdana (12 m apart), Dewan Serbaguna Rentak Perdana (25 m), Dewan Refelsia (28 m), Al-Amin Darul Musthopa (69 m), probably Masjid Nurul Amin (146 m). Same-name different places: Klinik Siti (6.5 km), Surau Nurul Iman (5.4 km), unnamed "Surau" (2.5 km).
5. **119 of 225 places have no name** ("Parking (unnamed, OSM)" x38, "Park (unnamed, OSM)" x22).

Cause: `data/scripts/import_osm.py` keeps only the `amenity`/`leisure` value as the type, queries the whole bbox (101.46–101.53, 3.15–3.24), not the township outline, and keeps both node and area of one feature.

## Fix (backend engineer)

1. Tag each place `in_township: true|false` against the boundary (+100 m buffer). Places outside stay findable, but answers say "outside City of Elmina". Evacuation candidates: keep only inside + buffer, unless Yunzhe rules otherwise.
2. Remove candidates that residents cannot use (prisons, `access=private|no`); log each removal with its reason.
3. Types from more tags: `amenity=kindergarten` → kindergarten; tuition (`amenity=school` + name "Tuition"/`school=tuition`) → tuition_centre; `leisure=pitch` → sports_pitch; `barrier=toll_booth`/toll plaza → drop; name-only "building" → use `tourism`/`shop`/`office`/`amenity` when present, else drop it from places.
4. Merge duplicates: same normalised name + type within 150 m → one place (prefer the area; keep the node id as an alias id).
5. Re-run `pnpm data:build` with the Overpass cache, re-record the demo cache with the mock, and report the before/after counts here.

## Acceptance

- Audit script re-run: 0 duplicates under 150 m, 0 name/type mismatches from the list above, prison surau gone from candidates, inside/outside count reported.
- `uv run pytest -q` and `pnpm golden` green; segment and place ids used in tests still exist.

## Log

- 2026-10-20 07:26 UTC · control (claude/sweet-davinci-29v7ne) · Created from Yunzhe's report and control's offline audit.
