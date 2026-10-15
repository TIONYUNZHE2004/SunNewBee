# Proposal (due Fri 23 Oct 2026): Outline & Draft

> ⚠️ **First, check the portal** for the official proposal format (page/word limit, template, required fields, file type) and adapt this outline to it. Record what you find in [hackathon-brief § Open questions](../01-hackathon/hackathon-brief.md).
> Internal deadlines: draft v1 **Wed 21 Oct** → review against the [criteria mapping](../01-hackathon/judging-criteria-mapping.md) **Thu 22 Oct** → submit **Fri 23 Oct before noon**.
> Fill `<…>` placeholders with real values (site, numbers, screenshots).

---

## Title
**TownshipLens: a 3D world model of your township that residents and managers can ask anything, and trust**
Track: **People** · Sub-themes: Accessibility & inclusion · Safety & security · Getting around · Digital living · Community wellbeing

## 1. Problem (≈150 words) → Fit 15%, Impact 25%
> Draft:
> A map pin tells a resident *where* a community facility is, but not *which entrance* to use, whether the route has stairs, where to rest, or whether a walkway is closed today. In SDP townships this information is spread across maps, notices, management-office WhatsApp groups and staff memory, and where "accessible" labels exist, nobody can say who checked them or when. Township teams have the mirror problem: when heavy rain comes, they cannot easily see which roads, walkways and community halls a river rise would cut off, which clusters of homes could become islands, or whether a wheelchair user could still reach an evacuation centre. In Malaysia, <805,509 registered persons with disabilities (DOSM, 2024)>, <about 12% of the population aged 60+ (2025)> and <2.31 million children under five> make step-free access an everyday issue; and flooding next door to City of Elmina (Kampung Kubu Gajah / Paya Jaras, Oct 2024) opened relief centres. The facts both groups need are the same (paths, levels, entrances, facilities, drains), but nobody keeps them in one trustworthy place.

## 2. Solution (≈200 words + 1 diagram) → Innovation 20%
> Draft:
> **TownshipLens** turns City of Elmina into a living **3D world model**, with themed "lenses" on top of one verified data model. Residents and managers ask in everyday language (English, Bahasa Melayu or Chinese) and an AI assistant answers from checked data, showing the answer in 3D.
> - **Lens 1, accessibility:** *"Can I take a stroller from the Lakeside Mall car park to the Urban Park playground without stairs?"* A deterministic routing engine checks the route for the resident's needs. Every fact is *yes*, *no* or *unknown*, with a source and a date, and the answer says which parts aren't verified yet.
> - **Lens 2, flood what-if:** a manager (or resident) picks "river +3 m". Water rises along Sungai Subang in 3D, paths and roads turn red (likely) or dashed orange (possible), and the same engine re-plans routes and shows which candidate evacuation centres each kind of resident can still reach, with a draft advisory for staff to edit (never sent by the app). It is an **indicative scenario, not a forecast**, and never says "safe".
> - **Recycling layer:** where to drop off batteries, with honest "unknown" answers.
>
> Every unknown becomes a **verification task** for the township team, ranked by demand; each fix improves every lens. **Test agents** walk every journey, under every scenario, to find gaps before residents do.

Diagram: one world model (terrain, buildings, paths, facilities, drains, centres) → lenses → AI + tools → 3D/list views; the gap loop on the side.

