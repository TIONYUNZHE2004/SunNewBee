# 0009. TownshipLens is a 3D Township World Model platform with lenses

- Status: **accepted**
- Date: 2026-10-14
- Deciders: team lead (user) with Claude; confirm with the team at kick-off
- Supersedes: the single-facility, accessibility-only framing of [original-idea](../original-idea.md) and parts of [0006](0006-mvp-site.md)

## Context
Reviewing the brief, the team lead wanted something more ambitious: a 3D "world model" of the township that residents *and* township management can ask anything, covering accessibility, disasters (flood) and waste/recycling, with more coverage than one park. Constraints still apply: 3 students, about 4 weeks of build, judging weights (Feasibility 20%, Impact 25%), and **one track only**.

## Decision
1. **Product shape:** TownshipLens = **one shared, verified world model of City of Elmina, shown in 3D, with "lenses"** (themed sets of data layers + tools + views) and an AI assistant that answers from it.
2. **Hero:** the **3D experience** (whole Elmina), with deep, verified detail only at a few key spots.
3. **MVP lenses:**
   - **Lens 1, Accessibility & getting around** (deep; residents): the existing design (tri-state facts, honest unknowns, staff verification loop).
   - **Lens 2, Flood / disaster what-if** (deep; management + residents; the wow moment): a rainfall/water-level scenario → water rises in 3D → cut-off paths and facilities → the same routing engine re-plans step-free and evacuation routes → the AI explains with evidence and uncertainty. **Indicative scenarios, never forecasts.**
   - **Recycling / waste** (thin layer + Q&A).
   - **Planning / data-centre siting:** roadmap only (commercial slide, tied to SDP's SHIFT32 data-centre business).
4. **Track:** **People.** The flood lens is framed as resident safety and getting around in emergencies.
5. **"World model"** keeps its meaning from ADR [0003](0003-structured-world-model-is-source-of-truth.md): structured, verified, layered data, not a generative world model.
6. **Resident agents** stay automatic journey testers, extended to flood scenarios ("can every resident profile still reach an evacuation centre at water level X?").

## Options considered
- **Accessibility only + 3D wow:** focused, but under-uses the world model and weakens the commercial story.
- **Platform, 4 working lenses:** impressive on paper, but a high risk of shallow, broken demos (Feasibility 20%).
- **Platform, 2 deep lenses + roadmap** (chosen): demonstrates the platform claim (two very different lenses on one model) while staying buildable.

## Consequences
- The 3D engine needs re-evaluating for terrain and water rendering at township scale (ADR-0007, pending research `township-3d-engine-and-data.md`).
- The world-model schema gains layers: terrain/elevation, waterways/drains/retention, flood scenarios, evacuation centres, waste/recycling points.
- Tool set grows (flood scenario tools, evacuation lookup, recycling lookup); the canonical names table must be updated.
- Product docs get reworked: brief, personas (add a management/disaster persona), MVP spec, demo script, pitch, judging mapping, timeline, scaffold spec.
- **Scope guard:** any lens beyond these two needs an ADR and must not delay the two deep lenses.
