# T-031 Marathon cinematic (cloud Claude) · T-032 Flood cinematic (Codex)

- **Status:** assigned · **Priority:** P0 for the demo video (23 Oct) · **Cut-off:** 07:00 MYT 23 Oct (22:59 UTC 22 Oct). Control merges whatever is green and screenshot-checked by then.
- **Source:** Yunzhe, 22 Oct 21:45 MYT: "we need the same animation as shaoxian's route video, but ONE camera (no split screen; split is only for his route compare). Current front end is ugly: same colour greys out the area, marathon is just a red line." Decision: one story per agent.

## Reference: shaoxian's route animation (match this look)
Overview with a mini-map inset → camera follows the traveller at street level → HUD (clock, metres, minutes, counters) → tags anchored in 3D where something happens ("Lowered kerb", "Covered walkway starts") → Pause / Restart / Exit with scrubber → "Simulation · indicative" label. **Reuse his code, do not build a new engine:** `apps/web/src/features/journey/` (JourneyHud, JourneyMiniMap, JourneyControls, SimulationLabel, cardTrack, cardPlacement, followCamera, heroDriver, safeFrame), `features/scene/three/journey/followRig.ts`, the anchored-tag code in `scene/three/compare/` (single camera only), `src/ui` tokens. Light + dark.

## Problems to fix (from Yunzhe's screenshots)
- Low-lying areas render as raw 30 m square blocks with an orange hatch over everything (roads, buildings): looks pixelated and hides the city.
- River-flooded areas are flat blue/purple fills.
- Marathon is a flat red line; no motion, no story.

## T-031 Marathon cinematic — cloud Claude (extend "Watch the marathon")
1. **Course reveal (≈3 s):** the course draws itself from the start (animated ribbon with soft glow, not a flat line); start/finish arch markers; km markers 1…N; road names fade in along the course.
2. **Closures:** closed roads as red-white barrier stripes; small cone/barrier props at the closure-boundary junctions; tag "Closed 06:00–10:00" (window from the tool).
3. **Follow the lead runner** (followRig, one camera) along the course; HUD: simulated clock, km run, roads closed N, sample trips rerouted N of 300 (numbers from the tool only).
4. **Cut to one sample car** (animation.rerouted_trips[0]): follow it on the after-route, the before-route as a grey ghost; tag "Detour +X m · +Y min" from the tool's numbers; detour roads show flowing arrows, width/colour by pressure band.
5. **Suggestions as tags** at their locations where the tool gives one ("Marshal suggested here"), else in the end card.
6. **End card** (overview): course, counts, suggestions; "Simulation · illustrative — runners and cars are not crowd sizes, vehicle counts or delays".

## T-032 Flood cinematic — Codex (web + data)
1. **Low-lying shapes:** replace square blocks with smooth outlines (e.g. polygon smoothing/buffer-in-buffer-out in `data/scripts/build_lowlying.py` output, or render-side smoothing), clipped to the township boundary, soft translucent fill + thin outline, drawn under buildings/roads (no hatch over roofs). Class stays `possible`; never drawn as water.
2. **River rises:** a "Watch the river rise" playback: Normal → +1 → +2 → +3 m, each stage fades in river-flooded areas (soft animated water look on `likely_flooded` river polygons only, never on low-lying terrain), "!" markers pop as places flood, HUD counters tick (places likely flooded, cut off, km of paths) from `/scenarios/{id}/affected`. "Indicative scenario, not a forecast" always visible.
3. **Follow one resident** (one camera, journey follow rig): a wheelchair user from a residential place to the nearest evacuation centre at +3 m (existing route + evacuation tools/API); tag at the flooded stretch "Likely flooded (indicative) — route goes around"; HUD minutes/metres from the route; centre labelled as the API gives it (`osm_candidate` ≠ official).
4. **End card:** counts + limits text (30 m surface model, drains not modelled, flash floods from heavy rain not shown) + official MBSA / JPS / NADMA pointer.

## Rules (both)
- Honesty invariants (AGENTS.md): no "safe", no water depth, no jam minutes/vehicle counts, low-lying never as water, residents never see pressure, everything labelled "Simulation · illustrative / indicative".
- Display only: numbers on screen come from tool/API results, never invented.
- Lanes: Claude = marathon files + shared journey helpers it must extend; Codex = flood files + `data/scripts/build_lowlying.py` (+ regenerated `data/seed/elmina/flood/lowlying.geojson`, data in its own commit). If you must touch a shared file (sceneStore, SettingsPopover, journey/*), keep the change small and say so in the PR.
- Branch from `origin/claude/sweet-davinci-29v7ne`; merge it again before each PR. One PR per tested step into `claude/sweet-davinci-29v7ne`.
- Checks (`set -o pipefail`): lint, typecheck, `pnpm -r --if-present test`, `uv run pytest -q` if Python changed, gen drift, golden, build. e2e runs in CI.
- **Screenshot gate:** each PR has light + dark screenshots (Stylised 3D, 1440×900) of every new shot, plus a short frame strip (3–4 frames) of each animation.
- Checkpoints: first PR (static polish: shapes/ribbons/barriers) by 01:00 MYT; animation PR by 05:00 MYT; cut-off 07:00 MYT.

## Log
- 2026-10-22 13:50 UTC · control · Created.
