# Rest stops under flood scenarios and temporary closures

`87a11ae` fixes a crafted, reproduced route-correctness bug. A fresh verified seat claim could
make an older-adult journey `confirmed` even while that seat was likely flooded or actively
closed. Search, route materialization and centre rows without previews now share one rest-stop
availability gate. This changes no schema or ordinary-destination closure policy.

- Active closures and scenario FAIL exclude a rest stop.
- Possible flood or partial/uncovered raster coverage cap it at unverified. It can support only
  lenient rest search; a journey that needs it stays `partly_unverified`.
- Retained uncertain stops include existing flood warning and evidence fields. Expired/future
  closures, no scenario/baseline and usable alternate seats retain their behavior.

## Reproduction and HTTP checks

`api-before.json` and `api-after.json` are real curl responses on own API port 8021 from a
**crafted tiny rest-detour world**, not Elmina. It has verified seats at n-b, n-c and n-r, a
226.2 m detour through n-r, and a shorter 222.4 m route that breaks the 100 m rest limit.
Scenario edge classes are cleared to isolate the rest-place assessment. The possible-flood case
also has partial coverage; the unit/API tests exercise those causes separately.

| Rest-r condition | Before | After |
|---|---|---|
| Open, no scenario | confirmed, 226.2 m, limit met | unchanged |
| Likely flooded | confirmed, 226.2 m, limit met | partly unverified, 222.4 m, limit not met |
| Active staff closure | confirmed, 226.2 m, limit met | partly unverified, 222.4 m, limit not met |
| Possible flood / partial coverage | confirmed, 226.2 m, limit met | partly unverified, 226.2 m, rest-r unverified |
| Closure ended | confirmed, 226.2 m, limit met | unchanged |

`mock-chat.json` records one real mock `/chat` response on that fixture. The answer correctly
names the unverified rest stop but omits its explicit possible-flood and coverage warnings.
The complete answer check accepts it. This warning-publication gap is handed to the AI owner
alongside the two existing orientation bypasses. Recommended: retain all applicable engine
warnings in canonical selected-route prose. Backend does not edit agent source.

## Real seed controls

`seed-availability.json` is an availability scan, not proof of an incorrect real-seed journey.
There are 29 seating/shelter places, with 28 mapped stops. Available stops are 28 for no
scenario/baseline, 19 at +1 m, 15 at +3 m and 12 at +5 m. At +5 m only one retains a verified
rest state; two other verified seating claims are capped by possible flooding.

`seed-api-controls.json` saves real seed `/routes`, `/places`, `/layers/access` and mock `/chat`.
The older-adult park-b → playground route stays partly unverified, 416.4 m, with its rest-limit
advisory. Walking remains likely OK at 416.4 m; driving remains likely OK at 113.3 m. The access
layer returns 16,352 features. Mock chat ends without an error.

Checks: 101 affected routing/verification tests passed at the first checkpoint; final 23 focused
spatial tests and five API tests passed; lint passed. Required agent/API compatibility: **1,188
passed in 198.35 s**, including current cache-body checks. Golden: **23/23 mock**, zero fallbacks
or rejected attempts. The earlier 2,338-pass whole Python run
predates this change and is not reported as validation of the new rest-availability rule.
No source-service requests, live model calls or e2e this round. Spend: US$0.00.

Recording metadata: `6feb312` refreshes the Elmina code/world/day signatures. That command also
touched three Tiny-world headers; `6a82222` restores all three files byte-for-byte. The final
comparison contains only 22 Elmina header changes, with event bodies preserved and 22/22 replay
loads verified. Final demo/cache tests: **35 passed in 101.20 s** after the correction.

Final state: own app stopped, sockets 8021/5191 verified closed. No PR opened. The new
rest-availability contract acknowledgement and canonical AI route renderer remain pending;
source-backed junction rebuilding, legal-turn source data and the destination-closure policy
retain their existing blockers.
