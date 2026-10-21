# Demo polish: navigation compare, building impact, living-city fixes — design spec

- Status: draft for owner review, 21 Oct 2026
- Owner decisions: discussion with Claude Code, 21 Oct 2026 (summarised in §2)
- **Acceptance baseline:** the prototype in [docs/03-product/prototypes/demo-storyboards/](../../03-product/prototypes/demo-storyboards/README.md)
- Builds on: [resident journey spec](2026-10-19-resident-journey-simulation-design.md), [developer lens spec](2026-10-21-developer-lens-development-simulation-design.md), [ADR 0013](../../00-overview/decisions/0013-living-township-traffic-people-and-sourced-signage.md), [ADR 0014](../../00-overview/decisions/0014-developer-lens-hypothetical-developments-on-real-parcels.md)

---

## 0. How to use this spec

- Everything in §2 is settled. Where this spec is silent, decide, log a ruling ("Ruling: what — why — cost if wrong") in the plan's ledger, and keep going.
- Read `AGENTS.md`, `CLAUDE.md`, this spec, then the prototype `README.md` and `index.html`.
- **The prototype is the baseline** for beat order, timing, overlays, copy and layout. The product uses the real Elmina map and real art, and must reach at least the prototype's clarity.
- Scope is all three parts (A, B, C), in that order. The owner asked for no phase gates: one final owner gate (§9).
- File paths and line numbers below were checked on 21 Oct 2026 on `main` (`2bc9011a`). Re-check before editing.

## 1. Goal

Two 45-second 3D demos for the judges, plus fixes to the living city that both demos show.

1. **Navigation (Resident):** for a wheelchair user, the world model shows two routes side by side, recommends one, and says why in terms that matter to people with limited mobility. It also shows, in two seconds, that unchecked facts turn into staff tickets.
2. **Building (Management):** a hypothetical tower plays from hoarding to move-in. Management sees impact numbers (detours, lorry route, schedule, cost, flood exposure, daily-life access) and can open any of **40 simulated residents** to read how each felt.
3. **Living city:** no mid-road U-turns, riders on two-wheelers, no ghosting on High quality, Malaysian-looking vehicles.

The 45 seconds is 3D playback time only. Typing or asking the question is not counted.

## 2. Settled decisions (do not relitigate)

| # | Decision |
|---|---|
| D1 | Navigation compares **two** routes in an automatic **split screen**: left "Fastest route", right "Recommended · step-free". |
| D2 | **Unknown never eliminates or penalises a route.** Ranking and reasons use known facts only. Unchecked stretches are shown neutrally as "? Not checked yet" and stated as "did not count for or against". |
| D3 | Ticket showcase = **option A**: when the recommended walker passes an unchecked stretch, a ticket card flies from that spot to a Tickets chip (counter 0→1), then a toast says what was queued and how many wheelchair trips checking it would confirm. The ticket is a real verification request; N is computed. |
| D4 | Residents may greet with bubbles on the navigation route. Greetings only, no facts, labelled "Simulated resident". |
| D5 | Demo corridor data = **option A**: add `team_survey_placeholder` claims to the segments of the chosen demo routes so the reasons card has facts. They render as "Demo value · not surveyed", like the existing 25. A real field survey can replace them later with no code change. |
| D6 | Building keeps the resident **bubbles** (existing devsim feature, retimed to the new 45 s timeline). |
| D7 | Building shows a **hoarding impact summary** (all nearby homes, not one). |
| D8 | Building shows **schedule and cost estimates** from published benchmarks, labelled ESTIMATE with a source line. Never presented as an SDP figure. |
| D9 | Public holidays appear as **ticks** on the timeline. Only **Hari Raya Aidilfitri** (one occurrence) and the **northeast monsoon** (one stretch) get an on-screen set piece. A summary line totals days lost. |
| D10 | **40 simulated residents**: a button on the 3D map ("Simulated residents · 40") opens a list; tapping one opens their facts and feelings for three phases. 20 move into the tower, 20 live nearby. |
| D11 | Resident lines are **templates** (persona × phase) filled with numbers from that resident's facts. No live LLM; demo caches are recorded with the mock. |
| D12 | Vehicles become **Malaysian-looking** models: shapes in the spirit of common local cars, **no logos, no brand or model names** in assets, code identifiers or UI. |
| D13 | Execute A → B → C, all of it, one final owner gate. |

## 3. Honesty rules (from AGENTS.md; enforce in code)

- Route reasons, minutes, metres, counts and N come from `packages/spatial`, never from the model or hard-coded copy. `validate.py` checks numbers against `TurnRecord`; the validator, mock and template change together.
- Placeholder evidence always shows "Demo value · not surveyed"; any agent answer citing it contains "demo values, not yet surveyed".
- Unknown is never called blocked, unsafe or not passable. `no_data` stays "No mapped connection (data gap)".
- Flood: "Indicative scenario, not a forecast." No depths on paths, no "safe".
- Estimates (cost, duration, rain days) carry an ESTIMATE badge plus a source line. Holiday dates for years whose official list is not yet gazetted are labelled "expected dates".
- Resident lines are labelled "Simulated reactions"; every number in a line comes from that resident's facts (`day/spotlight.py` `check_text` pattern). The tower stays "Hypothetical · not an SDP project".
- Greeting bubbles and decorative details state no facts. Vehicles, riders and crowds remain display-only.
- Verification requests store no user words (`safe_vr_args()`).

