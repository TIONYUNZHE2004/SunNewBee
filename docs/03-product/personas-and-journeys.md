# Personas & Journeys

> Two kinds of persona live in this project, and they must not be confused:
> 1. **Design personas** (this doc). Fictional but research-informed people who keep the team user-centred. They appear in the pitch.
> 2. **Test personas / resident agents**. Machine-readable constraint profiles used by the simulator. See [../04-architecture/resident-agents-design.md](../04-architecture/resident-agents-design.md).
>
> Every design persona maps to one or more routing **profiles** (`default`, `stroller`, `wheelchair`, `older_adult_rest`, `drive`; see the [canonical names](../04-architecture/README.md) and the [glossary](../00-overview/glossary.md)). Statistics that justify these personas are in [../02-research/accessibility-and-routing.md](../02-research/accessibility-and-routing.md). Cite them from there, not from memory.
> Product shape since the pivot ([ADR 0009](../00-overview/decisions/0009-township-world-model-platform.md)): one 3D world model of the whole of City of Elmina with **lenses**: `access` (deep), `flood` (deep), `waste` (thin). Each journey below says which lens it uses.

## Resident-side personas

### 1. Aisyah, parent with a stroller (profile: `stroller`)
- 32, two kids (3 years and 6 months). Shops at Elmina Lakeside Mall on Saturday mornings, then takes the kids to the Urban Park playground.
- **Need:** a step-free route from the car park to the right entrance, a baby-changing room, shade.
- **Today:** follows Google Maps to the park pin, comes out of the mall by the nearest exit and meets steps down to the waterside path. Carries the stroller down while holding the baby.
- **Questions she'd ask:** *"Can I take a stroller from the mall car park to the playground without stairs?"* · *"Is there a baby-changing room?"* · *"Which mall exit is closest to the park?"*
- **Flood lens (as a resident):** *"If the river rises, can I still get the kids to a hall with a stroller?"*
- **Success:** arrives at the right entrance first time, with no carrying.

### 2. Uncle Lim, older resident (profile: `older_adult_rest`)
- 71, walks with a cane, gets tired after about 150–200 m, and is sensitive to heat.
- **Need:** a route with seating at regular intervals, shade or shelter, toilets nearby, no long ramps.
- **Today:** avoids the park on hot days because he doesn't know where the benches and shelters are.
- **Questions:** *"Where can I sit along the lakeside walk to the bridge?"* · *"Nearest toilet to the playground?"* · *"Is the covered walkway open?"* · (waste lens) *"Where can I drop off old batteries?"*
- Prefers **Mandarin or Bahasa Melayu**, and large text or voice input.

### 3. Priya, wheelchair user (profile: `wheelchair`)
- 27, manual wheelchair, meeting friends for a weekend event at the Urban Park. Unfamiliar with the township.
- **Need:** *verified* step-free access, door width, an accessible toilet, OKU parking, kerb cuts.
- **Today:** calls ahead and often gets "should be OK" answers. Has learnt not to trust "accessible" labels.
- **Questions:** *"Is the main entrance wheelchair accessible? How do you know?"* · *"Where's the OKU parking closest to an accessible entrance?"* · (flood lens) *"The river is rising: where can I go from Lakeside?"*
- **Key insight: she values an honest "unknown" more than a confident "yes".** This is the persona that justifies the whole tri-state design (ADR [0004](../00-overview/decisions/0004-tri-state-accessibility-attributes.md)). In a flood scenario the same trait applies: she needs to know which segments are *uncertain*, not just which are red.

### 4. Daniel, first-time visitor (profile: `default`, or `drive` when arriving by car)
- 24, coming to an event at the park, dropped off by e-hailing. Has never been here.
- **Need:** which car park, which entrance, how long the walk is.
- **Questions:** *"I'm at the main gate. How do I get to court 2?"* · *"Where do I drop off my mum?"* · (flood lens, `drive`) *"Is the road out toward Kampung Kubu Gajah likely to be cut if the river rises 3 m?"*

## Management-side personas

### 5. Farah, township operations executive (staff console user)
- Handles resident feedback for several facilities. Today that comes by WhatsApp, the front desk and Facebook comments.
- **Need:** to see which questions recur, which facts are missing or stale, and to fix them quickly with evidence.
- **Success metric she cares about:** fewer repeated enquiries, and faster resolution of "where/how do I…" questions.
- **Uses:** the VR queue, attribute editor, recurring-questions view and gap map.

### 6. Encik Rahman, facility manager
- Looks after the park and mall-frontage facilities. Knows things that aren't written down ("the side gate to the waterside path is locked after 7pm").
- **Need:** a 2-minute way to record or update facts such as closures, temporary works and door schedules.
- **Uses:** a mobile-friendly "update a fact" form linked from a VR notification. For waste points, he is the person who can confirm "this bin is still here".

