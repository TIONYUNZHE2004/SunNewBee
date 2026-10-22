# Demo run sheet — 23 October 2026

**Status: BLOCKED — the built app has not been run. This is a source-based recording script, not a completed QA sign-off.**

Branch: `codex/demo-qa-fix`, created from `claude/sweet-davinci-29v7ne` at `446b5a160678aa9d457de7015f8990e950e83c48`.
Recording date: 23 October 2026 (Asia/Kuala_Lumpur).
Last-push deadline: 05:45 MYT on 23 October 2026.
Live model turns: **0**. App mock turns: **0**.

## Execution evidence and limits

`AGENTS.md` was read first through GitHub, including the honesty invariants and seven-check CI checklist. The managed execution environment never became usable. It first reported `pending/offline`, then `starting/offline`, and at approximately **03:08–03:09 MYT** reported:

```text
observed_phase: failed
connectivity: offline
failure.code: environment_startup_failed
failure.message: Environment startup failed. Check the configuration, retry, or contact support.
```

Shell attempts returned: `No usable execution environment is available. Wait for an environment to become available before using this tool.`
No restart operation was available in the exposed tools. Repository reads and this documentation commit used the GitHub connector.

Consequently:

- Dependency installation, production build, browser interaction, console inspection and every CI command are **NOT RUN**.
- No app defect has been reproduced even once; the requested two reproductions and before/after verification are **NOT RUN**.
- No product code, tests, generated client, seed or recorded demo data was changed.
- `floodStoryStore.ts`, `marathonCinematic.ts` and `MarathonTag.tsx` were not edited.
- `validate.py`, `template.py` and `mock.py` were not edited; no `--record` command was used.
- No JPGs or PDFs were produced. Screenshot budget used: **0 of 16 files, 0 bytes of 3 MB**.

## Resume setup

These commands are prepared, **not executed**. Use Node 24, pnpm 11 and Python 3.13 as required by `AGENTS.md`. Keep credentials out of terminal output.

From the repository root:

```bash
set -o pipefail
pnpm install && uv sync --all-packages --all-groups

export LLM_PROVIDER=mock
export GOLDEN_REAL=0
export DEMO_MODE=false
export TL_DATA_DIR=data/seed/elmina
export GOOGLE_MAPS_API_KEY=
export CESIUM_ION_ACCESS_TOKEN=
export MAPBOX_ACCESS_TOKEN=

pnpm --filter @tl/web build
```

Start the API in one terminal, preserving those exports:

```bash
LLM_PROVIDER=mock TL_DATA_DIR=data/seed/elmina DATABASE_URL=sqlite:///./.data/demo-qa.db \
  uv run uvicorn townshiplens_api.main:app --port 8000 --app-dir apps/api/src
```

Serve the production build in another terminal, with the same empty public map keys:

```bash
API_PORT=8000 pnpm --filter @tl/web exec vite preview --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173/`. Confirm `/api/site` resolves through the preview proxy and identifies City of Elmina before QA. If the production preview cannot reach the API, record that failure and repair the preview setup; do not silently substitute a dev-server run for built-app evidence.

Use a 1440 × 900 browser viewport at 100% zoom. Open DevTools Console, preserve the log, and record browser version, renderer and build SHA in the execution ledger. Confirm **3D → Stylised** and that buildings are drawn. The tiny fixture/List-view CI suite does not establish the Elmina 3D result.

## Recording script

All durations below are **planned hold times in seconds**, not measured timings. Every actual-duration cell remains `NOT RUN`. Do the complete A → B → C loop in **Day (light)** and again in a fresh browser context in **Night (dark)**. Capture actual waits as well as planned holds.

### Preparation for each skin