## 4. Part A — living-city fixes

Root causes were diagnosed on 21 Oct 2026 (read-only investigation).

### A1. No mid-road U-turns

- **Cause:** `motion/agents.ts` makes each walk-layer LineString its own run (`runsOf`, ~472–515) and cuts runs into ≤120 m chunks (`AGENT_CHUNK_M`, ~420, 750–755). Cars loop out and back on one chunk (~804–809), so they U-turn wherever the chunk ends. People ping-pong on open chunks and spin 180° over `TURN_S` (~102, 310–323); `trimPavement` (~623–657) and `avoidRoute` in `motionLayer.ts` (~99–147) shorten paths further.
- **Fix:** build a small **junction graph** per streamed tile from shared LineString endpoints (snap ≤1 m). An agent reaching a node picks a connected edge, never the one it came on unless the node is a true dead end (degree 1). Vehicles keep lane offset through the turn and ease speed around corners. People do the same on footways; `trimPavement` trims only at real junctions.
- **At a tile edge or keep-out (avoid zone):** fade the agent out and respawn it elsewhere on the graph. Never reverse in place.
- **Test:** a property test over the tiny fixture and a synthetic grid asserts no agent reverses heading by >150° except at degree-1 nodes, over 60 s of simulated time.

### A2. Riders on two-wheelers

- `_motorcycle` (`assets/blender/tl_assets/props.py` ~1327–1375) has no rider. Add a seated rider with helmet to `motorcycle`; add rider plus delivery box to `delivery_motorcycle`.
- Bicycles: spawn as a **vehicle** class on streets (not the people kit `cyclist`, which `agents.ts` ~340 excludes because it would walk at 4.5 m/s), using the existing `_rider`/`_bike` geometry (`props.py` ~1059–1102). Speed 4–5.5 m/s, kerb-side lane.
- Re-export `public/city/kits/vehicles.glb`, update the manifest, keep LOD1 triangle budgets in line with today's (hatchback 676/352).

### A3. No ghosting on High quality

- **Cause:** High adds only depth of field (`quality.ts:15`). `CityBokehPass` (`engine.ts` ~1420–1431) blurs foreground too and mixes the background into near figures. The crowd's walk animation lives in a vertex patch (`crowdRenderer.ts` ~53–107) that the depth override material lacks, so depth and colour silhouettes disagree.
- **Fix:** (1) no blur in front of the focus plane (foreground sharp, background soft), in both orbit and follow modes (`tiltShift.ts`); (2) give crowd and vehicle meshes a `customDepthMaterial`/depth override that carries the same vertex patch, or exclude the motion layer from the bokeh depth pass if that is cheaper and looks right.
- **Check:** screenshots at High with FX on and off, same frame, near-camera resident: no visible see-through.
- Not a bug: GLB materials are replaced by the project's clay material (`characters/glbHero.ts` ~322–346) by design.

### A4. Malaysian-looking vehicles

Replace the vehicle kit with generic shapes in the spirit of local streets. Variant ids are descriptive, never brand names.

| Variant id | Look | Share of street traffic |
|---|---|---|
| `compact_hatch` | small 5-door hatch, short bonnet | 30% |
| `micro_hatch` | very small hatch | 12% |
| `small_sedan` | small 4-door sedan with short boot | 20% |
| `mpv` | 7-seat MPV | 10% |
| `pickup` | double-cab pickup | 6% |
| `kapchai` | underbone moped with rider | 12% |
| `delivery_moto` | moped, rider, delivery box | 6% |
| `bicycle` | bicycle with rider | 2% |
| `bus` | single-deck city bus | major roads only |
| `lorry` | 3-tonne lorry | major roads only |

- Paint palette weighted to white, silver and grey, with some red, blue and black. Built by Blender Python scripts like today's (`specs.py` ~403–425, `props.py` `_car` ~1247). No textures or decals with logos or plates text.
- Parked cars (`ground/parking.ts` ~48–50) use the car variants only.
- Record any new external source in `CREDITS.md` (none expected).

## 5. Part B — Navigation: compare two routes

### 5.1 Backend