### 7. Puan Hajar, township safety and emergency lead (new, flood lens)
- *(Fictional persona. The real role and its duties at SDP / MBSA are **unverified**; we validate this with a township or ops person in the L3 feedback session, see [evaluation-plan](evaluation-plan.md).)*
- 45, coordinates the township's response when heavy rain is forecast: who to alert, which gates and roads to watch, which halls could be opened. Works with MBSA and the district disaster committee, who decide official PPS (evacuation centres) per event.
- **Need:** before the rain, a quick picture of *what a river rise would cut off*: roads, footpaths, community facilities, clusters of homes that could become "islands", and which candidate centres stay reachable for different residents (including wheelchair and stroller users, not only cars).
- **Today:** relies on experience, past events and phone calls. Past flooding is documented mainly in the *neighbouring downstream* Kampung Kubu Gajah / Paya Jaras (Apr 2024, 4 Oct 2024, Apr 2025; see [flood-disaster-lens § 1.3](../02-research/flood-disaster-lens.md)), and Elmina residents are mostly affected through cut roads. No tool shows this spatially.
- **Questions:** *"Which roads and facilities are likely cut off at river +3 m?"* · *"Which clusters become islands?"* · *"Which candidate centres can a wheelchair user still reach?"* · *"Draft a notice for residents, in Bahasa Melayu and English."*
- **What she must never get from us:** a forecast, the word "safe", or an advisory sent without her editing it. TownshipLens is a planning aid; official warnings come from JPS, MET Malaysia, NADMA and MBSA.
- **Uses:** the management console's flood briefing (cut-off list, islands, reachable centres) and the advisory draft editor.

---

## Core journeys (the demo is built from these)

### J1: Stroller step-free route ⭐ (hero journey, lens `access`)
1. Aisyah opens TownshipLens on her phone. The 3D scene opens over Elmina and flies to the Urban Park + Lakeside Mall frontage (`camera.fly_to`).
2. She asks: *"Can I push a stroller from Car Park B at Elmina Lakeside Mall to the Urban Park playground without stairs?"*
3. Assistant → `find_place("Car Park B")`, `find_place("playground")` → `plan_route(profile=stroller)`.
4. The engine returns **partly unverified**: one route uses ramp R2, whose slope is `unknown`.
5. The answer: route highlighted (`route.highlight`; green = verified, amber = unverified), *"…the ramp near the side entrance hasn't been verified yet (no record). The main entrance route is fully step-free but 120 m longer."* Plus evidence cards with photos and verified dates.
6. A VR "verify slope of ramp R2" is created automatically (or upvoted).

### J2: Rest points and toilets (lens `access`)
Uncle Lim asks in Mandarin: *"去桥那边的路上有哪里可以坐？"* (Where can I sit on the way to the bridge?) → `plan_route(profile=older_adult_rest)` + `nearby_amenities(type=seating|toilet|shelter)` → route with bench pins and the distance between rest points. One gap longer than 150 m is flagged.

### J3: "How do you know?" (lens `access`)
Priya asks: *"Is the main entrance wheelchair accessible?"* → `get_place_details(entrance)` → *"Yes: step-free, automatic door, 110 cm wide. Verified by site visit on 4 Nov 2026 (photo E-12)."* She taps the evidence card and sees the photo.

### J4: Temporary closure (lens `access`)
A staff member marks the covered walkway W3 as closed (works) from 5–20 Nov. The next stroller route automatically avoids W3 and says why (`get_closures`).

### J5: Knowledge-gap loop ⭐ (differentiator, all lenses)
1. A resident-agent run (or J1, or a flood what-if) creates VR-17: "slope of ramp R2 unknown". It has 4 upvotes from 4 resident questions this week.
2. Farah sees VR-17 at the top of the queue (it is ranked by demand).
3. Encik Rahman checks the ramp, uploads a photo and enters a slope of about 1:12 (`verified`).
4. Aisyah asks again → the route is now **confirmed** and shorter.
5. The staff dashboard shows the "% of journeys fully confirmed" rising.
6. *Flood variant:* a segment that was `UNKNOWN` under scenario `stage_p3m` because of a missing kerb-ramp fact is verified by staff, and the evacuation answer for Priya improves (see J8).

### J6: Resident-agent report (staff/ops)
Ops clicks "Run journey tests" → 3 personas × N tasks → report: 18/30 confirmed, 9 partly unverified, 3 blocked. Top 5 gaps by impact: "ramp R2 slope", "toilet T1 accessibility", and so on. Each gap → one click to create a VR. The same runner can also be pointed at a flood scenario (J9).

### J7: Priya at Lakeside, river +3 m: where can she go? ⭐ (resident, lens `flood`)
1. Priya is at Elmina Lakeside Mall. She opens the **scenario bar** and picks "River +3 m (indicative)" (`stage_p3m`), or asks: *"If the river rises 3 m, where can I go in my wheelchair?"*
2. The 3D scene shows water rising along Sungai Subang and the retention ponds (`flood.set_level`). Road and path segments are coloured by their class for the `wheelchair` profile: `likely_flooded` (red), `possible` (striped), `unlikely` (normal rules).
3. Assistant → `find_place("Lakeside")`, `list_evacuation_centres(scenario_id=stage_p3m, profile=wheelchair)`, `plan_route(profile=wheelchair, scenario_id=stage_p3m)`.
4. The answer names a candidate centre, e.g. *"Dewan Bunga Matahari (an OSM candidate, not an official PPS list entry)"*, says whether a route exists, lists any segment that is **uncertain**, and always shows the banner: *"Indicative scenario from a 30 m elevation model. Not a forecast."* It never says "safe". It shows official links (MBSA, JPS, NADMA) and tells her to follow the official PPS list.
5. Honest framing: Lakeside Mall sits at about 45 m and Elmina's core is not low-lying ([flood-disaster-lens § TL;DR](../02-research/flood-disaster-lens.md)), so the story is "how the river rise affects your routes, your neighbours and the centres", **not** "Elmina goes under". Her *starting point* may well be outside the modelled flood extent; what changes is which roads and links are usable.
6. If a segment on her route is `UNKNOWN`, a VR is created (J5 flood variant).

