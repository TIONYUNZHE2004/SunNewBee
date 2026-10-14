# Accessibility Data, Pedestrian Routing and Unknown-Handling

> Research for TownshipLens. Written 14 Oct 2026. Claims carry a source URL; anything not confirmed from a fetched page is marked "(unverified)". Companion file: [resident-agent-simulation.md](resident-agent-simulation.md). Source list: [../../reference/notes/access-sources.md](../../reference/notes/access-sources.md).

## TL;DR

1. **Do not invent a schema. Extend OpenSidewalks 0.3 (released 2026-01-27) and OSM tags.** OpenSidewalks already models nodes (curbs, curb ramps), edges (footway, sidewalk, crossing, steps) and zones, with `incline`, `width`, `surface`, `step_count`, `climb`, `tactile_paving`. It has a published JSON Schema. Add what it lacks: tri-state values, evidence, verification dates, closures, rest points, shade, and facility entrances.
2. **For a 100-500 edge graph, use NetworkX (or a 40-line Dijkstra) with a custom cost function.** Valhalla, GraphHopper, pgRouting and OSRM are built for planet-scale OSM data and cannot natively express "unknown". They are the township-scale story, not the hackathon build.
3. **Make unknown a first-class value, not a missing field.** Use three-valued logic (`yes`/`no`/`unknown`) per attribute per profile. Route twice: a strict pass (only verified-passable edges) and a lenient pass (unknown allowed, with penalty). Report **confirmed / partly unverified / no route found**. OpenTripPlanner's `unknownCost` and `onlyConsiderAccessible` options are the closest precedent.
4. **Provenance is a first-class column:** `source`, `method`, `verified_by`, `verified_at`, `evidence_ref`, `valid_until`, aligned to W3C PROV-O. Freshness decays trust. Stale facts degrade from "verified" to "needs re-check".
5. **Malaysian pitch numbers (cited below):** 805,509 registered persons with disabilities in 2024 (2.4% of population, DOSM); 60+ population 4.1 million / 12% in 2025, projected 13.3% by 2030; 2.31 million children under five. The governing standard is **MS 1184:2014** (with Amd. 1:2017), tied to UBBL By-law 34A and the PwD Act 2008 (Act 685), whose enforcement is weak. That weakness is the opening for a verified-data product.
6. **Rest points:** published bench-spacing guidance ranges from 50 m (strict) to 100-200 m. Use 50 m as the "frail" threshold and 100 m as the "general older resident" threshold, and make it a persona parameter.

---

## 1. Pedestrian accessibility data standards and projects

### 1.1 OpenSidewalks (Taskar Center for Accessible Technology, UW)