| Step | Click / input | Expected screen / observation | Planned hold (s) | Actual (s) |
| --- | --- | --- | ---: | --- |
| P1 | Open the app, then **Map settings**. | City of Elmina; no blank canvas or error fallback. | 3 | NOT RUN |
| P2 | In **Theme**, click **Day** for the light pass or **Night** for the dark pass. | Page and Stylised scene use the selected skin; text and controls remain legible. | 3 | NOT RUN |
| P3 | Confirm **Map view → 3D** and **Map style → Stylised**; close Map settings with its button or Escape. | Stylised buildings; decorative-details notice remains available. No billable map layer. | 3 | NOT RUN |
| P4 | Select **Resident**. If necessary click **Show assistant**. | “Ask about getting around” and the question composer. | 2 | NOT RUN |

### A. Resident step-free route question

| Step | Click / typed text | Expected screen / observation | Planned hold (s) | Actual (s) |
| --- | --- | --- | ---: | --- |
| A1 | Open **Travelling as**, choose **Stroller**, then return to the composer. | Stroller profile selected. | 2 | NOT RUN |
| A2 | Type exactly: **Can I push a stroller from Car Park B to the playground without stairs?** Click **Ask**. | Streamed answer followed by checked text; route state comes from the API. Measure time to first answer and completion separately. | 5 | NOT RUN |
| A3 | Read the final answer and route summary. | Gaps stay unverified; demo evidence carries “Demo value · not surveyed” and the answer includes **“demo values, not yet surveyed”** when placeholder evidence is used. Never promise “safe”, a checked route from placeholders, or a water depth. | 6 | NOT RUN |
| A4 | Expand **Evidence**. | Cited sources and demo labels are visible; no invented survey date or verified placeholder. | 4 | NOT RUN |
| A5 | If offered, click **Show on map**. | Camera frames the current answer’s route; no renderer crash or stale route. | 4 | NOT RUN |
| A6 | Inspect Console and record errors, warnings and failed requests. | Expected: no app exception or failed required asset/API request. This is not yet checked. | 3 | NOT RUN |

### B. Management marathon

| Step | Click / typed text | Expected screen / observation | Planned hold (s) | Actual (s) |
| --- | --- | --- | ---: | --- |
| B1 | Click **Management**. | Management assistant and planning panels; resident chat does not expose staff-only pressure data. | 2 | NOT RUN |
| B2 | Type exactly: **Plan a 5 km marathon starting at Elmina Lakeside Mall from 7 am to 11 am.** Click **Ask**. | Tool-backed course proposal with the requested start, distance and time window, or an explicit model/data gap. A gap that prevents the planned video must be logged. | 6 | NOT RUN |
| B3 | Click **Watch the marathon**. | Marathon overlay, course, runners, illustrative sample cars, clock and **Simulation · illustrative** badge. No jam-minute or vehicle-count claim. | 5 | NOT RUN |
| B4 | Click **Pause**. | Clock, runners and camera stop advancing. Observe for three real seconds. | 3 | NOT RUN |
| B5 | Drag **Marathon timeline** to its midpoint, then back to about one quarter. | Clock and scene seek coherently; repeated seeks reproduce the same display. Do not turn the simulated clock into an asserted real delay. | 4 | NOT RUN |
| B6 | Click **Play**. | Playback resumes from the sought position. | 4 | NOT RUN |
| B7 | Click **Restart**. | Clock and scene return to the beginning and resume. | 3 | NOT RUN |
| B8 | Scrub near the end and inspect the end card. | Illustrative limits remain visible; no unsupported jam minutes or vehicle counts. | 4 | NOT RUN |
| B9 | Click **Close marathon simulation** (×), or the end-card exit if present. | Player and its camera ownership end; ordinary map interaction returns. | 3 | NOT RUN |
| B10 | Inspect Console and failed requests. | Record every error with the step and skin; no “console clean” claim without this check. | 3 | NOT RUN |

### C. Rising river and all four chapters

The requested entry path must be tested as written first. The source currently routes **Rising river** into the older rollout panel; Q-02 below explains the suspected conflict. Do not report a workaround as a passing direct-path test.

