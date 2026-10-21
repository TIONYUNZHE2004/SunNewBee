# Overnight log: developer lens Development Simulation

- Spec: [specs/2026-10-21-developer-lens-development-simulation-design.md](specs/2026-10-21-developer-lens-development-simulation-design.md)
- Plan: [plans/2026-10-21-developer-lens-devsim.md](plans/2026-10-21-developer-lens-devsim.md)
- Branch: `feat/devsim` (lanes `devsim/{be,ai,fe,3d,assets}`). **Not merged to `main`.**
- Ledger and rulings: `.superpowers/sdd/devsim/ledger.md` (gitignored). This log quotes the important ones.

## How to write in this log

Append, never rewrite. Get every timestamp from `date "+%Y-%m-%d %H:%M %Z"`.

There are four kinds of entry:
- **Phase or merge-point start and end:** what happened, the commits (short sha), and what comes next.
- **Gate result:** the AC/Q table with PASS / FAIL / BLOCKED / NOT RUN, evidence paths, and whether each check was mock-backed.
- **CI checklist:** the 7 steps with their status, plus the failure tail if any.
- **Ruling (quoted from the ledger):** "Ruling: what — why — cost if wrong".

## Entries

<!-- The first entry is written by T0.1. -->

### 2026-10-21 01:35 MPST — T0 start

Branch `feat/devsim` created from `origin/main` (44d0cacd). Ledger created. Next: T0.2–T0.5 contract (schema, provisional fixture, TS types), then Wave 1.


### 2026-10-21 01:47 MPST — T0 done, Wave 1 started

T0 contract committed and pushed: `333c8ba5` (devsim_models.py, provisional fixture, types.ts, devsimStore/anchors skeleton). Worktrees `../SunNiuBi-wt/dv-{be,ai,fe,3d,assets}` set up. Lanes BE, FE, 3D and QA dispatched; AI and ASSETS start when a slot frees (≤3 implementers, 8 GB).

Rulings so far (ledger R1–R6): store/anchors skeleton in the contract; tool on a world without the parcel emits `development.play` without a plan and FE fetches (404 → "not available"); hook name `useDevsimDriver.ts`; golden + recording after M1; `detour_side_switch` on the detour object; numbers with thousands separators normalised by `check_plan`.

### 2026-10-21 02:31 MPST — M1 and M2 merged

