# MVP Site Selection

> Researched 14 Oct 2026. Data checks marked "ran" were executed by us against the live OpenStreetMap Overpass API on 14 Oct 2026; everything else is cited [L1]... or marked "(unverified)".

## TL;DR

- **Top pick: Elmina Urban Park (Central Park, "Urban Park" precinct), City of Elmina, Shah Alam, with the Elmina Lakeside Mall frontage as the arrival/entrance node.** Bbox (S, W, N, E): **3.1775, 101.5055, 3.1835, 101.5135** (about 0.67 km north-south by 0.89 km east-west, roughly 0.6 km2). Centre about **3.1805 N, 101.5095 E**.
- **Why:** it is SDP's flagship township, open to the public, adjacent to an SDP-owned mall that opened in Aug 2024 (180,000 visits in week one), and it mixes mall entrances, car parks, footways, a playground, a pedestrian bridge and waterside paths, so accessibility questions are genuinely interesting. The mall's ~214,000 sq ft NLA spread over nine single/double-storey blocks and the adjoining park mean one site covers "arrival, path, destination" [L1][L2].
- **Data check (ran):** OSM has the pedestrian skeleton (54 footways and 58 buildings in the bbox, including the mall) but almost no accessibility facts: 0 mapped entrances, 0 kerb nodes, 0 toilets, 1 bench. 28 of 54 footways carry `wheelchair=yes` + `surface=concrete`, with no width or incline: asserted, not verified. That is the ideal story for a verification loop.
- **Google Photorealistic 3D Tiles:** Google's coverage table lists Malaysia with 2D and 3D Map Tiles as available [L3]. We could not confirm mesh quality over Elmina without a browser/API key (unverified); 5-minute check in Google Earth web is the first task. **Policy warning:** Google's terms bar image analysis, machine interpretation, object detection and geodata extraction, and restrict caching/offline use [L4], so use the tiles only as a visual backdrop and build the spatial graph from our own survey and OSM.
- **Shortlist:** (1) Elmina Urban Park + Lakeside Mall frontage; (2) Elmina Rainforest Knowledge Centre and Central Park forest precinct; (3) Bandar Bukit Raja Wetland Townpark with the MBDK community hall.

---

## 1. Selection criteria

| # | Criterion | Why it matters | Weight |
|---|---|---|---|
| 1 | Publicly accessible without membership | Residents and judges can visit; permission is easier | High |
| 2 | Accessibility complexity (entrances, level changes, bridges, paths, shelter) | Makes the assistant's answers non-trivial | High |
| 3 | Community relevance and footfall | Real questions from real residents | High |
| 4 | Existing data (OSM detail, 3D coverage, SDP documents) | Faster build within 4 weeks | Medium |
| 5 | Student feasibility (distance, daylight, safety) for 2 to 3 verification visits | We must verify by hand | High |
| 6 | Alignment with SDP flagship messaging (SSR2030 Community Experience, inclusion, biodiversity) | Strategic Fit and Feasibility score 15% + 20% | High |
| 7 | Clear owner/contact (SDP township office) for permission and ops loop | Pilot path | High |
| 8 | Bounded size (about 0.5 to 1 km2) | Fits MVP scope | Medium |

## 2. Ranked shortlist

| Rank | Site | Location (OSM) | Strengths | Risks | Score (our judgement, 1-5) |
|---|---|---|---|---|---|
| **1** | **Elmina Urban Park + Lakeside Mall frontage** (Central Park Urban precinct) | Lakeside Mall 3.18133, 101.50990; Urban Park 3.17999, 101.50956; playground 3.18077, 101.51053; Sales Gallery 3.18032, 101.50823; Iconic Bridge 3.17968, 101.51289 | Flagship township; SDP-owned mall plus adjoining park; daily footfall; mix of mall blocks, parking, footways, waterway views, a dragon-bridge lookout, playground; sparse OSM attributes; SDP is a known accessibility champion in Elmina [L1][L2][L5] | Mall interior is private (needs mall management consent); park layout may still change; heat/rain affect paths; Google tiles quality unconfirmed | **4.4** |
| 2 | Elmina Rainforest Knowledge Centre (ERKC) and Central Park forest precinct | ERKC 3.17115, 101.50065; Central Park West 3.17785, 101.50637 | Strong biodiversity/ESG story; boardwalks and trails raise real access questions; 13,000+ people engaged in programmes [L6] | More remote, programme-based opening, less daily footfall; trails and boardwalk geometry harder to verify; fewer "everyday" questions | 3.6 |
| 3 | Bandar Bukit Raja Wetland Townpark + Dewan MBDK community hall | Dewan MBDK Bandar Bukit Raja 3.08673, 101.43977; wetland park (180 acres) | Large park, 75 km track, community pavilion, 64 bird species; Klang council hall relevant to "community hall" scenario [L7][L8] | Hall is council-run (SDP may not own the data); accessibility of the park undocumented; farther from most students (unverified); lower SDP flagship visibility | 3.2 |

