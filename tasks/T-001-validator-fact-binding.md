# T-001 Bind every stated fact to a tool field (audit A2)

- **Status:** assigned
- **Owner:** Claude worker
- **Branch:** `claude/kind-cannon-mormhi`
- **Priority:** P1 (before open demo)
- **Lane:** AI
- **Source:** [A2; extends Cannon F2 (partial)](https://github.com/TIONYUNZHE2004/SunNewBee/blob/main/docs/04-architecture/ai-independent-audit-2026-10-17.md)

## Goal

The validator accepts unsupported prose with valid citations: "99 steps", "27 wheelchair toilets", "1 km" for a 440.6 m route. Bind each factual claim to an entity, attribute, value, unit and evidence field, and check summaries and steps too. `cannot_answer` must not let positive numeric claims through.

## Acceptance

Reject every A2 example in the audit while accepting the real route measurements, correct unit conversions and "about 440 m". Add multilingual and mixed-unit cases. Convert the matching probes in `evals/audits/2026-10-17/independent_probes.py` to assertions.

## Log

- 2026-10-17 08:39 UTC · control (claude/sweet-davinci-29v7ne) · Created from the independent audit by Codex (`codex/yunzhe-workflow`, merged as PR #4).
- 2026-10-17 09:13 UTC · control (claude/sweet-davinci-29v7ne) · Assigned to Claude worker on `claude/kind-cannon-mormhi`. Claude, step 1 of 3. Owns validate.py; Codex verifies with its probes.
- 2026-10-17 10:32 UTC · Claude worker (claude/kind-cannon-mormhi) · Started. Plan: typed fact binding in validate.py — every number with a unit must match a tool value of the same attribute kind (distance, time, width, slope, steps, counts), approximation only with approximate wording, number words read, cannot_answer no longer skips the check; claims with attribute/value must match their cited evidence.
- 2026-10-17 10:58 UTC · Claude worker (claude/kind-cannon-mormhi) · Ready for review: commit 4917199, PR https://github.com/TIONYUNZHE2004/SunNewBee/pull/8 (the old PR #2 was closed unmerged; control already had its commits). New facts.py: 7 fact kinds, EN/BM/中文 numbers, unit conversion, rounding only with "about" (whole number within 15%), "exactly" forbids rounding, counts never rounded, feature claims need positive evidence, cannot_answer checked. Tests: evals/tests/test_independent_audit.py — 18 dishonest probes + 2 citation/refusal cases rejected, 8 honest controls pass, run_turn "99 steps" never shown. mock.py / template.py: NOT changed. Checks (mock): lint PASS, pytest PASS 1348, typecheck PASS, vitest PASS 789, gen drift PASS, golden PASS 22/22, e2e PASS 19 (temp executablePath config), mock eval 36/36 first attempt, 0 fallbacks. Live: NOT RUN (no key; openrouter.ai blocked). Finding: A4 probes (negation scope, "zero risk") still accepted → T-003.

- 2026-10-17 11:28 UTC · Codex (codex/yunzhe-workflow) · Independent verification of PR #8 at Cannon 2ed7b88 in /workspace/audits/cannon-worker (clean, no code edited): all 9 original A2 cases plus exact-500m and changing-room probes now reject; honest rounding passes; all 32 independent audit assertions pass including 9 honest controls and run_turn 99-step fallback. NEW dishonest cases still ACCEPTED: There are two toilets beside the playground; There is one toilet beside the playground; The toilet is 440.6 m from the mall; No steps, so the toilet has a baby changing room; The toilet is open 6.3 minutes every day. Typed values still lose entity/attribute identity and feature negation still scopes across unrelated clauses. Request: keep T-001 open and bind counts and measurements to the claimed subject/attribute; clause-scope feature negation. Evidence /workspace/audits/claude-2ed7b88/{independent-probes,supplementary-probes,followup}.json. Asking Yunzhe; no validator/draft changes made by Codex.
