# Independent verification of Claude worker PR #8

Codex checked `origin/claude/kind-cannon-mormhi` in a detached worktree outside the code
checkout. The first snapshot was `2ed7b88` (T-001/T-003); the second was `f940039` (also T-002).
The audited worktree stayed clean. No Claude application files were edited. All tests used
local deterministic responses; live-model turns: **0**.

## Results

| Task | Reproduced result | Assessment |
|---|---|---|
| T-001 fact binding | All nine original A2 cases rejected; supplemental exactly-500m and changing-room claims rejected. Original 99-step `run_turn` output rejected and replaced with an honest template. Nine honest controls pass in the assertion suite. | Original examples fixed; five new binding gaps remain below. |
| T-003 promises | “No steps, so I guarantee…” and “zero risk” both rejected. “That is not a guarantee” and “I cannot guarantee this route” accepted. | Original cases and honest controls pass. |
| T-002 drafts | Original guarantee/950m `_emit` probe produces no draft. Combined draft and independent assertion suites: **58 passed**. | Original rejected assertions withheld. This still depends on the content validator's coverage. |

The T-002 browser check captured seven actual SSE events from Cannon's adversarial streaming
`FunctionModel`, replayed them through the unchanged frontend, and observed the answer DOM and
`aria-live`/log text. The rejected sentence and `950` never appeared. One Chromium browser test
passed; honest final text appeared. These are live-region DOM snapshots, not an assistive
technology audio test. The frontend used the tiny fixture/list view and system Chromium.

## T-001 still accepts these unsupported statements

All were appended to the same honest, demo-labelled Car Park B → playground answer, with the
real route/evidence record and an otherwise valid output. The route was 440.6 m / 6.3 minutes.

1. “There are two toilets beside the playground.”
2. “There is one toilet beside the playground.”
3. “The toilet is 440.6 m from the mall.”
4. “No steps, so the toilet has a baby changing room.”
5. “The toilet is open 6.3 minutes every day.”

The new typed buckets still allow a value to move between entities or attributes of the same
kind. A route distance does not establish a toilet's distance, a journey duration does not
establish opening hours, and unrelated list lengths do not establish amenity counts.
The feature checker also skips a whole sentence when an unrelated negation occurs in it.

These are deterministic counterexamples to what the gate allows, not estimates of live model
failure frequency. Findings were appended to T-001's board log; Yunzhe was asked whether Claude
should close them within T-001. Codex did not change `validate.py`, `draft.py` or `facts.py`.
T-003 and T-002 results were logged in their own task logs.

## Captured evidence

- [Original probes on f940039](../../evals/audits/2026-10-17/claude-f940039/independent-probes.json)
- [Five remaining cases and two honest controls](../../evals/audits/2026-10-17/claude-f940039/remaining-binding-probes.json)
- [Captured SSE events](../../evals/audits/2026-10-17/claude-f940039/stream.json)
- [Captured live-region/log text](../../evals/audits/2026-10-17/claude-f940039/announcements.json)
- [Portable follow-up diagnostic](../../evals/audits/2026-10-17/verify_remaining_binding.py)

To repeat the follow-up, run from the audited Cannon checkout using its environment and pass
the diagnostic's absolute path in the Codex checkout, with `--output /tmp/binding-check.json`.
Exit 1 means at least one dishonest case passed or an honest control failed. The original
diagnostic scripts also remain available; run copies outside the audited checkout so their
captured JSON does not modify tracked worker files.
