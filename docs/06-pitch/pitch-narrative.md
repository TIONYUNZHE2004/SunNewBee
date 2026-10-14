# Pitch Narrative & Slide Plan

> The story we tell on 14 Nov (and in shorter form in the 23 Oct proposal). It's built to cover **Mechanism** and **Enabler** explicitly and to hit every criterion in [judging-criteria-mapping](../01-hackathon/judging-criteria-mapping.md). Demo choreography: [demo-script](../03-product/demo-script.md). Answers to likely questions: [judge-qa](judge-qa.md). Product shape: [project-brief](../00-overview/project-brief.md) and [ADR 0009](../00-overview/decisions/0009-township-world-model-platform.md).

## The story in three sentences
1. **Today**, township knowledge is scattered across maps, notices, WhatsApp groups and staff memory, and none of it is spatial or verified, so a parent with a stroller can't tell which entrance to use, and a township team can't tell what a river rise would cut off.
2. **TownshipLens** turns City of Elmina into a living **3D world model** that residents and managers can ask anything: step-free routes today (lens 1) and "what if the river rises?" tomorrow (lens 2), answered from checked data and honest about what isn't known.
3. **Every unknown becomes a task** for the township team, and every fix improves every lens, so the township gets easier to use and safer to plan for every week.

## Taglines (pick one, use it consistently)
- "Evidence, not guesswork."
- "A township that knows what it doesn't know."
- "Ask your township anything, and trust the answer."

## Framing guardrails
- **Track: People.** Flood is framed as *resident safety and getting around in an emergency*, not as a climate-modelling project.
- **Platform claim, honest scope:** one world model, **two deep lenses** (accessibility, flood what-if) and one thin one (recycling/waste). Further lenses are roadmap, for example site screening tied to SDP's SHIFT32 data-centre strategy.
- **Flood honesty:** "indicative scenario, not a forecast"; never "safe"; Elmina's core is not low-lying, the documented floods are in downstream Kampung Kubu Gajah / Paya Jaras ([flood-disaster-lens § 1](../02-research/flood-disaster-lens.md)).

## Slide plan (target 7 minutes + demo; adjust to the official time limit)

| # | Slide | Purpose | Criterion | Content |
|---|---|---|---|---|
| 1 | **Aisyah's morning** | Hook | Fit, Impact | Photo-style illustration: the stroller at the bottom of the stairs, the wrong entrance. One sentence. |
| 2 | **The real problem** | Problem | Fit, Impact | "A pin tells you where, not how." And "nobody can show what a river rise would cut off". Fragmented info (map, notices, WhatsApp, staff memory) + "accessible ✓, says who? when?" + Malaysian numbers (OKU 805,509; 60+ about 12% and rising; young families) + one local flood fact (Oct 2024 relief centres opened next door). Cite sources ([key-numbers](key-numbers.md)). |
| 3 | **Meet TownshipLens** | Mechanism | Innovation | One 3D screenshot of Elmina: question → route with green/amber segments and an evidence card. "One world model, many lenses." |
| 4 | **Live demo** | Proof | Feasibility, Evidence | [demo-script](../03-product/demo-script.md): 3D fly-in → J1 (stroller route) → flood slider to +3 m → Priya's question → management briefing → gap loop |
| 5 | **The gap loop** | Mechanism / differentiator | Innovation, Impact | A circular diagram: question or scenario → unknown → ranked VR → staff fix (2 min) → confirmed answer, in both lenses. Before→after numbers. |
| 6 | **Who benefits** | Mechanism | Impact, Commercial | Residents (4 personas), staff (ops, facility manager, **township safety lead**), SDP (enquiries ↓, utilisation ↑, ESG inclusivity and climate-resilience proof, sales differentiator) |
| 7 | **Enabler 1: verified world model** | Enabler | Innovation, Feasibility | Base twin of the whole of Elmina from open data + lens overlays; tri-state facts with provenance; "our world model is verified data, not generated pictures". OSM counts as proof of the gap (e.g. 0 mapped entrances across the envelope; [key-numbers](key-numbers.md)). |
| 8 | **Enabler 2: AI for language, algorithms for geometry** | Enabler | Innovation | Tool-calling LLM (PydanticAI over OpenRouter) + deterministic routing and flood scenarios + validator; cite MapEval / *Lost in Aggregation* (2026); "0 unsupported claims in N test questions"; "disclaimer on 100% of scenario answers" |
| 9 | **Enabler 3: flood scenarios, honestly** | Enabler | Innovation, Feasibility | HAND on Copernicus GLO-30 (open, 30 m); `stage_p1m` … `stage_p5m`; three classes (`likely_flooded` / `possible` / `unlikely`); unknown never becomes passable; "indicative, not a forecast"; upgrade path to SDP LiDAR + SFINCS |
| 10 | **Enabler 4: agents that test the township** | Enabler | Innovation, Evidence | Persona profiles; seeded faults found (x/y); "can every profile reach an evacuation centre under scenario X?"; "not role-play: real residents consulted in person" |
| 11 | **Enabler 5: 3D, built to scale** | Enabler | Feasibility, Commercial | CesiumJS + Google photoreal tiles; Mapbox lite and list view as fallbacks; browser-only; about USD 0.6 per 1,000 questions on a small model ([key-numbers](key-numbers.md)); onboarding a deep spot = N hours |
| 12 | **Evidence** | Results | Evidence, Impact | Results table from [evaluation-plan § 5](../03-product/evaluation-plan.md); user quotes; management feedback quotes |
| 13 | **Pilot plan and roadmap** | Ask | Feasibility, Commercial | 4–8 weeks at Elmina: Lens 1 at Urban Park + Lakeside Mall frontage, Lens 2 as an ops planning tool with SDP/MBSA data (LiDAR, drainage GIS, PPS list). Roadmap: more lenses, including data-centre site screening for SHIFT32. "What we need from SDP: one ops contact, data access, comms review of flood wording." |
| 14 | **Team** | Team | Team | Three lanes (photo + one-line role each); mentors' feedback we acted on |
| 15 | **Close** | Memory | (all) | Tagline + the Aisyah image at the right entrance, and the same model showing the township's routes under a river rise |

## Speaking parts
| Part | Speaker |
|---|---|
| Slides 1–3, 5–6, 13, 15 (Mechanism story) | Pitch lead |
| Slide 4 demo | FE (drives) + pitch lead (narrates) |
| Slides 7, 9, 11 | BE |
| Slides 8, 10, 12 | AI |
| Slide 14 | Everyone, one line each |

## Proposal version (23 Oct)
The same arc, compressed: problem → solution (one world model, two lenses) → how it works (one diagram) → why it's different → feasibility (spike screenshots + stack) → impact & how we'll measure → pilot pathway → team. See [proposal-outline](proposal-outline.md).

## Design guidelines for the deck
- One idea per slide; 6 words max in titles; real screenshots over icons.
- Colour legend consistent with the app (green = checked, amber dashed = not checked yet, red = not passable / likely flooded, stripes = uncertain), always with text labels (accessibility of our own slides).
- Every number has a tiny source footnote.
- Every flood visual carries the caption "Indicative scenario, not a forecast".
- **Avoid:** "revolutionary", "AI-powered" as a headline, "digital twin of the whole township" (our *verified* depth is at the deep spots; say "world model with deep verified spots"), "100% safe", "predicts floods", any claim that Elmina is flood-prone as a whole, and presenting the data-centre lens as built (it is a roadmap slide).
