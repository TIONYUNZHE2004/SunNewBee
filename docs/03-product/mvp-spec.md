# MVP Feature Specification

> **Scope rule:** if it isn't in this doc, it isn't in the MVP. New ideas go to [§ Later](#later-not-in-mvp).
> Priorities: **P0** = the demo fails without it · **P1** = needed for a strong final submission · **P2** = only if time allows.
> Journeys (J1–J6) are defined in [personas-and-journeys.md](personas-and-journeys.md).

## 1. Resident app (web, mobile-first)

### 1.1 Scene and map
| ID | Feature | Pri | Acceptance criteria |
|---|---|---|---|
| R-01 | 3D scene of the site from existing data | P0 | Loads in under 6 s on 4G on a mid-range Android; site centred; orbit/zoom/pan by touch |
| R-02 | Overlay: path segments coloured by status for the active profile | P0 | green = verified OK · amber = unknown · red = blocked/closed · grey = not relevant |
| R-03 | Place markers: entrances, toilets, seating, shelter, parking, drop-off | P0 | Tap marker → place card |
| R-04 | Route highlight + camera fly-to driven by assistant **map actions** | P0 | `highlight_route` animates the route, `focus_place` flies to the place |
| R-05 | 2D map fallback (toggle, and automatic when WebGL is unavailable) | P1 | Same overlay and markers on a 2D basemap |
| R-06 | Text/list mode (screen-reader friendly): route as numbered steps | P1 | Every step has text; passes a basic VoiceOver/TalkBack check |
| R-07 | Profile selector (default / stroller / wheelchair / rest-needed) | P0 | Changes overlay colours and routing |

### 1.2 Assistant
| ID | Feature | Pri | Acceptance criteria |
|---|---|---|---|
| A-01 | Chat panel with streaming answers | P0 | First token in under 2 s (p50) |
| A-02 | Grounded answers: every fact cites a tool result | P0 | 0 unsupported claims on the golden set |
| A-03 | Route answers with status: confirmed / partly unverified / blocked / no data | P0 | The status label is always shown; unknown segments are listed by name |
| A-04 | Evidence cards (photo, source type, verified date) | P0 | Tap → full-size photo + provenance |
| A-05 | Abstain + auto-create or upvote a verification request | P0 | "I don't know" answer explains *what* is missing; the VR is visible in the staff console |
| A-06 | Suggested questions (chips) on first open | P1 | 4 chips, one per persona |
| A-07 | Multilingual: English, Bahasa Melayu, 中文 | P1 | Answers in the user's language; place names unchanged |
| A-08 | Voice input | P2 | Browser speech API or STT model |
| A-09 | "Report an issue here" from a place card (resident-reported fact) | P1 | Creates a VR with `source_type=resident_report`; never auto-applied |

## 2. Staff console (desktop-first, password-protected)

| ID | Feature | Pri | Acceptance criteria |
|---|---|---|---|
| S-01 | Verification-request queue, ranked by demand (upvotes) and age | P0 | List + filters (open/resolved, type, place) |
| S-02 | Resolve VR: verify / correct / reject, with evidence upload | P0 | Writes the new attribute value + provenance + audit log entry |
| S-03 | Attribute editor for any node/edge | P0 | Tri-state controls; required `source_type`; optional photo |
| S-04 | Closures: create a time-bounded closure on an edge or place | P1 | The routing engine respects it immediately |
| S-05 | Recurring-questions view (clustered resident questions) | P1 | Top 10 clusters this week with counts |
| S-06 | Gap map: the scene coloured by unknown/stale density | P1 | Toggle on the map |
| S-07 | KPI tiles: % journeys confirmed, open VRs, median time-to-resolve | P1 | Numbers update after each resolve |
| S-08 | Audit log / history per attribute | P2 | Who changed what, when, and why |

## 3. Resident-agent simulation

| ID | Feature | Pri | Acceptance criteria |
|---|---|---|---|
| G-01 | 3 personas as constraint profiles (stroller, wheelchair, older_adult_rest) | P0 | Defined in versioned YAML/JSON |
| G-02 | Task generator: all origin–destination pairs among key places, plus LLM-proposed realistic tasks | P1 | Deterministic set + LLM extras, deduplicated |
| G-03 | Batch runner → outcome per journey | P0 | Outcomes: success / success_with_unknowns / blocked / no_data |
| G-04 | Gap ranking: which unknown attributes block the most journeys | P0 | Top-N list with "create VR" action |
| G-05 | LLM failure explanation in plain language | P1 | Each failed journey gets a 1–2 sentence explanation citing segments |
| G-06 | Before/after comparison across two runs | P2 | Shows improvement after VRs are resolved |

## 4. World model and backend

| ID | Feature | Pri | Acceptance criteria |
|---|---|---|---|
| W-01 | Graph schema with tri-state attributes + provenance | P0 | Per [world-model-schema](../04-architecture/world-model-schema.md) |
| W-02 | Site seed data: at least 30 nodes and 50 edges, ≥ 4 entrances, ≥ 2 car parks, toilets, seating, shelter | P0 | Loaded from a seed file; reproducible |
| W-03 | OSM/Overture import script for the site bbox | P1 | One command regenerates the base graph |
| W-04 | Routing per profile with route classification | P0 | Unit tests for every status |
| W-05 | Evidence storage (photos) | P0 | Upload + serve; EXIF GPS stripped; faces avoided or blurred |
| W-06 | Question log (anonymised) for recurring-question analytics | P1 | No personal data stored; text only, with a timestamp |

## 5. Non-functional requirements

| Area | Requirement |
|---|---|
| Privacy | No accounts for residents. No location tracking. Question logs have no user IDs. Photos contain no identifiable people. Clear notice of which LLM provider processes questions. |
| Accessibility (of our own UI) | WCAG 2.2 AA basics: contrast, keyboard, focus, text alternatives, chat in an ARIA live region. |
| Performance | Scene interactive in under 6 s on 4G; route answer in under 5 s p50. |
| Cost | Runs on free tiers or credits for the hackathon period. |
| Reliability for demo | A "demo mode" with cached LLM responses for the scripted journeys. |
| Honesty | The UI never shows "accessible" without a source and date. |

## Later (not in MVP)

Live crowd or flood sensing · own 3D capture / Gaussian splats · indoor floor-by-floor navigation · turn-by-turn GPS · resident accounts and personalisation · push notifications · facility booking integration · compliance certification (MS 1184 audit) · township-wide coverage · native apps · WhatsApp bot channel (strong P5 candidate: most Malaysian residents already use WhatsApp).
