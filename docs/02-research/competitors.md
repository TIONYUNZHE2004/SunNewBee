# Competitors and Analogous Solutions

> Researched 14 Oct 2026. Claims marked "(vendor claim)" come from vendor marketing; "(unverified)" means we could not confirm it. Sources numbered [C1]... at the bottom.

## TL;DR

- **Nobody we found combines all five of our differentiators**: (1) verified, timestamped accessibility attributes, (2) explicit uncertainty labelling, (3) 3D/spatial view, (4) conversational answers, and (5) a closed loop that turns unanswerable questions into verification tasks for township ops staff. Individual pieces exist; the loop is the gap.
- **Malaysian developer/township apps are transactional.** SDP's own SDP App is for buyers and owners (billing, construction progress, defects) [C1]. SP Setia has "Setia Go" (smart-community app built with Ant Digital's mPaaS; current status unverified) [C2]; Sunway's property app is a buyer/listing app [C3]; Sunway City Iskandar Puteri won Platinum at the Smart Township Malaysia 2025 awards but we found no resident-wayfinding product [C4]. Community-management platforms such as TimeTec i-Neighbour cover visitor passes, facility booking, panic button, e-billing [C5]. None of these answer "which entrance can I use with a stroller?"
- **Google Maps is the real incumbent** for "is this place wheelchair accessible?" It shows a wheelchair icon and amenity details, fed largely by Local Guides, with incomplete coverage and no live info (for example, elevator outages) [C6][C7]. Gemini-powered **Ask Maps** (March 2026, US/India first) offers conversational multi-condition search; we could not confirm it reads structured accessibility attributes versus review text, and it is not shown to be live in Malaysia (unverified) [C8].
- **Indoor wayfinding vendors** (Mappedin, Pointr, Esri Indoors, Wemap, GoodMaps) offer accessible routing, step-free preferences and AI-assisted map creation, but are per-venue paid platforms that assume a managed floor plan and do not offer an evidence-and-gap loop (vendor claims) [C9][C10].
- **Closest analogues**: Dublin City University's "Campus Ambassador" AI wayfinding assistant paired with a Bentley-built digital twin, and a Turkish university's AI navigation system for visually impaired users (Jan 2026) [C11][C12]. Both are single-institution and neither highlights verification provenance.
- **Crowdsourced accessibility data** (Wheelmap, Project Sidewalk, AccessMap/OpenSidewalks, OSM) validates the data-gap problem: mainstream maps have poor physical-accessibility data; coverage in Malaysia is thin [C13]. We should treat these as data sources and design inspirations, not competitors.
- **Strategic positioning:** "Not another map. A maintained, evidence-backed answer layer for one place, with a loop that makes SDP's accessibility investments discoverable and keeps data fresh."

---

## 1. Landscape by category

### 1.1 Malaysian property developer and township apps

| Player | Product | What it does | Gap relative to TownshipLens |
|---|---|---|---|
| Sime Darby Property | **SDP App**; Elmina Valley Community app; KLGCC App | SDP App: construction milestones, payments, handover, defects, PRIME membership. KLGCC app: golf and driving range services [C1][C14] | No spatial or accessibility information; Elmina Valley Community features not public (unverified) |
| SP Setia | **Setia Go** (with Ant Digital mPaaS) | Smart-community "super app" with startup services; launch details and current status not confirmed [C2] | Not a facility-accessibility product (unverified) |
| Sunway Property | Sunway Property App; Sunway City Iskandar Puteri smart township | Listings and chat for buyers [C3]; Platinum, Smart Township Malaysia 2025 (pillars incl. Smart Living, Mobility, Environment) [C4] | Awards show the smart-township bar; no wayfinding assistant found |
| Gamuda Land | Gamuda Cove with Huawei 5G/smart plans (2020) | Township-level smart infrastructure announcement [C15] | No resident app found; evidence dated 2020 |
| IOI Properties, Mah Sing, EcoWorld, UEM Sunrise | Not researched in depth | Township marketing; IOI has a hospitality app only (T Journey) per one snippet [C4] | Unverified |

### 1.2 Community-management and neighbourhood apps

