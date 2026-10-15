# Judge Q&A Prep

> Updated 15 Oct 2026 for the Township World Model platform (lenses `access`, `flood`, `waste`) and again after the demo and pitch polish (gap map, closures, rest-gap honesty, major roads, replay demo). Flood answers must always say "indicative scenario, not a forecast" and never "safe". Numbers come only from [key-numbers](key-numbers.md).
> Likely questions, grouped by judging criterion, with **short** answers (aim for 20–30 seconds each). The owner is who answers on stage. Practise them out loud. Each answer should end with a fact or a demo pointer, not an adjective.

## Strategic fit (15%)

**Q: Why is this a People-track solution and not just a map feature (or a Planet/climate one)?**
A (Mechanism lead): It's about *who* gets excluded today: parents with strollers, older residents, wheelchair users, first-time visitors. A pin on a map tells them where a building is, not how to get in without stairs. We make township knowledge usable for every resident, which is the People question word for word. The flood lens is the same idea: it asks "can every resident, including a wheelchair user, still get to a place of shelter?", so it is resident safety and getting around, not climate modelling.

**Q: How does it fit SDP's priorities?**
A: SDP builds integrated townships with shared community facilities. Their value depends on residents actually using them. TownshipLens makes those facilities discoverable and inclusive, and gives the township team data on what residents ask and where information is missing. (Cite specifics from [sdp-context.md](../01-hackathon/sdp-context.md).)

## Impact (25%)

**Q: What's the measurable impact?**
A: Three measured numbers from our pilot test (read from [evaluation-plan § 5](../03-product/evaluation-plan.md)): correct-entrance rate vs map+FAQ, journeys confirmed before vs after one verification round, and unsupported AI claims = 0 on our test set. In a pilot we'd also track repeated enquiries to the management office.

**Q: How much of Elmina is actually checked today?**
A: Almost none, and we show it. Our gap map says "Most paths are not yet checked: 16,131 of 16,148 for wheelchair travel" (measured on the seed, 15 Oct 2026). The mapped network is there, and the OSM facts that matter for access mostly aren't. That is the honest case for a field survey and for SDP's own data, and every gap is already a ranked task for the township team. The access facts we demo are placeholder demo values and the app labels them "Demo value · not surveyed".

**Q: How many people actually need this?**
A: Malaysia had 805,509 registered persons with disabilities in 2024, and about 12% of the population is 60+ and rising, plus every family with young children and every visitor. Cite from [accessibility-and-routing § 2](../02-research/accessibility-and-routing.md). **Don't say "aged nation by 2030".**

**Q: Is this sustainable after the hackathon? Who keeps the data current?**
A: That's exactly what the verification loop is for. The system tells staff *which* facts matter most, ranked by resident demand, and a fix takes about 2 minutes (a value and an optional photo). Freshness is tracked per fact, and staff can also report a closure with an end date, which only ever blocks a route. Staff effort per fix: <measure it before claiming a number>.

## Innovation (20%)

**Q: Google Maps already has wheelchair info and Immersive View. What's new?**
A: Three things Google doesn't do at township level: (1) **entrance- and path-segment-level** facts, not just a place flag; (2) **honest uncertainty**, where every fact has a source and a date and "unknown" is shown, not hidden; (3) a **closed loop** to the township team: unknowns become ranked work items, and fixes improve every future answer. See [competitors.md](../02-research/competitors.md).

**Q: Isn't this just a chatbot with RAG?**
A: No. The AI doesn't answer from documents. It calls a deterministic routing engine over a verified spatial graph, and a validator rejects any claim it can't cite. Recent benchmarks (MapEval, *Lost in Aggregation*, 2026) show LLMs fail at routing on their own. We designed around that.

**Q: What's a "world model" here? Isn't that a generative AI thing?**
A: Good question, and we're deliberate about it. Generative world models create plausible scenes. Ours is a *verified, structured* model of the real place: buildings, terrain, paths, facilities, waterways, each fact with a source and a date. The 3D view is presentation; the data is the truth. Residents and managers need facts, not plausible pictures.

**Q: Your "resident agents": are you simulating people?**
A: No, and on purpose. Research shows LLM personas of disabled people are stereotyped and idealised. Our agents are constraint profiles (step-free, rest every 100 m) that test the *map* on every journey. Real residents are consulted in person, as we did in our user test.

## Feasibility (20%)

**Q: Can SDP actually deploy this?**
A: Yes. It runs in a browser with no app install and no resident accounts. It builds on open data for the whole of Elmina (OSM, Overture, Copernicus elevation), an open schema (OpenSidewalks), and it's hosted for near-zero cost. Adding a *deep* verified spot is a one-day survey plus data entry; we did Elmina Urban Park in <N> hours. SDP data (LiDAR, drainage GIS) would sharpen the flood lens.

