# Demo Script

> The demo is the most persuasive 3–4 minutes we have. It is built from journeys J1, J3, J5, J7 and J8 ([personas-and-journeys](personas-and-journeys.md)) and shows the platform claim: **one 3D world model of Elmina, two very different lenses**. Rehearse it until it's boring. **Always have the recorded backup video ready** and run with `DEMO_MODE=1` (cached LLM responses) if the venue Wi-Fi is weak.
> Rules for the flood part: say "indicative scenario, not a forecast", never say "safe", and never present Elmina itself as "going under". Elmina's core is not low-lying; the documented floods are in the downstream neighbours Kampung Kubu Gajah / Paya Jaras ([flood-disaster-lens § 1.3](../02-research/flood-disaster-lens.md)). The story is how a river rise affects **Elmina residents' routes, their neighbours and the evacuation centres**.

## Setup checklist (T–30 min)

- [ ] Laptop + phone charged; phone mirrored or the laptop in a mobile viewport
- [ ] Deployed URL warm (hit `/healthz`; Cloud Run `min-instances=1` set the day before)
- [ ] Google 3D tiles loading and credits visible; Cesium chunk warmed; "Lite view" button tested
- [ ] Seed data reset to the **"before"** state: `POST /admin/demo/reset` (ramp R2 slope = unknown, VR-17 open with demand 4; kerb-ramp fact on the demo evacuation-route segment `<seg-id>` = unknown, so `stage_p3m` shows one striped segment)
- [ ] Scenario `stage_p3m` pre-selected in the cache; check that the chosen start place (Lakeside) and the candidate centre give the answer you rehearse. **Rehearse from the real engine output; don't script outcomes the engine doesn't produce.**
- [ ] Staff/management console logged in, in a second tab
- [ ] Backup video open in a third tab
- [ ] Browser zoom 125%, notifications off, dark mode off

## Script (about 3:45)

