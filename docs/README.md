# TownshipLens Knowledge Base

> Team knowledge base for **TownshipLens**, our entry to the Sime Darby Property University Hackathon 2026 ("Township of Tomorrow", **People** track).
> Research is current to **15 Oct 2026**. **Proposal due 23 Oct (with a proof-of-life) · Final 11 Nov · Pitch 14 Nov.**
> Scope: the **whole of City of Elmina** as a 3D world model; deep, verified accessibility detail at **Elmina Urban Park + Elmina Lakeside Mall frontage** ([why](02-research/site-selection.md)).

**TownshipLens** is a **3D Township World Model** of City of Elmina that residents and township managers can ask anything, and trust the answer. Lenses on one verified model: **accessibility** (step-free routes, honest unknowns), **flood what-if** (indicative river-stage scenarios, cut-off routes, evacuation centres) and a thin **waste** layer. The AI calls deterministic tools, cites checked data, and turns every gap into a ranked task for the township team. → [Project brief](00-overview/project-brief.md) · [ADR 0009](00-overview/decisions/0009-township-world-model-platform.md)

---

## Start here (30 minutes, everyone)

1. [Project brief](00-overview/project-brief.md): what we're building, on one page
2. [Hackathon brief](01-hackathon/hackathon-brief.md): rules, dates, judging weights
3. [Judging-criteria mapping](01-hackathon/judging-criteria-mapping.md): how we win each criterion
4. [Personas & journeys](03-product/personas-and-journeys.md): who we serve and the hero demo flows (being updated for the flood lens)
5. [Architecture overview](04-architecture/README.md): one diagram, **canonical names** (they win over older docs)
6. [Roles](05-team/roles.md) and [timeline](05-team/timeline.md): what you own and what's due this week
7. [Glossary](00-overview/glossary.md): shared vocabulary (please use it)

## Then, by role

| Backend | Frontend | AI |
|---|---|---|
| [World-model schema, routing & lenses](04-architecture/world-model-schema.md) | [3D pipeline (Cesium hero)](04-architecture/3d-pipeline.md) | [AI assistant design](04-architecture/ai-assistant-design.md) |
| [API contract](04-architecture/api-contract.md) | [API contract](04-architecture/api-contract.md) (SSE events, scene intents) | [Agent harness research (PydanticAI)](02-research/agent-harness-2026.md) · [ADR 0008](00-overview/decisions/0008-agent-harness-pydantic-ai.md) |
| [Flood / disaster lens research](02-research/flood-disaster-lens.md) · [ADR 0010](00-overview/decisions/0010-flood-lens-hand-scenarios.md) | [Township 3D engine & data research](02-research/township-3d-engine-and-data.md) · [ADR 0007](00-overview/decisions/0007-3d-engine-cesium.md) | [Resident-agent design](04-architecture/resident-agents-design.md) (incl. flood invariants) |
| [Accessibility & routing research](02-research/accessibility-and-routing.md) | [3D data & rendering research](02-research/3d-data-and-rendering.md) (older; Google tiles, splats, licensing) | [AI assistant research](02-research/ai-assistant-research.md) |
| [Field verification guide](03-product/field-verification-guide.md) | [MVP spec](03-product/mvp-spec.md) (R- and S- features) | [Evaluation plan](03-product/evaluation-plan.md) · [Resident-agent research](02-research/resident-agent-simulation.md) |
| [Stack decision](04-architecture/stack-decision.md) · [Dev setup](05-team/dev-setup.md) | [Stack decision](04-architecture/stack-decision.md) · [Dev setup](05-team/dev-setup.md) | [Stack decision](04-architecture/stack-decision.md) · [Dev setup](05-team/dev-setup.md) |

## Full map