## 3. How it works / prototype (≈200 words + 2–3 screenshots) → Feasibility 20%
- Coverage: **the whole of City of Elmina, Shah Alam** (SDP's flagship township) from open data. In OpenStreetMap across our Elmina envelope, we found 6,901 buildings and about 1,430 footway/path/pedestrian ways, but **0 mapped entrances and 4 toilets** ([key-numbers](key-numbers.md)): the network exists, the accessibility facts don't. That is the gap we close.
- Deep spots: **Elmina Urban Park + Lakeside Mall frontage** (verified on site; why: [site-selection](../02-research/site-selection.md)) and the **Sungai Subang corridor** for the flood lens.
- Flood method: precomputed **river-stage scenarios** (+1 to +5 m) from a relative elevation model (height above mapped OSM drainage) on the open Copernicus 30 m elevation model, three classes per path (likely flooded / possible / unlikely) where unknown is never passable ([ADR 0010](../00-overview/decisions/0010-flood-lens-hand-scenarios.md); HAND was tried first and replaced). The story is how a river rise affects *Elmina residents' routes, neighbours and evacuation centres*; the recent floods were in downstream Kampung Kubu Gajah / Paya Jaras, and Elmina's core is not low-lying.
- Screenshots (real app on the Elmina seed, mock-backed answers; [screenshots/README](screenshots/README.md)):
  1. `screenshots/01-access-stroller-route-3d.jpg`: 3D route, unchecked paths dashed amber, "Route status: partly unverified", demo values labelled "not yet surveyed";
  2. `screenshots/02-flood-p3m-wheelchair-where-can-i-go.jpg`: river +3 m (indicative) with the banner and a "Where can I go?" answer naming a candidate centre;
  3. `screenshots/03-manage-flood-briefing-baseline-vs-p3m.jpg`: management briefing, normal level vs +3 m;
  4. `screenshots/04-gap-map-wheelchair-not-yet-checked.jpg`: "16,131 of 16,148" paths not yet checked for wheelchair travel.
- Architecture in one line: *verified world model (base twin + lens overlays) + NetworkX routing and flood scenarios + tool-calling LLM (PydanticAI over OpenRouter) with a citation validator + CesiumJS with Google Photorealistic 3D Tiles, Mapbox lite and list view as fallbacks; browser-based, no app install, no resident accounts.*
- Link: <deployed URL> · <60–90 s demo video>.

## 4. What makes it different (≈120 words + small table) → Innovation 20%
| | Generic map apps | Flood warning apps / Flood Hub | Township apps / chatbots | **TownshipLens** |
|---|---|---|---|---|
| Entrance- and path-level accessibility | partial | n/a | rarely | ✓ |
| Shows *unknown* + source + date | ✗ | n/a | ✗ | ✓ |
| Route checked by profile (stroller, wheelchair, rest, drive) | limited | ✗ | ✗ | ✓ |
| "What if the river rises N m?" with routes and centres, for a township | ✗ | ✗ (river-level warnings, no township routing) | ✗ | ✓ (indicative scenario) |
| Gaps flow to the township team, ranked | ✗ | ✗ | ✗ | ✓ |
| AI answers cite verified data only | n/a | n/a | rarely | ✓ |
| One model, many lenses (3 today, more later) | ✗ | ✗ | ✗ | ✓ |

Refine with [competitors.md](../02-research/competitors.md) and [flood-disaster-lens § 7](../02-research/flood-disaster-lens.md). Name real products there, but be fair: JPS InfoBanjir and Flood Hub are live and authoritative; we are not a warning system.

## 5. Impact & how we'll measure it (≈150 words) → Impact 25%, Evidence 10%
- Residents: correct-entrance rate and time vs map+FAQ (small user test, 2–6 Nov); comprehension that flood scenarios are "indicative, not a forecast".
- Trust: whether users correctly identify what's unverified.
- Township ops: journeys confirmed **before → after** one verification round; staff minutes per fix; feedback from 1–2 township/ops people on the flood briefing.
- Emergency planning: for each profile and scenario, the share of residential clusters that can still reach a candidate evacuation centre (from our resident agents).
- AI quality: unsupported-claim rate (target 0), correct route-status decisions (target 100%), disclaimer on 100% of scenario answers, agreement with the engine, on a golden test set.
- Early numbers, measured on the seed (15 Oct 2026, [key-numbers](key-numbers.md)): golden set 13/13 passing on the mock assistant; 16,131 of 16,148 paths not yet checked for wheelchair travel. User-test and before/after results: <fill in when run>.

## 6. Feasibility, cost & pilot pathway (≈150 words) → Feasibility 20%, Commercial 10%
- Built on open data and standards for the whole township; runs in any phone browser; about USD 0.6 per 1,000 questions in AI cost on a small model ([key-numbers](key-numbers.md)); free-tier hosting at pilot scale. Two deep lenses share one engine and one data model, so the extra lens costs weeks, not months.
- Privacy by design: no resident accounts, no tracking, personal details redacted before AI processing, no identifiable people in photos (PDPA-aware). Flood answers always link to official sources (MBSA, JPS, NADMA); advisory drafts are never auto-sent.
- **Pilot:** 4–8 weeks in Elmina: Lens 1 at one facility with one ops contact; Lens 2 as an ops planning tool, sharpened with SDP/MBSA data (LiDAR, drainage GIS, evacuation-centre list, flood photos) → measure enquiries, verification effort and planning usefulness → scale across townships and lenses. **Roadmap lens:** site screening (e.g. for SDP's data-centre business), commercial slide only. See [business-case](business-case.md).

## 7. Team (≈80 words) → Team 10%
<Name>: Backend (world model, routing, flood pipeline) · <Name>: Frontend (3D/2D experience, management console) · <Name>: AI (assistant, evaluation, resident-agent testing). University, programme, one relevant strength each.

---

## Submission checklist
- [ ] Every member registered **and accepted the team invite** (by Wed 21 Oct)
- [ ] Track = **People** (only one track)
- [ ] Word or page limits respected
- [ ] Screenshots are real (from the proof-of-life build), not mock-ups, or clearly labelled as mock-ups
- [ ] Every statistic has a source
- [ ] No claims of guaranteed safety or compliance; no forecast wording; every flood screenshot carries "indicative scenario, not a forecast"; data-centre siting shown as roadmap only
- [ ] Demo link works in an incognito window on a phone
- [ ] Proofread by someone outside the lane that wrote each section
- [ ] PDF exported and submitted; confirmation email screenshotted