**Q: What does it cost to run?**
A: The LLM is about USD 1 per 1,000 questions on a small model. Hosting is on free or low tiers at pilot scale. The main cost is staff time for verification, which the system minimises by ranking. Details: [business-case.md](business-case.md).

**Q: What about Google 3D Tiles licensing?**
A: We use them for display only, as the policy allows. All our geometry comes from OSM, our own survey or SDP plans, never traced from Google. And the 3D layer is swappable: we have an open-data fallback, and SDP BIM can replace it.

**Q: What if the AI is wrong?**
A: Its job is limited to language. Routes come from a deterministic engine. Every claim is cited, a validator blocks uncited claims, and if validation fails twice we fall back to a template answer built straight from the data. Our golden set (13 questions) passes 13/13 on the mock assistant (15 Oct 2026); the unsupported-claim rate on a live model: <number, only if measured>.

**Q: Is the assistant in your demo a live AI?**
A: No. The demo runs the deterministic mock assistant with recorded answers (`DEMO_MODE`), on the real Elmina seed and the real routing and flood engines. The answers are scripted and checked, and the facts behind them come from the engines, not from a model. A live model is a one-line configuration change (`LLM_PROVIDER`), with the same tools and the same validator.

**Q: PDPA and privacy?**
A: No resident accounts, no location tracking. Personal details are redacted before any AI call. Question logs are anonymised and time-limited. Photos exclude people.

## Commercial (10%)

**Q: Who pays?**
A: SDP's township/property management, or the facility owner, as part of the service charge or a digital-services budget. The value is fewer repeated enquiries, better facility usage, an inclusivity credential for ESG reporting, and a sales-gallery differentiator for new launches. See [business-case.md](business-case.md).

**Q: How does it scale across townships?**
A: Per facility, not per city. The schema, tools and app are identical everywhere; only data onboarding repeats. The simulator measures the coverage of each new facility on day one.

## Team & evidence (10%)

**Q: What did you validate with real users?**
A: <n> participants, <tasks>: results from [evaluation-plan § 5](../03-product/evaluation-plan.md). Be honest about the small sample size.

**Q: What would you do with more time?**
A: Pilot at one SDP facility for 4–8 weeks with the ops team, add a WhatsApp channel (where residents already are), and onboard a second facility to measure onboarding time.

**Q: What's the hardest thing you haven't solved?**
A: Keeping facts fresh at scale without burdening staff. Our ranking helps, but in a pilot we'd test resident-submitted photo reports with staff approval.

---

## Platform, breadth and flood (new after the pivot)

**Q: Isn't this too broad for 4 weeks and 3 students?**
A (Pitch lead + BE): It's one world model with **two deep lenses and one thin one**. The flood lens reuses the routing engine and the verified-claims model, and its method is precomputed scenarios on an open elevation model, so it doesn't need a hydraulic simulator. Waste is 20–40 hand-curated points. Everything else (including data-centre siting) is labelled roadmap. Breadth is the platform claim; depth is where we demo.

**Q: Is Elmina even flood-prone? Why a flood lens here?**
A (AI/BE): Honest answer: Elmina's built-up core is **not** low-lying. Our elevation sampling gives a median of about 38 m, and Lakeside Mall sits around 45 m ([flood-disaster-lens](../02-research/flood-disaster-lens.md)). The documented floods are in the downstream neighbours, Kampung Kubu Gajah and Paya Jaras (April 2024, 4 October 2024 when relief centres opened, April 2025). Elmina residents are affected through **cut roads and links** (at +3 m the briefing shows 1,353 paths likely flooded and 396 possibly, against none at the normal river level; indicative, measured on the seed), and that is exactly what a routing lens answers. We don't claim "Elmina goes under"; we show how a river rise affects residents' routes, their neighbours and the evacuation centres.

**Q: What about paths a resident can't use for another reason, like works or an event?**
A: Staff can report a closure on a path or place, with a reason and an end date (or "until further notice"). Residents see it as "Reported closure (staff)", it is not passable for everyone while in force, and it can only block a route, never make one look better.

**Q: Can you predict floods?**
A: No, and we say so on screen. These are **indicative scenarios** ("river +3 m"), not forecasts. We never say "safe". For warnings people should follow JPS, MET Malaysia, NADMA and MBSA, and the app links to them. A live heavy-rain banner from MET Malaysia's open API is an optional extra.

