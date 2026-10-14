# Decision Log (ADRs)

Each important decision gets one short file: `NNNN-short-title.md`. Write it **when** you decide, not afterwards. When a decision is reversed, add a new ADR that supersedes the old one; don't delete the old one. Mentors and judges often ask "why did you choose X?", and this log is our answer.

## Template

```markdown
# NNNN. Title

- Status: proposed | accepted | superseded by NNNN
- Date: YYYY-MM-DD
- Deciders: (names)

## Context
What forced the decision? What constraints apply?

## Decision
What we chose, in one or two sentences.

## Options considered
- Option A: pros / cons
- Option B: pros / cons

## Consequences
What gets easier, what gets harder, what we must watch.
```

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-people-track-inclusive-access-focus.md) | Enter the People track, focusing on inclusive access and facility discovery | accepted |
| [0002](0002-use-existing-3d-data.md) | Use existing 3D data instead of our own capture for the MVP | accepted |
| [0003](0003-structured-world-model-is-source-of-truth.md) | The structured world model, not the 3D scene or the LLM, is the source of truth | accepted |
| [0004](0004-tri-state-accessibility-attributes.md) | Accessibility attributes are tri-state (yes / no / unknown) with provenance | accepted |
| [0005](0005-tech-stack.md) | Tech stack (3D engine superseded by 0007; AI loop by 0008) | partly superseded |
| [0006](0006-mvp-site.md) | MVP site: Elmina Urban Park + Lakeside Mall frontage (now the accessibility deep spot inside whole-Elmina coverage, per 0009) | proposed |
| [0007](0007-3d-engine-cesium.md) | 3D engine: CesiumJS + Resium + Google photoreal tiles; Mapbox lite; list view | accepted (confirm in Day-1 spike) |
| [0008](0008-agent-harness-pydantic-ai.md) | Agent harness: PydanticAI over OpenRouter (model from env) | accepted |
| [0009](0009-township-world-model-platform.md) | **Township World Model platform: whole-Elmina 3D, 2 deep lenses (accessibility, flood), People track** | accepted |
| [0010](0010-flood-lens-hand-scenarios.md) | Flood lens: precomputed HAND river-stage scenarios, indicative, Elmina + downstream corridor | accepted |
