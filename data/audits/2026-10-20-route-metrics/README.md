# Reject invalid route metrics before search

`fc8c284` closes an input-integrity gap in `load_world`. A crafted tiny world with
`seg-ab.length_m=-100` produced a `confirmed` stroller route from Car Park B to Lakeside Mall,
with distance −100 m, duration −1.4 minutes and a negative departure-step distance.
`api-before.json` is the real curl response from own port 8021 before the fix.

The loader now rejects negative and non-finite edge lengths with `WorldDataError`, including
replacements from the access overlay. It preserves legitimate nonnegative values, including
zero-length coincident-position links. It does not invent a replacement measurement.
Healthy API fields, route statuses and schemas are unchanged.

`api-after.json` records the same malformed world after the guard: site, route, place and
access endpoints return 500, with no route or substitute tiny world. Chat emits an error and
`cannot_answer`. A malformed data source cannot become a checked route.

This is a crafted corruption finding, not an invalid measurement observed in the Elmina seed.
`seed-api-controls.json` records zero invalid lengths among all 16,120 real edges. Its walking
and stroller controls remain 416.4 m (likely OK / partly unverified respectively), and driving
remains likely OK at 113.3 m. The access layer has 16,352 features; mock chat finishes without
an error. The original-OSM-node rebuild and legal-turn limitations remain open.

Current checks: **67 loader/API/flood-build tests pass**; lint passes. The targeted matrix
covers negative fractional lengths, NaN, both infinities, base/overlay input, healthy metric
controls and malformed-world HTTP behavior. **23 current replay-body checks pass in 104.47 s**. Metadata commit `86b9951` refreshes
22/22 Elmina signatures with validated event bodies byte-preserved; every replay load succeeds.
The three Tiny-world files are untouched.
The earlier 1,188 agent/API, 35 demo/cache and 23/23 golden checkpoints predate this input-only
guard; this round does not claim a repeated full-suite result. No schema or frontend changes.
No e2e, live model calls, source-service requests or PR. Spend: US$0.00.

Recommended: review this backend guard, but keep the existing merge hold for the AI canonical
route renderer, its orientation bypasses and omitted rest-stop flood warnings. The prior
rest-availability contract acknowledgement is still pending.

Final state: own app stopped, ports 8021/5191 verified closed. Matching local checks are green;
GitHub CI is control-owned. No full suite was repeated for this input-only guard.
