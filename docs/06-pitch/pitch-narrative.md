# Pitch Narrative & Slide Plan

> The story we tell on 14 Nov (and in shorter form in the 23 Oct proposal). It's built to cover **Mechanism** and **Enabler** explicitly and to hit every criterion in [judging-criteria-mapping](../01-hackathon/judging-criteria-mapping.md). Demo choreography: [demo-script](../03-product/demo-script.md). Answers to likely questions: [judge-qa](judge-qa.md).

## The story in three sentences
1. **Today**, township facilities are hard to *use* for anyone who can't take stairs, needs to rest, or doesn't know the place, because information is scattered and nobody knows what's been checked.
2. **TownshipLens** answers "how do I get there?" from a verified map of entrances and paths, shows it in 3D, and is honest about what isn't checked yet.
3. **Every unknown becomes a task** for the township team, so the township gets easier to use every week.

## Taglines (pick one, use it consistently)
- "Evidence, not guesswork."
- "A township that knows what it doesn't know."
- "Find the right entrance, the first time."

## Slide plan (target 7 minutes + demo; adjust to the official time limit)

| # | Slide | Purpose | Criterion | Content |
|---|---|---|---|---|
| 1 | **Aisyah's morning** | Hook | Fit, Impact | Photo-style illustration: the stroller at the bottom of the stairs, the wrong entrance. One sentence. |
| 2 | **The real problem** | Problem | Fit, Impact | "A pin tells you where, not how." Fragmented info (map, notices, WhatsApp, staff memory) + "accessible ✓, says who? when?" + Malaysian numbers (OKU 805,509; 60+ about 12% and rising; young families). Cite sources. |
| 3 | **Meet TownshipLens** | Mechanism | Innovation | One screenshot: question → 3D route, green/amber segments, evidence card. |
| 4 | **Live demo** | Proof | Feasibility, Evidence | [demo-script](../03-product/demo-script.md): J1 → J3 → J5 |
| 5 | **The gap loop** | Mechanism / differentiator | Innovation, Impact | A circular diagram: question → unknown → ranked VR → staff fix (2 min) → confirmed answer. Before→after numbers. |
| 6 | **Who benefits** | Mechanism | Impact, Commercial | Residents (4 personas), staff (ops and facility manager), SDP (enquiries ↓, utilisation ↑, ESG inclusivity proof, sales differentiator) |
| 7 | **Enabler 1: verified world model** | Enabler | Innovation, Feasibility | OpenSidewalks-based graph; tri-state facts with provenance; "our world model is verified data, not generated pictures" |
| 8 | **Enabler 2: AI for language, algorithms for geometry** | Enabler | Innovation | Tool-calling LLM + deterministic routing + validator; cite MapEval / *Lost in Aggregation* (2026); "0 unsupported claims in N test questions" |
| 9 | **Enabler 3: agents that test the map** | Enabler | Innovation, Evidence | Persona profiles; seeded faults found (x/y); "not role-play: real residents consulted in person" |
| 10 | **Enabler 4: built to scale** | Enabler | Feasibility, Commercial | Swappable 3D (Google tiles today; SDP BIM or phone splats tomorrow); browser-only; about USD 1 per 1,000 questions; onboarding a facility = N hours |
| 11 | **Evidence** | Results | Evidence, Impact | Results table from [evaluation-plan § 5](../03-product/evaluation-plan.md); user quotes |
| 12 | **Pilot plan** | Ask | Feasibility, Commercial | 4–8 weeks at Elmina Urban Park + Lakeside Mall frontage: KPIs, staff involvement, cost, privacy. "What we need from SDP: one facility, one ops contact, data access." |
| 13 | **Team** | Team | Team | Three lanes (photo + one-line role each); mentors' feedback we acted on |
| 14 | **Close** | Memory | (all) | Tagline + the Aisyah image, now at the right entrance |

## Speaking parts
| Part | Speaker |
|---|---|
| Slides 1–3, 5–6, 12, 14 (Mechanism story) | Pitch lead |
| Slide 4 demo | FE (drives) + pitch lead (narrates) |
| Slides 7, 10 | BE |
| Slides 8, 9, 11 | AI |
| Slide 13 | Everyone, one line each |

## Proposal version (23 Oct)
The same arc, compressed: problem → solution → how it works (one diagram) → why it's different → feasibility (spike screenshots + stack) → impact & how we'll measure → pilot pathway → team. See [proposal-outline](proposal-outline.md).

## Design guidelines for the deck
- One idea per slide; 6 words max in titles; real screenshots over icons.
- Colour legend consistent with the app (green = checked, amber dashed = not checked yet, red = not passable), always with text labels (accessibility of our own slides).
- Every number has a tiny source footnote.
- Avoid: "revolutionary", "AI-powered" as a headline, "digital twin of the whole township", "100% safe".