| Player | Features | Notes |
|---|---|---|
| **TimeTec i-Neighbour** | Visitor QR passes, facility booking (courts, halls, pools), panic button, e-billing, feedback, guard patrol, barrier gate/IoT access control [C5] | Built for gated strata schemes. Facility booking is a natural integration partner: answer "can I get in?" and then "can I book it?" |
| Others (Kiple, JomPay-adjacent, Propxy, "Doorbell") | Not researched | Treat as unverified; ask a mentor which platform Elmina JMBs actually use |

### 1.3 Global consumer maps

| Product | Relevant capability | Limits |
|---|---|---|
| **Google Maps** | Wheelchair-accessible entrance icon and amenity details (seating, restrooms, parking); crowd data from Local Guides; wheelchair-accessible transit routing since 2018 in select cities [C6][C7] | Place-level, not path-level; incomplete; no confidence or date shown to the user; cannot report elevator outage [C7] |
| **Gemini in Maps ("Ask Maps")** | Conversational, multi-constraint search; summarises reviews (launched 12 Mar 2026, US and India first, then Australia, Brazil) [C8] | Review-derived reasoning; unclear access to structured attributes; Malaysia availability unverified |
| **Google Immersive View / Photorealistic 3D Tiles** | Photoreal context; Map Tiles API lists Malaysia 2D and 3D tiles as available [C16] | Policy bars image analysis, machine interpretation, object detection and geodata extraction from the tiles, and caching/offline use [C17]. Use only as a visual layer |
| **Apple Maps** | Not researched (unverified) | Likely similar place-level accessibility info |

### 1.4 Accessibility data communities

| Product | What it is | Takeaway |
|---|---|---|
| **Wheelmap** | Volunteer tool to tag wheelchair accessibility of POIs [C13] | POI-level traffic-light ratings; no path graph |
| **Project Sidewalk / AccessMap / OpenSidewalks** (UW) | Crowdsourced and ML sidewalk accessibility labelling from street imagery; routing with user-defined slope and curb preferences (Seattle) [C13] | Closest methodological cousin for path-level data; city-scale, US-centred |
| **Mapillary** | Street-level imagery (not researched in detail) | Possible evidence source; coverage at Elmina unverified |
| **OpenStreetMap** | Open pedestrian network and attributes (our own check of Elmina below) | Attributes often unsourced and undated |

OSM spot check at Elmina Lakeside Mall to Urban Park (bbox in `site-selection.md`): 54 footways, of which 28 carry `wheelchair=yes` and `surface=concrete` but none carry width or incline; 0 mapped entrances, 0 kerb nodes, 0 toilets, 1 bench. This is exactly the "asserted but unverified, and incomplete" data our evidence labels address.

### 1.5 Indoor wayfinding and digital twin platforms

