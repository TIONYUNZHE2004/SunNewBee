# Field Verification Guide

How we turn a site visit into **verified facts with evidence**. The quality of this data *is* the product: a beautiful UI over unverified data is just another map.

## Before you go

- [ ] Check the site's public-access rules. Public parks and walkways are fine; for building interiors and private areas, **ask the management office first** and record who gave permission.
- [ ] Print or download the current graph as a checklist (BE can export `GET /export/checklist?bbox=...`, or use the seed CSV).
- [ ] Go as a pair: one person measures, one person records.
- [ ] Kit: phone with camera, a tape measure (3–5 m), a free inclinometer/level app for slopes, a water bottle (heat), a portable charger.
- [ ] Best times: weekday morning (few people in photos), not during heavy rain.

## What to record

For every **entrance**:
| Attribute | How to measure |
|---|---|
| `step_free` yes/no | Any step or kerb above about 2 cm at the threshold = no |
| `step_count`, `step_height_cm` | Count and measure the highest step |
| `door_width_cm` | Clear opening width with the door open |
| `door_type` | automatic / push / pull / sliding / revolving / none |
| `ramp` + `ramp_slope` | Inclinometer on the ramp surface, in degrees or as a ratio (1:12 ≈ 4.8°) |
| `handrail` | yes/no, one side or both |
| `opening_hours` | From the signage (photograph the sign) |
| `tactile_paving` | yes/no |

For every **path segment** on the demo routes:
| Attribute | How |
|---|---|
| `has_steps` / `step_count` | Count |
| `max_slope` | Measure the steepest part |
| `min_width_cm` | Narrowest point (bollards, poles, parked motorbikes) |
| `surface` | paved / tiles / gravel / grass / grating |
| `covered` (shelter from rain/sun) | yes / partial / no |
| `kerb_ramp` at crossings | yes/no, and flush? |
| `lighting` | yes/no (for evening use) |
| `obstacles` | Free text plus a photo |

For every **amenity** (toilet, accessible toilet, baby-changing room, bench, shelter, water fountain, surau):
location (pin it in the app or note the nearest node), `accessible` yes/no/unknown, opening hours, photo.

## Evidence photo rules

1. **No identifiable people.** Wait for people to pass, or reframe. If a face appears, blur it before upload (FE provides auto-blur in P2; until then, blur manually).
2. **No sensitive details**: car plates, security keypads, CCTV positions, children.
3. Photograph the **thing that proves the fact**: the step, the ramp with the level app visible, the sign with opening hours.
4. Filenames: `YYYYMMDD_<nodeOrEdgeId>_<attribute>.jpg`. EXIF GPS is stripped on upload.

## After the visit (same day)

1. Enter the facts through the staff console (or the bulk CSV import) with `source_type=site_visit`, `verified_at=<visit date>`, `recorded_by=<initials>`.
2. Anything you couldn't check stays `unknown`. **Never guess.**
3. Anything that conflicts with existing data: create a VR with both values, so the team decides.
4. Post a summary in the team chat: facts added, unknowns remaining, surprises (surprises make good pitch stories).

## Ethics checklist for user-testing sessions

- [ ] Verbal or written consent; explain that it's a student hackathon prototype.
- [ ] No names recorded, or pseudonyms only. No audio or video without explicit consent.
- [ ] Participants can stop any time.
- [ ] Don't present the prototype's accessibility info as reliable for real trips during testing.
- [ ] Thank participants (a drink or snack voucher, within budget).
