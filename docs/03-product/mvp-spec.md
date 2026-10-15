# MVP Feature Specification

> **Scope rule:** if it isn't in this doc, it isn't in the MVP. New ideas go to [§ Later](#9-later-not-in-mvp). Any lens beyond `access`, `flood` and `waste` needs an ADR ([ADR 0009](../00-overview/decisions/0009-township-world-model-platform.md) scope guard).
> Priorities: **P0** = the demo fails without it · **P1** = needed for a strong final submission · **P2** = only if time allows. Calibrated for **3 students and about 4 weeks of build** (timeline: [../05-team/timeline.md](../05-team/timeline.md)); the flood lens week-by-week split is in [flood-disaster-lens § 8.6](../02-research/flood-disaster-lens.md).
> Journeys (J1–J10) are defined in [personas-and-journeys.md](personas-and-journeys.md). Names (lenses, profiles, tools, scenario ids, events) follow the [canonical names table](../04-architecture/README.md); endpoints and events are in the [API contract](../04-architecture/api-contract.md).

> **Status (2026-10-16):** the web UI is now two screens, `/` (map plus assistant) and `/tickets` (verification queue), with a day/night theme. The `/manage` console (KPI tiles, flood briefing, journey tests, closures) and the persona/scenario bars described in the M- and P- rows below were removed in that redesign; the backend endpoints stay. See [apps/web/README.md](../../apps/web/README.md) and the [redesign spec](../superpowers/specs/2026-10-16-frontend-redesign-two-screens-design.md). Rows below are the original scope, not the current UI.

## How the product is organised

```
Platform (3D hero · lite 2.5D · list view · chat · scene intents · management console)
   ├─ Lens `access`  (deep)  Elmina Urban Park + Lakeside Mall frontage verified on site
   ├─ Lens `flood`   (deep)  precomputed HAND river-stage scenarios, indicative, never a forecast
   └─ Lens `waste`   (thin)  20–40 hand-curated points
World model + backend (base twin, lens overlays, pipelines)  ·  Resident agents (automatic testers)
```

> **ID prefixes in this doc:** `P-` platform scene, `C-` chat/assistant, `M-` management & staff console, `AX-` access lens, `F-` flood lens, `W-` waste lens, `B-` world model/backend, `G-` resident agents. (Before the pivot the prefixes were R-, A-, S-, W- and G-; they were renamed so that `W-` can mean waste.)

## 1. Platform: scene and views (resident and management)

| ID | Feature | Pri | Acceptance criteria |
|---|---|---|---|
| P-01 | **3D hero view** of the whole City of Elmina: CesiumJS + Google Photorealistic 3D Tiles ([ADR 0007](../00-overview/decisions/0007-3d-engine-cesium.md)), credits on screen | P0 | Day-1 spike passed (tile quality over Elmina, mid-range Android test); loads in under 6 s on 4G; orbit/zoom/pan by touch |
| P-02 | Scene intents drive the camera and layers: `camera.fly_to`, `place.focus`, `route.highlight`, `flood.set_level`, `layer.toggle` | P0 | The AI and the UI emit intents only; one adapter per renderer draws them; a demo can be replayed from a list of intents |
| P-03 | Lens switcher (`access` / `flood` / `waste`) and layer toggles | P0 | Switching the lens changes the overlay and the suggested questions; base buildings and terrain stay |
| P-04 | Place markers: entrances, toilets, seating, shelter, parking, drop-off, evacuation centres, waste points | P0 | Tap a marker → place card |
| P-05 | Profile selector (`default` / `stroller` / `wheelchair` / `older_adult_rest` / `drive`) | P0 | Changes overlay colours and routing; `drive` is shown in the flood lens |
| P-06 | **Lite 2.5D view** (Mapbox Standard) using the same GeoJSON layers | P1 | Toggle ("Lite view") and automatic when WebGL or the Cesium chunk fails; same overlay, markers and flood layer |
| P-07 | **List / text view** (screen-reader friendly): routes as numbered steps, scenario results as lists | P1 (build the skeleton in week 1) | Every step has text; passes a basic VoiceOver/TalkBack check; always available |
| P-08 | "Fallback chain" switch: Google tiles → Cesium OSM Buildings + World Terrain | P1 | One config flag; used if Google tiles look poor over Elmina ([township-3d-engine-and-data § 1.4](../02-research/township-3d-engine-and-data.md)) |
| P-09 | Deep-spot shortcuts: "Urban Park + Lakeside" (access) and "Sungai Subang corridor" (flood) | P1 | Buttons fly the camera and activate the right lens |

## 2. Platform: chat and assistant

| ID | Feature | Pri | Acceptance criteria |
|---|---|---|---|
| C-01 | Chat panel with streaming answers (`text.delta`) | P0 | First token in under 2 s (p50) |
| C-02 | Grounded answers: every fact cites a tool result (`citation`) | P0 | 0 unsupported claims on the golden set |
| C-03 | Route answers with status: `confirmed` / `partly_unverified` / `blocked` / `no_data` | P0 | The status label is always shown; unknown segments are listed by name |
| C-04 | Evidence cards (photo, source type, verified date) | P0 | Tap → full-size photo + provenance |
| C-05 | Abstain + auto-create or upvote a verification request (`verification.requested`) | P0 | "I don't know" explains *what* is missing; the VR is visible in the staff console |
| C-06 | Assistant limited to the **10 canonical tools** + forced `final_answer`; PydanticAI over OpenRouter, model set in env ([ADR 0008](../00-overview/decisions/0008-agent-harness-pydantic-ai.md)) | P0 | Adding a tool needs an ADR and at least 3 golden questions |
| C-07 | Suggested questions (chips) per lens on first open | P1 | 4 chips for `access` (one per persona), 3 for `flood`, 1 for `waste` |
| C-08 | Multilingual: English, Bahasa Melayu, 中文 | P1 | Answers in the user's language; place names unchanged; identical tool calls across languages |
| C-09 | "Report an issue here" from a place card | P1 | Creates a VR with `source_type=resident_report`; never auto-applied |
| C-10 | `DEMO_MODE` cached responses for the scripted journeys | P0 | Demo runs offline from cache |
| C-11 | Voice input | P2 | Browser speech API or an STT model |

## 3. Lens `access`: accessibility & getting around (deep)

Already designed; this lens keeps its scope. Deep spot: **Elmina Urban Park + Lakeside Mall frontage** (bbox `3.1775,101.5055,3.1835,101.5135`).

| ID | Feature | Pri | Acceptance criteria |
|---|---|---|---|
| AX-01 | Overlay: path segments coloured by status for the active profile | P0 | green = verified OK · amber = unknown · red = blocked/closed · grey = not relevant (always with a text label and a pattern, not colour alone) |
| AX-02 | Route highlight + camera fly-to from assistant intents | P0 | `route.highlight` animates the route; `place.focus` flies to the place |
| AX-03 | Tri-state attributes with provenance (yes / no / unknown + source + date) on entrances, segments, amenities | P0 | Per [world-model-schema](../04-architecture/world-model-schema.md); the UI never shows "accessible" without a source and a date |
| AX-04 | Routing per profile with route classification | P0 | Unit tests for every status |
| AX-05 | Site facts surveyed on site: at least 30 nodes and 50 edges, ≥ 4 entrances, ≥ 2 car parks, toilets, seating, shelter | P0 | Loaded from a seed file; reproducible; field protocol in [field-verification-guide](field-verification-guide.md) |
| AX-06 | Verification-request loop (VR queue, resolve, evidence, audit; see M-01 to M-04) | P0 | The J5 before → after demo works end to end |
| AX-07 | Closures: time-bounded closure on an edge or place | P1 | The routing engine respects it immediately (`get_closures`) |
| AX-08 | Rest-point logic for `older_adult_rest` | P1 | Max gap between rest points reported; gaps over 150 m flagged |
| AX-09 | Gap map: the scene coloured by unknown/stale density | P1 | Toggle on the map |

## 4. Lens `flood`: flood / disaster what-if (deep)

Method: precomputed **HAND river-stage scenarios** (`baseline`, `stage_p1m` … `stage_p5m`) on Copernicus GLO-30 ([ADR 0010](../00-overview/decisions/0010-flood-lens-hand-scenarios.md)). Coverage: Elmina envelope plus the downstream Sungai Subang / Sungai Buloh corridor. Research: [flood-disaster-lens](../02-research/flood-disaster-lens.md).

| ID | Feature | Pri | Acceptance criteria |
|---|---|---|---|
| F-01 | **Scenario bar**: slider and presets (`stage_p1m` … `stage_p5m`, plus `baseline`) with the permanent disclaimer banner | P0 | Changing the scenario emits `flood.set_level`; the label always reads "indicative" |
| F-02 | **Water render**: one translucent extruded polygon per scenario, top face at the surface height, depth-tested against the 3D mesh | P0 | Water rises along Sungai Subang and the retention ponds; hydrology comes from the DEM pipeline only, **never from Google tiles** (licence and honesty); datum offset calibrated once at the Elmina lake surface |
| F-03 | **Edge colouring** by flood class for the active profile | P0 | `likely_flooded` = red (FAIL) · `possible` = stripe/amber (UNKNOWN) · `unlikely` = normal rules; colour-blind-safe with patterns; legend shows the margin |
| F-04 | **Re-route with scenario**: `plan_route(scenario_id=…)` for `default`, `stroller`, `wheelchair`, `older_adult_rest` and `drive` | P0 | A scenario can only *add* FAIL/UNKNOWN, never turn an UNKNOWN into PASS; `flood_notes[]` explain each affected element |
| F-05 | **Evacuation reachability**: `list_evacuation_centres(scenario_id, profile)` | P0 | Each centre labelled `osm_candidate` or `official_pps` (with evidence); reachable yes/no and route status per profile |
| F-06 | **Affected places and islands**: `affected_places(scenario_id)` | P0 for the cut-off list · P1 for islands | Lists `likely` and `possible` elements and `isolated_components` (clusters with no passing route to any centre) |
| F-07 | **Disclaimer on every scenario answer**: `disclaimer` SSE event + banner with official links (MBSA, JPS, NADMA) | P0 | 100% of scenario answers carry it; the validator rejects an answer without it; the word "safe" is never produced |
| F-08 | **"Why this edge?" popover**: scenario, margin, DEM source, method, version | P1 | Shows provenance; never a depth number to two decimals, only bands |
| F-09 | **Management flood briefing** (in the console, see M-05) | P1 | Cut-off list, islands, reachable centres per profile, baseline vs scenario |
| F-10 | **Advisory draft** (BM/EN/中文) with hedged wording and links | P1 | Shown in an editor; **never auto-sent**; a person edits and sends it outside the app |
| F-11 | Printable briefing (PDF/print view) with scenario provenance | P2 | One page; includes the disclaimer |
| F-12 | Resident flow: "Where can I go?" chat shortcut from the scenario bar | P1 | Uses the resident's profile; names the centre, shows the route and unknown segments, tells the user to check the official PPS list first |
| F-13 | **MET Malaysia warning banner** (optional live banner from `api.data.gov.my`) | P2 | Fails silently if the API is down; labelled as MET Malaysia's warning, not ours |
| F-14 | Isochrones / travel-time bands to centres | P2 | Computed per scenario with a cutoff |
| F-15 | Calibration against real events (4 Oct 2024, Apr 2025 photos or flood marks, if SDP/MBSA/residents share them) | P2 | Sanity check of the modelled footprint in Kampung Kubu Gajah; any mismatch is documented, not hidden |
| F-16 | Versioned depth-threshold parameters (YAML) shown to users | P1 | Wheelchair/stroller values labelled "our engineering default (no published source)" |

**Honesty rules for this lens (hard requirements, tested in [evaluation-plan](evaluation-plan.md)):**
1. Always "indicative scenario, not a forecast". Never "safe", never "no risk"; say "not in the modelled flood extent" instead.
2. No per-path depth to the centimetre; use bands and the three classes.
3. A scenario never turns UNKNOWN into PASS.
4. Elmina's core is **not** low-lying; the documented floods are in the downstream neighbours (Kampung Kubu Gajah / Paya Jaras). The demo must not present a dramatic whole-township flood.
5. Evacuation centres from OSM are only candidates unless an official PPS source is attached.
6. Official sources (MBSA, JPS, NADMA, MET Malaysia) are always linked; no scraping of JPS InfoBanjir without permission.

## 5. Lens `waste`: recycling & waste (thin)

About 2–3 days of work in total ([township-3d-engine-and-data § 3](../02-research/township-3d-engine-and-data.md)). It reuses the claims/verification model and adds no new infrastructure.

| ID | Feature | Pri | Acceptance criteria |
|---|---|---|---|
| W-01 | `waste_point` place type with subtypes (`bin`, `recycling_drop_off`, `e_waste_drop_off`, `composting_site`, `programme_site`) and 20–40 hand-curated points (IDs `wp-…`) | P1 | Each point has a source URL (or "site visit") and a checked-on date; nothing bulk-copied from aggregators |
| W-02 | `find_waste_points(type, near)` tool + `waste` layer in 3D and the list view | P1 | Returns status (`reported` / `verified` / `unknown` / `stale`) and evidence |
| W-03 | "Collection day: unknown, ask MBSA" card with the council contact | P1 | The gap becomes a VR like any other |
| W-04 | Q&A coverage: 5–8 golden questions ("where can I drop off old batteries?") | P1 | Verified/unknown wording; no invented schedules |
| W-05 | Field survey of waste points near the park (see [field-verification-guide](field-verification-guide.md)) | P2 | Points stay `reported` until visited |

## 6. Management console (desktop-first, password-protected)

| ID | Feature | Pri | Acceptance criteria |
|---|---|---|---|
| M-01 | Verification-request queue, ranked by demand (upvotes) and age | P0 | List + filters (open/resolved, type, place, lens) |
| M-02 | Resolve VR: verify / correct / reject, with evidence upload | P0 | Writes the new attribute value + provenance + audit log entry |
| M-03 | Attribute editor for any node/edge | P0 | Tri-state controls; required `source_type`; optional photo |
| M-04 | Closures UI | P1 | See AX-07 |
| M-05 | **Flood briefing view**: scenario picker, cut-off list, islands, reachable centres per profile, baseline vs scenario | P1 (cut-off list P0 via F-06) | Numbers come from the engine, not the LLM |
| M-06 | Recurring-questions view (clustered resident questions) | P1 | Top 10 clusters this week with counts |
| M-07 | KPI tiles: % journeys confirmed, open VRs, median time-to-resolve | P1 | Numbers update after each resolve |
| M-08 | Audit log / history per attribute | P2 | Who changed what, when, and why |
| M-09 | Evacuation-centre status editor: mark a centre `official_pps` with evidence | P1 | Changes the label and the answers; audit logged |

## 7. Resident agents (automatic testers)

Agents are **constraint profiles, not role-play**. Design: [resident-agents-design](../04-architecture/resident-agents-design.md).

| ID | Feature | Pri | Acceptance criteria |
|---|---|---|---|
| G-01 | 3 personas as constraint profiles (`stroller`, `wheelchair`, `older_adult_rest`) + `default` and `drive` | P0 | Defined in versioned YAML/JSON |
| G-02 | Task generator: all origin–destination pairs among key places, plus LLM-proposed realistic tasks | P1 | Deterministic set + LLM extras, deduplicated |
| G-03 | Batch runner → outcome per journey | P0 | Outcomes: success / success_with_unknowns / blocked / no_data |
| G-04 | Gap ranking: which unknown attributes block the most journeys | P0 | Top-N list with "create VR" action |
| G-05 | LLM failure explanation in plain language | P1 | Each failed journey gets a 1–2 sentence explanation citing segments |
| G-06 | Before/after comparison across two runs | P2 | Shows improvement after VRs are resolved |
| G-07 | **Flood evacuation journeys**: for every profile × scenario × residential cluster, "can this profile reach an evacuation centre?" | P1 | Report lists clusters/profiles that cannot, per scenario |
| G-08 | **Flood invariants** (deterministic checks, also run in CI) | P1 | (a) monotonicity: a higher stage never un-floods an edge (property test, e.g. Hypothesis); (b) a scenario never turns UNKNOWN into PASS; (c) `baseline` equals the no-scenario result; (d) every scenario answer carries the disclaimer and cites the scenario provenance |

## 8. World model and backend

| ID | Feature | Pri | Acceptance criteria |
|---|---|---|---|
| B-01 | Graph schema with tri-state attributes + provenance | P0 | Per [world-model-schema](../04-architecture/world-model-schema.md) |
| B-02 | **Base twin for the whole of Elmina** from open data: buildings (OSM/Overture), footways and roads (OSMnx), waterways and ponds, places. Clip the envelope (`3.150,101.460,3.240,101.530`) to a polygon | P0 | One command regenerates it; counts logged against [township-3d-engine-and-data § 2.2](../02-research/township-3d-engine-and-data.md) |
| B-03 | **Flood pipeline** (offline): GLO-30 → ASF HAND (CC0) → pysheds recompute → scenarios `stage_p1m` … `stage_p5m` → edge classes with margin → evacuation analytics | P0 (scenarios + edge classes) · P1 (recompute with pysheds) | Reproducible script; scenario provenance stored (DEM, method, threshold, margin, git hash) |
| B-04 | Drivable road graph (OSMnx) for the `drive` profile | P0 | Used by `plan_route(profile=drive)` |
| B-05 | Candidate evacuation centres from OSM (halls, schools, mosques, community centres) with `osm_candidate` label; official PPS entries added with evidence | P0 | `official_pps` only with an evidence link (e.g. the 4 Oct 2024 relief-centre report) |
| B-06 | Scenario store + REST (`/scenarios`, `/scenarios/{id}/affected`, `/evacuation-centres`) | P0 | Matches the [API contract](../04-architecture/api-contract.md) |
| B-07 | Evidence storage (photos) | P0 | Upload + serve; EXIF GPS stripped; faces avoided or blurred |
| B-08 | Question log (anonymised) for recurring-question analytics | P1 | No personal data stored; text only, with a timestamp |
| B-09 | Per-lens GeoJSON layers (`GET /layers/{lens}`) gzip + ETag | P0 | A few MB gzipped per lens |

## 9. Later (not in MVP)

| Item | Why later |
|---|---|
| **Data-centre / site-screening lens** (roadmap lens tied to SDP's SHIFT32 data-centre strategy) | Pitch and commercial slide only; needs its own data and an ADR |
| **SFINCS / hydrodynamic modelling** calibrated with SDP LiDAR, drainage GIS and gauge data | Pilot-phase work; replaces the HAND polygons behind the same API |
| Live river gauges (JPS InfoBanjir), rainfall nowcasting | No documented public API; needs written permission |
| Pluvial ponding layer (SCS-CN + depression filling) | Add-on after HAND |
| Registered vulnerable-resident lists, personal alerts, push notifications | Privacy and PDPA work |
| Live crowd sensing · own 3D capture / Gaussian splats · indoor floor-by-floor navigation · turn-by-turn GPS | Out of scope |
| Resident accounts and personalisation · facility booking integration | Out of scope |
| Compliance certification (MS 1184 audit) | We record measurements, we don't certify |
| Township-wide *verified* accessibility coverage | Only the deep spot is verified; the rest is open data marked `reported`/`unknown` |
| Native apps · WhatsApp bot channel (strong P5 candidate: most Malaysian residents already use WhatsApp) | After the hackathon |

## 10. Non-functional requirements

| Area | Requirement |
|---|---|
| Privacy | No accounts for residents. No location tracking. Question logs have no user IDs. Photos contain no identifiable people. Clear notice of which LLM provider processes questions. No vulnerable-resident lists in the MVP. |
| Accessibility (of our own UI) | WCAG 2.2 AA basics: contrast, keyboard, focus, text alternatives, chat in an ARIA live region. The list view is always available, including for the flood lens. |
| Performance | Hero scene interactive in under 6 s on 4G; route answer in under 5 s p50. Each flood scenario kept under about 50k polygon vertices; scenario switching swaps pre-baked polygons, with no runtime flood solve. |
| Cost | Runs on free tiers or credits for the hackathon period; Google tiles key restricted by referrer, with budget alerts. |
| Reliability for demo | `DEMO_MODE` with cached LLM responses for the scripted journeys; recorded backup video; lite view as a fallback. |
| Honesty (general) | The UI never shows "accessible" without a source and a date. |
| **Honesty (flood)** | See the six rules in § 4: always "indicative scenario, not a forecast"; never "safe"; no centimetre depths; scenarios never create PASS; OSM centres are candidates; official links always shown; no use of Google tiles to derive heights or extents; advisory drafts never auto-sent. Enforced by the validator, the golden set and invariants G-08. |
| Licences | Copernicus GLO-30 attribution; ODbL for OSM/Overture; Google tile credits visible; FABDEM (non-commercial) not used in the product. |