**Q: Why should SDP trust a 30 m elevation model?**
A (BE): They shouldn't trust it as survey data, and neither do we. Copernicus GLO-30 has a vertical error under about 4 m, which is bigger than the water depths that matter for a wheelchair. So we classify paths into three bands (`likely_flooded`, `possible`, `unlikely`), treat `possible` as *not passable*, never print per-path depths, and show the margin. A scenario can only add "blocked" or "unknown", never turn an unknown into a pass. It is a planning aid for the questions "what might be cut off and who needs a plan?". The upgrade path is SDP's LiDAR and drainage data with a hydraulic model (SFINCS) behind the same interface.

**Q: What about the data centre?**
A (Pitch lead): It's a **roadmap lens, not something we built**. SDP's SHIFT32 strategy includes data centres (DC1 at Elmina Business Park was completed in March 2026; see [sdp-context](../01-hackathon/sdp-context.md)). Because our model already holds terrain, hydrology, roads and buildings, a site-screening lens would be another overlay on the same model. It would need its own data (power, fibre, planning rules) and an ADR, so we show it only as a commercial slide.

**Q: Which model is the "AI" and what happens if it's wrong?**
A (AI): The model is configurable (PydanticAI over OpenRouter, set in an environment variable), so we can swap it. It only calls ten deterministic tools, and a validator rejects uncited claims. For flood answers the server attaches the disclaimer and the scenario provenance; if validation fails, a template answer built from the data is used.

**Q: Who is the management user and did you talk to one?**
A: A township safety/ops lead (a persona we are validating, see [personas-and-journeys](../03-product/personas-and-journeys.md)) who wants to know what a river rise would cut off before it happens. We ran a feedback session with <n> township/ops person(s) ([evaluation-plan § 4.1](../03-product/evaluation-plan.md)): <findings>. We say honestly that n is tiny.

**Q: Can't the advisory draft cause panic or false reassurance?**
A: The draft is hedged ("likely cut off in this scenario"), links to official sources, is clearly marked a draft, and is **never sent by the app**. A person edits and sends it. We test that every scenario answer carries the disclaimer (100% target) and never says "safe".

**Q: How is this different from Google Flood Hub or JPS InfoBanjir?**
A: Those are live and authoritative at river-point or area level. We are not a warning system. We answer a different question: *"if the river rises by N metres, which streets, facilities and residents of this township get cut off, and where can each kind of resident go?"*, route-aware and uncertainty-honest ([competitors](../02-research/competitors.md), [flood-disaster-lens § 7](../02-research/flood-disaster-lens.md)).

---

## Tough or curveball questions

| Question | Answer direction |
|---|---|
| "Why 3D at all?" | Recognition: people find entrances faster when they *see* the façade, and managers grasp "what a river rise cuts off" at a glance. But the list view and a lite 2.5D map are always available; 3D is a layer, not a dependency. |
| "Isn't your verified data too small to matter?" | Yes, today almost nothing is verified, and the gap map says so (16,131 of 16,148 paths not yet checked for wheelchair travel). The model covers the whole of Elmina from open data: 16,148 paths, 74 walk-network components with 95.2% of nodes in the largest. Correctness is the product, and every gap is a ranked task, so adding verified spots is a repeatable process. |
| "Older residents need rest points. Do you handle that?" | Only honestly. The older-adult profile checks the longest stretch between rest points (limit 100 m). Rest points are sparse in the data, so most older-adult routes come back "partly unverified" with the longest stretch named, never "confirmed". Journey tests list these as advisory notes, not errors. |
| "Your routes use main roads. Are there pavements?" | We don't know, and we say so. OSM has no usable sidewalk tags on Elmina's major roads (909 segments, 86.7 km, none with a sidewalk claim), so a route over them is "partly unverified" at best; stroller and wheelchair routes need a *verified* sidewalk to pass. |
| "If there is no route, is the place 'not reachable'?" | No. When two places sit in different parts of the walk network, that is shown as "No mapped connection (data gap)", never "not reachable". "Blocked" is only for a known barrier. |
| "What stops someone submitting false reports?" | Resident reports never auto-apply; only staff verify. A reported barrier makes us *cautious*, never *confident*. |
| "Where did the flood water in your 3D come from? From the Google mesh?" | No. Heights and water extents come from the open elevation model only; Google's terms forbid deriving heights from the tiles. The tiles are just the backdrop. |
| "Will you tell residents their home is safe?" | Never. We say "not in the modelled flood extent" and point to official sources. |
| "Is a hand-curated waste layer worth it?" | It's deliberately thin (20–40 points) to show a third lens costs days, not weeks, on the same model; OSM has zero recycling points in Elmina. |
| "Does it meet MS 1184?" | We don't certify compliance. We record verified measurements, which an auditor could use. |
| "Why not just put up better signs?" | Do both. Signs help on site; we help *before* the trip and in any language. And our gap data tells SDP where signs are needed. |
