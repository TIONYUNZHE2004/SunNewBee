# T-014 Tell sidewalks from roads in data, routing and answers

- **Status:** assigned
- **Owner:** Local backend engineer
- **Branch:** `local/backend-engineer`
- **Priority:** P1
- **Lane:** Backend (`data/scripts/import_osm.py`, `packages/spatial`, seed data)
- **Source:** Control's 18 Oct routing check

## Goal

Today the code cannot tell a sidewalk from a road. Separate OSM sidewalks become `footway` (the `footway=sidewalk` subtag is dropped); roads are one centre line typed `street`/`major_road`, and walking along it counts as walkable; `sidewalk=*` tags are read only on major roads (0 in the seed); the router has no preference for sidewalks. Control measured: Surau Al Mahdi → Surau At Taqwa (walking) is "confirmed" with 97% of its 364 m on road centre lines.

Decide and implement the smallest honest model, for example: keep the sidewalk subtag as its own type; link each sidewalk to its road; read `sidewalk=*` on all roads; make a road centre line cost more where a parallel sidewalk exists; and report per route how many metres run on a road with no mapped sidewalk, so the answer can say "about N m along <road>; sidewalk not mapped". Fold T-010 (crossing types) into the same seed rebuild. Route status rules stay tri-state; nothing becomes PASS that was not.

## Acceptance

A written design in the log first (what changes in data, evaluation, routing, API). Then: seed rebuilt through `overpass.py` (data in its own commit), tests on the real seed for the surau route and the hero route showing sidewalk use and the road-without-sidewalk metres, and the walking map layer able to show which lines are sidewalks. Every Backend file listed in the PR for Jun Quan.

## Log

- 2026-10-18 10:00 UTC · control (claude/sweet-davinci-29v7ne) · Created and assigned to Local backend engineer (Yunzhe, 18 Oct: scope B+, two local engineers).

- 2026-10-18 10:41 UTC · Local backend engineer (local/backend-engineer) · Started round: fetched origin and merged control 9621d6e (already included). Design before implementation: import highway=footway + footway=sidewalk as type=sidewalk; preserve explicit sidewalk claims for street/major_road; retain reported OSM provenance and never invent a road-sidewalk link from proximity. Walking searches apply a modest road-centre-line cost penalty while retaining strict-before-lenient evaluation; drive unchanged; no PASS/status-rule changes. Route composition will expose sidewalk_m, road_m and road_without_mapped_sidewalk_m (metres), plus road names/ids for caveats; access layer exposes sidewalk type and explicit sidewalk claim. Tool contract will be logged with examples before merge. Rebuild sidewalks plus T-010 crossings together through bounded overpass.py requests, data in separate commit, then dependent overlay/flood/waste and mock cache. Starting mock pnpm dev on 8021/5191 and curl baseline reproductions first. Spend planned US$0.