| Step | Click / input | Expected screen / observation | Planned hold (s) | Actual (s) |
| --- | --- | --- | ---: | --- |
| C1 | In Management, click **Rising river**. | Record the actual panel. The source currently labels it “Rising river · synthetic residents”. | 3 | NOT RUN |
| C2 | Find and click **Watch the river rise**. If needed select the **River +3 m** stage first. | Four-chapter river player starts. If absent or disabled, record Q-02, screenshot the screen and repeat the attempt in a fresh context. Do not claim success. | 4 | NOT RUN |
| C3 | If direct entry fails, separately try this source-based workaround: close the rollout with **Close**, open **Map settings**, select **River level → +3 m**, close settings, then click **Watch the river rise** under the map’s flood impact summary. | This may provide access to test the story independently of the launcher. Its success is unverified. | 5 | NOT RUN |
| C4 | Click **Pause**, then **River rise**. Click **Play** and observe the stage sequence. | Normal → +1 → +2 → +3; counters use whole API values. “Indicative scenario, not a forecast” and illustrative-water limits stay visible. | 24 | NOT RUN |
| C5 | Click **Pause**, then **Building edge**. | Building-edge shot; no claim of a measured depth, lower-floor inundation or unsupported road closure. | 5 | NOT RUN |
| C6 | Click **Resident route**. | Origin, candidate centre, wheelchair route and access/entrance/sidewalk caveats. OSM candidates remain unofficial. Any demo evidence is labelled. Current seed documentation says the route is unchanged at +3 m; do not narrate a flood detour without tool evidence. | 7 | NOT RUN |
| C7 | Click **Model limits**. | End card: scenario limits, 30 m model, drains/flash-flood omissions and MBSA / JPS / NADMA guidance. **Simulation · illustrative** must remain visible. | 6 | NOT RUN |
| C8 | Scrub **River story time** backwards, then click **Restart**. | Scene, water presentation and clock seek coherently; Restart returns to the beginning and plays. | 4 | NOT RUN |
| C9 | Click **Exit story**. | Story, route actor and camera ownership end; assistant and ordinary map return coherently. | 3 | NOT RUN |
| C10 | Switch to **Resident** and inspect the resulting screen, then inspect Console. | No staff-only pressure values leak into Resident; no stale story overlay or application error. | 4 | NOT RUN |

### Honesty gates for both skins

Any failure here is **blocks-video** under the recording brief:

- “safe” / “selamat” / “安全” used as a product assurance.
- A water depth on a path, invented jam minutes or vehicle counts.
- Staff-only pressure shown to residents.
- Missing **“demo values, not yet surveyed”** in a relevant placeholder-backed answer, or placeholders presented as surveyed/verified.
- Missing **“Simulation · illustrative”** during a simulation.
- Data gaps presented as a known barrier or “not reachable”, or an OSM centre presented as official.

Source/API-derived counts can be described only with their actual scope. Decorative cars, people, heights and water motion remain illustrative.

## Defect / investigation register

**No row below is a twice-reproduced app defect.** Runtime reproduction counts are explicitly 0/2. Severity for source findings is provisional; Q-01 would be blocks-video under the exact-wording requirement. There is no fixed SHA because no product fix could be tested or verified.

