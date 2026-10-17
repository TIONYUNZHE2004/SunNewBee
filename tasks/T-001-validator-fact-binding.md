# T-001 Bind every stated fact to a tool field (audit A2)

- **Status:** open
- **Owner:** unassigned
- **Branch:** —
- **Priority:** P1 (before open demo)
- **Lane:** AI
- **Source:** [A2; extends Cannon F2 (partial)](https://github.com/TIONYUNZHE2004/SunNewBee/blob/main/docs/04-architecture/ai-independent-audit-2026-10-17.md)

## Goal

The validator accepts unsupported prose with valid citations: "99 steps", "27 wheelchair toilets", "1 km" for a 440.6 m route. Bind each factual claim to an entity, attribute, value, unit and evidence field, and check summaries and steps too. `cannot_answer` must not let positive numeric claims through.

## Acceptance

Reject every A2 example in the audit while accepting the real route measurements, correct unit conversions and "about 440 m". Add multilingual and mixed-unit cases. Convert the matching probes in `evals/audits/2026-10-17/independent_probes.py` to assertions.

## Log

- 2026-10-17 08:39 UTC · control (claude/sweet-davinci-29v7ne) · Created from the independent audit by Codex (`codex/yunzhe-workflow`, merged as PR #4).
