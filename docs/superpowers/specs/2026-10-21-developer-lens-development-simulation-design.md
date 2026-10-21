# Developer lens: Development Simulation — design spec

- Status: approved for an overnight build, 21 Oct 2026
- Owner decisions: grilling session with Claude Code, 20–21 Oct 2026
- Decision record: [ADR 0014](../../00-overview/decisions/0014-developer-lens-hypothetical-developments-on-real-parcels.md)
- Terms: [GLOSSARY.md](../../../GLOSSARY.md), sections "Developer lens" and "Residents"
- **Acceptance baseline:** the approved prototype in [docs/03-product/prototypes/developer-lens/](../../03-product/prototypes/developer-lens/README.md)

---

## 0. How to use this spec (for the executing session)

This spec is written for a fresh Claude Code session that runs the build **overnight and unattended, for up to 20 hours, without stopping to ask the owner anything**.

- **Everything in §2 is settled.** Do not reopen it. Where this spec is silent, decide, then log a ruling (§12.4) and keep going.
- **Read these first, in this order:**
  1. `AGENTS.md` and `CLAUDE.md` (commands, CI checklist, honesty invariants, worktree lanes);
  2. this spec;
  3. the prototype `README.md`, `index.html` and `build_scene.py`;
  4. ADR 0014;
  5. the GLOSSARY sections named above.
- **The prototype is the acceptance baseline** for flow, camera, composition, overlays and copy. The product changes the art (§4.1) and must reach at least the prototype's quality.
- **Execute from the plan:** [plans/2026-10-21-developer-lens-devsim.md](../plans/2026-10-21-developer-lens-devsim.md). It has the fine-grained tasks, the parallel lanes, file ownership and the merge points. Log to [overnight-log-devsim.md](../overnight-log-devsim.md), not the general `overnight-log.md`.
- File paths below were checked on 21 Oct 2026. Verify an API before relying on it: teammates pushed changes to place scoping on the same day (`b1b47d77`, `2f7941aa`).

## 1. Goal and audience

This is a second demo, for **Sime Darby Property's planning and township-management teams**: *"Live it before you build it."*

1. In the **Management** tab, a staff user attaches or types a **Development Brief**.
2. The 3D map on the left plays a **Development Simulation** of a **Hypothetical Development**: Construction, then Handover, then Daily Life.
3. Spotlight Residents react along the way.
4. It ends on a card, "What residents raised".

The demo has to show three things at a glance:
- **Fast-forward time:** visible day/night cycles, with residents and vehicles flowing.
- **A living township:** residents talking to each other and reacting to the project.
- **Honesty:** the only numbers shown are computed by the routing engine.

## 2. Settled decisions (do not relitigate)

