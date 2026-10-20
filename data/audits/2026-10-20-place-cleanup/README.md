# T-022 offline place cleanup

The existing seed was filtered against the owner master-plan boundary plus 200 m.
No Overpass requests, live model calls, graph rebuild or demo recording were made.

| Stage | Base places | Evacuation candidates |
|---|---:|---:|
| Before (`2484218`) | 225 | 72 |
| Within boundary plus 200 m | 113 | 32 |
| After explicit exclusions, types and duplicates | 110 | 30 |

The seven overlay places remain, so the loaded world changes from 232 to 117 places.
The prison surau is outside scope and leaves both sets. The toll plaza is inside the margin
but is explicitly excluded. Two retained duplicate pairs are merged: Al-Amin Darul Musthopa
and Dewan Refelsia. The Rentak Perdana and Masjid Nurul Amin pairs are all outside scope.
Canonical records retain their own nodes, coordinates and claims.

Six type corrections are recorded in [cleanup.json](cleanup.json). Five follow control's
name-based ruling, without a new survey. NakNak Elmina's `amenity=restaurant` comes from the
existing OSM caches `bafda1c13350b5f6503a2d0fd5c88dd6001a27a3.json` and
`c0eddf781da7fb26fc6e310e2c5458480ff30bb1.json`. Taman Permainan is corrected before scope
filtering removes it. Tadika Fasa B8 and the tuition centre leave the school candidate set.
Unresolved generic building types remain gaps.

Flood place classes and coverage diagnostics drop removed IDs. Scenario definitions, flood
edge classes and polygons retain their values. Every other seed file, including the walk
graph and overlay, retains its SHA-256 hash; a repeated cleanup is byte-identical. See
[integrity.json](integrity.json).

[referenced-removed-ids.json](referenced-removed-ids.json) lists removed IDs used by tests,
the answer key and historical eval artifacts. Backend regressions now check that excluded
places return `no_data`, and the sidewalk regression uses temporary endpoints on the retained
graph. Control must coordinate the frontend mosque count and the answer key's candidate sets.
The AI engineer records demo turns once after merging.

Reproduce on a copy with:

```bash
uv run python -m data.scripts.cleanup_places --data-dir <copied-seed> --report <report.json>
uv run pytest data/scripts/tests/test_cleanup_places.py data/scripts/tests/test_seed_regression.py -q
```
