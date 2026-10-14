# 0004. Accessibility attributes are tri-state (yes / no / unknown) with provenance

- Status: accepted
- Date: 2026-10-14
- Deciders: whole team

## Context
Most map data treats a missing tag as "probably fine". For a wheelchair user, "probably fine" can mean a wasted trip. The knowledge-gap loop only works if the system *knows what it doesn't know*.

## Decision
- Every accessibility-relevant attribute is `yes | no | unknown` (or a number plus `unknown`), never a silent default.
- Every attribute stores provenance: `source_type`, `source_ref`, `recorded_by`, `verified_at` and `evidence_ids`.
- The routing engine classifies each route as **confirmed** (all segments known-OK for the profile), **partly unverified** (feasible only if unknowns turn out OK; the unknown segments are listed), **blocked**, or **no data**.
- Hitting an `unknown` on a requested journey creates (or upvotes) a **verification request**.

## Consequences
- The schema is slightly more verbose. The data-entry UI must make `unknown` easy to set and easy to resolve.
- Answers stay honest: "Route found, but the ramp at segment S12 is unverified (last checked: never)."
- This gives a measurable ops KPI: unknowns resolved per week, and the share of journeys that are fully confirmed.
