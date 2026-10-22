# Task 2: marathon audit round 1

22 October 2026. Engine code: c9add178; generated label index: 3358d5dd.
Control baseline: ce16538f. Mock only; zero live model calls. No DEM or network build.

The request starts at Elmina Valley Central Park, 5 km, 25 October 2026,
06:00–10:00 +08:00. All counts below come from the committed Elmina seed.

Q1 — repeated course

The old course repeats 1,429.31 m of 5,102.7 m (28.01%). The new proposal is
5,212.9 m, 95 ordered segments, with zero repeated physical metres. Three named-road
revisits remain over different segments; the warning remains. This is a bounded
proposal, not proof that every named-road revisit is necessary.

The old generator did not generate this alternative. It joined one root shortest-path
tree with one edge; it did not consider a different return path. Thus “rejected” would
be inaccurate. `old-candidate-membership.json` checks the new sequence and its reverse
against that old candidate set. The square-with-diagonal regression in
`test_marathon.py::test_alternate_return_finds_repeat_free_distance_that_one_tree_misses`
proves the omission and the correction. `_candidates` now excludes outbound edges
on return paths and samples several radii and directions. An in-band repeat-free
proposal precedes repeated proposals; the final pool is capped at 24.

Q2 — public names

“unnamed path near Buggy Path (stretch 217)” described one large branched network.
It now splits into degree-two chains at junctions and named roads. Example labels on
the same original course include “unnamed path near Jalan Metafasa U16/166
(north, 26 m path)” and “unnamed path near Iconic Bridge of Elmina City
(south-east, 81 m path)”. See `original-course.json` for the full before/after group.
Direction and measured length identify chains; coordinates disambiguate coincident
words. Labels are derived map descriptions, not surveyed names.

`test_marathon_sampling.py::test_public_unnamed_labels_have_landmarks_and_lengths_not_internal_ids`
rejects internal ids. The optional compiled index is validated against source geometry,
names and rules version; its parity/staleness test is in `test_closure_label_index.py`.
The separate road-label layer has 416 unique names, each anchor inside the configured
township boundary (`engine-edits.jsonl`). Course rows describe traversal order and may
repeat a road name; map labels remain one per name.

Q3 — cold time

Before: 7.865 s cold / 3.964 s warm. After: three fresh-world trials gave
4.810 / 4.490 / 4.668 s cold and 2.304 / 2.151 / 2.288 s warm. Timings exclude
`load_world`, whose elapsed time is recorded separately; they include snapshotting and
loading/validating the committed static label index. Each cold call has empty baseline
and course caches. Earlier intermediate trials exceeded 5 s; these are the final code's
three trials, not a selection of successful individual trials. Results are machine-specific.

Reproduce with `uv run python data/scripts/benchmark_marathon.py --cold-runs 3
--profile /tmp/marathon.prof`. Profiling runs separately from wall-clock trials.
Inclusive cProfile times overlap and must not be summed.

| Top five inclusive functions | Before (s) | After (s) |
| --- | ---: | ---: |
| marathon.simulate_marathon | 15.600 | 8.759 |
| marathon._simulate_marathon (new wrapper body) | — | 8.587 |
| events._simulate | 8.875 | 5.067 |
| twm._state | 6.014 | 4.589 |
| routing.plan_route | 6.007 | 4.575 |

The old fifth function was routing._plan (5.918 s), since the wrapper body was not
separate. Raw profiles are in `profile-before.txt` and the last row of `benchmark.jsonl`.
Changes: one frozen snapshot; bounded alternate-return search; lazy Dijkstra frontiers;
exact spherical road-snap candidates; static component reuse; incremental closure
reachability; aggregate projections that retain every RouteState fact; compiled labels.
Route weights, direction, barriers and rest constraints remain unchanged. Regression
tests compare ordinary and batch routes, weighted and reachability results, and full
versus aggregate RouteState facts.

Q4 — sample denominator

The old pool had seven parking origins (maximum 15%) and 20 destinations (maximum 7%)
per 100-trip profile. Seven origins cannot meet a 10% share cap. The old 60/300
no-route baseline is not caused by the event.

| Profile | Trips | Origins | Destinations | Largest origin | Largest destination | Baseline no route |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| default | 100 | 10 | 19 | 10% | 10% | 7 |
| wheelchair | 100 | 10 | 19 | 10% | 10% | 7 |
| drive | 100 | 10 | 19 | 10% | 10% | 7 |

This is a changed cohort: up to ten origins rotate across resident and transport
categories near the site centre. Outlying journeys are not represented, and this is
not measured demand. The new 21/300 baseline cannot be compared as an accessibility
improvement. Existing unavailable routes remain in the denominator, distinct from
new closure losses and endpoint-on-course cases. A small-pool limitation is emitted
once if any profile cannot meet the cap. Tests: diverse endpoints, one limitation
warning, pre-existing gaps and course-endpoint exclusions.

Q5 — resident destinations

`events.RESIDENT_DESTINATION_TYPES` is the explicit whitelist used by general closure
cutoff counts and course ranking. It includes homes, schools, shops, parks, health and
community/evacuation facilities, plus listed resident amenities. Bins, seating and
shelters do not count. Legacy simulate_event keeps its previous public contract.

For the same old course, five cutoffs become one resident destination: the unnamed
park (osm-way-1150761049). That park still supports reviewing a crossing; four pieces
of furniture no longer inflate the basis. The new course has six mapped resident
destinations cut off, listed in `benchmark.jsonl`; this is a different proposal, not a
five-to-six comparison. Demo provenance remains explicit; these counts do not certify
entrances or surveyed access. `test_bins_and_benches_do_not_trigger_resident_cutoff_suggestions`
checks both the count and suggestion basis.

Task 2 integration

`engine-edits.jsonl` records successful avoid/prefer, finish/point_to_point, 10 km and
21.1 km edits. The half-marathon proposal is 21,090 m / 304 ordered segments and
explicitly reports two laps. Unknown roads and places give clear errors.
`chat-edits.jsonl` records the unresolved AI-lane dependency: all five short follow-ups
call only find_place and abstain. This was posted to Claude on PR #31. No agent source
was edited. The authorized fixed-length test now reads the returned tool distance.
