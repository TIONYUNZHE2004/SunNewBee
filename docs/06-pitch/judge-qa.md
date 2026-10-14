# Judge Q&A Prep

> Likely questions, grouped by judging criterion, with **short** answers (aim for 20–30 seconds each). The owner is who answers on stage. Practise them out loud. Each answer should end with a fact or a demo pointer, not an adjective.

## Strategic fit (15%)

**Q: Why is this a People-track solution and not just a map feature?**
A (Mechanism lead): It's about *who* gets excluded today: parents with strollers, older residents, wheelchair users, first-time visitors. A pin on a map tells them where a building is, not how to get in without stairs. We make township knowledge usable for every resident, which is the People question word for word.

**Q: How does it fit SDP's priorities?**
A: SDP builds integrated townships with shared community facilities. Their value depends on residents actually using them. TownshipLens makes those facilities discoverable and inclusive, and gives the township team data on what residents ask and where information is missing. (Cite specifics from [sdp-context.md](../01-hackathon/sdp-context.md).)

## Impact (25%)

**Q: What's the measurable impact?**
A: Three measured numbers from our pilot test (read from [evaluation-plan § 5](../03-product/evaluation-plan.md)): correct-entrance rate vs map+FAQ, journeys confirmed before vs after one verification round, and unsupported AI claims = 0 on our test set. In a pilot we'd also track repeated enquiries to the management office.

**Q: How many people actually need this?**
A: Malaysia had 805,509 registered persons with disabilities in 2024, and about 12% of the population is 60+ and rising, plus every family with young children and every visitor. Cite from [accessibility-and-routing § 2](../02-research/accessibility-and-routing.md). **Don't say "aged nation by 2030".**

**Q: Is this sustainable after the hackathon? Who keeps the data current?**
A: That's exactly what the verification loop is for. The system tells staff *which* facts matter most, ranked by resident demand, and a fix takes about 2 minutes. Freshness is tracked per fact. Staff effort per fix is something we measured.

## Innovation (20%)

**Q: Google Maps already has wheelchair info and Immersive View. What's new?**
A: Three things Google doesn't do at township level: (1) **entrance- and path-segment-level** facts, not just a place flag; (2) **honest uncertainty**, where every fact has a source and a date and "unknown" is shown, not hidden; (3) a **closed loop** to the township team: unknowns become ranked work items, and fixes improve every future answer. See [competitors.md](../02-research/competitors.md).

**Q: Isn't this just a chatbot with RAG?**
A: No. The AI doesn't answer from documents. It calls a deterministic routing engine over a verified spatial graph, and a validator rejects any claim it can't cite. Recent benchmarks (MapEval, *Lost in Aggregation*, 2026) show LLMs fail at routing on their own. We designed around that.

**Q: What's a "world model" here? Isn't that a generative AI thing?**
A: Good question, and we're deliberate about it. Generative world models create plausible scenes. Ours is a *verified, structured* model of the real place. Residents need facts, not plausible pictures.

**Q: Your "resident agents": are you simulating people?**
A: No, and on purpose. Research shows LLM personas of disabled people are stereotyped and idealised. Our agents are constraint profiles (step-free, rest every 100 m) that test the *map* on every journey. Real residents are consulted in person, as we did in our user test.

## Feasibility (20%)

**Q: Can SDP actually deploy this?**
A: Yes. It runs in a browser with no app install and no resident accounts. It uses existing 3D data and an open schema (OpenSidewalks), and it's hosted for near-zero cost. Onboarding a facility is a one-day survey plus data entry. We did it for <site> in <N> hours.

**Q: What does it cost to run?**
A: The LLM is about USD 1 per 1,000 questions on a small model. Hosting is on free or low tiers at pilot scale. The main cost is staff time for verification, which the system minimises by ranking. Details: [business-case.md](business-case.md).

**Q: What about Google 3D Tiles licensing?**
A: We use them for display only, as the policy allows. All our geometry comes from OSM, our own survey or SDP plans, never traced from Google. And the 3D layer is swappable: we have an open-data fallback, and SDP BIM can replace it.

**Q: What if the AI is wrong?**
A: Its job is limited to language. Routes come from a deterministic engine. Every claim is cited, a validator blocks uncited claims, and if validation fails twice we fall back to a template answer built straight from the data. We measured the unsupported-claim rate: <number>.

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

## Tough or curveball questions

| Question | Answer direction |
|---|---|
| "Why 3D at all?" | Recognition: people find entrances faster when they *see* the façade. But 2D/text is always available, and 3D is optional. |
| "Isn't your data too small to matter?" | It's deliberately one facility done *right*. Correctness is the product, and scale is a repeatable process. |
| "What stops someone submitting false reports?" | Resident reports never auto-apply; only staff verify. A reported barrier makes us *cautious*, never *confident*. |
| "Does it meet MS 1184?" | We don't certify compliance. We record verified measurements, which an auditor could use. |
| "Why not just put up better signs?" | Do both. Signs help on site; we help *before* the trip and in any language. And our gap data tells SDP where signs are needed. |