| ID | What | Root cause / evidence | Severity | Reproductions | Fixed in / not fixed and why |
| --- | --- | --- | --- | --- | --- |
| ENV-01 | Managed runtime cannot start; blocks all app QA. | Runtime failure `environment_startup_failed`, `failed/offline`; shell unavailable. Repository file:line is not applicable to this infrastructure failure. | blocks-video | Shell unavailable on two attempts; no app attempt possible. | **Not fixed:** no environment restart/configuration control available to the agent. |
| Q-01 | Flood story uses a shared badge that omits the required exact “Simulation · illustrative” wording. Source-confirmed text mismatch; app visibility unverified. | [SimulationLabel.tsx:14–15](../../apps/web/src/features/journey/SimulationLabel.tsx#L14) renders “Simulation · indicative times, not a prediction”; [cardContent.ts:26](../../apps/web/src/features/journey/cardContent.ts#L26) supplies the same accessible label; [FloodStoryOverlay.tsx:181](../../apps/web/src/features/flood/FloodStoryOverlay.tsx#L181) mounts it. | blocks-video if reproduced | **0/2 — NOT RUN** | **Not fixed:** cannot run a failing regression test, reproduce twice, capture before/after JPGs or verify the same story. Proposed next step: align shared visible/accessibility wording, then run the required loop. |
| Q-02 | Requested **Rising river → Watch the river rise** entry may require an undisclosed exit from the legacy rollout; selecting a rollout stage disables the four-chapter launcher. Source finding; direct-path UI result unverified. | [RisingRiverPanel.tsx:73](../../apps/web/src/features/whatif/RisingRiverPanel.tsx#L73) sets `rollout.on=true`; [WatchRiverButton.tsx:14](../../apps/web/src/features/flood/WatchRiverButton.tsx#L14) includes `rollout.on` in `otherPlayback`, then [line 25](../../apps/web/src/features/flood/WatchRiverButton.tsx#L25) disables launch. The panel itself contains the older stage/play controls. | visible; blocks-video if the requested entry cannot be completed | **0/2 — NOT RUN** | **Not fixed:** intentional playback exclusion may be correct; app reproduction is required before choosing a launcher/transition change. The separate Close → Map settings workaround is unverified. |

No defect has been established in `floodStoryStore.ts`, `marathonCinematic.ts` or `MarathonTag.tsx`. These ownership-restricted files remain untouched. If reproduction later identifies one there, add it to this register and leave the fix to its owner.

## Verification ledger

Run the full checklist after each product fix, with `set -o pipefail`. A command that never started is **NOT RUN**, not FAIL. ENV-01 is the reason for every NOT RUN entry in this session.

| Check | Result |
| --- | --- |
| `pnpm install && uv sync --all-packages --all-groups` | NOT RUN |
| `pnpm --filter @tl/web build` | NOT RUN |
| A: Day / Night in built Elmina Stylised app | NOT RUN / NOT RUN |
| B: Day / Night, play/pause/scrub/restart/exit | NOT RUN / NOT RUN |
| C: Day / Night, all four chapters and exit | NOT RUN / NOT RUN |
| Browser Console inspection | NOT RUN |
| Twice reproduce each app defect | NOT RUN |
| Regression test fails before / passes after | NOT RUN |
| Same-story fix verification with before/after JPGs | NOT RUN |
| `pnpm lint` | NOT RUN |
| `uv run pytest -q` | NOT RUN |
| `pnpm -r --if-present typecheck` | NOT RUN |
| `pnpm -r --if-present test` | NOT RUN |
| `pnpm gen && git diff --exit-code packages/api-client` | NOT RUN |
| `pnpm golden` | NOT RUN |
| `pnpm --filter @tl/web e2e` | NOT RUN |

Prepared checklist, not executed:

```bash
set -o pipefail
export LLM_PROVIDER=mock
export GOLDEN_REAL=0
pnpm lint
uv run pytest -q
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm gen && git diff --exit-code packages/api-client
pnpm golden
pnpm --filter @tl/web e2e
```

Record every exit status individually; do not let a later success replace an earlier failure. The standard e2e suite uses the tiny fixture; retain the separate built-app Elmina runs above.

## Screenshot and fix protocol on resume

Write only real browser captures as JPGs under `docs/superpowers/screenshots/run-sheet/`; maximum **16 files and 3 MB total**. No PDFs. Use clear names such as `q01-night-before.jpg` and `q01-night-after.jpg`. Capture the same story, skin, viewport and playback position before and after each fix. Keep enough of the screen to show the relevant notice/control; log the build SHA and exact step beside each image.

For each blocks-video or visible defect: reproduce twice; record actual click sequence, typed text, seconds, expected/actual screen, console output and file:line root cause; add a meaningful regression test; demonstrate red then green; make the smallest correct change; re-run the same built-app story; capture before/after; complete the seven checks; commit that fix separately and push it. Leave ownership-restricted-file fixes listed rather than editing them.

If `validate.py`, `template.py` or `mock.py` changes, change all three together. Re-record `data/demo` only with `LLM_PROVIDER=mock`, never a live model; commit regenerated data separately as required by `AGENTS.md`.

The current branch contains documentation only. It does **not** certify the demo as ready to record.