- New tool **`compare_routes(ctx, from_id, to_id, profile="wheelchair", scenario_id=None, question_summary=None, file_vrs=True)`** in `townshiplens_spatial.tools` (count goes from 21 to 22; two tests pin the set: `packages/spatial/tests/test_tools_flood.py:13`, `packages/agent/tests/test_run.py:281`).
  - **Fastest:** the route for the `default` profile (shortest walk).
  - **Recommended:** the route for the requested profile (today's `plan_route` logic).
  - If both are the same path, return one route and say so; the UI then skips the split screen.
  - The fastest route is **evaluated under the requested profile**. Its first known FAIL edge (e.g. `step_count > 0` for wheelchair) is the **stop point**: edge id, position along the route, attribute, value, limit.
  - **Reasons**, per route, from known (PASS/FAIL with a claim value) facts only: number of steps; steepest incline vs the profile limit; narrowest width vs the limit; share of length with `covered`; seating/rest stops on or adjacent to the route; length and minutes at the profile pace; extra minutes for the recommended route.
  - **Unchecked stretches** (UNKNOWN edges) are returned separately with their attributes and lengths. They do not enter the ranking or the reasons.
  - **Points of interest** along the recommended route for the 3D tags, each with position (distance along the route), kind (`kerb`, `covered_start`, `incline`, `seating`, `unknown`, `arrival`), value and evidence ids.
  - For the first unchecked stretch on the recommended route, the tool **files one verification request** through the existing path (`create_verification_request`, `safe_vr_args()`) and computes **N = wheelchair sample journeys that checking it would confirm**, using the existing `plan_verifications`/`impact.py` logic. Returns the VR id and N. Deduplicate: an open VR for the same target and attribute is reused, not duplicated.
- REST: expose it next to `/routes` (e.g. `POST /routes/compare`). Run `pnpm gen` and commit `packages/api-client`.
- Agent: `compare_routes` is offered when the user asks for a route with a mobility profile. A new scene intent **`route.compare`** carries both paths, stop point, POIs, unchecked stretches, VR id and N. `validate.py`, `mock.py` and `template.py` are updated together; the answer cites evidence ids and, if placeholder evidence is used, contains "demo values, not yet surveyed".

### 5.2 Demo corridor and data (D5)

- Write a small script (`data/scripts/pick_demo_corridor.py`) that searches Elmina place pairs for: default route crosses one of the only three real `highway=steps` edges (`seg-1346147887-0`, `seg-1323093125-0`, `seg-430198556-0`; today `step_count` 1, status `reported`, so a wheelchair FAIL only once the corridor build gives it a placeholder claim with a plausible count). Never place steps where OSM has none. If no pair works, use a real crossing with a raised kerb and log a ruling; wheelchair route exists, adds 1–4 minutes, and runs mostly on paths. Print candidates; pick one and log a ruling with the pair.
- `access/overlay.geojson` is fully rewritten by `data/scripts/build_overlay.py` (part of `pnpm data:build`), so corridor claims are added **in that script** next to today's Car Park B → Playground P1/P2 claims, never by hand. Add `team_survey_placeholder` claims (`step_count`, `incline_pct`, `width_m`, `covered`, `kerb`, `seating` where sensible) to the segments of **both** demo routes, leaving exactly **one** stretch of 30–60 m on the recommended route without an incline claim (the unchecked stretch). Values must be plausible for the real place. Committed separately as `data: …`.
- Re-record the affected demo replays with the mock.

### 5.3 Web: split-screen playback

- Entry: the answer to a profile route question shows the existing **Watch trip** button (`journey/WatchTripButton.tsx`); with a `route.compare` intent it starts the compare playback.
- **Renderer:** one Three.js scene, two cameras, scissor viewports (left/right halves), divider line, a pill at the top of each half (route name, minutes). Merge to one overview camera at 31.5 s.
- **Walkers:** two wheelchair users (existing journey hero assets in a wheelchair pose, or a new chair prop), same speed. Playback speed is chosen so the recommended walker arrives at **29 s**. The fastest walker stops at the stop point.
- **Tags:** anchored HTML tags from the POIs (prototype `.tag` style); placeholder evidence shows "Demo value · not surveyed"; the unchecked tag reads "? Not checked yet · {attribute} on this {m} m · Not counted for or against".
- **Greeting:** one simulated resident near the recommended route, greeting only ("Selamat pagi! 👋" or similar), labelled "Simulated resident".
- **Ticket flight:** card flies from the unchecked stretch to a **Tickets chip** at the top right (counter 0→1), then a toast: "Survey ticket queued for staff · {Attribute} on {m} m of the recommended path is not checked yet. Checking it would confirm {N} wheelchair trips." The ticket appears on `/tickets`.
- **Reasons card** at the end (prototype `#reasons`): header "Recommended: the step-free route (+{d} min)", rows Steps, Steepest slope, Narrowest point, Covered from sun and rain, Rest stop on the way; footer "Reasons use checked facts only." + the unchecked line + "Demo values · not surveyed" when applicable. A row whose fact is unknown for a route shows "Not checked yet", never a guess.
- Reduced motion: no fly-overs; cut between beats. List view: the same reasons card and toast, no 3D.

### 5.4 Navigation timeline (baseline)

Times are seconds of playback. Beats tied to the route (tags, stop, ticket) fire when the walker reaches that point; with the demo corridor they must land within ±1.5 s of these times.

| t (s) | Beat |
|---|---|
| 0–3 | Split screen up, both pills, both walkers at the start, query chip "Wheelchair · {from} → {to}" |
| 3 | Both walkers start |
| 3–5.5 | Right: kerb tag |
| 4.5–7 | Right: covered walkway tag |
| 7–10 | Right: greeting bubble |
| 10–14 | Left: "Fastest" tag |
| 10.3–13.3 | Right: incline tag |
| 13.6–18 | Right: "? Not checked yet" tag over the unchecked stretch |
| 16.7 | Left walker stops at the stop point; red "Not passable · {value} {attribute}" tag until 31 |
| 17.6–19.4 | Ticket card flies to the Tickets chip; counter 0→1 at 19.4 |
| 19.4–25 | Ticket toast |
| 19.5–23 | Right: rest/seating tag |
| 29–31.5 | Right walker arrives; arrival tag |
| 31.5 | Merge to one overview with both routes |
| 32–45 | Reasons card |

## 6. Part C — Building: impact simulation

### 6.1 Backend (extend `devsim.py`; new `devsim_schedule.py`)

1. **Hoarding impact summary:** for every home (building) within 500 m of the site, route to its usual targets (mall, park, nearest school, nearest clinic) before and after the hoarded edges close. Report: homes with ≥2 min extra; the longest extra; wheelchair step-free links cut (homes whose wheelchair route turns `blocked` or `partly_unverified`); the same for each hoarding side option, with the best side. Today's single-home `DevsimDetour` stays for Halim's bubble.
2. **Lorry route:** `drive` profile route from the nearest major road to the site gate. List schools, kindergartens, parks and playgrounds within 50 m of the route with names. School hours line uses a fixed, labelled assumption ("school run 7–8 am, typical") unless data exists.
3. **Schedule and cost (`devsim_schedule.py`):**
   - **Research first** (owner wants sources): cost per m² GFA for high-rise condominiums in the Klang Valley from a published handbook (e.g. JUBM/Arcadis *Construction Cost Handbook Malaysia*, latest edition); typical structural floor cycle and foundation/fit-out durations from published Malaysian sources; Selangor public holidays 2027–2030 (gazetted list where published, otherwise expected dates labelled as such); northeast monsoon months and typical wet days per month for Petaling from MetMalaysia climatology. Record sources, editions and figures in `docs/04-architecture/devsim-estimates-sources.md`; credit them in the UI source line.
   - **Model:** inputs `storeys`, `homes`, assumed GFA per home (labelled input). Outputs: month-by-month floors, cumulative cost S-curve, total months, days lost to holidays (working days only) and to rain (monsoon wet days × fraction lost, labelled assumption), one Hari Raya site shutdown length (labelled assumption, e.g. 10 working days).
4. **Flood exposure at handover:** the lowest flood scenario (`stage_p1m`…`stage_p5m`) at which the tower entrance's route to the nearest major road crosses a `likely_flooded` edge; the nearest evacuation candidate and walk minutes (`osm_candidate` vs `official_pps` labels kept).
5. **Daily-life matrix:** walk minutes from the tower entrance to Urban Park, Lakeside Mall, nearest clinic, nearest school for `default`, `stroller`, `wheelchair`; a cell is "?" when the route is `partly_unverified` for that profile.
6. **40 simulated residents:** reuse the Elmina Day spotlight machinery (`day/spotlight.py` `choose`, `facts`, `check_text`). 20 from the tower households already synthesised in `devsim.py` (`synthesize(n_residents=round(homes × 3.8))`), 20 from homes within 500 m of the site. Keep today's five named cast members among them. Per resident: name, role, home side (tower/neighbour), colour; facts (extra walk during construction for neighbours, walk minutes to park/mall/clinic/school for their profile); three lines (construction, handover, daily life) from templates by persona × phase, numbers filled from facts and checked by `check_text`.
7. All of the above go into the development plan payload (`DevelopmentPlan`); `check_plan` extends to every new number.

### 6.2 Web

- **Timeline bar** (prototype `#tl`): Jan of start year → handover; monsoon bands; one tick per public holiday (tooltip with name); progress fill and a now-marker. Legend.
- **HUD** (prototype `#hud`): Month, Floors x/30, Spent (est.), Days lost; footnote "Estimate from published benchmarks".
- **Set pieces:** Hari Raya hold (site still, crane parked, workers gone, banner "Hari Raya Aidilfitri · site closed ~{n} days" with the schedule effect); monsoon stretch (rain, darker sky, crane stops on wet days, banner with days lost per month).
- **Construction detail:** hoarding, piling rig in the foundation phase, crane slewing with a swinging load, concrete mixers and lorries on the computed lorry route (route drawn), scaffold and green netting that rise with the floors, workers in high-vis, site lights at night if the existing day/night cycle is kept.
- **Move-in:** hoarding, crane and scaffold go; moving lorries arrive; boxes stack at the door; residents carry boxes in (visible walkers into the entrance); windows light up progressively with an occupancy counter; cars park in the car park; children at the nearest playground.
- **Cards:** hoarding impact card (prototype `#hoard`) with a "best side" row; lorry-route tag at the school; detour drawn red.
- **Impact Brief** panel (prototype `#brief`) from 33 s: During construction / At handover / Daily life, with badges ROUTE, FLOOD, ESTIMATE, CALENDAR. The camera view shifts so the tower stays clear of the panel.
- **Residents button** on the map from 33 s ("Simulated residents · 40", pulsing); panel with a 4-column list; detail view with facts block and three phase lines; back and close. Labelled "Simulated reactions" and "Lines are written for the simulation; every number comes from the world model."
- Bubbles keep today's component and style (`devsim/Bubble.tsx`).

### 6.3 Building timeline (baseline; replaces the 66 s devsim timeline)

| t (s) | Beat |
|---|---|
| 0–3 | Brief; hypothetical pill "Hypothetical tower · not an SDP project · {storeys} storeys · ~{homes} homes"; camera to site |
| 3.5 | Hoarding up; detour drawn |
| 4–9.5 | Hoarding impact card; detour tag |
| 5.5–9 | Bubble: Halim on the detour (ROUTE ENGINE tag, existing copy rules) |
| 8.5–12.5 | Lorry route drawn; tag at the school |
| 3–27 | Months advance 0 → handover month; floors rise from the foundation phase; HUD counts |
| 11–13 | Hari Raya hold and banner |
| 14–16.5 | Bubble: Farid "So noisy lah" |
| 18.5–23 | Monsoon stretch: rain, banner; 19.5–22.5 worker bubble "Hujan lagi, crane stop." |
| 27–30.5 | Handover banner; hoarding, crane and scaffold go |
| 27–33 | Move-in: lorries, boxes, residents in, windows light, cars park |
| 28.5–31.5 | Bubble: Mei Ling "We got our keys!" |
| 31–33 | Bubble: Halim "Eh, new neighbours ah? Welcome!" |
| 33 | Impact Brief slides in; residents button appears |
| 34–37 | Bubble: Zainab park line (ROUTE ENGINE tag) |
| 36.5–39 | Bubble: Arjun mall line (ROUTE ENGINE tag) |
| 39 | Residents panel opens (scripted tap) |
| 41 | Mei Ling's detail opens (scripted tap) |
| 45 | End; every control is interactive |

The month mapping follows the prototype's `KEYS` shape (hold at Hari Raya, slower through the monsoon), recomputed from the real schedule.

## 7. Test hooks

- Both playbacks expose `window.__tl.demo` in dev and e2e builds only: `seek(seconds)`, `play()`, `pause()`, `state()` (current beat ids, visible overlay ids, counters). Not shipped in production builds.
- Overlay elements carry stable `data-beat` attributes matching the beat names in §5.4 and §6.3.

## 8. Acceptance criteria

Every criterion has an id. The plan ([plans/2026-10-21-demo-polish.md](../plans/2026-10-21-demo-polish.md)) maps each task to the ids it must satisfy. "Hook" means the dev- and e2e-only `window.__tl.demo.state()` (§7). Times are in playback seconds.

### 8.1 Living city (Part A)

| Id | Criterion | How it is checked |
|---|---|---|
| AC-L1 | No agent reverses in place. Over 60 s of simulated time at 30 Hz, a heading change above 150° within any 2 s window happens only at a graph node of degree 1. Zero violations. | vitest property test on three road sets: the tiny fixture walk layer, a synthetic 5×5 grid, and a committed 1 km² Elmina walk extract (`motion/fixtures/elmina-hero-walk.json`) |
| AC-L2 | Vehicles really drive through junctions. On the 5×5 grid, at least 90% of vehicle agents traverse 3 or more distinct edges in 60 s; on the Elmina extract, at least 70%. | same test |
| AC-L3 | At a path end, a tile edge or an avoid zone, an agent fades to opacity 0 within 1.0 s and respawns elsewhere. It never turns round. | vitest on `poseAt` and the fade state |
| AC-L4 | In the running app (Stylised, Elmina, Medium, hero district), the hook counter `uturns` reports 0 mid-edge reversals over 60 s, with at least 40 vehicles and 60 people in view. | acceptance script `apps/web/acceptance/uturns.accept.ts`; numbers logged |
| AC-L5 | `kapchai`, `delivery_moto` and `bicycle` each contain a rider mesh: a seated figure, with a helmet on the two motor variants. `delivery_moto` also has a box. | `assets/blender/tests/test_specs.py` (the spec has `rider=True`); `test_committed_assets.py` (a node named `rider` is present for each variant and LOD) |
| AC-L6 | Bicycles spawn only on `street` edges, at 4.0–5.5 m/s, on the kerb side (lateral offset at least 0.35 × road width). Never on `major_road`, never in the people crowd. | vitest on `planAgents` |
| AC-L7 | No brand or model names anywhere in assets, specs, manifests, code identifiers or UI. Banned, case-insensitive: myvi, axia, bezza, saga, alza, vios, hilux, persona, x50, proton, perodua, toyota, honda, yamaha, ex5, y15. | vitest scan of `apps/web/public/city/**/manifest.json` and `apps/web/src/**`; pytest scan of `assets/blender/tl_assets/**`. Docs and this spec are excluded. |
| AC-L8 | Over 2,000 seeded spawns, the street traffic mix matches the §4 A4 shares within ±4 percentage points. Buses and lorries appear only on `major_road`. | vitest |
| AC-L9 | Per-variant triangle caps: cars and two-wheelers at most 3,000 (LOD0) and 400 (LOD1); bus and lorry at most 5,000 and 600. Vehicles kit at most 1.5 MB; `public/city` folder at most 12 MB. | the existing budgets in `test_committed_assets.py` pass |
| AC-L10 | Parked cars use only `compact_hatch`, `micro_hatch`, `small_sedan` and `mpv`. | vitest on `ground/parking.ts` |
| AC-L11 | At High quality with depth of field on, the circle of confusion is 0 at every depth nearer than the focus distance, in orbit and follow modes. | vitest on the `tiltShift.ts` params or CoC function |
| AC-L12 | Crowd people and vehicles write depth with their animated pose, or are excluded from the bokeh depth pass. No pass uses a bind-pose silhouette for them. | vitest asserting the bokeh skip list, or the depth material on the motion and crowd meshes |
| AC-L13 | Visual check at High: follow camera on the journey hero, with a crowd person 6–15 m from the camera. Screenshots of the same frame with FX on and FX off show the person equally opaque. The owner judges this in the comparison sheet. | comparison sheet rows L-1 and L-2 |

### 8.2 Navigation backend (Part B)

| Id | Criterion | How it is checked |
|---|---|---|
| AC-B1 | `compare_routes` is in `TOOLS`, making 22 tools. `test_tools_flood.py:13` and `packages/agent/tests/test_run.py:281` are updated, as are `AGENTS.md`, `packages/spatial/README.md` and the stale tool counts in `docs/`. | pytest; grep |
| AC-B2 | The result `data` has exactly these fields:<br>• `status`, `profile`, `same_path`<br>• `fastest` and `recommended` (Route dicts)<br>• `stop`: {`edge_id`, `at_m`, `attribute`, `value`, `limit`, `evidence_id`}, or null<br>• `reasons`: {`fastest`, `recommended`}, each with `steps`, `max_incline_pct`, `min_width_m`, `covered_share`, `rest_stops`, `distance_m`, `minutes`. A field is null when it is not known for that route.<br>• `extra_minutes`<br>• `unchecked`: [{`edge_id`, `attribute`, `start_m`, `end_m`, `length_m`}]<br>• `pois`: [{`kind`, `at_m`, `value`, `evidence_ids`, `demo`}]<br>• `vr`: {`id`, `created`, `target_id`, `attribute`}, or null<br>• `confirm_n`: int or null | pydantic model + pytest |
| AC-B3 | Unknown neutrality: whatever PASS values are assigned to the missing attributes of UNKNOWN edges, the recommended route id and every non-null reason value stay the same. | hypothesis test |
| AC-B4 | Every non-null reason value is derived only from edges whose evaluation for that attribute is known (PASS, or FAIL with a claim value). Each can be traced to evidence ids returned in the result. | pytest |
| AC-B5 | `stop` is the first edge along `fastest` that evaluates to FAIL under the requested profile. `at_m` is the distance from the start to that edge's start (±1 m). If there is no FAIL, `stop` is null. | pytest |
| AC-B6 | Reason values:<br>• `steps` = sum of known `step_count`<br>• `max_incline_pct` = max known incline<br>• `min_width_m` = min known width<br>• `covered_share` = covered length / route length, rounded to 0.05<br>• `minutes` = the route's `est_minutes`<br>• `extra_minutes` = recommended − fastest minutes (≥ 0) | pytest with a hand-built world |
| AC-B7 | `same_path` is true when both routes have the same edge sequence. In that case `fastest` equals `recommended` and `stop` is null. | pytest |
| AC-B8 | If the recommended route is `no_data`, `status` is `no_data`, with no VR and no stop, and the UI says "No mapped connection (data gap)". If it is `blocked`, `status` is `blocked`. | pytest + dom test |
| AC-B9 | Exactly one VR is filed, for the first unchecked stretch on the recommended route, through `create_verification_request` with args sanitised by `safe_vr_args`. Calling again returns the same VR id with `created=False`. The REST compare endpoint files none (`file_vrs=False`, like `POST /routes`). | pytest |
| AC-B10 | `confirm_n` equals the number of sampled wheelchair journeys that become confirmed if that fact passes, as computed by `impact.fact_impact` for the same element and attribute. | pytest cross-check |
| AC-B11 | `POST /routes/compare` returns the tool's `data`. After the commit, `pnpm gen && git diff --exit-code packages/api-client` is clean. | pytest api + CI step 5 |
| AC-B12 | In the mock, a question asking for a route with profile wheelchair, stroller or older_adult_rest calls `find_place` twice, then `compare_routes`. It emits `route.compare`, plus `route.highlight` of the recommended route for the List and Mapbox views. The answer passes `validate_answer`; if it cites placeholder evidence, the text contains "demo values, not yet surveyed". `template.py` produces a passing answer from the same record. | pytest agent; golden case `nav-compare-wheelchair` (world elmina) with `tools_include: [compare_routes]` and `intents_include: [route.compare]` |
| AC-B13 | Demo corridor. The chosen pair is recorded in a ruling. The fastest route crosses one of the 3 real `highway=steps` edges (`seg-1346147887-0`, `seg-1323093125-0`, `seg-430198556-0`), or, by ruling, a real raised-kerb crossing. The recommended route adds 1–4 min and has exactly one unchecked stretch of 30–60 m (incline). Every other recommended edge has known `step_count`, `incline_pct` and `width_m`. | pytest on the Elmina world (`world: elmina` marker) |
| AC-B14 | Corridor claims are produced by `data/scripts/build_overlay.py`, not by hand edits. Re-running the script reproduces `access/overlay.geojson` byte-for-byte. Every new claim has `evidence_type: team_survey_placeholder`. | pytest in `data/scripts/tests` |
| AC-B15 | Demo replays are re-recorded with the mock, and `test_demo_cache_current.py` passes. | pytest |

### 8.3 Navigation web (Part B)

| Id | Criterion | How it is checked |
|---|---|---|
| AC-N1 | On an answer with `route.compare`, **Watch trip** starts the compare playback. Answers without it keep today's journey playback unchanged: the existing e2e `heroes` and `pathStatus` still pass. | e2e |
| AC-N2 | Split screen with two viewports of equal width (±1 px) and a divider. The left pill reads "Fastest route · {fastest.minutes} min walking". The right pill reads "Recommended · step-free · {recommended.minutes} min"; the word "step-free" appears only when `reasons.recommended.steps == 0`. | dom test + e2e |
| AC-N3 | Beat timing:<br>• each row of §5.4 is visible (by `data-beat`) at the midpoint of its window, and hidden 0.5 s outside it;<br>• on the demo corridor, route-tied beats fall within ±1.5 s of the table;<br>• the recommended walker arrives at 29.0 ± 0.2 s;<br>• the fastest walker stops at `stop.at_m` ± 2 m. | e2e `demo-beats.spec.ts`, with a recorded `route.compare` fixture from Elmina |
| AC-N4 | Tags take their text from `pois`. Demo values show "Demo value · not surveyed". The unchecked tag reads exactly "? Not checked yet · {Attribute} on this {length_m} m · Not counted for or against". | dom test |
| AC-N5 | Ticket:<br>• the card flies for 1.8 ± 0.1 s from the unchecked stretch's screen point to the Tickets chip;<br>• the chip counter is 0 before 19.4 s and 1 after;<br>• the toast reads exactly "Survey ticket queued for staff · {Attribute} on {length_m} m of the recommended path is not checked yet. Checking it would confirm {confirm_n} wheelchair trips.";<br>• the Rail open-ticket badge goes up by one, and `/tickets` lists the VR;<br>• when `vr` is null, there is no flight, chip or toast. | e2e |
| AC-N6 | Reasons card:<br>• title "Recommended: the step-free route (+{extra_minutes} min)";<br>• rows Steps, Steepest slope, Narrowest point, Covered from sun and rain, Rest stop on the way;<br>• a null value shows "Not checked yet";<br>• footer: "Reasons use checked facts only.", then the unchecked line, then "Demo values · not surveyed" when any value shown is a demo value. | dom test |
| AC-N7 | At 31.5 s the view merges into one overview. The screen bbox of both routes lies fully above the top edge of the reasons card, with at least 24 px margin. | e2e via hook (`state().routesBbox`, `state().cardTop`) |
| AC-N8 | The greeting bubble text comes from a fixed list, contains no digits, and carries "Simulated resident". | vitest |
| AC-N9 | Reduced motion: no camera fly, but beats still appear in order. List view: the reasons card and toast appear, with no 3D and no split. | dom test + e2e (List view is the e2e default) |
| AC-N10 | Play/pause, Replay, scrub and Exit trip work. Exit trip returns the map to the normal route view. | dom test |
| AC-N11 | No banned words (`test/honesty.ts` BANNED, DEPTH) in any new navigation copy. | vitest |

### 8.4 Building backend (Part C)

| Id | Criterion | How it is checked |
|---|---|---|
| AC-C1 | Hoarding summary over every residential building within 500 m of the site, with targets Lakeside Mall, Urban Park, nearest school and nearest clinic. Fields:<br>• `homes_considered`<br>• `homes_2min_plus`<br>• `max_extra_min`<br>• `wheelchair_links_cut`: homes whose wheelchair route to any target becomes `blocked` or `no_data`<br>• one option per hoarding side, with the same fields<br>• `best_side` | pytest on a synthetic world with a known answer + Elmina smoke test |
| AC-C2 | Lorry route: `drive` profile from the nearest `major_road` node to the site gate. `sensitive` lists, by name, the schools, kindergartens, parks and playgrounds within 50 m of the route. `school_run_note` is the labelled assumption string. | pytest |
| AC-C3 | `docs/04-architecture/devsim-estimates-sources.md` lists every figure used: value, unit, source title, edition or year, URL, date accessed, and whether it is gazetted, a published benchmark or an assumption. No figure appears in code without a row. | pytest reads the doc's table and compares it with `devsim_schedule.SOURCES` |
| AC-C4 | Given storeys and homes, the schedule model outputs:<br>• `months_total`, `floors_by_month`<br>• `cost_total_rm`, `cost_by_month` (a monotonic S-curve)<br>• `holidays`: [{date, name, status gazetted/expected}]<br>• `holiday_days_lost` (working days only), `rain_days_lost`<br>• `raya_shutdown_days` (assumption), `monsoon_bands`<br>Unit tests reproduce the sourced inputs exactly. | pytest |
| AC-C5 | Flood: `cut_from_scenario` is the lowest of `stage_p1m`…`stage_p5m` at which the route from the entrance to the nearest major road crosses `likely_flooded`; null otherwise ("not cut up to +5 m"). Also reports the nearest evacuation candidate, with walk minutes and its `osm_candidate` or `official_pps` label. | pytest |
| AC-C6 | Daily-life matrix. Rows: Urban Park, Lakeside Mall, nearest clinic, nearest school. Columns: default, stroller, wheelchair. Each cell is minutes; "?" when that route is `partly_unverified`; "gap" when it is `no_data`. | pytest |
| AC-C7 | Exactly 40 residents:<br>• 20 `tower` and 20 `neighbour`, including Halim, Farid, Mei Ling, Zainab and Arjun;<br>• unique ids and names;<br>• each has facts and three lines (construction, handover, daily_life);<br>• every line passes `check_text` against that resident's facts and is at most 220 characters;<br>• no two residents share all three lines;<br>• the same seed gives identical output. | pytest |
| AC-C8 | `DevelopmentPlan.total_s == 45`, and bubbles and acts match §6.3. The school-run envelope beat is gone. `check_plan` covers every new number. The fixtures `plan.elmina.json` and `e2e/fixtures/devsim-plan.json` are regenerated, and the equality test at `test_devsim.py:339` passes. | pytest |

### 8.5 Building web (Part C)

| Id | Criterion | How it is checked |
|---|---|---|
| AC-W1 | Timeline bar:<br>• one tick per `holidays` entry; the tooltip is the name, plus "expected" when the date is not gazetted;<br>• the one Hari Raya set-piece tick is emphasised;<br>• monsoon bands come from `monsoon_bands`;<br>• the now-marker month equals the HUD month. | dom test |
| AC-W2 | At t = 8, 21 and 30 s, the HUD shows the plan's month, floors, cumulative cost and days lost for that month, formatted "RM {n} M" and "{n} d", with the footnote "Estimate from published benchmarks". | e2e via hook |
| AC-W3 | At t = 12 s: the Hari Raya banner is visible; the crane jib yaw changes by less than 0.5° over 1 s; workers and lorries are hidden. At t = 21 s: the monsoon banner is visible, rain is on, and the crane is stopped on wet beats. | e2e via hook (`state().crane.yaw`, `state().rain`) |
| AC-W4 | Construction detail:<br>• the piling rig is visible from 3.5 to 8.5 s;<br>• lorries move along `lorry_route`, each within 3 m of the route polyline;<br>• the scaffold top is the top built floor + 1 floor (±0.5 m);<br>• netting is visible while floors < total. | hook |
| AC-W5 | Move-in, between 27 and 33 s: at least 2 moving lorries, 8 boxes and 10 residents walking into the entrance. The lit-window share rises monotonically to at least 0.85 by 33 s. At least 6 cars are parked. After 32.5 s, at least 4 children are at the nearest playground. | hook |
| AC-W6 | From 33 s, the Impact Brief shows sections During construction / At handover / Daily life, with badges ROUTE, FLOOD, ESTIMATE and CALENDAR. The tower's screen bbox does not overlap the panel. | dom test + e2e |
| AC-W7 | Residents:<br>• the button appears from 33 s; the panel opens at 39 s and Mei Ling's detail at 41 s;<br>• the list has exactly 40 entries;<br>• the detail shows the facts block, three phase lines, "Simulated reactions" and the footnote;<br>• Back and Close work; Tab, Enter and Escape work; focus returns to the button on close. | dom test (jsdom) + e2e |
| AC-W8 | Bubble windows match the plan exactly (±0.05 s) and §6.3. | e2e |
| AC-W9 | "Hypothetical tower · not an SDP project" is visible throughout. Every estimate shows ESTIMATE, and holiday dates that are not gazetted show "expected". No banned words. | dom test |

### 8.6 Performance

| Id | Criterion | How it is checked |
|---|---|---|
| AC-P1 | Compare split screen at Medium: median frame at most 1.3 × today's single-view journey median, and p95 at most 33 ms (headless, same machine, same seed). | `__tlAcceptance.measure`; numbers logged in the overnight log |
| AC-P2 | Building move-in at Medium: p95 at most 33 ms, at most 150 draw calls and at most 2.5 M triangles. | same |

### 8.7 Process

| Id | Criterion |
|---|---|
| AC-X1 | All seven CI checks pass on the merged branch, each reported as PASS, FAIL, BLOCKED or NOT RUN. |
| AC-X2 | The comparison sheet has 16 rows (8 per demo) plus L-1 and L-2. Every row is marked "matches", or "differs as expected" with a reason. |
| AC-X3 | Two 45 s recordings (mock LLM, Stylised view, demo corridor). |
| AC-X4 | Commits follow §10, data commits are separate, and rulings are logged. |

## 9. Verification and owner gate

1. **Comparison sheet:** at 8 timestamps per demo, screenshot the prototype and the app side by side; mark each "matches / differs as expected (real map, real art) / missing". Published as a private artifact for the owner. Missing items are fixed before the gate.
2. **Recordings:** a 45 s video or GIF of each demo (mock LLM, Stylised view, demo corridor).
3. **Report:** each CI check as PASS / FAIL / BLOCKED / NOT RUN; which results are mock-backed; implemented vs pushed vs merged state; the estimate sources table.
4. **Owner gate:** the owner watches both recordings and the sheet; "pass" closes the round.

## 10. Execution

- Branch `feat/demo-polish` (created from `main` with the spec, plan and prototype commit). Lanes as worktrees under `../SunNiuBi-wt/dp-<lane>`: `dp-3d` (A1, A3, B and C 3D), `dp-assets` (A2, A4 Blender), `dp-be` (B backend, C backend, data), `dp-fe` (overlays, panels, HUD, timeline). At most two lanes building at once (8 GB machine).
- Plan: `docs/superpowers/plans/2026-10-21-demo-polish.md`; ledger in `.superpowers/sdd/demo-polish/`; log in `docs/superpowers/overnight-log.md` with real timestamps.
- Commits: conventional with scope; data separate from code; `pnpm gen` output committed with the API change.

## 11. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Junction graph across streamed tiles is costly | Graph per tile; fade/respawn at tile edges (still no in-place U-turn) |
| No Elmina pair gives a convincing stop point | Use a kerb (`kerb=raised`) or width FAIL instead of steps; log a ruling |
| Split screen halves the frame rate | Lower pixel ratio and shadow size during compare; drop AO in compare mode |
| Cost or holiday sources not found for some years | Show only the sourced figure with its year; label the rest "expected"; never invent |
| 40 template sets read repetitive | Persona × phase × tone variants, seeded per resident; owner reviews a sample in the sheet |

## 12. Out of scope

- Real field survey of the demo corridor (can replace D5 later).
- Live LLM resident lines.
- Realistic (Cesium) view for either demo; both run in Stylised, with List as fallback.
- Changes to flood modelling or routing evaluation rules.
