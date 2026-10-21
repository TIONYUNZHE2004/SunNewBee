# Access overlay (deep spot: Elmina Urban Park)

Demo facts are placeholders until the field visit (`evidence_type: "team_survey_placeholder"`, dated 2026-10-18). Unknown ramp: `seg-1306543755-2`. Confirmed path P2 length: `441` m; shorter path via ramp: `416` m.

- Route `park-b` -> `playground`: P1 (13 edges) goes through `seg-1306543755-2` whose `incline_pct` is unknown.
- P2 (13 edges) avoids it; every edge has verified placeholder claims (0 steps, 3 % incline, 1.5 m).
- Removed duplicate OSM places (same type within 25 m of an overlay place): osm-way-1308938137, osm-way-1318133036, osm-way-1346154592
- P1 edges: seg-1306543769-3, seg-1306543769-2, seg-1306543775-0, seg-1306543775-1, seg-1306543754-8, seg-1306543755-1, seg-1306543755-2, seg-1346147882-0, seg-1346147882-1, seg-1318133037-1, seg-1318133037-2, seg-1318133037-3, seg-1318133035-2
- P2 edges: seg-1306543769-3, seg-1306543769-2, seg-1306543769-1, seg-1306543769-0, seg-1306543758-0, seg-1306543755-4, seg-1306543755-3, seg-1346147882-0, seg-1346147882-1, seg-1318133037-1, seg-1318133037-2, seg-1318133037-3, seg-1318133035-2

## Demo corridor (navigation compare, demo polish B5)

Route `lakeside-mall` -> `osm-way-910487880`, profile `wheelchair`. Fastest walk 2076 m / 29.7 min crosses the real OSM steps `seg-1346147887-0` (placeholder `step_count` 3) at 1153 m. Wheelchair route 2168 m / 31.0 min (+1.3 min), 62% footway/path by length.

- 57 edges of both routes carry placeholder `step_count`, `incline_pct`, `width_m`, `covered` and (crossings) `kerb` claims; values are deterministic per edge.
- Unchecked on purpose: `incline_pct` on `seg-909868196-4` (60 m from 906 m).
- Covered (placeholder): seg-1346147882-1, seg-1318133037-0, seg-1318133035-0, seg-1343835668-1, seg-1343835668-0. Steepest incline (4.5 %): `seg-909875982-0`.
- Seating: no OSM bench within 15 m, so none is claimed.