| Vendor | Claims | Fit |
|---|---|---|
| **Mappedin** | Multi-floor wayfinding, routes prioritising elevators and ramps, WCAG compliance, AI map creation, per-map pricing (a 2026 buyer's guide lists a Pro tier of $165 per map per month) [C9] (vendor/review claims) | Strong for malls; commercial per-venue; no evidence-of-provenance loop |
| **Pointr** | AI conversion of floor plans to navigation maps, BLE blue dot 1-3 m accuracy, persona-based routes [C10] (vendor claim) | Needs beacon infrastructure; costlier |
| **Esri ArcGIS Indoors** | Enterprise indoor routing and space search on ArcGIS [C9] | Accessible routing detail not confirmed; GIS-heavy |
| **Wemap** | Campus navigation with configurable accessibility profiles [C11] | Vendor product |
| **GoodMaps, Waymap** | Accessibility-focused indoor/outdoor navigation (listed in a buyer's guide) [C9] | Specialist for blind and low-vision users; not township-wide knowledge systems |
| **Bentley iTwin, Cityzenith/SmartWorldPro, Virtual Singapore** | Enterprise or government digital twins; Bentley built DCU's twin [C11]. Cityzenith and Virtual Singapore not researched (unverified) | Heavy, expert-operated; not resident-facing Q&A with uncertainty |

### 1.6 AI concierges and campus assistants (2025 to 2026)

- **DCU (Ireland):** Campus Explorer (virtual model of three campuses) plus Campus Ambassador (AI wayfinding assistant), built with Bentley; the page appears under both 2025 and 2026 URLs so the launch date is unclear [C11].
- **Ondokuz Mayis University (Turkey):** AI-powered visual assistance system for visually impaired users, launched Jan 2026 [C12].
- **University of Birmingham smart campus:** wayfinding via totems, app and web [C11].
- **Singapore JTC Open Digital Platform:** concept of an AI assistant for recommendations and a digital twin queried in plain language (a plan under consideration, per one article) [C18].
- **Malls:** we found only vendor marketing about mall digital twins; no verified mall AI concierge with accessibility features (unverified) [C18].
- **Research signal:** a University of Turku study used LLM-generated "synthetic residents" to test a GenAI-assisted urban twin and found usability varied with digital skills and demographics. This supports our position that agent simulation is a test aid, not a substitute for residents [C18].

---

## 2. Differentiation matrix

Legend: Yes = documented capability; Partial = limited or place-level; No = not found; ? = not verified. Our column is the target for the MVP, not a claim about current shipped features.

| Capability | **TownshipLens (target)** | SDP App / developer apps | i-Neighbour | Google Maps (+ Ask Maps) | Wheelmap / Project Sidewalk | Mappedin / Pointr / Esri Indoors | DCU-style AI wayfinder |
|---|---|---|---|---|---|---|---|
| **Verified accessibility attributes with source and date** | Yes (staff and field verified, timestamped) | No | No | Partial (crowd, undated) | Partial (crowd/ML, some validation) | Partial (as modelled by venue) | ? |
| **Path-level step-free routing** | Yes (graph over entrances, paths, levels) | No | No | Partial (place icon; wheelchair routing in select transit cities) | Partial (sidewalks in covered cities) | Yes indoors (vendor claim) | Partial |
| **Explicit uncertainty labelling** ("unverified", "last checked") | **Yes (core)** | No | No | No | Partial (data-sparse flags) | No | ? |
| **3D or spatial visual** | Yes (3D plus 2D fallback) | No | No | Yes (Immersive View, where available) | No | Yes (indoor maps, some 3D) | Yes (digital twin) |
| **Conversational Q&A about physical access** | Yes (tool-grounded) | No | No | Partial (Ask Maps; US/India first) | No | Partial (AI map creation, not Q&A; vendor claims) | Yes |
| **Knowledge-gap loop to ops staff** | **Yes (core)** | Defects only (for owners) | Feedback/inquiry form | No (user edits go to Google) | Community edits | Venue admin edits | ? |
| **Township/ops dashboard of unanswered questions** | Yes | Internal PACC (not resident-driven) | Admin portal | No | No | Analytics (footfall, search) | ? |
| **Fits Malaysian context (OKU, MS 1184, PDPA)** | Yes by design | n/a | n/a | Global | Mostly West | Global | Non-MY |
| **Cost to SDP** | Low (pilot) | Existing | Per-scheme subscription | Free to residents | Free | Per-venue subscription (Mappedin Pro $165/map/month, review claim) | Bespoke |

**Where we are weaker (be honest in the pitch):** Google has scale, brand and indoor/outdoor coverage; Mappedin/Pointr have mature indoor positioning (blue dot); we have no turn-by-turn navigation and one pilot site. Our edge is **trust and maintenance**, not breadth.

## 3. Positioning statements to test with mentors

1. "Google tells you a place has a wheelchair icon. TownshipLens tells you which entrance, which path, who checked it, and when, and if nobody has, it says so and asks the township team to check."
2. "Every unanswered question becomes a verification task. Over time the township's accessibility knowledge improves instead of decaying."
3. "It complements, not replaces, the SDP App: same resident, a different question."

## 4. Integration opportunities rather than competition
- **SDP App / Elmina Valley Community:** embed as a web view or deep link (SDP App adoption grows ~3% month-on-month) [C1][C14].
- **i-Neighbour or other facility-booking platforms:** link "book this hall" after "can I reach it step-free?".
- **Google Maps:** keep as a baseline in our evaluation (compare answer correctness to a Maps + FAQ baseline).
- **OSM / Wheelmap:** export verified attributes back (ODbL obligations apply; check licence before importing).

---

## Sources

- [C1] SDP IAR 2025 (SDP App, PACC, KLGCC App): https://www.simedarbyproperty.com/sites/default/files/2026-04/SDP%20IAR2025%20%28Website%29.pdf
- [C2] Ant Digital, Setia Go: https://intl.antdigital.com/en/company/news-and-press/news-7
- [C3] App Store, Sunway Property App: https://apps.apple.com/us/app/id1504841707
- [C4] Sunway City Iskandar Puteri, Smart Township Malaysia 2025: https://sunwayproperty.com/news-events/sunway-city-iskandar-puteri-earns-platinum-distinction-at-smart-township-malaysia-2025-awards/ ; IOI Central Park / T Journey mention: https://www.edgeprop.my/bites/content/1915974/ioi-properties-opens-275-acre-central-park-senna-puteri-eyes-rm3b-gdv-sepang-township
- [C5] TimeTec i-Neighbour features: https://www.i-neighbour.com/feature/Oct2024/ ; App Store listing: https://apps.apple.com/us/app/i-neighbour/id1056428647
- [C6] AOL/TechCrunch, Google Maps wheelchair accessible places: https://www.aol.com/google-maps-now-highlight-wheelchair-230933107.html
- [C7] Google, wheelchair-accessible transit routes (2018) and limits: https://goo.gle/2MSSRjx ; https://www.bgr.com/2271448/google-maps-wheelchair-accessible-routes-what-they-show/
- [C8] Ask Maps (Gemini) March 2026 coverage: https://www.sicurauto.it/news/attualita-e-curiosita/google-maps-nel-2026-il-piu-grande-aggiornamento-degli-ultimi-10-anni-cosa-cambia/ ; https://weel.co.jp/media/innovator/google-maps-gemini/
- [C9] Mappedin comparison and buyer's guides: https://www.mappedin.com/resources/blog/mappedin-vs-pointr-indoor-mapping-comparison/ ; https://www.guideflow.com/blog/indoor-mapping-software ; https://worldmetrics.org/best/indoor-routing-software/
- [C10] Pointr AI mapping (Siemens-hosted): https://www.siemens.com/et-ee/products/pointr-ai-mapping-indoor-location/ ; https://www.pointr.tech/ai-mapping
- [C11] DCU AI-powered campus wayfinding: https://www.dcu.ie/dts/news/2025/oct/ai-powered-campus-way-finding ; Wemap education: https://getwemap.com/en/industries/education/ ; Birmingham: https://birmingham.ac.uk/university/building/smart-campus/progress-to-date
- [C12] Ondokuz Mayis University AI navigation: https://www.omu.edu.tr/en/node/20569
- [C13] Project Sidewalk / AccessMap / Wheelmap: https://urbanalytics.uw.edu/projects/projectsidewalk ; https://depts.washington.edu/pactrans/research/projects/combining-crowdsourcing-and-machine-learning-to-collect-sidewalk-accessibility-data-at-scale ; https://blog.openstreetmap.org/page/12/?page=12
- [C14] App Store, Elmina Valley Community: https://apps.apple.com/us/app/id1488080665
- [C15] Malay Mail, Gamuda Land and Huawei (2020): https://www.malaymail.com/news/money/2020/12/15/gamuda-land-collaborates-with-huawei-for-smart-city-township/1932207
- [C16] Google Maps Platform coverage (Malaysia row): https://developers.google.com/maps/coverage
- [C17] Map Tiles API policies: https://developers.google.com/maps/documentation/tile/policies
- [C18] GovInsider, generative AI in smart cities; Turku study: https://govinsider.asia/intl-en/article/what-role-could-generative-ai-play-within-tomorrows-smart-city ; https://www.utupub.fi/items/3c7eac94-fc58-485b-a823-0c87540401ed/full
- Our own OSM Overpass checks (14 Oct 2026): see `docs/02-research/site-selection.md`.
