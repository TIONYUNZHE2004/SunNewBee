# Mapped one-way driving check

Backend commit `752c2a1` applies retained OSM one-way direction to route search and flood-centre reachability. Ordered node-pair choices preserve the correct parallel carriageway. Vehicle one-way rules do not alter pedestrian routing.

Real API comparison is saved in `route-comparison.json`. Car Park B → playground previously went against `oneway=yes` on `seg-1306543778-0` (113.2 m). It now selects a legal mapped direction (113.3 m). Reverse remains 113.2 m; both mosque controls remain 352.0 m. All four final paths have zero against-tag traversals.

This is not a legal navigation guarantee. Turn-restriction relations remain unmodelled, and the legacy seed lacks some directional subtags and original node identities. Conditional/reversible directions stay unknown with warnings. The drive endpoint is 123.3 m short of the playground, as the API warning states; do not call this physical arrival.

Checks: affected routing/access/tool/import tests 186 passed; final direction/access/import checks 72 passed; flood tools/core API 40 passed. Lint and generated client drift checks passed. Golden 23/23, zero fallbacks/rejections. After integrating AI 3f02d69, 1,125 agent/API tests passed and one closure-wording test failed; the reproduction is on T-021. Maneuver claim baits also expose four accepted false statements. These AI integration issues block merge until corrected.

Live model questions: 0. Spend: US$0. No e2e run, as instructed.
