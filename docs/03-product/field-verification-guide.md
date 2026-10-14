# Field Verification Guide

How we turn a site visit into **verified facts with evidence**. The quality of this data *is* the product: a beautiful UI over unverified data is just another map.

This guide has three surveys, one per lens (see [mvp-spec](mvp-spec.md)): **accessibility** (`access`, the deep survey at Elmina Urban Park + Lakeside Mall frontage), **waste points** (`waste`, a light survey) and **flood evidence** (`flood`, collecting evidence to sanity-check scenarios, not measuring floods). The first survey is unchanged; start there.

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

## Waste-point survey (lens `waste`, thin: 20–40 points in total)

Most waste points will be hand-entered from official sources and only a few visited. OSM has 0 `amenity=recycling` and only 5 waste baskets across the Elmina envelope ([township-3d-engine-and-data § 2.2](../02-research/township-3d-engine-and-data.md)), so **do not bulk-copy** from aggregator maps (no licence stated); enter each point by hand with its own source.

| Field | How to record |
|---|---|
| `wp-` ID and name | Short readable ID, e.g. `wp-park-bin-03` |
| `type` | `bin` / `recycling_drop_off` / `e_waste_drop_off` / `composting_site` / `programme_site` |
| Location | Pin in the app, or the nearest node; a photo of the point in its surroundings |
| `accepted_items` | Read the sign (paper, plastic, glass, batteries, old phones, food waste, garden waste); photograph the sign. If there is no sign: leave it `unknown` |
| Operator | SDP / MBSA / a company or NGO / unknown |
| Opening hours or collection day | From the sign or the official page. **If unknown, write `unknown, ask MBSA`**; never guess a collection day |
| Accessibility basics | Step-free approach yes/no/unknown, bin opening height if easy to measure |
| Source | `site_visit` (with date) or the URL of the official page, plus the checked-on date |
| Status | `reported` until someone has visited; then `verified`, with the date |

- Points further away (recycling and e-waste drop-offs within roughly 10 km) are **desk research**: confirm the operator's own page or phone number, and record the URL and the date you checked.
- SDP programme sites (the Central Park composting/edible-garden area, Elmina Rainforest Knowledge Centre workshops) are listed as `programme_site`; ask the township office before visiting.
- Council contact for schedules: use the MBSA number given in [township-3d-engine-and-data § 3](../02-research/township-3d-engine-and-data.md), and verify it before publishing.

## Flood-evidence collection (lens `flood`)

Purpose: **sanity-check our indicative scenarios** (HAND on a 30 m model) against what is on the ground and in residents' memories. We are *not* measuring or forecasting floods. Background: [flood-disaster-lens § 1.3, § 8.1](../02-research/flood-disaster-lens.md).

**What to collect**

| Evidence | How | Notes |
|---|---|---|
| **Flood marks** | Photograph watermarks on walls, fences, bridge piers or posts in Elmina and, if access is allowed, Kampung Kubu Gajah / Paya Jaras; place a tape measure or a ruler in the frame; note the nearest node and date seen | Record *what the mark is* (e.g. "mud line on wall"), not who it belongs to |
| **Resident memories** (with consent) | A 5-minute chat: "Where did water reach, in which month and year (Apr 2024, 4 Oct 2024, Apr 2025?), which road was cut?" Write it as `reported`, with an approximate date and place only | Verbal or written consent first (see the ethics checklist below). No names, no house numbers, nothing that identifies a household. Never press anyone who lived through a flood |
| **Drains and ponds** | Photograph drain outlets, culverts, the retention pond edges and any pumping station from public ground: size, condition, blocked or clear, signs of overflow | These feed our "drains are under-mapped" caveat (OSM has 43 drain and 41 ditch ways across the envelope, in our judgement under-mapped). Do not enter fenced or private areas |
| **Critical crossings** | Low points on roads, underpasses, footbridges that a route might use: kerb ramps, steps, whether they look prone to ponding | Same attributes as the accessibility survey, with a note "flood-relevant" |
| **Evacuation-centre candidates** | Halls and schools: entrance step-free yes/no/unknown, nearest accessible toilet, is there a sign saying it is used as a PPS (relief centre)? | Without an official source it stays `osm_candidate`. Do not mark `official_pps` from a sign alone |
| **Official documents** | PPS lists, MBSA/JPS notices, news reports for Oct 2024 and Apr 2025 | Save the URL and date. Ask SDP, MBSA and community groups for flood photos |

**Flood evidence rules**
1. **No people in photos**, and no faces, car plates, house numbers or family belongings. Photograph the water mark or the structure, not the household.
2. **Safety first.** Go only in dry weather, never near fast water, and never into a flooded or fenced area. Not during heavy rain (the best-times advice at the top still applies).
3. Everything is `reported` unless we measured it ourselves with a date and a photo.
4. Enter each item as evidence with `source_type` (`site_visit`, `resident_report`, `news`, `official`), a date and a place. If the mark disagrees with what a scenario shows, **record the mismatch**: it goes into the sanity-check section of [evaluation-plan](evaluation-plan.md); we do not tweak scenarios to match.
5. Sharing: ask SDP communications before publishing any flood photo or extent ([flood-disaster-lens § 9](../02-research/flood-disaster-lens.md), question 4).

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
- [ ] Flood memories: consent first, no names or addresses, no pressure. Make clear that the prototype shows indicative scenarios, not forecasts, and is not a reason to ignore official warnings.
- [ ] Thank participants (a drink or snack voucher, within budget).
