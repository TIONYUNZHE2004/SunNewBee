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

## Root cause (control, confirmed offline)

The 3D map draws buildings within 3.5 km of the centre (`site.json` buildings.radius_m), which covers City of Elmina. Places, evacuation candidates and the walk graph are imported from the much larger `site.json` bbox (101.46-101.53, 3.15-3.24). So **107 of 225 places lie beyond the 3D map**; 103 of them are also outside the township boundary.

## Fix, kept simple (Yunzhe, 20 Oct: "don't over complex it")

**Backend engineer (data):**
1. Keep only places and evacuation candidates inside `base/boundary.geojson` + 200 m. Use the existing seed; no new Overpass download is needed. Leave the walk graph as it is.
2. Fix the 6 wrong types and drop the toll plaza; merge the node + area duplicates listed above (same name, under 150 m).
3. Re-record the demo cache with the mock. Check that place ids used in tests and golden still exist; if a test place is now outside, tell control.

**AI engineer (names): "type it sloppy, still found" (Yunzhe, 20 Oct).** People do not type exact names; Google says 1 in 10 search queries is misspelled. Simple version of what search engines do, in `find_place` + route binding:

1. **Normalise:** lowercase, drop punctuation, collapse spaces. Expand a short list of Malaysian short forms both ways: sk = sekolah kebangsaan, smk = sekolah menengah kebangsaan, sjk, sra, tmn = taman, jln = jalan, kg = kampung, sek = sekolah.
2. **Word prefixes, any order** (typeahead style): every typed word is the start of some word in the name. "sk tam" and "bukit subang sk" both match "SK Taman Bukit Subang".
3. **Small typos** (Algolia defaults): 1 wrong letter in a word of 4+ letters, 2 in 8+. "surau at takwa" matches "Surau At Taqwa".
4. **Rank:** exact > all words match > match with typos. Ties: name starts with the typed words; inside City of Elmina (like Google's location bias); shorter name.
5. **Decide:** one clear winner → use it, and the answer names it ("I took 'SK Taman' as SK Taman Bukit Subang"). 2–3 close → ask "Which one: A or B?". None → "I can't find that place. Did you mean X?". Never refuse because of wording, never use a place without naming it.
6. Bug: never add a derived alias that equals another place's name ("Surau SK Taman Bukit Subang" → alias "SK Taman Bukit Subang" collides with the school).
7. Tests, one per rule, EN and BM, including: "sk taman", "SK TAMAN BKT SUBANG", "tmn bukit subang", "surau at takwa", "klinik siti" (2 places → asks which one).

## Log

- 2026-10-20 07:26 UTC · control (claude/sweet-davinci-29v7ne) · Created from Yunzhe's report and control's offline audit.
