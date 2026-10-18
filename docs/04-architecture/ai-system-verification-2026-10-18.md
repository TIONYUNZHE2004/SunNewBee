# Repository verification — 18 October 2026

Codex synced `codex/yunzhe-workflow` from the current Davinci control branch and tested
`d469ca3ececca7850ef3b4ad3ed136f2befeddb9`. PR #7 was already merged. No application,
validator, test, seed or dependency files were changed during this verification.

The application runs, and the regression checklist passes. **The AI audit remains open.**
Passing these tests does not establish surveyed accuracy or complete factual correctness.
Machine-readable results are in [the evidence summary](../../evals/audits/2026-10-18/system-verification.json).

## Checks

| Check | Result |
|---|---|
| Lint | PASS |
| Python | PASS: 1,846; 33 skipped in the default suite |
| Types | PASS |
| Frontend unit/component tests | PASS: 1,301 in 161 files |
| Generated client | PASS: regenerated without drift |
| Golden | PASS: 23/23, mock, no template fallbacks |
| Browser | PASS: 24/24, system Chromium and software WebGL |
| Production build | PASS, including Cesium asset check |
| Opt-in Blender pipeline | PASS: 32/32 separately, covering the 32 Blender skips above |

The remaining Python skip requires uncached external calibration data. Blender integration
used installed **4.3.2**; the authoring README's **5.2** was not tested. Generated raw assets
and temporary packed models were isolated from the committed city assets.

The first browser run passed 20 tests; four Three.js tests could not launch because their
`launchOptions` replaced the external executable override. Downloading Playwright's browser
returned HTTP 403, `Domain forbidden`. A supported `launchServer`/`connectOptions` wrapper
outside the checkout connected every unchanged test to system Chromium; all 24 then passed.
No assertion was disabled. The reusable setup instructions were updated for this runner.

## Running application

API and Vite were started with the real Elmina seed, mock LLM, default `access_flood` scope,
background warm-up disabled, and a separate audit SQLite database. Twenty-two functional
checks passed: seed/scope identity, demo-place provenance, access-layer ETag/304 behaviour,
route output, indicative flood scenarios, affected places, centres, invalid inputs, staff
mutation rejection, and access/flood/refusal SSE behaviour. Staff outcome workflows also
passed in the isolated browser suite.

The actual buildings endpoint returned 7,803 buildings, 491 trees, 80 water features,
89 parks, 504 land-cover features, 318 signs and two landmarks. Both Cesium and Three.js
rendered the real seed without page errors. Three.js reported 7,572 building instances and
231 markers; its assistant route was highlighted with demo-source citations. The decorative
disclaimer was checked in Three.js and in Cesium's Map settings. Screenshots and full logs
are retained under `/workspace/audits/repo-2026-10-18-runtime/` in this environment.

The configured server key was absent from all 380 files in the built frontend. External map
providers, physical field conditions, a full external-data rebuild, and hardware-GPU/mobile
device performance were not validated.

## AI findings

**T-001 stays open.** On both Davinci `d469ca3` and the clean Cannon worktree at `a460d4c`,
all five remaining unsupported binding cases from the previous audit were still accepted.
Both honest negated-guarantee controls passed. The original twelve validator probe
expectations passed, and the rejected guarantee/950m draft produced zero draft events.
Codex did not edit Claude-owned `validate.py`, `draft.py` or `facts.py`.

**T-004 is still reproducible.** Synthetic bracketed-phone and spaced-MyKad examples remain
unredacted; the ordinary email/mobile control is redacted. The task remains parked; this
verification does not resolve it.

**The committed answer key is stale.** Its seed fingerprint correctly blocks scoring the
new seed. A fresh key was captured outside the checkout: all 32 expected fact sets are
identical, all review flags remain false. The fresh mock score is unchanged: correct 1/32,
honestly unverified 9/32, refused correctly 3/32, wrong 19/32; detected unsupported claims
3/32 overlap wrong. These are provisional mock constraint scores, not live-model accuracy.

**Two real OpenRouter turns completed**, using the configured
`anthropic/claude-haiku-5.5`, with one checked attempt each, no escalation and no template
fallback. The seven provider requests reported a combined cost of **USD 0.00838134**.
Demo replay and recording were disabled. No keys were printed or saved in this report.

The raw independent scorer labels both live turns wrong, but its two reasons are false
positives: it rejects “about 440 m” for the returned 440.6 m route, and flags “about 17
minutes” although `plan_route` returned 16.8 minutes. The latter score consults the key's
centre-list measurements rather than every tool result actually used this turn. The raw
scores are retained; the key and scorer were not softened. These cases need scorer fixes
and human review before they can support an accuracy claim. They do not clear T-001 or
the control-owned T-007 live-smoke gate.

## Evidence and reproduction

The JSON summary records command results, remaining audit cases, mock denominators and
live responses with their matching engine measurements. Full local evidence uses the
prefix `/workspace/audits/repo-2026-10-18`; no sensitive user data was used.

Run the repository checklist from `AGENTS.md`; in this cloud environment use
`node /workspace/cloud-setup/run-e2e-system.cjs` for the browser step. The existing
`evals/audits/2026-10-17/verify_remaining_binding.py` reproduces the five T-001 gaps.
Capture a new provisional key outside the checkout before running `evals/run_answer_key.py`
against the current seed. Do not overwrite the committed review record or record demo
cache entries with a live model.