| # | Decision |
|---|---|
| D1 | **Audience:** SDP planning and township management. This is not a construction-management tool. |
| D2 | **One run, no scenario comparison** in v1. |
| D3 | **Real parcel, hypothetical project.** A ~30-storey, ~500-home residential tower on the north-east corner of OSM `way/1564861412`, at least 200 m from the Kanopi lot `way/1314193194`. It is always labelled **"Hypothetical development · not an SDP project"**. |
| D4 | **Entry point:** the existing Management tab assistant panel (`apps/web/src/features/assistant/AssistantPanel.tsx`). The message goes through `/chat` and is answered by a **recorded `DEMO_MODE` turn** played by the mock assistant. That turn emits a new scene intent, `development.play`. **No AI narrator, and no live LLM.** |
| D5 | **Upload is front-end only.** A paperclip button in the composer accepts any file and shows a file chip ("Elmina_Tower_Brief.pdf" in the demo). On send, the fixed brief text is sent instead of the file. The file is never read, uploaded or stored. **Nothing on screen says it is a sample**; only `demo-script.md` carries a presenter note ("say so if asked"). |
| D6 | **Scripted autoplay,** deterministic, about **66 s** (the prototype's timeline), with play/pause, restart and a scrubber. |
| D7 | **Interactions are scripted, not engine-computed.** Facts come only from the routing engine. Residents' behaviour, lines and the crowd are illustrative. |
| D8 | **Labels:** a persistent **"Simulation · illustrative"** badge; the existing "Decorative details are illustrative."; the end card is marked **"Simulated reactions"**; numbers appear in **ROUTE ENGINE** tags under bubbles, never inside speech. |
| D9 | **Residents:** the new tower's ~500 households are generated with the existing population generator (`day/population.py`). 4–6 Spotlight Residents are picked with the existing naming and role logic (`day/spotlight.py`). One existing nearby resident, **Pak Cik Halim**, takes the detour. The prototype's cast names are the baseline. |
| D10 | **Art: the app's existing Stylised (Three.js) city.** Use its GLB crowd and hero models and its construction kit; do not port the clay look. The prototype's art is only a stand-in. |
| D11 | **No flood** content in this demo. |
| D12 | **Reactions:** each bubble is either positive or negative; a beat does not need both. The lines are fixed (§4.3). |
| D13 | **Delivery:** branch `feat/devsim`, with all 7 CI checks green. **Do not merge to `main`.** Push the branch to `origin` as a backup; do **not** open a PR. |
| D14 | **P4 scope** is fixed in §8. |

## 3. Honesty rules (from AGENTS.md and ADR 0014; enforce them in code)

- Every number shown, anywhere, is computed from the world model by `packages/spatial`: the detour, the walk to the park and the walk to the mall. The occupancy counter, month counter and clock are display values of the simulation clock. They sit under the "Simulation · illustrative" badge and are never cited as facts.
- **Bubble text contains no digits.** The exceptions are the park and mall lines, which say the minutes, and those must equal the computed facts. A test enforces this (AC-H2).
- Never say "safe", "selamat" or "安全", never give a water depth, and never mention flood.
- The hypothetical tower is never called an SDP project. The "Hypothetical development · not an SDP project" label is visible in every frame where the tower is on screen (AC-H3).
- Simulated reactions are never presented as real residents' views. The end card's subtitle is "Simulated reactions · Hypothetical development · not an SDP project".
- The validator, the mock and `template.py` change together; golden must stay green.

## 4. The acceptance baseline: the prototype

**Source of truth for flow:** `docs/03-product/prototypes/developer-lens/index.html` (`ACTS` around line 181, `BUBBLES` around line 703, `CAM` around line 759).

**To run it:**

```bash
cd docs/03-product/prototypes/developer-lens && python -m http.server 5191 --bind 127.0.0.1
```

It exposes `window.__devsim = {seek, play, pause, total, acts, facts}`.

### 4.1 What must match, and what changes

| Must match the prototype | Changes in the product |
|---|---|
| Act order and timing (§4.2), ±0.5 s | Clay chibis → the app's GLB crowd and hero models, with name tags |
| Bubble speaker, text, timing and positive/negative tone (§4.3), ±0.5 s | Slab tower → floor-by-floor tower in the city's facade style |
| Camera beats: same subject framed at the same moments (§4.4) | Prototype lighting → the app's `mood.ts`, `sky.ts` and `lighting.ts`, driven by the sim clock |
| Overlays: Simulation badge, decorative note, hypothetical label, HUD (Act · simulated time · homes occupied), Resident feedback badge with counter, ROUTE ENGINE tags, end card layout and copy | Mock chat panel → the real Management `AssistantPanel` |
| Lobby entrance with canopy and path; movers enter and residents leave through it; the greeting happens at the door | Prototype workers → the Blender worker variant (§8) |
| Day/night cycles in Construction (about 2.8 s each, 10 cycles, months 1→24); about 1.85 slower cycles in Handover ending at dawn; one day in Daily Life, 07:00 → about 19:40 | Prototype's known rough edges get fixed (§9, Q-criteria) |
| At night during Construction: workers gone, floodlights on, crane still, beacon blinking. By day: work, and floors rise | **New:** visible resident and vehicle flow during the fast-forward (§7) |

### 4.2 Timeline (baseline)

| Act | Start–end (s) | What plays |
|---|---|---|
| Brief | 0–4 | File chip appears in the composer, the message is sent, the assistant replies restating "Brief: 30 storeys · ~500 homes · parcel near Lakeside Mall", and the camera flies from the overview to the site |
| Construction | 4–32 | Hoarding closes the frontage sidewalk (closed edge drawn red, detour drawn dashed). Tower crane, mixer and workers move by day and floors rise; at night everything stops. Halim walks the detour; Farid complains |
| Handover | 32–44 | Hoarding and crane go. Lorries park where the entrance path meets the street. Movers queue on the path and enter one by one. Windows light floor by floor and the occupancy counter climbs. Halim greets Mei Ling's family at the door |
| Daily Life | 44–63 | One day: residents leave through the door in the morning; a school-run car queue at the junction, and Mei Ling's complaint becomes an envelope flying to the Resident feedback badge (counter 0→1); Zainab at Urban Park at midday; Arjun at the mall at dusk |
| Summary | 63–66 | Wide dusk/night shot plus the "What residents raised" card |

### 4.3 Bubbles (baseline copy, exact)

| # | Speaker | t0–t1 (s) | Tone | Text | Tag under bubble |
|---|---|---|---|---|---|
| 1 | Pak Cik Halim (existing resident) | 18.4–21.4 | − | Footpath closed lah, must walk the other side now | ROUTE ENGINE · +{detour_min} min walk · {before_m} → {after_m} m |
| 2 | Farid (passer-by) | 23.4–26.2 | − | So noisy lah | — |
| 3 | Mei Ling (new resident) | 35.4–38.2 | + | We got our keys! | — |
| 4 | Pak Cik Halim | 40.2–43.2 | + | Eh, new neighbours ah? Welcome! | — |
| 5 | Mei Ling | 47.6–50.4 | − | School run jam again… haiz | — (the envelope flies to Resident feedback) |
| 6 | Mak Cik Zainab (new resident) | 53.2–56.2 | + | Park in {park_min} min, love it | ROUTE ENGINE · {park_m} m · {park_min} min walk |
| 7 | Arjun (new resident) | 58.6–61.6 | + | Mall's a {mall_min} min walk, not bad! | ROUTE ENGINE · {mall_m} m · {mall_min} min walk |

**Copy rules:**
- Bubble 1 must stay true to the route result: the detour moves to the far-side sidewalk. If recomputed data changes the geometry, rewrite the line truthfully, with no number, and log a ruling.
- Bubble 7: if `mall_min ≤ 5`, the line may become "Mall's right downstairs!". If it is above 12, use a neutral line with no false claim.
- Lines have at most 8 words, except bubble 1, which the owner approved at 9. Malaysian-English flavour is intended.

### 4.4 Camera beats (baseline)

The keyframes are in the prototype's `CAM` array. As subjects:

| t (s) | Subject in frame |
|---|---|
| 0 | High overview of the site and mall |
| 3.6–8.6 | Construction yard, low (workers, stacks) |
| 10.4–15.4 | Tower rising, mid-wide |
| 17.2–21.6 | Halim on the detour, with the closed edge and the tower |
| 22.8–26.4 | Farid, close |
| 28–32 | Tower wide, topping out |
| 34.6–44 | Entrance close-up: movers, then the greeting |
| 47–51.6 | Junction with the school-run queue, plus Mei Ling |
| 52.8–57 | Urban Park, plus Zainab |
| 58–62.4 | Mall front, plus Arjun |
| 63.6–66 | Wide closing shot, with the tower and mall in frame |

### 4.5 End card (baseline copy)

**What residents raised**
*Simulated reactions · Hypothetical development · not an SDP project*

1. Building work closes the footpath beside the site: the walk to the mall gets about **{detour_min} min longer** ({before_m} m → {after_m} m). `ROUTE ENGINE`
2. Parents complain about the **morning school-run jam** at the junction. `SIMULATED`
3. Residents like having **Urban Park {park_min} min** and **the mall {mall_min} min** away on foot. `ROUTE ENGINE` `SIMULATED`

Footer legend: "ROUTE ENGINE numbers come from the mapped walk network. SIMULATED marks invented reactions."

## 5. Architecture

```
AssistantPanel (Management) ── paperclip chip + brief text ──► POST /chat
                                              │  DEMO_MODE replay hit (mock)
                                              ▼
            assistant reply + scene.intent { kind: "development.play", plan_id | plan }
                                              ▼
apps/web features/devsim/ ── fetch plan (if not inlined) ── timeline.stateAt(t) ──► Stylised Three.js renderer
                                              ▲
apps/api  POST /developments/simulate  ◄── packages/spatial townshiplens_spatial/devsim.py ── DevelopmentPlan
```

### 5.1 Backend: `packages/spatial/src/townshiplens_spatial/devsim.py` (new)

This mirrors `journey.py`, which builds `JourneyPlan` for `POST /journeys`. Port the computation from the prototype's `build_scene.py`.

`build_development_plan(world, brief) -> DevelopmentPlan` (Pydantic) contains:
- **`site`:** parcel id; tower footprint polygon (lon/lat) on the parcel's north-east corner; `storeys` = 30; `homes` ≈ 500; `entrance` (door point, facing, path polyline to the snapped walk node); `kanopi_clearance_m` ≥ 200.
- **`facts`**, each with an evidence/provenance note of "routing engine, default profile":
  - **Detour:** a resident home near the parcel whose route to the mall (`park-b`, Lakeside Mall Car Park B) uses the hoarded frontage edge. Compute the route before and after `twm.ClosePath` on that edge, giving `before_m`, `after_m` and `detour_min` (rounded), plus both polylines. Assert `detour_min ≥ 2`. The prototype used home `w909835115` and edge `seg-910300105-0` (+3 min, 2,516 → 2,754 m); recompute, don't hard-code.
  - **Walks:** tower → Elmina Urban Park (`park_m`, `park_min`) and tower → Lakeside Mall (`mall_m`, `mall_min`), from the entrance's snapped node.
- **`cast`:** a household summary for the tower (count ≈ 500 from the population generator, seeded), plus Spotlight Residents with `id`, `name`, `role`, `persona`, `home` (tower or existing) and colour. Use the baseline names: Halim (existing), Mei Ling (+ child), Zainab, Arjun, and Farid (passer-by). If the generator's naming can't yield these names deterministically, the baseline names win; log a ruling.
- **`beats`:** the acts (§4.2) and bubbles (§4.3) with rendered text and tags, the end card (§4.5) and anchor points (Halim's detour path, Farid's spot, the junction queue, the park spot, the mall spot) in lon/lat.
- **`labels`:** the label strings from D3 and D8.
- **Validation (`check_plan`):** every number in bubble text, tags and the end card must equal a value in `facts`; bubble 2–5 texts contain no digits; no banned words (§3). This runs on build and in tests. It works like `spotlight.check_text`, which you can reuse.
- **Availability:** if the world lacks the parcel, or the facts can't be computed (for example on the tiny fixture), raise a typed error. The API maps it to `404 {"detail": "development simulation not available for this world"}`.

**API:** add `POST /developments/simulate` in a new `apps/api/.../routes/devsim.py`, registered like `routes/day.py`. The body is `{brief_text?: str}` (it is ignored apart from echoing it) and the response is `DevelopmentPlan`. Run `pnpm gen` and commit `packages/api-client`.

### 5.2 Agent (`packages/agent`)

- **New scene intent `development.play`:** add it to the ChatEvent and scene-intent types and the web parser (`parseSse` → `useChatStream` → `chatReducer` → `useScene.applyIntent`). Follow how `journey.play` was added.
- **Mock branch:** a message matching the fixed brief (and the starter chip) calls a new tool, `simulate_development`, which wraps `devsim.build_development_plan`. It replies with a short checked answer restating the brief, "Brief: 30 storeys · ~500 homes · parcel near Lakeside Mall", plus one sentence that it is illustrative, not a forecast, and that walking times come from the mapped routes. It then emits `development.play`. Update the validator, mock and template together.
- **Starter:** add a Management starter (`apps/web/src/features/assistant/starters.ts`): "Simulate a 30-storey, 500-home tower near Lakeside Mall, from construction to daily life". The fixed brief text equals this starter text.
- **Record the replay:**

  ```bash
  LLM_PROVIDER=mock uv run python -m townshiplens_agent.cli --record "<starter text>" --profile default
  ```

  This writes it into `data/demo/*.jsonl`. `meta.world` must equal `elmina`. Never record with a live model.
- **Golden:** add one golden case (`world: elmina`) asserting the tool call, the intent and the checked answer.

### 5.3 Web (`apps/web/src/features/devsim/`, new)

- **`timeline.ts`:** a pure function `stateAt(t, plan)` that returns the act, sim clock (month/week/day and time), sun phase/elevation, occupancy, floors built, worker activity (day/night), visible bubbles, feedback count, camera keyframe interpolation, and crowd/traffic `flowRate` and `timeScale`. It is unit-tested and contains no Three.js. Model it on `features/journey/timeline.ts`.
- **`useDevsimPlayback.ts`:** the clock with play, pause, seek and restart. It exposes `window.__devsim = {seek, play, pause, total, acts, facts, probe}` in dev and test builds. `probe()` returns projected screen rectangles for `tower`, the current speaker, the current bubble and the labels, plus crowd and vehicle position samples (§10).
- **Overlays (React):** `DevsimHud`, `SimBadge`, `HypotheticalLabel` (anchored to the tower), `Bubble` + `RouteTag` (anchored to the speaker), `FeedbackBadge` + envelope animation, `EndCard`, and a `PlaybackBar` (play/pause, restart, scrubber, act label). Match the prototype's layout and copy; use the app's design tokens and themes.
- **Composer paperclip** (Management only): a hidden `<input type=file>`. Selecting a file shows a chip (file name, PDF badge). On send, the fixed brief text goes to `/chat`. Nothing is uploaded. Add a DOM test.
- **Scene (Stylised Three.js renderer):** a devsim overlay module under `apps/web/src/features/scene/three/` (for example `overlays/devsim/`), mounted while `development.play` is active. It covers:
  - **Tower:** floor-by-floor growth (floors only rise in sim daylight), the city's facade/window material so it matches neighbours, a scaffold band at the top, and an entrance with glass doors, canopy and paved path. Until Handover the windows are unlit (fix the prototype's floodlight tint); in Handover they light floor by floor.
  - **Construction kit:** `public/city/kits/construction.glb` (tower_crane, hoarding_6m, scaffold_bay, material_stack, cement_mixer, site_cabin). The crane slews by day and its beacon blinks at night; floodlights at night. Hoarding is removed at Handover.
  - **Closed edge and detour:** a red closed strip and the dashed detour route, using the existing route-drawing style.
  - **Characters:** Spotlight Residents use the GLB crowd/hero models (`public/city/characters/*.glb`, `crowd_*.glb`, `crowdBake.ts`) with name tags (see `detailBubble.ts`); workers use the worker variant (§8); movers carry boxes (a box prop is fine); lorries use the existing vehicle models.
  - **Lighting:** the sim clock drives `mood.ts`, `sky.ts` and `lighting.ts`, the way Elmina Day playback overrides the theme today (ADR 0011; `sunClock.ts`). Street lights and lit windows keep dusk and night readable.
  - **Camera:** keyframes per §4.4, adapted to the real scene. Clamp the camera so close shots never enter building volumes (fix the prototype's clipping).
  - **Fade-out:** while devsim plays, the normal decorative crowd and traffic are replaced by devsim's own flow (§7), as Elmina Day does (`motion/useMotion.ts`).
- **List view / no-WebGL / no buildings:** the List renderer shows a text version (act list, the bubbles as quotes with speaker names, the end card). No 3D is needed. This is what e2e exercises.
- **Mapbox lite:** text version only (as above). Do not build map animation.

## 6. Data and world

- Use the real Elmina seed (`data/seed/elmina`). The tower is **not** written into `buildings.geojson`; it exists only in the plan.
- The tiny fixture has no parcel, so the API returns 404 there. Playwright stubs `POST /api/developments/simulate` with a recorded plan fixture (`apps/web/e2e/fixtures/devsim-plan.json`, generated from the Elmina build) when it needs the full flow, the way `three.spec.ts` stubs `/api/layers/buildings`.
- After building, check that the segment ids quoted in docs and tests still exist.

## 7. Fast-forward flow (owner requirement, added 21 Oct)

During the fast-forward (Construction and Handover cycles) **residents and vehicles must visibly flow**, so the scene reads as a time-lapse and not only as a changing sky.

- **Vehicles:** drive the mapped roads near the site, speeded up by `timeScale` (so they streak), denser in sim daytime and rush hours, sparse but not empty at night. Lorries and the mixer come and go at the site by day.
- **People:** walk the footways around the site and mall, speeded up the same way, with daytime density higher than night. They detour around the closed edge (they don't walk through the hoarding).
- **Daily Life:** normal speed. Density follows the time of day; there is a school-run car queue at the junction in the morning.
- **Implementation hint:** reuse `motion/` (crowd `agents.ts`, `crowdRenderer`, traffic) with a speed multiplier and density curve fed from `stateAt`. This is decorative. It is never counted or cited and sits under the illustrative label.
- **Measurable (AC-F3):** during Construction, sampled crowd and vehicle positions move between two frames 0.5 s apart; the moving count by sim day is at least 2× the count by sim night; and there are at least 20 vehicles and 30 people on screen by day at the 10.4–15.4 s wide shot.

## 8. P4 scope (fixed)

**Build:**
1. Fast-forward flow (§7).
2. **Worker variant:** the adult man crowd model with a yellow hard hat and an orange hi-vis vest, made through the Blender asset pipeline (`assets/blender/tl_assets/`, the same pipeline as `construction.glb`). Use only the existing walk and idle clips.
   - **Fallback**, if Blender or the pipeline fails within 90 min: attach a hat and vest as simple meshes to the crowd model at runtime. Log a ruling.
3. Spotlight Residents on GLB models with name tags.
4. Tower growth plus entrance (§5.3).
5. Construction kit placement and animation.
6. Moving lorries.

**Not built (log them as future work):** new animation clips (hammering, carrying), a Blender-modelled bespoke tower, a mobile layout pass, map animation in Mapbox, a real file upload, scenario comparison, Elmina Day engine integration.

## 9. Quality criteria (at least the prototype's level)

| ID | Criterion |
|---|---|
| Q1 | Average ≥ 30 fps at 1440×860 on this laptop across the 66 s run, measured via `requestAnimationFrame` timing in Playwright headed Chromium. Report the number. |
| Q2 | No camera position inside any building volume at any sampled t (0.25 s steps). |
| Q3 | Readability: each visible bubble and label has a contrast ratio ≥ 4.5:1 against its own background (a DOM check), and the speaking character's screen rectangle has mean luminance contrast ≥ 1.5:1 against a ring of surrounding pixels at the dusk and night beats. |
| Q4 | No unfinished-tower windows lit before Handover (the window-lit fraction is 0 until t = 32 s). |
| Q5 | 0 console errors and 0 warnings from our code during a full 0→66 s sweep. |
| Q6 | Nothing flickers or z-fights on the tower, hoarding or route strips (visual check on the contact sheet, plus `polygonOffset` and depth settings reviewed). |

## 10. Acceptance criteria

Status per AC is recorded in the ledger as PASS / FAIL / BLOCKED / NOT RUN, with evidence.

**Facts and honesty (pytest unless noted)**
- **AC-H1:** `facts` are recomputed from the seed. `detour_min` equals round((after − before) / pace) and is ≥ 2. Park and mall values come from `routing.plan_route`.
- **AC-H2:** `check_plan` rejects any bubble, tag or end-card number not in `facts`, and any digit in bubbles 2–5. A property test mutates numbers to prove it.
- **AC-H3:** the hypothetical label is visible whenever the tower's projected rectangle is on screen. This is checked in Playwright via `probe()` at 0.25 s steps.
- **AC-H4:** no banned words (safe / selamat / 安全 / depth / flood) appear in the plan, the replay or the UI copy (a test greps them).
- **AC-H5:** the tower is ≥ 200 m from the Kanopi lot and inside `way/1564861412`.
- **AC-H6:** the tiny fixture returns 404, and the UI shows "not available for this map" in List view.

**Flow (vitest plus Playwright)**
- **AC-F1:** act boundaries equal §4.2 within ±0.5 s; bubble speakers, texts (after fact substitution) and times equal §4.3 within ±0.5 s; the end card copy equals §4.5.
- **AC-F2:** there are 10 day/night cycles in Construction and the month counter runs 1→24; Handover ends at sim dawn; Daily Life runs from 07:00 to about 19:40.
- **AC-F3:** fast-forward flow as measured in §7.
- **AC-F4:** in the Management tab, clicking the starter **or** attaching a file and sending → assistant reply → playback starts → end card at 66 s. This is e2e in List view with the stub, plus a Three.js run on the Elmina seed via `townshiplens-dev-demo`.
- **AC-F5:** the envelope animation runs and Resident feedback goes 0→1 at bubble 5.
- **AC-F6:** play, pause, restart and scrub work, and seeking backwards restores state deterministically (the same `probe()` output for the same t).

**Composition versus the prototype (Playwright)**
- **AC-C1:** at the 12 baseline times (2, 7, 11, 19, 24, 30, 37, 41, 48, 54, 60, 65 s), the centre of the subject named in §4.4 lies within 10% of the viewport width of where the prototype's `probe()` puts it. Add `probe()` to the prototype (a small, allowed edit) so both sides can be measured.
- **AC-C2:** every visible bubble's rectangle is fully inside the 3D stage and does not overlap the HUD, the playback bar or the assistant panel.
- **AC-C3:** a contact sheet (prototype left, product right, the 12 times) is saved for the owner.

**Quality:** Q1–Q6 (§9).

**Engineering:** the full CI checklist passes (§11.3).

## 11. Verification plan

1. **Unit tests:** pytest for `devsim.py` (facts, `check_plan`, availability, determinism with a seeded cast); agent tests for the tool, mock, validator and template; vitest for `timeline.ts` (acts, cycles, bubbles, flow curve); DOM tests for the paperclip chip and the end card.
2. **e2e:** a new `apps/web/e2e/devsim.spec.ts` (List view, stubbed plan), plus a Three.js variant like `three.spec.ts` that stubs `/api/layers/buildings` and the plan.
3. **CI checklist** with `set -o pipefail`, reporting each step:
   1. `pnpm lint`
   2. `uv run pytest -q`
   3. `pnpm -r --if-present typecheck`
   4. `pnpm -r --if-present test`
   5. `pnpm gen && git diff --exit-code packages/api-client`
   6. `pnpm golden`
   7. `pnpm --filter @tl/web e2e`

   Run vitest with the map keys blanked as well, because the local `.env` hides CI failures (see memory: local-ci-env-keys).
4. **Visual gate,** at the end of P3 and again at the end of P4: run the Elmina seed with `townshiplens-dev-demo` (mock, `DEMO_MODE`) in the **Stylised** view only, never Realistic, because Google tiles cost money. Run the `probe()` checks (AC-C1, AC-C2, AC-H3, AC-F3, Q1–Q5), save screenshots and the contact sheet, and look at every frame. A frame that "looks wrong" is a FAIL even if the numbers pass.
5. **Independent review:** a light code-reviewer subagent per phase, and a final **evaluator** agent that scores every AC and Q against this spec and the prototype without seeing the implementer's notes. Anything below PASS is fixed and re-scored before delivery, or reported as FAIL with the reason.
6. **Recording:** a 66 s Playwright video at 1440×860 of the product run, plus one of the prototype. Save both outside git, in the session scratchpad, and give their absolute paths in the final report.

## 12. Execution plan (overnight, unattended)

> **Superseded in detail by the parallel plan** [plans/2026-10-21-developer-lens-devsim.md](../plans/2026-10-21-developer-lens-devsim.md). That plan has a T0 contract, then parallel lanes BE / AI / FE / 3D / ASSETS / QA, then merge points M1–M3 with Gate 1 and Gate 2. The phase table below is the sequential view of the same work, kept for budgeting. Progress goes to `docs/superpowers/overnight-log-devsim.md`.

### 12.1 Phases and time budget (about 20 h)

| Phase | Budget | Output | Gate |
|---|---|---|---|
| P0 Plan | 1.5 h | Implementation plan `docs/superpowers/plans/2026-10-21-developer-lens-devsim.md` (tasks, lanes, AC mapping); ledger in `.superpowers/sdd/devsim/` | Plan covers every AC |
| P1 Backend | 3 h | `devsim.py`, the API route, `pnpm gen`, pytest | AC-H1, H2, H4, H5, H6 green |
| P2 Agent | 2 h | Tool, mock branch, intent, validator/template, replay recorded, golden | Golden green; `/chat` replay emits `development.play` |
| P3 Web skeleton | 5 h | Timeline, playback, overlays, paperclip, List view, scene with simple geometry, flow v1 | AC-F1, F2, F4, F5, F6, C2 + **visual gate 1** |
| P4 3D assets | 6 h | §8 build list | AC-F3, C1, Q1–Q6 + **visual gate 2** |
| P5 Finish | 2.5 h | Docs, full CI, evaluator, videos, contact sheet, report | All ACs reported |

If a phase overruns by more than 50%, cut scope following §8's fallbacks, log a ruling and move on. **Never stop to ask.**

### 12.2 Branching and lanes

- Branch `feat/devsim` off the latest `origin/main`. Use the worktrees under `../SunNiuBi-wt/<lane>` per CLAUDE.md: `lane/be` (P1), `lane/ai` (P2), `lane/fe` (P3/P4).
- Once P1 has fixed the `DevelopmentPlan` schema (commit it early, with a JSON fixture), P2 and P3 can run in parallel.
- The coordinator merges lanes into `feat/devsim` with `--no-ff` and runs the full checklist after each merge.
- Keep at most 2 heavy processes at once (8 GB RAM; see memory: journey-sim-overnight-run). Don't run e2e and a Blender export at the same time.

### 12.3 Commits

- Conventional, with a scope: `feat(spatial): …`, `feat(api): …`, `feat(agent): …`, `feat(web): …`, `data: …` (the replay recording is committed on its own), `docs: …`.
- Stage explicit paths; never `git commit -am`.
- Push `feat/devsim` to `origin` at the end of every phase as a backup. Never push to `main`, and never open a PR.

### 12.4 Rulings and logs

- **Rulings:** every decision this spec doesn't cover goes in the plan's ledger as "Ruling: what — why — cost if wrong".
- **Progress log:** `docs/superpowers/overnight-log-devsim.md`, with real `date` timestamps at each phase start and end and at every gate result.

### 12.5 Final report (morning)

Put it at the end of `overnight-log-devsim.md` and also in the final message:
- the AC/Q table with PASS / FAIL / BLOCKED / NOT RUN and evidence links, marked mock-backed where it is;
- the CI checklist results;
- the computed facts (detour, park, mall) and the home and edge used;
- the list of rulings;
- absolute paths to the contact sheet, screenshots and both videos;
- the branch state: commits on `feat/devsim`, pushed or not, and **not merged**;
- known gaps and suggested next steps.

## 13. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Recomputed facts change after the place-scoping data update (detour < 2 min, or a different edge) | Search nearby homes and frontage edges for a real detour ≥ 2 min. If none exists, keep bubble 1 without a tag, drop end-card item 1, and log a ruling |
| The Blender pipeline is slow or broken | Runtime hat and vest meshes (§8) |
| fps below 30 with flow, tower and kit | Cut crowd and vehicle counts first, then shadow quality during fast-forward; keep the AC-F3 minimums |
| A camera beat can't frame the subject in the real scene (occluders) | Adjust the offset and height; AC-C1 is about the subject's screen position, not the identical offset |
| The `DEMO_MODE` replay doesn't match the typed text | The starter chip and the paperclip both send the exact fixed brief text |
| The stylised city has no buildings in the test world | List view text version (§5.3); e2e covers it |

## 14. Out of scope

Scenario comparison; any live LLM call; real document parsing or storage; writing the tower into the seed; flood; Realistic (Cesium/Google) view support; new animation clips; mobile polish; merging to `main`.
