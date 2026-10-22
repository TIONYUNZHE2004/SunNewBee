Independent review of Claude flood PR #32 at 6a335a86, in a detached worktree.

11 builder and lowlying-agent tests passed. The seed classes are possible only;
combined river likely classes remain unchanged; no numeric depth/height property
is published on terrain polygons. Public-report locations were not independently
verified here. The existing artifact explicitly scores zero hits and misses.

Rejected: ignored DEM border cells remain inside the screened coverage polygon.
A temporary tiny fixture, flat 8x8 DEM at 10 m, Config(min_fill_m=2,min_cells=4,
boundary_cells=2,connectivity=8,exclude_mapped_water=False), and
from_origin(101.5085,3.18125,0.0005,0.0005) put park-b in ignored row 0. Its
coverage entry is absent and endpoint_flood(default,lowlying) returns PASS.
No seed data or Claude source was edited for the probe.

Audit round 1 (three evidence questions):
https://github.com/TIONYUNZHE2004/SunNewBee/pull/32#issuecomment-6332314197

Claude owns the fix, regeneration and threshold/source evidence. Codex will rerun
the border probe after that fix. Terrain-UNKNOWN integration is b2ebd171 on Codex's
branch, not part of the old PR #32 head. No DEM/network build or live model calls.

Round 2 at dc4bdcbf (after PR #34)

12 builder/lowlying-agent tests pass. The original ignored-border probe now returns
uncovered/UNKNOWN. Seed coverage contains 1,421 gaps. Terrain marks remain possible
only and combined river likely classes are preserved. Threshold wording now states
a heuristic, gives LE90's limit, separates pre-exclusion sensitivity, and records
source URL, checksum, transform and build command. The handbook page/table and DEM
checksum were not independently verified here. Public-report accuracy stays unscored.

One evidence error remained: integration.json claimed seg-1079112114-1 was UNKNOWN.
Its access=no tag makes it FAIL for all profiles at baseline and under lowlying.
The audit artifact is corrected in this branch, with seg-24420799-0 (Jalan Paip,
uncovered) added as an unrestricted UNKNOWN control. No evaluator or seed flood
classes change. Terrain edge/place, river possible and river likely controls match
the intended rules.

Round 2: https://github.com/TIONYUNZHE2004/SunNewBee/pull/34#issuecomment-6341528885