Also considered and rejected for the MVP: **Serenia City** (Sepang; newer, fewer mature public facilities; unverified details), **Nilai Impian lake park** (further south), **KLGCC Resort** (members' club, not public), and any **"community hall"** inside Elmina (we found no SDP community hall in OSM within the bbox; the "Dewan Refelsia" in OSM sits in the adjacent Bukit Subang area and is not an SDP facility as far as we know).

## 3. Top pick in detail

### 3.1 Scope for the MVP
- **Facility:** Elmina Urban Park (public), reachable from the Lakeside Mall frontage.
- **In scope:** 3 to 4 car-park or drop-off nodes, the mall's outdoor frontage and entrances (outside only, plus any publicly accessible toilets), the park's main footways, the playground, the bridge/lookout, seating and shelters, and the Sales Gallery as a landmark.
- **Out of scope:** mall interior shop layouts, residential streets, Central Park sports/forest precincts.

### 3.2 Bounding box
- **WGS84 (S, W, N, E):** 3.1775, 101.5055, 3.1835, 101.5135
- **Overpass form:** `(3.1775,101.5055,3.1835,101.5135)`
- **Slightly larger "context" bbox for routing to Central Park West and the Rainforest Centre:** 3.170, 101.500, 3.186, 101.518.

### 3.3 Why it also suits the evidence story
SDP built Malaysia's first UNICEF-backed inclusive playground in City of Elmina and claims Universal Design and MS 1184 alignment [L9]. Our assistant lets residents discover that investment, and lets SDP verify what is documented but not yet mapped. We could not confirm which park houses that playground (SDP brochure lists it under a "Community Park" zone) so ask SDP before putting it in the demo (unverified).

## 4. Data checks we ran

All queries used the public Overpass API (overpass-api.de) with a descriptive User-Agent on 14 Oct 2026. The first runs failed with server-busy timeouts; retries succeeded.

| Check | Bbox | Result |
|---|---|---|
| Named Elmina features | 3.17, 101.45, 3.26, 101.54 | Found Elmina Lakeside Mall (way 1308938137), Elmina Sales Gallery (1308938138), Elmina Urban Park (1309457596), Elmina Central Park West (1564861412), Elmina Valley Central Park (866543394), Elmina Rainforest Knowledge Centre (910312454), Iconic Bridge of Elmina City (909868199), Jambatan Pelangi Elmina footways |
| Pedestrian network in context bbox | 3.170, 101.503, 3.186, 101.522 | 185 `footway/path/pedestrian` ways (160 footway, 22 path, 3 pedestrian); 865 buildings (most are houses in adjacent estates). 100 ways have `wheelchair=yes`, `surface=concrete`, `smoothness=good`. No `incline`, `width`, `kerb` or `entrance` tags in the sample. The uniform tagging pattern suggests a bulk or assumed edit, not a survey (our inference, unverified) |
| Amenities in context bbox | 3.170, 101.500, 3.186, 101.518 | 13 pitches, 10 shelters, 5 benches, 5 car parks, 4 parks, 3 gardens, 1 playground (way 1346154592), 1 `highway=steps` (way 1346147887), **0 toilets**, 0 drinking-water points |
| MVP bbox | 3.1775, 101.5055, 3.1835, 101.5135 | 133 features: 54 footways (28 with wheelchair=yes + concrete, 26 untagged), 58 buildings (named: Lakeside Mall, Sales Gallery, Anytime Fitness, Ediya Coffee, Burger King, NakNak), 4 car parks, 3 parks, 3 pitches, 1 playground, 1 bench, 1 waste basket, 1 ATM, **0 entrances, 0 kerbs, 0 toilets** |
| Bandar Bukit Raja scan | 2.99, 101.40, 3.12, 101.47 | Many council halls (e.g., Dewan MBDK Bandar Bukit Raja, way 1133350305); wetland park not found by name in our regex (unverified) |

**Interpretation:** OSM gives us a geometry skeleton (good for a 2D graph) but nothing that answers a stroller or wheelchair question. Our field survey must add: entrance locations and widths, step/kerb presence, ramp slopes, surface condition, toilet and seating locations, shelter and shade, lighting, and closures. See `docs/03-product/field-verification-guide.md`.

## 5. 3D data options for the site

| Option | Status | Notes |
|---|---|---|
| **Google Photorealistic 3D Tiles** | Malaysia listed with 2D/3D Map Tiles available [L3]; Elmina mesh quality unverified | Pricing reported at $6.00 per 1,000 root tile requests for the first 100,000 (tiered down), with a 10,000/day root-request cap [L10]; check current pricing before relying on it. Attribution/logo mandatory; no image analysis, machine interpretation, object detection, geodata extraction, offline use or caching beyond the terms [L4]. You may overlay your own 3D objects not "extracted, traced, or otherwise derived" from the tiles [L4] |
| **OSM 3D buildings** (extrude footprints) | Available; footprints exist (58 in MVP bbox) | Free, open, low realism; can be the primary geometry |
| **Own capture** (photos or phone LiDAR of the frontage) | Needs SDP permission | Higher realism, fully ours to analyse |
| **SDP BIM/CAD** | Ask mentors | SDP uses BIM/Procore internally [L11]; sharing terms unknown |

**Recommendation:** primary geometry from OSM plus our survey; Google tiles as an optional, attribution-compliant visual backdrop; verify coverage first (open Google Earth web at 3.1805, 101.5095 and tilt).

## 6. Feasibility for students

- Shah Alam is within the Klang Valley; travel time depends on your base (unverified). Plan **3 visits** (reconnaissance, systematic survey, re-verification after a gap) in daylight, ideally including one wet/after-rain visit for surfaces and puddling.
- Ask SDP/mall management (via the hackathon mentors) for written permission to photograph and measure. Do not enter private or staff-only areas, avoid capturing identifiable people, and note a wheelchair user or older resident to co-verify.
- Safety: heat, rain, traffic at drop-off areas.

## 7. Questions to confirm before the proposal (23 Oct 2026)
1. Is Elmina Urban Park publicly owned by SDP or handed over to the council (MBSA), and who is the ops contact?
2. May we publish accessibility attributes about mall-frontage entrances?
3. Which playground is the UNICEF inclusive one, and is it inside our bbox?
4. Does SDP have as-built drawings (BIM/CAD) we can use under NDA?

---

## Sources

- [L1] SDP, Elmina Lakeside Mall opening release (30 Aug 2024): https://simedarbyproperty.com/sites/default/files/2024-09/20240830-%20For%20Immediate%20Release%20-%20Elmina%20Lakeside%20Mall%20Now%20Open%20-%20A%20Nature%20Inspired%20Lifestyle%20Community%20Hub%20by%20Sime%20Darby%20Property.pdf
- [L2] EdgeProp, mall opening week: https://www.edgeprop.my/content/1910344/elmina-lakeside-mall-attracts-over-180000-during-opening-week ; Seth Lui guide: https://sethlui.com/elmina-lakeside-mall-activities-guide-malaysia/ ; EdgeProp (mall facts, NLA): https://api.edgeprop.my/content/1911542/sultan-selangor-launches-elmina-lakeside-mall-and-museum
- [L3] Google Maps Platform coverage: https://developers.google.com/maps/coverage
- [L4] Map Tiles API policies: https://developers.google.com/maps/documentation/tile/policies
- [L5] EdgeProp, City of Elmina and Central Park precincts: https://www.edgeprop.my/content/1912815/city-elmina—-sustainable-integrated-township
- [L6] SDP biodiversity awards release (ERKC): https://www.simedarbyproperty.com/sites/default/files/2025-07/20250716%20-%20For%20Immediate%20Release%20-%20Sime%20Darby%20Property%20Demonstrates%20Sustainability%20Excellence%20with%20Four%20Wins%20Across%20Two%20Industry%20Awards.pdf
- [L7] SDP Bandar Bukit Raja: https://www.simedarbyproperty.com/bandar-bukit-raja
- [L8] The Star, Klang park record: https://thestar.com.my/metro/metro-news/2023/12/14/klang-park-gets-into-record-book
- [L9] Business Today, inclusive playground: https://www.businesstoday.com.my/2022/03/02/sime-darby-property-launches-malaysias-first-inclusive-playground-in-partnership-with-unicef/ ; UNICEF toolkit: https://www.unicef.org/malaysia/media/2071/file/Best%20Business%20Practice:%20Inclusive%20Playground%20Toolkit%20(FULL).pdf
- [L10] Google Map Tiles billing and Cesium cost discussion: https://developers.google.com/maps/documentation/tile/usage-and-billing ; https://community.cesium.com/t/google-3d-tiles-cost/27625
- [L11] SDP IAR 2025 (BIM, Procore): https://www.simedarbyproperty.com/sites/default/files/2026-04/SDP%20IAR2025%20%28Website%29.pdf
- OpenStreetMap data via Overpass API (ODbL): https://overpass-api.de/api/interpreter (queries run 14 Oct 2026; Element IDs above).
