# Proposal (due Fri 23 Oct 2026): Outline & Draft

> ⚠️ **First, check the portal** for the official proposal format (page/word limit, template, required fields, file type) and adapt this outline to it. Record what you find in [hackathon-brief § Open questions](../01-hackathon/hackathon-brief.md).
> Internal deadlines: draft v1 **Wed 21 Oct** → review against the [criteria mapping](../01-hackathon/judging-criteria-mapping.md) **Thu 22 Oct** → submit **Fri 23 Oct before noon**.
> Fill `<…>` placeholders with real values (site, numbers, screenshots).

---

## Title
**TownshipLens: an AI assistant that understands your township, not just its documents**
Track: **People** · Sub-themes: Accessibility & inclusion · Getting around · Digital living · Community wellbeing

## 1. Problem (≈150 words) → Fit 15%, Impact 25%
> Draft:
> A map pin tells a resident *where* a community facility is, but not *which entrance* to use, whether the route has stairs, where to rest, or whether a walkway is closed today. In SDP townships this information is spread across maps, notices, management-office WhatsApp groups and staff memory. Where "accessible" labels exist, nobody can say who checked them or when. The result: parents carrying strollers up stairs, older residents avoiding facilities on hot days, wheelchair users phoning ahead and still arriving at the wrong door, and visitors circling car parks. In Malaysia, <805,509 registered persons with disabilities (DOSM, 2024)>, <about 12% of the population aged 60+ (2025)> and <2.31 million children under five> make this an everyday problem, not an edge case. Township teams, meanwhile, have no view of which questions recur or which facts are missing.

## 2. Solution (≈200 words + 1 diagram) → Innovation 20%
> Draft:
> **TownshipLens** is a resident-facing web assistant for an SDP township facility. Residents ask questions in everyday language (English, Bahasa Melayu or Chinese), for example *"Can I take a stroller from the Lakeside Mall car park to the Urban Park playground without stairs?"*. TownshipLens answers from a **verified world model**: a map of entrances, path segments and amenities in which every accessibility fact is *yes*, *no* or *unknown*, with its source and verification date. A deterministic routing engine checks the route for the resident's needs (stroller, wheelchair, older resident needing rest points). An AI assistant explains the result in plain language, shows the route on a 3D view of the real site, and states clearly which parts are not yet verified.
>
> Every unknown becomes a **verification request** for the township team, ranked by how many residents it affects. Staff verify it with a photo in about two minutes, and every later answer improves. Behind the scenes, **test personas** walk every journey through the map to find gaps before residents do.

Diagram: the gap loop (question → route check → answer with evidence → unknown → ranked staff task → verified fact → better answer).

## 3. How it works / prototype (≈200 words + 2–3 screenshots) → Feasibility 20%
- Site: **Elmina Urban Park + Elmina Lakeside Mall frontage, City of Elmina, Shah Alam** (SDP's flagship township; why: [site-selection](../02-research/site-selection.md)). OpenStreetMap already marks 28 of 54 footways here as `wheelchair=yes`, with no width, slope or source: asserted, not verified. That is exactly the gap we close.
- Screenshots from the proof-of-life: 3D site view with route overlay; the chat answer with evidence and a "not checked yet" badge; the staff verification queue.
- Architecture in one line: *verified spatial graph (OpenSidewalks-based) + NetworkX routing + tool-calling LLM with a citation validator + Google Photorealistic 3D Tiles + MapLibre 2D fallback; browser-based, no app install, no resident accounts.*
- Link: <deployed URL> · <60–90 s demo video>.

## 4. What makes it different (≈120 words + small table) → Innovation 20%
| | Generic map apps | Township apps / chatbots | **TownshipLens** |
|---|---|---|---|
| Entrance- and path-level accessibility | partial | rarely | ✓ |
| Shows *unknown* + source + date | ✗ | ✗ | ✓ |
| Route checked by profile (stroller, wheelchair, rest) | limited | ✗ | ✓ |
| Gaps flow to the township team, ranked | ✗ | ✗ | ✓ |
| AI answers cite verified data only | n/a | rarely | ✓ |

Refine with [competitors.md](../02-research/competitors.md). Name real products there, but be fair.

## 5. Impact & how we'll measure it (≈150 words) → Impact 25%, Evidence 10%
- Residents: correct-entrance rate and time vs map+FAQ (small user test, 2–6 Nov).
- Trust: whether users correctly identify what's unverified.
- Township ops: journeys confirmed **before → after** one verification round; staff minutes per fix; recurring-question insight.
- AI quality: unsupported-claim rate (target 0), correct route-status decisions (target 100%) on a golden test set.
- Early numbers from our spike: <fill in, e.g. "15 test questions, 0 unsupported claims">.

## 6. Feasibility, cost & pilot pathway (≈150 words) → Feasibility 20%, Commercial 10%
- Built on existing data and open standards; runs in any phone browser; about USD 1 per 1,000 questions in AI cost; free-tier hosting at pilot scale.
- Privacy by design: no resident accounts, no tracking, personal details redacted before AI processing, no identifiable people in photos (PDPA-aware).
- **Pilot:** 4–8 weeks at one SDP facility with one ops contact → measure enquiries, verification effort and resident outcomes → onboard a second facility to measure onboarding time → scale across townships. See [business-case](business-case.md).

## 7. Team (≈80 words) → Team 10%
<Name>: Backend (world model, routing) · <Name>: Frontend (3D/2D experience, staff console) · <Name>: AI (assistant, evaluation, persona testing). University, programme, one relevant strength each.

---

## Submission checklist
- [ ] Every member registered **and accepted the team invite** (by Wed 21 Oct)
- [ ] Track = **People** (only one track)
- [ ] Word or page limits respected
- [ ] Screenshots are real (from the proof-of-life build), not mock-ups, or clearly labelled as mock-ups
- [ ] Every statistic has a source
- [ ] No claims of guaranteed safety or compliance
- [ ] Demo link works in an incognito window on a phone
- [ ] Proofread by someone outside the lane that wrote each section
- [ ] PDF exported and submitted; confirmation email screenshotted