Current version is **0.3, released 2026-01-27**; it adds custom entities, trees, tree rows, wood polygons and leaf type/cycle fields ([GitHub schema repo](https://github.com/OpenSidewalks/OpenSidewalks-Schema)). The repo describes three entity classes and ships a reference JSON Schema (`opensidewalks.schema.json`) for GeoJSON plus a PostgreSQL schema.

| Class | Entities (per repo README) | Key fields |
|---|---|---|
| Nodes (Point) | Bare Node, Generic/Raised/Rolled/Flush Curb, Curb Ramp | `kerb=*` equivalents, `tactile_paving` on curb nodes |
| Edges (LineString) | Footway, Sidewalk, Crossing (+`crossing:markings`), Traffic Island, Pedestrian Road, Steps (+`step_count`, `climb`), Living Street, plus motor roads | `width` (m), `surface`, `incline` (signed, uphill positive), `length` (m), `foot` |
| Zones (Polygon) | Pedestrian Zone (`highway=pedestrian`) | `surface`, `foot`, `name` |

Source: <https://github.com/OpenSidewalks/OpenSidewalks-Schema>. The README fetch did not reveal an **Entrance** entity or explicit license text (unverified); we add entrances ourselves using OSM `entrance=*`. Mapping rules treat a crossing as a line whose endpoints are Curb nodes ([OpenSidewalks mapping rules PDF](https://tcat.cs.washington.edu/wp-content/uploads/OpenSidewalks_mapping_rulesForMapping.pdf)).

### 1.2 OSM tags we should reuse

| Concept | Tag | Notes (source) |
|---|---|---|
| Wheelchair access | `wheelchair=yes/limited/no/designated` | No default; `limited` = step <= 7 cm and key rooms stepless; `no` = step > 7 cm ([OSM wiki](https://wiki.openstreetmap.org/wiki/Key:wheelchair)) |
| Free-text reason | `wheelchair:description` | Recommended when unsure (same page) |
| Accessible toilet | `toilets:wheelchair` | (same page) |
| Kerb | `kerb=flush/lowered/raised/rolled` | flush ~0 cm, lowered <= 3 cm imply wheelchair `yes`; raised > 3 cm implies `no`; `kerb:height` for exact value ([OSM wiki](https://wiki.openstreetmap.org/wiki/Key:kerb)) |
| Slope | `incline=8 %`, signed along way direction | Tag the practical *maximum* on the steep section, not the average ([OSM wiki](https://wiki.openstreetmap.org/wiki/Key:incline)) |
| Steps | `highway=steps`, `step_count`, `ramp=*` | Standard OSM keys (not re-fetched; unverified) |
| Surface/width | `surface=*`, `width=*` | Standard OSM keys; also in OpenSidewalks |
| Blind users | `tactile_paving=yes/no` | On curb nodes in OpenSidewalks |
| Entrances | `entrance=yes/main/service`, `door=*`, `door:width` | Building entrances use `entrance=*` rather than `indoor=door` ([Simple Indoor Tagging](https://wiki.openstreetmap.org/wiki/Simple_Indoor_Tagging)) |
| Indoor | `level`, `indoor=room/area/corridor/door`, `highway=elevator`, `repeat_on` | Source page has no accessibility tags, so our attributes sit alongside ([SIT](https://wiki.openstreetmap.org/wiki/Simple_Indoor_Tagging)) |

The `kerb` page explicitly says choose the value on usability, not exact height. This supports our "record the verified judgement, optionally the measurement" approach.

### 1.3 Other standards and tools

- **IndoorGML 2.0 Part 1** (OGC, published 28 Aug 2025): conceptual model for indoor navigation networks; the GML encoding (Part 2) is not finished ([OGC announcement](https://www.ogc.org/ogc-publishes-indoorgml-2-0-part-1-conceptual-model-standard/)). Too heavy for the MVP; borrow the idea of a cell/connection graph.
- **Apple IMDF 1.0.0** (OGC Community Standard, 2021): GeoJSON-based indoor model ([OGC](https://docs.ogc.org/cs/20-094/)). No accessibility attributes found in the sources checked (unverified).
- **Project Sidewalk** (UW, Froehlich): crowdsourced street-view labelling plus AI. The DC pilot had 1,400 users auditing 2,934 km and ~250,000 labels ([arXiv 2206.13677](https://arxiv.org/abs/2206.13677)); the repo reports AI validation (DINOv2-based) in production and RampNet (ICCV'25) for curb-ramp detection ([GitHub](https://github.com/ProjectSidewalk/SidewalkWebpage)). Lesson for us: **labels get human validation, and AI only proposes**. Same stance as our staff-correction loop.
- **AccessMap** (UW): accessible trip planner with foot/wheelchair profiles and user-set max uphill/downhill incline ([OSM wiki](https://wiki.openstreetmap.org/wiki/AccessMap); GitHub org [AccessMap](https://github.com/AccessMap) has `accessmap`, `sidewalkify`, `crossify`).
- **Microsoft Soundscape:** 3D audio navigation for blind users, open-sourced in 2023 and discontinued as a Microsoft service ([Microsoft Research](https://www.microsoft.com/en-us/research/blog/microsoft-soundscape-new-horiz); repo [microsoft/soundscape](https://github.com/microsoft/soundscape)). Maintenance status in 2026 not checked (unverified).
- **Wheelmap / AccessNow / Google Maps wheelchair attributes / NaviLens:** not researched in depth; Wheelmap uses OSM `wheelchair=*`, Google exposes a wheelchair-accessible-entrance place attribute (unverified, no source fetched). Treat as competitive context, not dependencies.

### 1.4 Visual-impairment and tactile considerations

Our graph should carry `tactile_paving` (kerbs, crossings, stair tops), `lit`, and `handrail` as attributes, even if the MVP only answers wheelchair/stroller/older-adult profiles. A Malay Mail column describes tactile blocks that abruptly stop and missing kerb ramps as everyday local barriers ([Malay Mail, Jan 2026](https://www.malaymail.com/amp/news/what-you-think/2026/01/27/walkability-that-works-putting-standards-first-saral-james-maniam/206982)); that is opinion, not a survey, so use it as colour only. A fourth "low-vision/blind" profile is a stretch goal; Valhalla already has a `blind` pedestrian type ([Valhalla API](https://valhalla.github.io/valhalla/api/route/api-reference/)).

---

## 2. Malaysian context (pitch numbers)

| Fact | Number | Source |
|---|---|---|
| Registered persons with disabilities, 2024 | **805,509 (2.4% of population)**; learning disabilities 37.1%, physical 35.6% | DOSM release 11 Dec 2025, [DOSM](https://v2.dosm.gov.my/portal-main/release-content/person-with-disability-statistics-malaysia-2024) |
| JKM-registered OKU, 31 Jan 2024 | 756,681; Selangor highest (128,401) | Minister reply, via [Galen Centre](https://ova.galencentre.org/756681-persons-with-disabilities-oku-registered-with-jkm-as-of-january-31-2024/) |
| 60+ population 2024 | 3.9 million (11.6%) | DOSM Current Population Estimates 2024, via [Malay Mail](https://www.malaymail.com/news/malaysia/2024/07/31/malaysia-set-to-become-ageing-nation-by-2030-perak-leads-senior-surge-dosm-report-says/145577) |
| 60+ population 2025 | ~4.1 million (12%); 13.3% (4.8 m) by 2030; 15.1% by 2036 | Minister's figures, [Malay Mail Aug 2025](https://www.malaymail.com/news/malaysia/2025/08/26/second-finance-minister-says-malaysia-to-be-aged-nation-by-2048-govt-planning-blueprint-as-births-fall-lifespans-rise/188944) |
| "Aged nation" (65+ >= 14%) | projected 2048; "ageing nation" status already reached 2021 under UN definition | same Malay Mail source; [theSun](https://thesun.my/malaysia-news/news-malaysia-news-malaysia-to-become-aged-nation-by-2048-as-elderly-population-rises-ke14763889/) |
| Children under five, 2025 | 2.31 million | DOSM Children Statistics 2025 via [Galen Centre](https://ova.galencentre.org/dosm-live-births-under-5-deaths-vaccination-coverage-for-infants-decreased-in-2024/) |

**Pitch warning.** The commonly repeated "aged nation by 2030" claim conflicts with newer official framing: one 2024 report cites DOSM projecting >15% aged 60+ by 2030, while the 2025 ministerial figure is 13.3% by 2030 and "aged nation" (65+ at 14%) by 2048. Say **"about one in eight Malaysians is 60+ today, rising to ~15% by the mid-2030s"** and cite the DOSM/ministry source, not "aged nation by 2030".

**Standards and law**

- **MS 1184:2014** *Universal Design and Accessibility in the Built Environment - Code of Practice (Second Revision)*, declared 3 June 2014; amendment AMD.1:2017. It replaced MS 1184:2002 and MS 1331:2003 (outdoor access) ([JSM declaration](https://www.jsm.gov.my/images/2-standards/declarations/document/revision/2014/03062014.pdf); [PAM repository](https://repository.pam.org.my/handle/123456789/133); [summary](https://www.sydneyaccessconsultants.com.au/articles/580-understanding-ms-1184-2014-a-comprehensive-guide-to-universal-design-and-accessibility-in-malaysia.html)). No newer edition found (check the JSM catalogue before the final pitch). The standard text is paywalled; **we have not verified its exact ramp gradient, width or bench figures**. Our profile thresholds are therefore engineering defaults, labelled as such. Do not claim MS 1184 compliance.
- **UBBL 1984, By-law 34A:** buildings built after adoption must be accessible; older buildings had to retrofit within three years; adopted state by state in the early 1990s ([UM presentation](https://eprints.um.edu.my/11495/1/UM_KHU.pdf); [Borneo Post](https://www.theborneopost.com/2013/02/23/the-state-of-accessible-facilities/)).
- **PwD Act 2008 (Act 685):** sets the right of access, but the National Council cannot penalise non-compliance and there is no mandatory access audit ([UM journal](https://ejournal.um.edu.my/index.php/jdbe/article/download/10143/7189/20342)). The "islands of accessibility in an ocean of barriers" framing in the Borneo Post article captures our pitch: buildings may comply while the *connections between them* are unknown.
- **Stroller/parent evidence is thin.** We found a *Planning Malaysia* study of mothers' mode choice (194 respondents) focused on transit, not walkways ([Planning Malaysia](https://planningmalaysia.org/index.php/pmj/article/view/1211)). Use the 2.31 million under-fives figure plus on-site photos; do not claim a measured stroller-barrier rate.

---

## 3. Routing engines

| Engine | Pedestrian/wheelchair support | Fit |
|---|---|---|
| **NetworkX** (Python) | Anything you code: Dijkstra/A* with callable weight | **MVP. Best fit** for 100-500 edges; weight function can return `None` to forbid an edge |
| **unweaver** (nbolten) | Config-based engine with per-user "profiles" and dynamic edge costs; GDAL data; ~9 stars, directed graphs only ([GitHub](https://github.com/nbolten/unweaver)). AccessMap link unconfirmed (unverified) | Good design reference; too immature to depend on |
| **Valhalla** | `type=foot/wheelchair/blind`; `step_penalty` (0-43200 s), `use_lit`, `use_hills`, `walkway_factor`, `sidewalk_factor`; wheelchair type changes defaults. `max_grade` not documented on the page checked ([API ref](https://valhalla.github.io/valhalla/api/route/api-reference/)) | Township scale on OSM |
| **GraphHopper** | Pre-built foot/hike profiles; custom models via JSON; Apache-2.0 ([GitHub](https://github.com/GraphHopper/graphhopper)). Wheelchair profile not listed on README | Township scale, custom model is flexible |
| **OpenTripPlanner** | `wheelchairAccessibility`: `maxSlope` default 8.3%, `slopeExceededReluctance`, `stairsReluctance`, `inaccessibleStreetReluctance`, `unknownCost`, `onlyConsiderAccessible` ([OTP docs](https://docs.opentripplanner.org/en/latest/Accessibility/)) | Transit multimodal; its unknown handling is the best precedent |
| **pgRouting** | Dijkstra/A* SQL over PostGIS; custom cost columns | Township scale if staff data lives in PostGIS |
| **OSRM** | Fast, foot profile in Lua; no dynamic per-user costs | Poor fit for profile-dependent routing |
| **routingpy** | Unified Python client for Valhalla, GraphHopper, ORS, OSRM, OTP v2; Apache-2.0 ([GitHub](https://github.com/gis-ops/routingpy)) | Use if we later swap to a real engine |

**Recommendation.** Hackathon: NetworkX `MultiDiGraph` loaded from a JSON/GeoJSON file in OpenSidewalks-style structure. Township scale: export the verified graph to OSM-tagged GeoJSON, load into Valhalla or pgRouting, and keep our own tri-state pass on top. The slope default of 8.3% (OTP) equals the common 1:12 ramp ratio; MS 1184's exact figure is unverified.

---

## 4. Rest points, shade, lighting

**Bench/rest-interval guidance** (no single authority; pick and cite):

| Source | Interval |
|---|---|
| Active Travel England | under 50 m between resting points on active-travel routes ([ATE](https://activetravelengland.gov.uk/planning-active-places/benches-and-resting-points)) |
| Wysocki (via MDPI 2025 review) | 50-100 m for limited mobility; grading: 50 m optimal, 150 m convenient ([MDPI Sustainability 17(8251)](https://www.mdpi.com/2071-1050/17/18/8251)) |
| UN Enable design manual | 100-200 m, more on gradients ([UN](https://www.un.org/esa/socdev/enable/designm/AD1-03.htm)) |
| Singapore (reported) | no greater than 50 m ([MND](https://www.mnd.gov.sg/newsroom/speeches/view/written-answer-by-ministry-of-national-development-on-provision-of-seating-areas-in-retail-and-commercial-developments-for-elderly-and-individuals-with-mobility-challenges)); exact applicability unverified |
| Australian transport standards (reported) | resting points where access path exceeds 60 m ([DITRDCA doc](https://www.infrastructure.gov.au/sites/default/files/documents/resting-points.docx)); unverified |
| Ageing Better age-friendly seating guide (2026) | not read ([PDF](https://ageing-better.org.uk/sites/default/files/2026-03/Age-friendly-Seating-and-Rest-Areas-Quick-Guide.pdf)) |

**Our rule:** `max_gap_between_rests` is a persona parameter: 50 m (frail), 100 m (older resident default). The router does not just minimise length; it enforces a **hard constraint** on the longest rest-free run. Implementation: run Dijkstra over the state `(node, metres_since_last_rest)`; a transition that would exceed the limit is pruned; reaching a node tagged `seating=yes` resets the counter. This is a resource-constrained shortest path; with ~500 edges and 50 m buckets the state space is tiny.

**Shade/heat.** In a field study in a hot tropical city, walking distance in shade was discounted by a factor of 0.86 relative to sun, with building shadows having a stronger effect than trees ([Melnikov et al., Sci Rep 2022](https://pure.uva.nl/ws/files/68289680/s41598_022_06383_5.pdf)). A Hong Kong simulation found thermally-optimal routes beat shortest routes for 81% of O-D pairs, but shade-only routing proved unreliable ([PolyU](https://research.polyu.edu.hk/en/publications/active-route-choice-to-minimize-pedestrian-thermal-discomfort-in-/)). Use: record `shelter=covered/partial/none` (verified, covered walkway) and apply a soft cost of `length * 0.86` for covered segments, shown as "preference", never as a guarantee. Do not claim thermal modelling.

**Lighting/safety.** Record `lit=yes/no/unknown`. Valhalla's `use_lit` is the precedent for a soft penalty ([API ref](https://valhalla.github.io/valhalla/api/route/api-reference/)). Never state a route is "safe"; the original idea already excludes safety guarantees.

---

## 5. Unknown-handling: the central design decision

Each profile-relevant attribute (for example `step_free`, `slope_ok`, `width_ok`) evaluates to **PASS / FAIL / UNKNOWN** per edge. Rules:

1. **FAIL on any hard constraint** (step_count > 0 for stroller/wheelchair; raised kerb; width < profile minimum; active closure) removes the edge.
2. **UNKNOWN is not PASS.** If a hard-constraint attribute is missing, stale (older than `max_age`), or contradicted by a pending report, the edge is UNKNOWN.
3. **Two-pass routing:**
   - *Strict pass:* only PASS edges. If a route exists, answer **"Confirmed route"**.
   - *Lenient pass:* PASS + UNKNOWN edges, with UNKNOWN edges costed `length * k` (k ~ 5) so verified routes win. If a route exists only here, answer **"Possible route, N segments unverified"**, list them, and create verification requests.
   - If neither passes: **"No step-free route found in verified data"** (with the blocking edge).
4. **Return the evidence set**: every edge ID with attribute, source, verified_at. The LLM may only *phrase* this; it cannot add claims.
5. **Rank gaps by impact:** an UNKNOWN edge that is a bridge in many persona routes ranks first in the staff queue (cut-edge/frequency analysis). This turns routing into the knowledge-gap prioritiser.

This mirrors OTP's documented approach: with incomplete accessibility data `onlyConsiderAccessible=true` returns barely any results, so a configurable unknown cost is preferable ([OTP docs](https://docs.opentripplanner.org/en/latest/Accessibility/)); we simply surface the distinction to the user instead of hiding it.

---

## 6. Verification, provenance and freshness

- **Model:** W3C PROV-O: `Entity` (the attribute value), `Activity` (a site visit/audit), `Agent` (staff member, resident report, import script); `wasDerivedFrom`, `wasAttributedTo`, `generatedAtTime` ([PROV-O](https://www.w3.org/TR/prov-o/)). Store plain columns; export to PROV JSON-LD only if time permits.
- **Statuses:** `unknown -> reported -> verified -> stale -> contested`. Resident or agent-raised gaps create `reported`; only authorised staff move to `verified`.
- **Freshness:** `verified_at` + `ttl_days` per attribute class (closures: 7 days; steps/ramps: 365; seating: 180; surface: 365). Past TTL becomes `stale` and the edge degrades to UNKNOWN for hard constraints. TTLs are our assumptions, not from literature.
- **Trust score** (display only): `evidence_type` weight (staff on-site measurement 1.0, staff photo 0.8, third-party document 0.5, imported 3D/photogrammetry 0.3, LLM inference 0.0) times freshness decay. LLM-derived values never reach `verified`.
- **How others validate:** Project Sidewalk crowdsources labels then has independent users *validate* them (2M+ validations reported on its site, self-reported; [GitHub](https://github.com/ProjectSidewalk/SidewalkWebpage)) and now uses AI to pre-screen. OSM relies on local survey plus peer review; no formal timestamps per tag (`check_date=*` exists, unverified here). Our `verified_at` per attribute is stricter than OSM's norm.
- **Staff workflow pattern:** inbox of gap/report tickets sorted by impact, one-screen verify form (photo + tape-measure fields + status), append-only audit log, optional second-person approval for hard-constraint changes (four-eyes).

---

## 7. Recommended schema

Store as three tables / GeoJSON feature collections: `nodes`, `edges`, `places`, plus `attribute_claims` for provenance. JSON shown at edge level for readability.

**Node types:** `entrance`, `junction`, `curb_ramp` (OpenSidewalks `kerb=lowered`), `door`, `lift`, `parking_bay`, `poi_anchor`. **Edge types:** `footway`, `sidewalk`, `crossing`, `steps`, `ramp`, `corridor`, `lift_ride`, `indoor_link`. **Place types:** `facility`, `toilet`, `seating`, `shelter`, `drop_off`.

| Field | Type | Aligned to | Values |
|---|---|---|---|
| `id`, `type`, `geometry` | str, enum, geojson | OpenSidewalks | - |
| `length_m` | float | OpenSidewalks `length` | - |
| `width_m` | float (min clear width) | OpenSidewalks `width` | - |
| `incline_pct` | float, signed along direction | OSM `incline` (max on section) | - |
| `surface` | enum | OSM/OpenSidewalks `surface` | asphalt, concrete, paving_stones, gravel, ... |
| `step_count`, `step_height_cm` | int, float | OpenSidewalks `step_count`, `climb` | - |
| `kerb` | enum | OSM `kerb` | flush, lowered, raised, rolled |
| `ramp`, `handrail` | tri-state | OSM `ramp`, `handrail` | yes/no/unknown |
| `shelter` | enum | ours | covered, partial, none, unknown |
| `lit` | tri-state | OSM `lit` | yes/no/unknown |
| `tactile_paving` | tri-state | OSM | yes/no/unknown |
| `seating_adjacent` | tri-state | ours (or place link) | - |
| `wheelchair` | enum | OSM `wheelchair` | yes, limited, no, unknown |
| `closure` | object | ours | `{status, from, to, source}` |
| `surface_condition` | enum | ours | good, uneven, obstructed, unknown |

**Per-attribute provenance** (in `attribute_claims`, one row per edge+attribute):
`entity_id, attribute, value, status{unknown|reported|verified|stale|contested}, evidence_type, evidence_ref (photo/doc URL), method (tape/inclinometer/visual/import), verified_by, verified_at, ttl_days, notes, supersedes_claim_id`.

**Example edge**
```json
{ "id": "e_park_a__hall_main", "type": "sidewalk",
  "from": "n_parkA_exit", "to": "n_hall_main_door", "length_m": 62,
  "attrs": {
    "step_count": {"value": 0, "status": "verified", "evidence_type": "staff_site_visit",
                   "verified_by": "staff:amir", "verified_at": "2026-10-20", "ttl_days": 365,
                   "evidence_ref": "img/IMG_0412.jpg"},
    "incline_pct": {"value": 4.5, "status": "verified", "method": "phone_inclinometer", "verified_at": "2026-10-20"},
    "width_m": {"value": null, "status": "unknown"},
    "shelter": {"value": "partial", "status": "reported", "evidence_type": "resident_report"} } }
```

**Profile definitions** (thresholds are defaults, editable, not claimed to be MS 1184 values):

| Profile | Hard constraints | Soft costs |
|---|---|---|
| Stroller | step_count = 0; kerb in {flush, lowered}; width >= 0.8 m; incline <= 8.3% | surface roughness, shelter bonus |
| Wheelchair | as above plus width >= 0.9 m (unverified default), no `surface_condition=obstructed`, lift required over any level change | slope penalty above 5%, closure |
| Older resident | max step run 0 (or handrail + <= 3 steps, optional); max rest-free run 100 m (50 m frail) | shade 0.86 factor, lit, distance |

Nodes carry `valid_for_profiles` as derived data, so the router never reads raw attributes directly.

---

## 8. Build plan for 4 weeks (routing side)

- **Week 1:** hand-survey one facility; write 100-200 edges as JSON; validate against a JSON Schema fork of OpenSidewalks.
- **Week 2:** NetworkX router with strict/lenient pass and rest-run constraint; unit tests with fixture graphs (including a deliberately unknown edge).
- **Week 3:** attribute_claims table, TTL staleness, staff verify form, gap ticket generation.
- **Week 4:** persona test runner (see companion doc), pitch metrics (verified-edge coverage, gaps closed).

## 9. Open items and risks

- MS 1184 numeric thresholds are not verified (paywalled); ask mentors for access. [ ] 
- Whether SDP permits capture and publication of the chosen facility.
- The statistic on stroller barriers is missing; plan a small on-site count as primary evidence.
- Google/Wheelmap/NaviLens attributes need a quick competitive check before the pitch (unverified).
- OSM licence (ODbL) matters if we publish OSM-derived data; OpenSidewalks licence unconfirmed.

## Sources

- OpenSidewalks Schema: https://github.com/OpenSidewalks/OpenSidewalks-Schema ; mapping rules https://tcat.cs.washington.edu/wp-content/uploads/OpenSidewalks_mapping_rulesForMapping.pdf
- OSM wiki: https://wiki.openstreetmap.org/wiki/Key:wheelchair , /Key:kerb , /Key:incline , /Simple_Indoor_Tagging , /AccessMap
- IndoorGML 2.0: https://www.ogc.org/ogc-publishes-indoorgml-2-0-part-1-conceptual-model-standard/ ; IMDF: https://docs.ogc.org/cs/20-094/
- Project Sidewalk: https://arxiv.org/abs/2206.13677 ; https://github.com/ProjectSidewalk/SidewalkWebpage ; AccessMap https://github.com/AccessMap ; unweaver https://github.com/nbolten/unweaver
- Soundscape: https://www.microsoft.com/en-us/research/blog/microsoft-soundscape-new-horiz
- Valhalla API: https://valhalla.github.io/valhalla/api/route/api-reference/ ; GraphHopper https://github.com/GraphHopper/graphhopper ; OTP https://docs.opentripplanner.org/en/latest/Accessibility/ ; routingpy https://github.com/gis-ops/routingpy
- DOSM PwD 2024: https://v2.dosm.gov.my/portal-main/release-content/person-with-disability-statistics-malaysia-2024
- Galen Centre: https://ova.galencentre.org/756681-persons-with-disabilities-oku-registered-with-jkm-as-of-january-31-2024/ ; https://ova.galencentre.org/dosm-live-births-under-5-deaths-vaccination-coverage-for-infants-decreased-in-2024/
- Ageing: https://www.malaymail.com/news/malaysia/2024/07/31/malaysia-set-to-become-ageing-nation-by-2030-perak-leads-senior-surge-dosm-report-says/145577 ; https://www.malaymail.com/news/malaysia/2025/08/26/second-finance-minister-says-malaysia-to-be-aged-nation-by-2048-govt-planning-blueprint-as-births-fall-lifespans-rise/188944 ; https://thesun.my/malaysia-news/news-malaysia-news-malaysia-to-become-aged-nation-by-2048-as-elderly-population-rises-ke14763889/
- MS 1184 / law: https://www.jsm.gov.my/images/2-standards/declarations/document/revision/2014/03062014.pdf ; https://repository.pam.org.my/handle/123456789/133 ; https://www.sydneyaccessconsultants.com.au/articles/580-understanding-ms-1184-2014-a-comprehensive-guide-to-universal-design-and-accessibility-in-malaysia.html ; https://eprints.um.edu.my/11495/1/UM_KHU.pdf ; https://www.theborneopost.com/2013/02/23/the-state-of-accessible-facilities/ ; https://ejournal.um.edu.my/index.php/jdbe/article/download/10143/7189/20342
- Walkability/stroller: https://www.malaymail.com/amp/news/what-you-think/2026/01/27/walkability-that-works-putting-standards-first-saral-james-maniam/206982 ; https://planningmalaysia.org/index.php/pmj/article/view/1211
- Benches: https://activetravelengland.gov.uk/planning-active-places/benches-and-resting-points ; https://www.mdpi.com/2071-1050/17/18/8251 ; https://www.un.org/esa/socdev/enable/designm/AD1-03.htm ; https://www.mnd.gov.sg/newsroom/speeches/view/written-answer-by-ministry-of-national-development-on-provision-of-seating-areas-in-retail-and-commercial-developments-for-elderly-and-individuals-with-mobility-challenges ; https://www.infrastructure.gov.au/sites/default/files/documents/resting-points.docx ; https://ageing-better.org.uk/sites/default/files/2026-03/Age-friendly-Seating-and-Rest-Areas-Quick-Guide.pdf
- Shade: https://pure.uva.nl/ws/files/68289680/s41598_022_06383_5.pdf ; https://research.polyu.edu.hk/en/publications/active-route-choice-to-minimize-pedestrian-thermal-discomfort-in-/
- PROV-O: https://www.w3.org/TR/prov-o/
