# 0003. The structured world model, not the 3D scene or the LLM, is the source of truth

- Status: accepted
- Date: 2026-10-14
- Deciders: whole team

## Context
LLMs are unreliable at raw spatial reasoning and will invent plausible facts ("yes, there's a ramp"). 3D meshes can't tell you reliably whether a step exists, how wide a door is, or whether a walkway is closed today. For an accessibility product, a confident wrong answer is worse than no answer.

## Decision
- All facts live in the **world model**: a graph plus attributes plus provenance plus closures.
- The LLM **only** gets facts through approved tools and must cite them. Route feasibility is computed by a **deterministic routing engine**, never by the LLM.
- The 3D scene is **presentation only**.

## Consequences
- Eval metric #1 is the count of *unsupported claims*, and the target is zero.
- The backend owns correctness. The AI layer owns language, tool selection and explanation. The frontend owns visualisation.
- "World model" in our pitch means this structured model. We say so explicitly to avoid confusion with generative world models.
