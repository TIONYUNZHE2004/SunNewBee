# T-020 Replace "all yellow" with an honest "Likely OK (estimated)" level

- **Status:** assigned
- **Owner:** Local backend engineer (rules, data, API) + Local AI engineer (answers, validator)
- **Branch:** `local/backend-engineer` and `local/ai-engineer`
- **Priority:** P1 (before the 23 Oct proposal)
- **Lane:** Backend + AI (+ one small Frontend change, approved by Yunzhe for this task)
- **Source:** Yunzhe, 18 Oct: "we don't want everything yellow; we make our own decision"

## Decision (Yunzhe, 18 Oct)

Today almost every path is yellow "Not checked yet" for wheelchair, stroller and older adults, because the map has no width, slope or step facts. That hides what the map data does tell us. We add one level, so the map has four:

| Level | Colour | Meaning | Based on |
|---|---|---|---|
| Verified | solid green | Checked on site by staff | verified claims only |
| **Likely OK (estimated)** | **light green / teal, thin dashes** | **Our rules say this mode can probably use it** | **OSM tags and path type, by a written rule** |
| Not checked | yellow dashes | No basis for an estimate | nothing usable |
| Barrier | red | Known barrier, or not usable in this mode | claims, tags, flood, closures |

Honesty rules that do not change:
- "Likely OK" is **never** shown or said as verified, checked, safe or confirmed. It always says it is estimated from map data.
- An estimate never overrides a real fact: a verified or reported barrier stays red; a verified fact stays verified.
- Every estimate records **which rule** produced it (rule id + the tags used), so it can be shown and audited.
- A route made only of Verified + Likely OK segments gets its own status, e.g. `likely_ok` ("Likely step-free, estimated from map data, not checked"). It is never `confirmed`.

## Backend engineer: the rules and the data

1. Write the estimate rules per travel mode in one place (for example `config/profiles/*.yaml` or one rules module), each with an id and a one-line reason. Start from these and adjust with evidence from the T-018 audit:
   - Footway, sidewalk, pedestrian path, crossing in an urban area with no `steps`, no `incline` above the mode's limit, and no `surface` in (gravel, grass, dirt, sand, unpaved) → Likely OK for wheelchair and stroller.
   - `highway=steps` → Barrier for wheelchair and stroller (already so).
   - Track, path with unpaved or unknown surface outside built-up areas → Not checked.
   - Residential street centre line with no mapped sidewalk → walking: Likely OK; wheelchair and stroller: Not checked (a carriageway is not a sidewalk). Major road with no sidewalk → Not checked for all walking modes.
   - Driving: footways, sidewalks, paths and crossings are **not roads**: hide them or draw them grey "not a road", never red "not passable" (fold in T-018 item 4).
2. Expose the level per edge in `/layers/access` and in route results (with rule id), plus route metres per level.
3. Report the before/after counts per mode on the real seed (how much turns from yellow to Likely OK) in this log.

## AI engineer: answers and checks

1. Answers name the level honestly: "likely step-free (estimated from map data, not checked)". Never "confirmed" for a `likely_ok` route.
2. The validator rejects "step-free", "accessible", "wheelchair-friendly" and similar stated as fact for estimated segments, in EN/BM/中文.
3. The mock and the template handle the new status and wording; golden cases updated.

## Frontend (one small change, approved by Yunzhe for this task)

Add the "Likely OK (estimated)" colour and legend entry in `apps/web/src/features/scene/styles.ts` and the legend. List the files in the PR for shaoxian04.

## Acceptance

- Wheelchair map on the real seed: yellow drops substantially; every non-yellow line traces to a rule id or a fact.
- Tests: rule unit tests per mode; a route made of estimated segments is `likely_ok`, never `confirmed`; the validator rejects the bait sentences; driving shows no red footways.
- Backend lands first (contract note in this log); the AI engineer adapts; control merges one PR when CI is green.

## Log

- 2026-10-18 15:04 UTC · control (claude/sweet-davinci-29v7ne) · Created from Yunzhe's decision and assigned to both local engineers. Replaces T-018 item 4 and supersedes the "cap road routes at partly unverified" proposal in T-019.
