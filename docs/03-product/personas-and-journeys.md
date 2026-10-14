# Personas & Journeys

> Two kinds of persona live in this project, and they must not be confused:
> 1. **Design personas** (this doc). Fictional but research-informed people who keep the team user-centred. They appear in the pitch.
> 2. **Test personas / resident agents**. Machine-readable constraint profiles used by the simulator. See [../04-architecture/resident-agents-design.md](../04-architecture/resident-agents-design.md).
>
> Every design persona maps to one or more routing **profiles** (see [glossary](../00-overview/glossary.md)). Statistics that justify these personas are in [../02-research/accessibility-and-routing.md](../02-research/accessibility-and-routing.md). Cite them from there, not from memory.

## Resident-side personas

### 1. Aisyah, parent with a stroller (profile: `stroller`)
- 32, two kids (3 years and 6 months). Comes to the community hall for a weekend parenting class.
- **Need:** a step-free route from the car park to the right entrance, a baby-changing room, shade.
- **Today:** follows Google Maps to the building pin, which is the back of the hall. Finds stairs. Carries the stroller up while holding the baby.
- **Questions she'd ask:** *"Can I take a stroller from the car park to the hall without stairs?"* · *"Is there a baby-changing room?"* · *"Which entrance is closest to the drop-off?"*
- **Success:** arrives at the right entrance first time, with no carrying.

### 2. Uncle Lim, older resident (profile: `older_adult_rest`)
- 71, walks with a cane, gets tired after about 150–200 m, and is sensitive to heat.
- **Need:** a route with seating at regular intervals, shade or shelter, toilets nearby, no long ramps.
- **Today:** avoids the park on hot days because he doesn't know where the benches and shelters are.
- **Questions:** *"Where can I sit along the way to the surau?"* · *"Nearest toilet to the playground?"* · *"Is the covered walkway open?"*
- Prefers **Mandarin or Bahasa Melayu**, and large text or voice input.

### 3. Priya, wheelchair user (profile: `wheelchair`)
- 27, manual wheelchair, visiting a friend's event at the hall. Unfamiliar with the township.
- **Need:** *verified* step-free access, door width, an accessible toilet, OKU parking, kerb cuts.
- **Today:** calls ahead and often gets "should be OK" answers. Has learnt not to trust "accessible" labels.
- **Questions:** *"Is the main entrance wheelchair accessible? How do you know?"* · *"Where's the OKU parking closest to an accessible entrance?"*
- **Key insight: she values an honest "unknown" more than a confident "yes".** This is the persona that justifies the whole tri-state design (ADR [0004](../00-overview/decisions/0004-tri-state-accessibility-attributes.md)).

### 4. Daniel, first-time visitor (profile: `default`)
- 24, coming to a futsal booking or a mall event. Has never been here.
- **Need:** which car park, which entrance, how long the walk is.
- **Questions:** *"I'm at the main gate. How do I get to court 2?"* · *"Where do I drop off my mum?"*

## Staff-side personas

### 5. Farah, township operations executive (staff console user)
- Handles resident feedback for several facilities. Today that comes by WhatsApp, the front desk and Facebook comments.
- **Need:** to see which questions recur, which facts are missing or stale, and to fix them quickly with evidence.
- **Success metric she cares about:** fewer repeated enquiries, and faster resolution of "where/how do I…" questions.
- **Uses:** the VR queue, attribute editor, recurring-questions view and gap map.

### 6. Encik Rahman, facility manager
- Runs the community hall. Knows things that aren't written down ("the side door is locked after 6pm").
- **Need:** a 2-minute way to record or update facts such as closures, temporary works and door schedules.
- **Uses:** a mobile-friendly "update a fact" form linked from a VR notification.

---

## Core journeys (the demo is built from these)

### J1: Stroller step-free route ⭐ (hero journey)
1. Aisyah opens TownshipLens on her phone. The 3D scene is centred on the site.
2. She asks: *"Can I push a stroller from Car Park B to the community hall without stairs?"*
3. Assistant → `find_place("Car Park B")`, `find_place("community hall")` → `plan_route(profile=stroller)`.
4. The engine returns **partly unverified**: one route uses ramp R2, whose slope is `unknown`.
5. The answer: route highlighted (green = verified, amber = unverified), *"…the ramp near the side entrance hasn't been verified yet (no record). The main entrance route is fully step-free but 120 m longer."* Plus evidence cards with photos and verified dates.
6. A VR "verify slope of ramp R2" is created automatically (or upvoted).

### J2: Rest points and toilets
Uncle Lim asks in Mandarin: *"去 surau 的路上有哪里可以坐？"* (Where can I sit on the way to the surau?) → `plan_route(profile=older_adult_rest)` + `nearby_amenities(type=seating|toilet|shelter)` → route with bench pins and the distance between rest points. One gap longer than 150 m is flagged.

### J3: "How do you know?"
Priya asks: *"Is the main entrance wheelchair accessible?"* → `get_place_details(entrance)` → *"Yes: step-free, automatic door, 110 cm wide. Verified by site visit on 4 Nov 2026 (photo E-12)."* She taps the evidence card and sees the photo.

### J4: Temporary closure
A staff member marks the covered walkway W3 as closed (works) from 5–20 Nov. The next stroller route automatically avoids W3 and says why.

### J5: Knowledge-gap loop ⭐ (differentiator)
1. A persona-simulation run (or J1) creates VR-17: "slope of ramp R2 unknown". It has 4 upvotes from 4 resident questions this week.
2. Farah sees VR-17 at the top of the queue (it is ranked by demand).
3. Encik Rahman checks the ramp, uploads a photo and enters a slope of about 1:12 (`verified`).
4. Aisyah asks again → the route is now **confirmed** and shorter.
5. The staff dashboard shows the "% of journeys fully confirmed" rising.

### J6: Persona simulation report (staff/ops)
Ops clicks "Run journey tests" → 3 personas × N tasks → report: 18/30 confirmed, 9 partly unverified, 3 blocked. Top 5 gaps by impact: "ramp R2 slope", "toilet T1 accessibility", and so on. Each gap → one click to create a VR.

## Journey → feature matrix

| Journey | 3D scene | Chat | Routing profiles | Evidence | Uncertainty | VR loop | Staff console | Simulation |
|---|---|---|---|---|---|---|---|---|
| J1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| J2 | ✓ | ✓ (multilingual) | ✓ | | ✓ | | | |
| J3 | ✓ | ✓ | | ✓ | ✓ | | | |
| J4 | ✓ | ✓ | ✓ | | | | ✓ | |
| J5 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| J6 | | | ✓ | | ✓ | ✓ | ✓ | ✓ |