```
docs/
├── README.md                         ← you are here
├── 00-overview/
│   ├── project-brief.md              living one-pager (platform)
│   ├── original-idea.md              frozen v0 concept note
│   ├── glossary.md                   shared vocabulary (lenses, HAND, PPS, scene intent...)
│   └── decisions/                    ADRs 0001–0010 (why we chose X; 0007 Cesium, 0008 PydanticAI,
│                                     0009 platform with lenses, 0010 flood HAND scenarios)
├── 01-hackathon/
│   ├── hackathon-brief.md            official rules, timeline, criteria, open questions for organisers
│   ├── judging-criteria-mapping.md   criterion → our evidence → where it's shown
│   └── sdp-context.md                Sime Darby Property, townships, strategy, Malaysian policy
├── 02-research/                      (research is sourced; check "(unverified)" flags)
│   ├── trends-2026.md                ★ synthesis: what's new and what it means for us
│   ├── 3d-data-and-rendering.md      Google 3D Tiles, renderers, splats, licensing
│   ├── township-3d-engine-and-data.md ★ Cesium decision, whole-Elmina data, waste lens, data architecture
│   ├── flood-disaster-lens.md        ★ Lens 2: HAND scenarios, DEM, thresholds, evacuation, MY context
│   ├── agent-harness-2026.md         ★ agent frameworks compared; PydanticAI over OpenRouter
│   ├── ai-assistant-research.md      tool-use LLMs, grounding, spatial limits, evals, PDPA
│   ├── accessibility-and-routing.md  OpenSidewalks, OSM tags, routing, unknowns, MY stats
│   ├── resident-agent-simulation.md  generative agents, synthetic-user limits, design
│   ├── competitors.md                differentiation matrix
│   └── site-selection.md             which township and facility, and why
├── 03-product/
│   ├── personas-and-journeys.md      6 personas, journeys J1–J6
│   ├── mvp-spec.md                   prioritised features + acceptance criteria
│   ├── demo-script.md                3-minute demo + recovery plan
│   ├── evaluation-plan.md            golden set, metrics, user study, results table
│   └── field-verification-guide.md   site visit protocol + ethics
├── 04-architecture/
│   ├── README.md                     overview + canonical names
│   ├── stack-decision.md             versions, hosting, monorepo (superseded notes: Cesium, PydanticAI, SQLite)
│   ├── api-contract.md               REST + SSE + tool names
│   ├── world-model-schema.md         entities, claims, profiles, routing algorithm
│   ├── ai-assistant-design.md        loop, tools, prompt, validator, VR triggers
│   ├── 3d-pipeline.md                Cesium hero, water, scene intents, fallbacks
│   └── resident-agents-design.md     persona simulator incl. flood invariants
├── 05-team/
│   ├── roles.md                      lanes and per-lens ownership, working agreements
│   ├── timeline.md                   phase plan to 3 Dec (P0 proof-of-life by 23 Oct)
│   └── dev-setup.md                  monorepo, tooling, git workflow, Day-1 commands
├── superpowers/
│   └── specs/                        design specs (walking-skeleton scaffold: superseded, being rewritten)
└── 06-pitch/
    ├── proposal-outline.md           23 Oct proposal structure + draft text
    ├── pitch-narrative.md            story arc, Mechanism/Enabler, slide plan
    ├── business-case.md              who pays, costs, KPIs, scale, pilot plan
    ├── key-numbers.md                ★ the only numbers allowed in the pitch (sourced)
    ├── judge-qa.md                   likely questions + answers
    └── risks.md                      project risk register
```

The raw research material (papers, cloned repos, source lists) is in [`../reference/`](../reference/README.md).

## How to maintain this knowledge base

- **Docs change with code.** Update the relevant doc in the same PR.
- **Decisions get an ADR** in [00-overview/decisions/](00-overview/decisions/README.md).
- **Canonical names** (profiles, tools, statuses, events) are defined in [04-architecture/README.md](04-architecture/README.md). Don't invent synonyms.
- **Numbers in the pitch** must come from a research doc (with its source) or from [evaluation-plan § 5](03-product/evaluation-plan.md).
- **"(unverified)"** means the researcher couldn't confirm it from a primary source. Verify it before relying on it.
- Ask Claude Code questions about this repo; it reads these docs.
