# World integrity and AI integration checkpoint

`f1fea67` rejects malformed worlds before they can supply a route: duplicate IDs within a source, overlapping edge/place IDs, blank endpoint IDs, unusable line or point geometry, and conflicting positions for one node ID. Intentional overlay replacement across files still works. Distinct node IDs at equal coordinates remain disconnected. The API test confirms malformed data yields an error rather than a substituted tiny-world route.

This is a crafted data-integrity fix, not a real-seed identity finding. The committed Elmina seed loads 16,120 edges, 232 places and 11,736 consistent node positions. Its node IDs remain legacy coordinate-derived IDs; the original-OSM-node rebuild is still blocked by the source-service failures already logged on the board. No seed data changed this round. One fresh bounded source probe after the interruption still timed out; details follow below.

`ccddf0c` fixes my earlier test filename collision by renaming the API flood module to `test_api_flood_entrances.py`. Repository-wide collection now works. `f1fea67` also dates the positive `test_walkways` verification control and adds undated/expired composition controls, keeping the production verification rule intact. The AI engineer's reported failing test now passes. The earlier background test processes were interrupted and their partial output is not counted as a pass.

AI `c9da379` (`60a0d82` + `5c73728`) is integrated through `460e743`. Both previously saved probe sets now behave as expected (9 + 13), including the four English/Malay/Chinese wrong-turn paraphrases. The rest/sidewalk/flood contract acknowledgements are recorded on T-016. No agent source was edited by backend.

**Merge hold remains for two demonstrated orientation bypasses:** the complete validator accepts “Rotate clockwise onto Persiaran Elmina” on its left-turn fixture and “Follow Persiaran Elmina in the opposite direction.” They extend `../2026-10-20-zero-route/probe_remaining_navigation.py` to 15 cases: 13 expected results pass and these two fail. These are offline validator fixtures, not paid model answers or demonstrated bad seed routes. Recommended correction: publish canonical route summary/caveats from checked route fields and engine warnings, with deterministic maneuvers, instead of allowing arbitrary model navigation prose through a lexical exclusion list.

`api-controls.json` saves real-seed HTTP checks after the loader/AI merge: walking remains 416.4 m, driving 113.3 m, 16,352 access-layer features, expected place matches and a mock drive answer preserving mapped-end wording and both road-end/legal-turn warnings. Own app is stopped; ports 8021/5191 are checked closed. No e2e, live model calls or PR. Spend: US$0.

Final checks: **2,338 Python tests passed, 37 skipped in 315.51 s** after all source and fixture changes. This includes the required agent/API compatibility and all 23 cache-body checks. Also passed: 41 focused loader/walkway/API tests; 56 flood-build/world/API checks; 72 AI direction/closure tests; lint; golden 23/23 mock with no fallbacks/rejected attempts.

The first whole-suite run exposed one synthetic flood fixture that reused a node ID across independent raster samples at different coordinates (2,337 passed, 37 skipped, one failure). `5b8af8a` assigns distinct sample node IDs, preserving every coordinate and flood assertion. The final whole-suite rerun is green. `23be90e` refreshes all 22 demo metadata signatures; validated event bodies are byte-preserved and 22/22 replay loads succeed.

Source recovery remains blocked: after the long interruption, one read-only request through `data/scripts/overpass.py` to the Kumi mirror timed out (connect 5 s, read 18 s, one request, one attempt). No seed writes or further service retries followed. Loader guards do not prove the original junction identities of this legacy seed.

Recommended: review the backend changes now, and hold merge for the two reproduced AI orientation errors and green control CI. Source-backed rebuilding, legal turn data and the destination-closure policy remain explicit limitations. No PR was opened.