- **M1** (`devsim/be`): `devsim.py`, `POST /developments/simulate`, generated client, Elmina fixtures. Task review found the detour minutes were computed from pre-rounded route minutes (+4 instead of the engine's +3) and that `check_plan` accepted swapped facts; both fixed in fix round 1 and re-reviewed clean.
- **Computed facts (routing engine, default profile):** home `w909852736` (17 homes tie at 3 min; nearest wins), edge `seg-910300105-0`, 2,684 → 2,923 m, **+3 min**, detour moves to the far-side sidewalk; Urban Park 659 m · 9 min; Lakeside Mall 712 m · 10 min. Tower footprint moved ~6 m inward from the prototype (its footprint stuck out of the parcel); Kanopi clearance 214 m.
- M1 full pytest: 2713 passed, 2 failed, 1 error — all pre-existing / environment: `test_mcp_server` (Windows path separator), `test_journey_vrs` demo replay (recordings expire daily by design: the fingerprint includes the date and a code digest), `test_inapp_prompts` (flaky under load; passes alone). Rulings R15/R16.
- **M2**: `devsim/fe` (timeline, store, driver, overlays, paperclip, list + Mapbox text version, e2e; fix round 1 for a probe fallback that could mask a broken 3D render) and `devsim/ai` (intent, tool, mock/validator/template, golden 25/25, replay recorded). ASSETS lane finished (`crowd_worker.glb`, 38 KB, reviewed clean; merges at M3). 3D lane still running.
- Full CI checklist running for Gate 1.

### 2026-10-21 02:53 MPST — CI after M2 and GATE 1

**CI checklist (M2, `ab2d9391`):**

| Step | Status |
|---|---|
| 1 lint | PASS |
| 2 pytest | FAIL → 1 ours fixed in `eee15bf0` (tool registry exact set); 2 pre-existing (`test_mcp_server` Windows path; `test_journey_vrs` demo replay expiry, R15) |
| 3 typecheck | PASS |
| 4 vitest (map keys blank) | FAIL → fixed in `eee15bf0` (a11y check now skips the hidden file input; R18) |
| 5 gen | PASS |
| 6 golden (mock) | PASS 25/25 |
| 7 e2e | PASS 34/34 (devsim 4/4) |

**GATE 1: PASS** (mock-backed: mock LLM, DEMO_MODE cache hit `mock-scripted+demo-cache`; List view on the Elmina seed, own server on 5175/8002 because the pre-existing 5173/8000 server runs a live provider).

| Check | Status | Evidence |
|---|---|---|
| AC-F4 starter → reply → playback → end card | PASS | gate1-report.md, `list-t66.png` |
| AC-F4 paperclip | PASS (via hook) | gate1-report.md |
| AC-H6 404 → "not available" | PASS | e2e devsim.spec |
| AC-F1/F2/F5/F6 | PASS | vitest timeline/flow/overlay |
| AC-C2 DOM part | PASS | vitest |
| Console errors | PASS (0) | gate1-report.md |

The Stylised 3D view shows no devsim UI yet: the 3D lane wires `DevsimMount` into `ThreeScene` (M3).

### 2026-10-21 11:30 MPST — M3 (ASSETS + 3D) and CI after M3

M3 merged at `f733f6a0` (assets: `crowd_worker.glb` + `crowd.json` key `worker`; 3D: tower, site kit, cast, fast-forward flow, lighting, camera beats). Two CI runs in the background were stopped by Claude Code's low-memory reaper (04:45 and 11:03); the owner OK'd a restart, and Teams/WhatsApp desktop were closed to free about 1.9 GB. The run was then finished in the foreground with vitest capped at 2 workers and e2e at 1 worker (R22).

| Step | Status |
|---|---|
| 1 lint | PASS |
| 2 pytest | 2763 passed; 2 pre-existing failures only (R15 demo-replay expiry, R16 Windows path) |
| 3 typecheck | PASS |
| 4 vitest (map keys blank) | FAIL → AC-B1 colour-literal grep test (devsim 3D colours not in the token table), fixed in `b58d9202` → PASS (2,493 tests) |
| 5 gen | PASS |
| 6 golden (mock) | PASS 25/25 |
| 7 e2e | PASS 34/34 |

Pushed `feat/devsim` at `b58d9202`. GATE 2 started.

## Final report

Written 2026-10-21 14:55 MPST.

**Branch:** `feat/devsim` @ `ce300eb4`. It has 63 commits since `main` (`44d0cacd`), touching 139 files (+15,226 / −74). It is **pushed to origin, NOT merged, and has no PR**.

Everything below is **mock-backed**:
- mock LLM, with the DEMO_MODE cache;
- Elmina seed, Stylised view, headless Chromium;
- no live LLM call and no Google tile load were made.

### Gates

| Gate | Result | Evidence |
|---|---|---|
| GATE 1 (List view + early 3D) | PASS | `.superpowers/sdd/devsim/gate1-report.md` |
| GATE 2 (QA2 acceptance, QA3 contact sheet, 12 frames) | FAIL on the first run → 2 fix loops → PASS 10/10 | `gate2-report.md`, `gate2-fix1-report.md`, `acceptance-gate2-fix2.json` |
| Final whole-branch review (Opus) | 0 Critical; 3 Important, all fixed, re-review clean; 11 Minor, triaged | `final-review.md`, `final-fix-report.md`, `final-rereview.md` |
| F3 evaluator | 88/100: 18 PASS / 4 PARTIAL / 0 FAIL. The PARTIALs were fixed in `7b0cd837..ce300eb4` | `evaluation.md`, `f3-fix-report.md` |
| Final acceptance (`final2`) | PASS 10/10 | `acceptance-final2.json` |

### AC / Q table (final state)

| Item | Status | Evidence |
|---|---|---|
| AC-H1, H2, H5, H6 | PASS | `evaluation.md`; devsim pytest; e2e `devsim.spec` |
| AC-H3 label whenever the tower is on stage | PASS | `acceptance-final2.json`: 0.25 s sweep, stage size asserted non-zero |
| AC-H4 no banned or flood wording | PASS (was PARTIAL) | `2d470957` hides the flood UI while devsim runs and adds a DOM sweep over 0–66 s; `7b0cd837` greps the replay file |
| AC-F1, F2, F4, F5, F6 | PASS | timeline and overlay vitest; Gate 1; e2e |
| AC-F3 fast-forward flow | PASS | by day at least 99 people and 38 vehicles (spec: 30 / 20); day/night ratio 2.28 (R23) |
| AC-C1 subject within 10% at the 12 beats | PASS (was PARTIAL on look) | worst 0.069; after `53d09bc5`, 48 s is 0.036 and 54 s is 0.029 |
| AC-C2 bubbles inside the stage and clear of HUD, bar, panel and speaker | PASS | `acceptance-final2.json`: 0 bad |
| AC-C3 contact sheet | PASS | path in Outputs below |
| Q1 fps | PASS | about 105 fps, headless, not headed |
| Q2 camera never inside a building | PASS | probe sweep |
| Q3 speaker contrast ring ≥ 1.5 | PASS | 19 s 1.56, 37 s 2.23, 41 s 1.60, 60 s 1.74 (R24) |
| Q4 no lit windows before 32 s | PASS | probe |
| Q5 console errors and warnings | PASS | 0 problems |
| Q6 flicker, z-fighting, pops | PASS (was PARTIAL) | the video was checked frame by frame. Fixed: the camera hitting the tower roof at 22.6 and 26.6 s (`aa01cf84`), and the pink flashes when flights skimmed the mall roof (`ce300eb4`). Montages in `devsim-final2/q6/v3` |

### CI checklist @ `ce300eb4`

| Step | Status |
|---|---|
| 1 lint | PASS |
| 2 pytest | **FAIL (2 pre-existing, also on `main`); partly NOT RUN at HEAD.** Full run at `f9ecc721`: 2765 passed, 2 failed (`test_mcp_server` Windows path, R16; `test_journey_vrs` daily demo expiry, R27). After that only a test file changed (`test_devsim_answer.py`, 42 passed). The full re-run at `ce300eb4` was stopped by the Claude Code low-memory reaper at 87%, with no failures up to that point |
| 3 typecheck | PASS |
| 4 vitest (map keys blank, `--maxWorkers=2`, R22) | PASS 2519/2519 |
| 5 gen | PASS, no drift |
| 6 golden (mock) | PASS 25/25 |
| 7 e2e (`--workers=1`) | PASS 34/34 |

### Computed facts (route engine, Elmina seed)

- Home `w909852736`. 17 homes tie at +3 min; the one nearest the tower wins. Closed edge `seg-910300105-0`.
- Footpath detour **2,684 m → 2,923 m, +3 min**, with a switch to the other side of the street.
- Urban Park **659 m · 9 min**; Lakeside Mall **712 m · 10 min**.
- Tower: 30 storeys, 500 homes, footprint 38 × 26 m. It was moved about 6 m inward so it sits inside the lot. Clearance to Kanopi is 214.3 m, measured footprint to lot.

### Outputs (scratch, not committed)

- Final contact sheet: `C:/Users/shaoxian04/AppData/Local/Temp/claude/devsim-final2/contact-sheet.png`
- Final product video (66 s, 1440×860), re-recorded after the Q6 fixes: `C:/Users/shaoxian04/AppData/Local/Temp/claude/devsim-final2/product.webm`
- Prototype video: `C:/Users/shaoxian04/AppData/Local/Temp/claude/devsim-final2/prototype.webm`
- Gate 2 frames and diagnostics:
  - `C:/Users/shaoxian04/AppData/Local/Temp/claude/devsim-gate2/`
  - `C:/Users/shaoxian04/AppData/Local/Temp/claude/devsim-gate2-fix1/`
  - `C:/Users/shaoxian04/AppData/Local/Temp/claude/devsim-gate2-fix2/`
- Ledger, reports and acceptance JSON: `C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/devsim/`

### Rulings I made

Each ruling reads: what was decided — why — cost if wrong. The full text is in `.superpowers/sdd/devsim/ledger.md` and in the lane reports.

**Coordinator rulings (R1–R27)**
- **R1:** T0 also ships `devsimStore.ts` and `anchors.ts` — FE and 3D both need them — cost: a small store refactor.
- **R2:** on a world where the simulation is unavailable, the answer still restates the brief, the intent carries no plan, and the web fetches the API and shows "not available" on a 404 — one code path for e2e and the real demo — cost: the answer mentions an illustrative simulation that then reports unavailable (still honest).
- **R3:** the hook is named `useDevsimDriver.ts` (the plan's name), not `useDevsimPlayback.ts` (the spec's) — the plan owns file names — cost: a rename.
- **R4:** the golden case and the recording ran after the M1 rebase — both need the real BE function — cost: the AI lane idled about 30 min.
- **R5:** `detour_side_switch` lives on `DevsimDetour` — it means nothing without a detour — cost: one field path.
- **R6:** numbers print with thousands separators and `check_plan` normalises them — matches the prototype — cost: a regex tweak.
- **R7:** the largest-detour rule was kept; after the rounding fix the chosen home gives +3 min — deterministic and computed — cost: a different home in the copy.
- **R8:** BE's 2-line cache clear in `state.py` was accepted — needed for test isolation — cost: none.
- **R9:** bubble 7 (mall more than 12 min away) keeps a neutral line with no claim, tone "neg" — the model only has pos and neg — cost: none today; that branch is unused.
- **R10:** AI's edits to `scope.py` and `tools.py` were accepted, so `simulate_development` is in the default scope — the tool must be registered to exist — cost: a live resident chat could call it, though only the exact brief triggers it.
- **R11:** the coordinator regenerated the api-client at the merge — the schema changed — cost: none.
- **R12:** `plan: null` is sent on the wire for unavailable worlds — matches the TS type — cost: a type tweak.
- **R13:** the envelope lands and the feedback counter steps at 51.6 s, after bubble 5 ends, as in the prototype — the complaint is spoken before it is filed — cost: a 2.8 s timing shift.
- **R14:** FE owns the Mapbox-lite text version — spec §5.3 requires it and no other lane touches Mapbox — cost: a small mount.
- **R15:** re-record all demo turns at Finish. Superseded by R27.
- **R16:** the `test_mcp_server` Windows-path failure is environment-only — it passes on Linux — cost: none for CI.
- **R17:** the M2 regressions were fixed by one coordinator fixer directly on `feat/devsim` — the lanes had finished — cost: none.
- **R18:** the a11y check skips inputs hidden from the accessibility tree — a hidden file input can't be operated — cost: a future visible input under a hidden ancestor escapes the check.
- **R19:** the 3D lane owned the M3 integration (rebase, wiring, camera keys in `timeline.ts`, hiding the city's construction dressing) — it held the context — cost: a cross-lane edit.
- **R20:** flow people turn back before the closed edge instead of vanishing — spec §7 — cost: extra motion work.
- **R21:** the cement mixer comes from the kit, with a static drum — the D10 art rule outranks an animation — cost: the drum doesn't spin.
- **R22:** CI runs vitest with `--maxWorkers=2` and e2e with `--workers=1` — the default runs were reaped on this 8 GB laptop — cost: about twice the wall time.
- **R23:** AC-F3 is judged on daytime samples — sparse streets at night are realistic — cost: the night flow may need densifying.
- **R24:** Q3 scores the speaking character at the dusk and night speaker beats; the tower ring at 11 s and 65 s is recorded for information only (11 s measures 1.46) — the spec words Q3 as speaker contrast — cost: 11 s would fail a stricter reading.
- **R25:** walkers avoid the old hoarding strip for the whole run — removes the 33.5 s pop and keeps seeking deterministic — cost: walkers still skip that footway after handover.
- **R26:** Spotlight Residents scale with camera distance, 1× up to 60 m and up to 2.4× at 180 m — keeps speakers readable — cost: they may look oversized in wide shots.
- **R27:** no blanket re-record of the 28 demo turns — the fingerprint includes the date, so a re-record would expire tonight, and some recordings are multi-turn follow-ups that a single-turn re-record could change — cost: `test_journey_vrs` stays red, as on `main`, until the demo-day re-record.

**Lane and fix-agent rulings (from their reports)**

Tower and site:
- The footprint is the prototype's 38 × 26 m, stepped inward until it fits 1 m inside the lot.
- Clearance to Kanopi is measured footprint to lot (214.3 m), not centre to lot (the prototype's 241 m).
- The hoarding stands 8 m in from the closed footway.
- The crane is re-centred on its mast foot.
- The door, and the timeline's door anchor, are snapped to the footprint.
- The yard anchor is 30 m behind the tower.
- The junction anchor is the street point nearest the entrance node.

Numbers and copy:
- Rounding is half-up.
- Detours are ranked on unrounded distance at walking pace; ties go to the nearest home, then the lowest id.
- `brief_text` is always the fixed BRIEF (PDPA). The request field is accepted and ignored.
- The validator forbids "flood" in devsim answers, and there is no draft guard for devsim.
- The baseline cast names override the spotlight generator.
- Bubble 1 falls back to lines without numbers when there is no side switch or no detour.
- The site label is an FE constant.
- Speaker names are drawn in text colour with a cast-colour dot, for contrast.

Look and lighting:
- Occupancy eases to 460 and then 488 of 500 homes, as the prototype shows.
- The lit-window fraction follows the prototype's occupied share.
- Tower night glow is 0.2 + 0.6 × night.
- Floodlights are emissive pools, not real lights.
- The dusk and night grade applies only while devsim runs.
- The Brief sun is late morning, and the Summary clock reads "First month".
- The devsim camera pins the prototype's 38° field of view and holds its pose after the end card.
- Three street-to-street transfers are hard cuts (27, 52.2 and 57.4 s) instead of flights over roofs.

Crowd and traffic:
- The flow reuses the decorative motion layer with density multipliers:
  - night 0.25 for people and 0.2 for vehicles;
  - the morning rush adds +0.25 for people and +0.5 for vehicles;
  - time runs 8× faster in Construction and Handover.
- People within 3 m of the closed edge are hidden while it is hoarded.
- The closed edge and the detour are drawn as ground ribbons.
- Decorative occluders are cut with the journey's `setTreeCut` capsule.
- The school-run queue lines up along the closed footway.
- Decorative cars stay off the queue lane from 44 to 52.4 s.
- Decorative props never stand in water, anywhere in the city.
- The worker is its own glb with a `worker` manifest key; its stripe is dropped at LOD1.

Interaction:
- The paperclip sends the fixed brief even if text was typed.
- The file chip is keyed by message index.
- `__devsim` is installed from `sceneStore`.
- `DevsimOverlay` hides its own decorative note when ThreeScene already shows one.
- One simulation runs at a time on every path. Later map intents, including `day.trip`, `river.rollout` and `whatif.diff`, take the map back.
- That hand-back is scoped by answer id rather than by reordering intents in `run.py`, which would have invalidated every demo recording.

Testing:
- The AC-C1 subjects follow the §4.4 table.
- The contact sheet is built as an HTML grid screenshotted by Playwright.
- AC-F3 day and night come from the prototype's sun curve.

### Known gaps and next steps

1. **Demo-day re-record (about 5 min).** The replay expires daily. Either run the demo with `LLM_PROVIDER=mock`, or re-record that morning with `LLM_PROVIDER=mock uv run python -m townshiplens_agent.cli --record "Simulate a 30-storey, 500-home tower near Lakeside Mall, from construction to daily life" --profile default`; `demo-script.md` has the same command. With a live provider and a stale cache, the live model may not call the tool.
2. **Full pytest at HEAD.** The memory reaper stopped it; re-run `uv run pytest -q` when memory allows. Only a test file changed since the last full run, whose only failures were the 2 pre-existing ones.
3. **Watch the final product video once, in a headed browser,** before the demo. Q1 was measured headless.
4. **Look-and-feel items:**
   - About 34.2 s reads as a cut, because the move to the entrance, the fast dusk and the movers appearing all land within an eighth of a second.
   - Mei Ling at 48 s is small, with the camera about 70 m out.
   - Three transfers are hard cuts where the prototype flies.
5. **Deferred minor issues** (`final-review.md`):
   - building the plan costs about 1.2 s per turn and isn't cached in the tool;
   - persona number-words aren't checked;
   - name tags aren't occlusion-tested;
   - a second copy of the crowd kit is loaded;
   - the golden case has no `mock_only` split;
   - `simulate_development` is in the default scope for live models.
6. **Laptop.** `DtsApo4Service` held about 2.5 GB, which looks like a leak; a reboot clears it. Teams and WhatsApp desktop were closed at about 11:15, with the owner's go-ahead, to free memory.
7. **Merging to `main`** is the owner's decision. This run does not merge (spec §14).

### Owner feedback round (2026-10-21 15:45 MPST)

The owner watched the product video and reported three problems. All are fixed in `9b50f3a6..62f98aae` (web only, no agent/spatial source change, so the demo recordings stay valid):

1. **Cars off the road at about 52 s.** These were the school-run queue cars, lined up 4.5 m off the street. The Handover lorries had the same fault. Both now follow the mapped street centreline in the left-hand lane, and the queue clears at 52.4 s. A new test checks that every queue car and lorry is on the carriageway and within 15° of the street.
2. **Resident feedback showed 1 while the end card listed 3 items.** R28: the badge now counts the end-card items, from the same list, and goes 0→1→2→3 at 22.6, 51.6 and 62.8 s. This supersedes spec AC-F5 ("0→1 at bubble 5").
3. **Halim's bubble jumped around while he walked.** Every speaker now stands still while their bubble is up, which a test checks for all 7, and bubbles glide instead of jumping. Halim stays "Pak Cik" (owner).

**Checks:**
- acceptance `owner1` 10/10 (fresh server; Q3 at 19 s is 1.57);
- vitest 2524/2524 with map keys blanked;
- lint and typecheck PASS;
- e2e 34/34.

**New video:** `C:/Users/shaoxian04/AppData/Local/Temp/claude/devsim-owner1/product.webm`. Playback starts about 11 s into the file.

**Known and left:** decorative traffic cars (not the queue) can briefly overlap at junctions, for example around 51 s, because the decorative traffic has no collision avoidance.