### J8: Management: what gets cut off at +3 m, and the advisory draft ⭐ (management, lens `flood`)
1. Puan Hajar opens the management console → **Flood briefing**, picks `stage_p3m` and compares it with `baseline`.
2. `affected_places(scenario_id=stage_p3m)` returns the **cut-off list** (roads, paths, facilities, each `likely` or `possible`) and the **isolated components** ("islands": clusters of residential nodes with no passing route to any centre).
3. `list_evacuation_centres` shows which candidate centres stay reachable, **per profile** (`drive`, `default`, `wheelchair`, `stroller`). Centres are labelled `osm_candidate` or `official_pps`.
4. She asks the assistant for a draft notice. The assistant produces an **advisory draft** in BM/EN/中文 with the hedged wording and links. It is shown in an editor and **never sent automatically**; a person edits and sends it through their own channels.
5. She exports a printable briefing (the scenario, its provenance: DEM source, method, margin, version).
6. She flags "which facts would change this picture?", and the top unknowns (e.g. an unmapped culvert, an unverified kerb ramp) become VRs.

### J9: Can every profile reach an evacuation centre? (resident agents, lens `flood`)
Ops clicks "Run flood journey tests" → for each profile (`default`, `stroller`, `wheelchair`, `older_adult_rest`, `drive`) × each scenario (`baseline`, `stage_p1m` … `stage_p5m`) × each residential cluster → outcome per journey (success / success_with_unknowns / blocked / no_data). The report lists clusters that cannot reach any centre under a given profile and scenario, and checks invariants such as "a higher stage never un-floods an edge". See [resident-agents-design](../04-architecture/resident-agents-design.md).

### J10: Where do I drop off old batteries? (lens `waste`, thin)
Uncle Lim (or anyone) asks: *"Where can I drop off old batteries or an old phone near Elmina?"* → `find_waste_points(type=e_waste, near=…)` → a handful of hand-curated points (each with a source URL, a checked-on date and a status). For collection days the honest answer is *"unknown, ask MBSA"* with the council contact, and that gap becomes a VR like any other (J5). There are 0 `amenity=recycling` points in OSM across the Elmina envelope ([township-3d-engine-and-data § 2.2](../02-research/township-3d-engine-and-data.md)), so every point is hand-entered, never bulk-copied.

## Journey → feature matrix

Lens column: `access` = accessibility & getting around · `flood` = flood / disaster what-if · `waste` = recycling & waste · `all` = platform-level.

| Journey | Lens | 3D scene | Chat | Routing profiles | Evidence | Uncertainty | VR loop | Staff / mgmt console | Resident agents | Scenario bar |
|---|---|---|---|---|---|---|---|---|---|---|
| J1 | access | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| J2 | access | ✓ | ✓ (multilingual) | ✓ | | ✓ | | | | |
| J3 | access | ✓ | ✓ | | ✓ | ✓ | | | | |
| J4 | access | ✓ | ✓ | ✓ | | | | ✓ | | |
| J5 | all | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | (flood variant ✓) |
| J6 | access | | | ✓ | | ✓ | ✓ | ✓ | ✓ | |
| J7 | flood | ✓ | ✓ | ✓ (`wheelchair`, `stroller`, `drive`) | ✓ (scenario provenance) | ✓ (UNKNOWN edges, disclaimer) | ✓ | | | ✓ |
| J8 | flood | ✓ | ✓ (advisory draft) | ✓ (all five) | ✓ | ✓ | ✓ | ✓ (flood briefing) | | ✓ |
| J9 | flood | | | ✓ (all five) | | ✓ | ✓ | ✓ | ✓ | ✓ |
| J10 | waste | ✓ (layer) | ✓ | | ✓ (source URL + date) | ✓ ("unknown, ask MBSA") | ✓ | ✓ | | |

## Priority for the 4-week build

| Journey | Priority | Why |
|---|---|---|
| J1, J5 | P0 | Hero accessibility moment and the differentiator |
| J7 | P0 | The flood "wow" moment |
| J8 | P0 (cut-off list, islands, reachable centres) · P1 (advisory draft, printable briefing) | Why management cares |
| J3, J6, J9 | P1 | Evidence and trust; automatic testing |
| J2, J4, J10 | P1 / P2 | Support the platform claim; J10 is deliberately thin |

Details and IDs: [mvp-spec](mvp-spec.md).
