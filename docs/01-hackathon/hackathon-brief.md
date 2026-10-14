# Hackathon Brief — Sime Darby Property University Hackathon 2026

> Source: <https://www.simedarbyproperty.com/universityhackathon> (captured 14 Oct 2026). This file restates the official rules so the team doesn't have to re-read the website. If the website changes, update this file and note the date.

## The challenge in one line

> *How might we reimagine the **Township of Tomorrow** where people, businesses and nature thrive together through innovation, technology and sustainable living?*

Organiser: **Sime Darby Property Berhad (SDP)**. Format: a 10–12 week innovation programme for teams of **3–5 university students** based in Malaysia. Free to join.

Winning solutions are reviewed by SDP leadership for **potential real-world pilots in live SDP townships**. Mentoring comes from the people who design, build and operate those townships.

## Tracks (pick exactly one)

Submitting the same idea to several tracks can get the team disqualified.

### People: *the track TownshipLens enters*
> How might we enable every resident to live healthier, safer, more connected and more fulfilling lives?

1. Community wellbeing
2. Safety and security
3. **Accessibility and inclusion** ← TownshipLens primary
4. **Getting around (mobility)** ← TownshipLens primary
5. **Digital living** ← TownshipLens primary
6. Feeling connected to neighbours
7. Healthy lifestyles

### Planet
> How might we create townships that regenerate the environment while making sustainable living effortless?

Waste management · Circular economy · Energy efficiency · Water conservation · Green transport · Biodiversity · Climate resilience

*Possible secondary angle for TownshipLens: climate resilience (shelter/shade/flood-closed walkways as path attributes). Mention it, but the submission stays in People.*

## Timeline

| Phase | Date | Status (as of 14 Oct 2026) |
|---|---|---|
| Official launch | 11 Sep 2026 | done |
| Registration | 11 Sep – 21 Oct 2026 | **open, closes in 7 days** |
| Challenge briefing | 9 Oct 2026 | done |
| **Proposal submission** | **23 Oct 2026** | **9 days left** |
| Judging rounds | 24 – 28 Oct 2026 | |
| Top 10 announcement | 28 Oct 2026 | |
| Mentoring sprint (Top 10) | 2 – 6 Nov 2026 | |
| **Final submission** | **11 Nov 2026** | |
| Top 10 pitch day | 14 Nov 2026 | |
| Final presentation & awards | 3 Dec 2026 | |

The team plan built on these dates is in [../05-team/timeline.md](../05-team/timeline.md).

## Judging criteria

| # | Criterion | Weight | What judges look for |
|---|---|---|---|
| 1 | Strategic Fit & Theme Relevance | 15% | Fit with the People/Planet theme and SDP's township priorities |
| 2 | **Impact & Sustainability Value** | **25%** | Potential to deliver measurable benefits to residents, communities and the environment |
| 3 | Innovation & Differentiation | 20% | How original the idea is and how it beats or differs from existing solutions |
| 4 | Feasibility & Deliverability | 20% | How practical it is to implement and pilot inside an SDP township |
| 5 | Commercial & Value Multiplication | 10% | Business value; scaling across townships or use cases |
| 6 | Team, Evidence & Pitch Quality | 10% | Research, validation, the prototype or demo, team capability, clarity |

Impact, Innovation and Feasibility together are **65%**. How we answer each criterion is in [judging-criteria-mapping.md](judging-criteria-mapping.md).

## What we must pitch

1. **Mechanism:** what the solution is, how it works, who benefits and why it creates value for the township.
2. **Enabler:** how technology makes the solution work, improves the user experience and supports implementation at township scale.

## What counts as a prototype

The organisers accept any of these: a mobile or web app · AI assistant · smart device or IoT concept · interactive dashboard · service prototype · physical model · smart infrastructure concept · digital experience.
TownshipLens = **web app + AI assistant + interactive dashboard (staff side)**.

## What makes a great submission (official list)

Innovative · User-centred · Practical · Scalable · Sustainable · Relevant to future township living.

## Participation mechanics

- Every member registers on the website. The team leader groups the members into one submission, picks one track and submits on the team's behalf. **Each member must accept the team invitation before the submission is final.**
- At least one member must be able to code (we have three).
- Non-Malaysians may join if they hold a Malaysian PR, work visa or student visa and live in Malaysia.

## Prizes and opportunities

| Place | Prize |
|---|---|
| Champion | RM 6,000 |
| 1st runner-up | RM 3,000 |
| 2nd runner-up | RM 1,500 |
| 4th–10th | RM 500 each |

Other opportunities: internships with SDP, development with SDP's industry experts, a possible real proof of concept, and a route into SDP's Management Associate Programme.

## Open questions to ask organisers / mentors

Updated 15 Oct 2026 for the whole-Elmina platform with an accessibility lens and a flood what-if lens. Ask the organisers the rules questions now; ask mentors and SDP the data questions on **28 Oct** (Top 10) or earlier through the organisers. Nothing in the MVP depends on the answers (we fall back to open data and label it), but each one upgrades the demo.

**Rules and submission (organisers)**
- [ ] What format and page limit does the 23 Oct proposal have, and may it include a screenshot or short video of a working prototype? (Check the registration portal.)
- [ ] Do the judges expect a deployed URL, or is a video demo enough, for the 11 Nov final submission?
- [ ] **IP:** who owns the IP in submitted work, and what happens to it if we are not selected? (Check the Terms & Conditions.)
- [ ] **Permission to publish:** may we publish a public demo and accessibility attributes about named SDP facilities (the mall frontage) and **flood what-if scenarios** for Elmina? Is there required wording from SDP communications? (Flood scenarios are labelled indicative, never a forecast.)

**Elmina data (SDP / mentors)**
- [ ] **Elmina boundary polygon** (and the township's own place list) so we can clip the whole-township model exactly. Today we use an envelope `3.150,101.460,3.240,101.530`.
- [ ] **PPS list:** the official *Pusat Pemindahan Sementara* (evacuation centres) for Elmina / Subang Bestari / Shah Alam. Is "Dewan Bunga Matahari" the same as "Dewan MBSA Matahari"? Until we get a list, OSM halls, schools and mosques are labelled `osm_candidate`, never "official".
- [ ] **LiDAR, drainage and flood study:** survey or LiDAR data, drainage GIS, the stormwater masterplan (pond volumes, design storms, hand-over status SDP vs MBSA), and any flood marks or photos from Oct 2024 / Apr 2025 to sanity-check our scenario footprints. Also JPS gauge thresholds and permission to read InfoBanjir data (no documented API; we do not scrape).
- [ ] Access to site data for the deep spot (master plans, facility lists, BIM/CAD, photos), and under what terms. May we survey and photograph Elmina Urban Park and the Lakeside Mall frontage (see [site-selection](../02-research/site-selection.md))?

**Waste lens**
- [ ] **MBSA / SWCorp waste contact:** collection schedules for Elmina, recycling and e-waste points, and whether SDP operates composting or recycling sites we can list. We found no OSM recycling points and no open MBSA dataset covering Elmina, so the `waste` lens is hand-curated and thin.

**Judging and roadmap**
- [ ] Is a roadmap lens (planning / data-centre site screening tied to SHIFT32) welcome as a pitch slide, or would it distract from the People track?