| Time | On screen | Say (presenter) |
|---|---|---|
| 0:00 | Title slide → the **3D fly-in over City of Elmina** (photoreal tiles, `camera.fly_to` from the whole township down to Lakeside Mall) | "This is City of Elmina as a living 3D model. Behind it is one verified world model of the township. Every fact in it has a source and a date, and 'unknown' is a valid answer. Residents and township managers can ask it anything. We'll look through two lenses." |
| 0:15 | Lens `access`. Types: *"Can I push a stroller from Car Park B to the playground without stairs?"* | "Meet Aisyah, with a stroller. She asks the way she'd ask a person." |
| 0:25 | Chips: "Finding places… Checking step-free routes…" | "TownshipLens doesn't guess. It looks up the real places and runs a route check for a stroller over our verified map of the park." |
| 0:35 | Route highlighted: green with one amber dashed segment; the answer appears | "It found a route, and it's honest. Most of it is staff-verified, but the slope of the ramp down to the waterside path has never been checked. It tells her that first, and offers the fully verified route via the mall frontage, 120 metres longer." |
| 0:55 | Tap the evidence card → photo + "verified <date>, site visit" | "Every fact has a source and a date. No 'accessible' badge without proof." |
| 1:05 | Switch to lens `flood`. The scenario bar appears with the banner "Indicative scenario, not a forecast". Drag the slider to **+3 m** (`stage_p3m`): the water rises along Sungai Subang and the retention ponds; road and path segments turn red; one is striped | "Same model, a different lens. Township managers ask: if the river rises 3 metres, what happens? The water here comes from a 30-metre elevation model, not from the picture. Red means likely under water; striped means we're not sure, so we treat it as not passable. This is an indicative scenario, not a forecast, and Elmina's core sits well above the river. The real flooding in recent years was next door, in Kampung Kubu Gajah, so the question is how a rise affects Elmina residents' routes." |
| 1:35 | Types as Priya: *"I'm in a wheelchair at Lakeside. If the river rises 3 m, where can I go?"* | "Priya uses a wheelchair and is at the mall." |
| 1:45 | Answer: one candidate centre named, the route drawn, one striped segment called out, the banner and official links (MBSA, JPS, NADMA) shown; the label reads "OSM candidate, not an official PPS list" | "It names a hall that's reachable, shows the route, and flags one segment it can't be sure about, and why. It never says 'safe'. It labels the hall as a candidate, because only the district committee decides official evacuation centres, and it points her to the official sources." |
| 2:15 | Switch to the **management console → Flood briefing**, `stage_p3m` vs `baseline` | "Now the township safety lead. At +3 metres: <N> road links and <M> facilities likely cut off, <K> more uncertain. These <J> clusters of homes become islands with no route out. And here is which candidate centres remain reachable for a car, a walker, a wheelchair." *(numbers read from the screen, from the engine; never invented)* |
| 2:40 | Click "Draft advisory" → an editable BM/EN draft with hedged wording and official links; a "Not sent" badge | "The assistant drafts a notice, with the hedging and the official links. It is a draft: a person edits it and sends it. TownshipLens never sends anything by itself." |
| 2:55 | Back to the console's VR queue: the striped segment's kerb-ramp fact is at the top (and VR-17). Staff resolves one: photo, `verified` | "The striped segment is a knowledge gap, and it's now a task for the team. Encik Rahman checks the kerb ramp on his round: two minutes, one photo." |
| 3:10 | Back to the resident tab; ask Priya's question again → the segment is now a confirmed pass or a confirmed fail, the answer is more specific | "Priya asks again. The answer is sharper: the segment is now a fact, not a guess. One fix improved the access lens and the flood lens at once, because they share one model." |
| 3:25 | Resident-agent report: before/after matrix; "can every profile reach a centre under each scenario?" | "We don't wait for residents to hit gaps. Test agents for strollers, wheelchairs, older residents and cars walk every journey, in every scenario, overnight. Before one verification round, <X>% of journeys were confirmed. After it, <Y>%." *(only real numbers from [evaluation-plan § 5](evaluation-plan.md))* |
| 3:40 | Architecture one-liner → roadmap slide (data-centre siting, more lenses) | "A verified world model is the source of truth. Routing and flood scenarios are deterministic code, not the AI; the AI translates questions and cites everything. New lenses, like site screening for SDP's data-centre strategy, are new layers on the same model." |
| 3:50 | Close | "TownshipLens: one township model, asked by residents and managers, with evidence instead of guesswork, and a township that learns what it doesn't know." |

## What can go wrong → recovery

| Failure | Recovery line + action |
|---|---|
| LLM slow or down | "Let me show you the recorded run" → switch to the video at the same timestamp (or `DEMO_MODE=1` cached responses) |
| Google 3D tiles don't load or look poor | Switch to the config fallback (Cesium OSM Buildings) or click "Lite view" / "2D map". *"Works on any phone. 3D is a layer, not a dependency."* The flood animation carries the wow either way |
| Water polygon floats above or sinks below the mesh (datum offset) | Reload with the calibrated offset; if still off, use the lite view where the flood layer is drawn flat. Say: "we calibrate the water against the DEM, not the picture" |
| Slider slow on the venue laptop | Use the preset buttons (swap pre-baked scenarios, no animation) or the recorded video |
| Scenario answer lacks the banner or says anything like "safe" | Stop, say: "That's exactly what our validator is there to block." Show the golden-set result for the disclaimer check (100%), then switch to the video |
| Flood answer differs from the rehearsal | Don't argue with it. *"This is why every answer shows its evidence. Let's look at what the engine returned."* Read the cut-off list from the console, then the video |
| Wrong answer live | Same: show the evidence, then the video |
| Staff/management login expired | Pre-recorded GIF of the resolve step |

## Variants
- **60-second version** (proposal video): 0:00 fly-in, one J1 answer (0:15–0:55), the flood slider to +3 m with the banner (1:05–1:35), close.
- **3-minute slot:** drop the evidence-card tap (0:55), shorten the console to cut-off list + islands, skip the resident-agent slide.
- **5-minute version** (final): add J4 (closure), J3 ("How do you know?" from Priya), the waste-point question (J10, "where can I drop off old batteries?" with the honest "collection day unknown, ask MBSA"), and the advisory edit.
