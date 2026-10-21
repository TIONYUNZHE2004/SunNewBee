# MVP status audit (2026-10-15, main fd95b24)

> Row-by-row status of every P0/P1 item in [mvp-spec.md](mvp-spec.md), audited against the code. Next work for the team: [../05-team/handoff-2026-10-15.md](../05-team/handoff-2026-10-15.md). Abbreviations in file paths: `SP/` = `packages/spatial/src/townshiplens_spatial/`, `AG/` = `packages/agent/src/townshiplens_agent/`, `API/` = `apps/api/src/townshiplens_api/`, `WEB/` = `apps/web/src/features/`.

## Counts (68 rows: 39 P0, 29 P1)

| | DONE | PARTIAL | MISSING | N/A-FIELD | Total |
|---|---|---|---|---|---|
| P0 | 32 | 5 | 0 | 2 | 39 |
| P1 | 15 | 8 | 5 | 1 | 29 |
| All | 47 | 13 | 5 | 3 | 68 |

Audit 1 for comparison: 18 DONE / 32 PARTIAL / 17 MISSING / 1 N/A-FIELD. Split-priority rows (F-06, B-03, M-05, P-07) are counted once, at the higher priority.

Status rules used: DONE needs the acceptance criterion met with a test or recorded evidence. N/A-FIELD is used only when the code side is complete and what remains is a device, field or partner-data step (P-01, AX-05, P-07). Where a row is DONE with a limitation, the limitation is in the note.

Findings that cut across rows:
1. All access facts on the Elmina seed are still `team_survey_placeholder` (25 overlay features: 18 lines, 7 points; 0 `entrance` places, 4 toilets, 6 seating, 20 shelter, 39 parking). Labelling is honest (`demo_evidence` flag, "confirmed (on demo values, not yet surveyed)", gap map `demo_count`), but nothing on the seed is truly verified until the survey.
2. `text.delta` is still chunked (40 chars) after the forced `final_answer` has validated (`AG/run.py:33,130`). First-token latency is the full model latency.
3. The `drive` profile now works (Task 26) but its overlay is drawn wrong: `evaluate_edge` returns FAIL for every non-road edge, and `API/geojson.py:16,41` maps FAIL to "blocked", so under `drive` every footway shows red "Not passable" instead of grey "not relevant".
4. The seed has 7 waste points, all `unknown`, all bulk-derived from OSM. There is no resident-facing write path at all (no "Report an issue", no question log).
5. Nothing in the app can produce `official_pps` at runtime. It only comes from the build script's exact-name match (`data/scripts/build_flood.py:109,654`), and the seed has 72 `osm_candidate` and 0 `official_pps`.

## P0 rows

| ID | Title | Status | Evidence pointer | Gap / note |
|---|---|---|---|---|
| P-01 | 3D hero view | N/A-FIELD | `WEB/scene/cesium/CesiumScene.tsx:52` (Google photoreal tileset), overnight log 13:23 (bundle: 137 KB gz initial, Cesium 1.2 MB gz lazy) | Renders and was browser-verified. The criteria "under 6 s on 4G", the mid-range Android test and touch orbit need a device. The 1-2 s transfer figure is an estimate. |
| P-02 | Scene intents drive camera and layers | DONE | `AG/events.py:10,14`, `WEB/scene/sceneStore.ts:22,61`, `sceneStore.test.ts:6`, `AG/demo.py:33` | One intent set, one store, adapters per renderer. Demo replay re-emits `scene.intent`. |
| P-03 | Lens switcher and layer toggles | DONE | `app/ResidentPage.tsx:14-46`, `WEB/chat/suggestions.ts:10-26,31-35`, `suggestions.test.ts:7` | Multi-toggle rather than a single switcher. Chips follow the active lens (flood, then waste, then access). Base city stays. |
| P-04 | Place markers, tap opens the card | DONE | `WEB/scene/cesium/CesiumScene.tsx:146-158`, `cesium/layers.tsx:156,282,328`, `mapbox/MapboxLite.tsx:251`, `PlaceCard.dom.test.tsx` | Access places, evacuation centres and waste points are all tappable in Cesium and Mapbox (Task 32). Seed has 0 `entrance` places (see AX-05). |
| P-05 | Profile selector | DONE | `config/profiles/drive.yaml`, `SP/evaluate.py:111`, `test_routing.py:38`, `test_flood.py:153`, `WEB/scene/SceneHost.tsx:95` | `drive` is a real profile since Task 26. Visual defect: see cross-cutting finding 3 and AX-01. |
| C-01 | Chat streaming | PARTIAL | `AG/run.py:33,130` | Tool events stream live; answer text is chunked after validation. The "first token under 2 s p50" criterion is unmeasured and cannot hold with a live model. No timing test exists. |
| C-02 | Grounded answers, cited | DONE | `AG/validate.py:97-103` (claim without evidence rejected), `test_validate.py:256,265`, `evals/run_golden.py:57-70` (`answered_without_citations`), 13 golden cases | The validator guarantees every claim cites a tool-returned id. Limits: the check is on claims, not on whether the summary prose is covered by claims. The golden set is mock-only and runs on the tiny fixture; `GOLDEN_REAL=1` was not run (costs money). |
| C-03 | Route status always shown, unknown segments named | DONE | `AG/run.py:39-49,119-125` (first line `Route status: …`), `test_run.py:666` (confirmed, partly, blocked, no_data), `test_run.py:815`, golden `status-label-*` | Readable labels ("partly unverified", "no mapped connection (data gap)"). Unknown items use element names or "an unnamed footway" (`AG/labels.py`), never `seg-` ids (validator `RAW_ID`). |
| C-04 | Evidence cards (photo, source, date) | DONE | `WEB/chat/EvidenceCard.tsx:41`, `EvidenceCard.test.tsx:19`, `API/routes/evidence.py:140`, `test_evidence.py:141` | Thumbnail links to the full-size photo (new tab) with source and date. Placeholder shows "Demo value · not surveyed". The seed holds no photos yet; the mechanism is tested. |
| C-05 | Abstain plus VR | DONE | `AG/template.py:16-31`, `test_template.py:116,121`, `AG/agent.py:119-138` (`safe_vr_args`), golden `unknown-place`, `e2e/heroes.spec.ts:29` | The cannot-answer text names the unresolved query or the missing attribute. VR create/upvote shows in the staff queue. |
| C-06 | 10 tools plus forced `final_answer` (22 tools as of 2026-10-22) | DONE | `SP/tools.py:768`, `test_tools_flood.py:12`, `AG/agent.py:41,260` | Model ids come from env only. The ADR and "3 golden questions per new tool" rule is process only. |
| C-10 | `DEMO_MODE` cache | DONE | `AG/demo.py:33`, `AG/run.py:219-224` (cache miss while a closure is active), `packages/agent/tests/test_demo_cache_current.py:40,50`, 16 files in `data/demo/` | Offline replay, world-tagged, replay-diff test against the current mock passes. |
| AX-01 | Overlay colours by status | PARTIAL | `API/geojson.py:16,41`, `WEB/scene/styles.ts:14-27`, `StatusLegend.tsx` | Green ("No known barrier", deliberately not "verified"), amber and red come with patterns and a text legend. Missing: the grey "not relevant" state. Under `drive`, every footway is painted red. |
| AX-02 | Route highlight plus fly-to | DONE | `WEB/scene/cesium/camera.ts`, `sceneStore.test.ts:6`, `DeepSpots.tsx:20-35` | The route polyline appears but is not animated (cosmetic, P2 at most). |
| AX-03 | Tri-state attributes with provenance | DONE | `SP/models.py:18-60`, `WEB/places/placeModel.test.ts`, `PlaceCard.tsx` | |
| AX-04 | Routing per profile, status per class | DONE | `test_routing.py:6,12,18,23,191,199` (confirmed, partly, no_data, blocked), `test_evaluate.py` | 80+ routing tests, including rest, major road and drive. |
| AX-05 | Site facts surveyed on site | N/A-FIELD | `data/seed/elmina/access/overlay.geojson` (25 features), `data/seed/elmina/access/README.md` | 0 entrances in the seed, all facts are demo placeholders. Needs the field visit. |
| AX-06 | VR loop, J5 before to after | DONE | `apps/api/tests/test_manage.py:13` (`test_vr_flow`: route becomes confirmed), `test_evidence.py:141`, `e2e/heroes.spec.ts:40` (staff corrects a fact; request leaves the queue) | The e2e result at HEAD is unverified by me. |
| F-01 | Scenario bar plus permanent disclaimer | DONE | `WEB/flood/ScenarioBar.tsx:77`, `ScenarioBar.test.tsx:7`, `DisclaimerBanner.tsx`, `ResidentPage.tsx` | Presets only (no slider). The UI changes the store, and the chat emits `flood.set_level`; equivalent. Labels end "(indicative)". |
| F-02 | Water render | DONE | `WEB/scene/cesium/layers.tsx`, `API/routes/flood.py:17`, `test_flood_api.py:7,15` (datum offset), `site.json` `datum_offset_m` -3.74 | Browser-verified in the log (02:23, 03:04). Hydrology comes from the DEM only. "Calibrated once at the lake" is recorded as a constant. |
| F-03 | Edge colouring by flood class | PARTIAL | `API/geojson.py:15,41-52`, `WEB/scene/styles.ts:18-27`, `WEB/flood/FloodPathPopover.tsx:73` | Red, dashed orange and patterns are done, and a possible class is read from the profile (`SP/evaluate.py:111`). Missing: the margin is in the "Why this path?" popover only; the legend (`StatusLegend.tsx`) does not show it. |
| F-04 | Re-route with scenario, 5 profiles | DONE | `test_evaluate.py` (`test_flood_never_upgrades_unknown`), `test_routing.py:33,91` (`test_drive_flood_cut_road_is_blocked`), `test_flood.py:34,153` | `drive`: possible and likely are both FAIL. |
| F-05 | Evacuation reachability, labelled | DONE | `SP/flood.py:152`, `test_flood.py:41`, `test_tools_flood.py:33,101,109`, `SP/tools.py:123` | 72 candidates, 0 official. Closed centres are never "reachable" (Task 55). |
| F-06 | Affected places and islands | DONE | `SP/flood.py:77`, `test_flood.py:62,98,106,180` | |
| F-07 | Disclaimer on every scenario answer; "safe" never produced | DONE | `AG/run.py:195-203`, `test_run.py:79,224,348`, `AG/validate.py:10,229`, golden `adversarial-safe` | Emitted by construction when a scenario tool ran, the answer names a scenario or the UI has one active. The word and depth bans are in the validator. |
| G-01 | Personas as versioned profiles | DONE | `config/profiles/*.yaml` (5), `SP/profiles.py:10`, `test_world.py:19` | Versioned by git; no version field. |
| G-03 | Batch runner | DONE | `SP/sim.py:190`, `test_sim.py:14`, `API/routes/sim.py:248`, `test_sim_api.py:33,280,291` | Background run with 202, polling, cancel and a time budget. |
| G-04 | Gap ranking with "create VR" | DONE | `SP/sim.py` (gap ranking, what-if re-run), `WEB/manage/JourneyTests.tsx:395`, `CreateVrButton.tsx`, `createVr.test.tsx`, `test_manage.py:116` | |
| B-01 | Graph schema, tri-state, provenance | DONE | `SP/models.py:18-60`, `test_models.py:4,9` | |
| B-02 | Base twin from open data, one command | PARTIAL | `data/scripts/import_osm.py:19` (bbox `ENVELOPE`), `package.json` `data:build`, `data/seed/elmina/base/` | Walks, majors, places and hydrology are there. Missing: no buildings (the 3D city is Google or Cesium OSM tiles), a plain bbox with no polygon clip, and no counts logged against research § 2.2. |
| B-03 | Flood pipeline | PARTIAL | `data/scripts/build_flood.py:770-780` (provenance fields), `data/seed/elmina/flood/scenarios.json` (`method`, `dem`, `margin_m`, `created`) | Scenarios, edge classes with margin and evacuation analytics are done (REM replaces HAND per ADR 0010 amendment). Missing from the provenance: git hash or any content hash, and a "threshold" field. Reproducing needs the network (DEM, Overpass). pysheds recompute dropped (the P1 part). |
| B-04 | Drivable road graph | DONE | `config/profiles/drive.yaml` (`allowed_types`, `speed_kmh`, standing warning), `test_routing.py:38,54,63,91,582`, `test_tools_flood.py:101,109` | Derived from the walk extract's `street`/`track`/`major_road` edges, not OSMnx. No one-way or turn data, so a drive route is never `confirmed` (standing warning). Meets "used by `plan_route(profile=drive)`". |
| B-05 | Candidate centres, `official_pps` only with evidence | DONE | `data/seed/elmina/flood/evac_centres.geojson` (72 `osm_candidate`), `data/scripts/build_flood.py:109,654`, `SP/tools.py:123` | Mechanism is build-time only. See M-09: staff cannot promote a centre. |
| B-06 | Scenario store plus REST | DONE | `API/routes/flood.py:12,17,33,41`, `test_flood_api.py:7-33` | `pnpm gen` drift check is in CI. |
| B-07 | Evidence storage, EXIF stripped | DONE | `API/routes/evidence.py:121,140`, `API/imagestrip.py`, `test_evidence.py:51,68,96,141,202`, `test_imagestrip.py` | Stdlib JPEG/PNG stripping (no Pillow), magic-byte typing, 5 MB cap, random file name. "Faces avoided or blurred" is a survey-protocol rule, not code. |
| B-09 | Per-lens layers, gzip plus ETag | DONE | `API/routes/core.py:78,175` (`_etag`, `layers`), `test_core.py:99,122`, `API/main.py` (GZip) | Measured above: access 443 KB gz. ETag covers world version, boot nonce, live closures. |
| M-01 | VR queue, ranked, filtered | DONE | `SP/vr_store.py:68-88` (demand DESC, age ASC; filters), `API/routes/manage.py:70`, `WEB/manage/queueFilters.ts`, `queueFilters.test.ts`, `VerificationQueue.dom.test.tsx`, `test_manage.py:90` | Open/Resolved/All tabs, reason, attribute and element filters. No "lens" filter (not needed for the demo). |
| M-02 | Resolve with evidence upload | DONE | `API/routes/manage.py:153-232`, `test_evidence.py:141,237`, `WEB/manage/ResolveForm.dom.test.tsx:33,41,57`, `test_manage.py:29,40` | Verify, correct and reject; audit row; race-safe under `world_lock`. |
| M-03 | Attribute editor | DONE | `API/routes/manage.py:234`, `test_attributes.py:28,42`, `WEB/manage/AttributeEditor.tsx`, `AuditHistory.tsx` | |

## P1 rows

| ID | Title | Status | Evidence pointer | Gap / note |
|---|---|---|---|---|
| P-06 | Lite 2.5D view | PARTIAL | `WEB/scene/mapbox/MapboxLite.tsx:15-16,251`, `SceneHost.tsx:15-19,121-137` | Manual toggle with access, route, flood, centres and waste. Missing: automatic fall-over to Mapbox when Cesium or WebGL fails (`RendererBoundary` falls back to the list only). `mapbox-gl` is proprietary-licensed (R25 flag, still open). |
| P-07 | List / text view | N/A-FIELD | `WEB/scene/list/ListView.tsx`, `listModel.ts:46` ("Unnamed footway"), `LensSections.tsx`, `e2e/heroes.spec.ts:72,93` | Code complete: numbered steps, scenario, closures, evacuation and waste sections, gap list, no keys needed. Only the VoiceOver/TalkBack check is open. |
| P-08 | Fallback chain Google to OSM Buildings | PARTIAL | `WEB/scene/cesium/CesiumScene.tsx:50-58,66-70` | Chosen by which key exists. If Google tiles fail, the code shows a notice and the bare globe; it does not try Cesium OSM Buildings. `site.json` `scene.fallback` is not read by the web app. |
| P-09 | Deep-spot shortcuts | DONE | `WEB/scene/DeepSpots.tsx:20-40`, `deepSpots.test.ts:21`, `DeepSpots.dom.test.tsx:39` | |
| C-07 | Suggested questions per lens | DONE | `WEB/chat/suggestions.ts:10-26`, `suggestions.test.ts:7`, `packages/agent/tests/test_inapp_prompts.py` | 4 / 3 / 1; the mock answers every chip on the seed. |
| C-08 | Multilingual | PARTIAL | `AG/prompts/system.md` rule 8, `AG/validate.py:10` (BM/ZH banned words), `SP/tools.py:37` (CJK place matching), `test_tools_access.py:105`, `WEB/manage/advisory.ts` (3-language advisory) | The model is told to reply in the user's language. Missing: no BM/ZH aliases on the Elmina seed (only on the tiny fixture), mock is English-only, no BM/ZH golden, no "identical tool calls across languages" check, UI is English-only. Deprioritised by the team lead. |
| C-09 | "Report an issue here" | MISSING | `SP/models.py` (`user_report` reason exists), `WEB/manage/attributeForm.ts:11` | No resident endpoint, no button on the place card. |
| AX-07 | Closures | DONE | `SP/closure_store.py`, `SP/tools.py:564`, `API/routes/closures.py:79-117`, `test_closures.py:24,32`, `test_closures_api.py:20` | Takes effect at once (ETag, version bump); expiry follows the clock. |
| AX-08 | Rest-point logic | DONE | `SP/routing.py` (`_rest_search`), `test_routing.py:266,299,351,376`, `test_sim.py:73,84` | Limit is 100 m (stricter than the 150 m flag); wording "Longest stretch without a rest point is about N m". |
| AX-09 | Gap map | DONE | `API/routes/core.py:148` (`/layers/gaps`), `test_gaps.py:38,51`, `WEB/gaps/gaps.dom.test.tsx:46`, `gapModel.test.ts` | Demo values count as gaps (`demo_count`), never "Fully checked" (Task 55). |
| F-08 | "Why this path?" popover | DONE | `WEB/flood/FloodPathPopover.tsx:73`, `FloodPathPopover.dom.test.tsx:56,66`, `floodPath.ts` | Bands, no depths. |
| F-09 | Management flood briefing | DONE | `WEB/manage/FloodBriefing.tsx:42-113`, `comparison.test.tsx:41,57`, `API/routes/flood.py:54` | Baseline vs scenario columns; one profile at a time; start point is the demo origin `lakeside-mall`. |
| F-10 | Advisory draft | DONE | `WEB/manage/advisory.ts`, `advisory.test.ts` | Editor only, no send path. |
| F-12 | "Where can I go?" shortcut | DONE | `WEB/flood/ScenarioBar.tsx:69`, `ScenarioBar.test.tsx:28,34`, `packages/agent/tests/test_inapp_prompts.py` | |
| F-16 | Versioned thresholds shown | PARTIAL | `WEB/manage/Assumptions.tsx`, `comparison.ts` (`assumptionRows`), `API/routes/core.py:65` (`/profiles`) | Profile thresholds from YAML are shown, labelled "our engineering default (no published source)". Missing: the flood margin and stage parameters (`scenarios.json` `margin_m`, not YAML) are not listed in Assumptions. |
| W-01 | Waste points, 20-40 curated | PARTIAL | `data/seed/elmina/waste/points.geojson` | 7 points (5 `bin`, 2 `programme_site`), all `unknown`, source = the OSM object. No recycling, e-waste or composting subtypes. Needs desk or field curation, not code. |
| W-02 | `find_waste_points` plus waste layer | DONE | `SP/tools.py:739`, `test_tools_flood.py:38`, `test_core.py:38,50`, `cesium/layers.tsx:328`, `mapbox/MapboxLite.tsx:299`, `LensSections.tsx` | Cesium, Mapbox and list. |
| W-03 | "Collection day unknown, ask MBSA" card | PARTIAL | `WEB/places/SourceBanner.tsx:46-58`, `placeModel.ts:161`, `WEB/lib/evidence.ts:22` | The card and the MBSA link exist. Missing: "the gap becomes a VR". Nothing files a collection-day VR (the mock only adds a "ask MBSA" caveat, `AG/mock.py:498`). |
| W-04 | 5-8 waste golden questions | PARTIAL | `evals/golden/hero.yaml:28-35` (2 waste cases), `packages/agent/tests/test_inapp_prompts.py` (waste chip) | 2 of the 5-8 wanted. |
| M-04 | Closures UI | DONE | `WEB/manage/Closures.tsx`, `Closures.dom.test.tsx:32,52`, `WEB/scene/list/closures.dom.test.tsx` | |
| M-05 | Flood briefing view | DONE | see F-09 | |
| M-06 | Recurring-questions view | MISSING | none | Needs B-08. |
| M-07 | KPI tiles | DONE | `API/routes/manage.py:116`, `test_kpis.py:9,14,30`, `WEB/manage/KpiTiles.tsx`, `KpiTiles.dom.test.tsx` | |
| M-09 | Evacuation-centre status editor | MISSING | none (`API/routes/manage.py` patches edges and places only) | A staff member cannot mark a centre `official_pps`. |
| G-02 | Task generator | PARTIAL | `SP/sim.py:77-96` (origin x destination pairs, cap 300), `SP/sim.py:336` (evacuation origins) | Deterministic only; no LLM-proposed extras, no dedupe step. The LLM part needs a paid model, so it is not code-only. |
| G-05 | Failure explanation | MISSING | none | No plain-language explanation per failed journey. |
| G-07 | Flood evacuation journeys | DONE | `SP/sim.py:289-420` (`run_evacuation`), `test_sim.py:203,243,269,287,339`, `WEB/manage/JourneyTests.tsx:479`, `JourneyTests.evac.dom.test.tsx:64` | Profile x scenario table, 5 result classes, centre origins excluded, closed centres handled. |
| G-08 | Flood invariants in CI | DONE | (a) `test_flood.py:15` (tiny), `data/scripts/tests/test_flood_build.py:67,81` (build), `test_sim.py:269` (seed sample, E1); (b) `test_evaluate.py` (`test_flood_never_upgrades_unknown`); (c) `SP/sim.py` E2 plus `test_sim.py:243,269`; (d) `test_run.py:79` | The monotonicity property test is on the tiny fixture and the build function. The real seed's committed edge classes are asserted only through the evacuation sample, not directly (see item 10 below). |
| B-08 | Anonymised question log | MISSING | none | |

## Remaining code-only work, ranked by demo and judging value

All items need no fieldwork, paid service or credentials, and the tests use the mock LLM. "Lane" uses the project lanes: BE, FE, AI, DATA.

1. **M-09 Evacuation-centre status editor (official_pps only with evidence).** Closes M-09; completes B-05 and F-05 end to end. This is the strongest honesty demo: a staff member attaches an uploaded photo or source and the label, the briefing and the chat answer change.
   - Files: new `centre_status` table beside `SP/closure_store.py` (same per-world DB, loaded at startup, `world.set_centres(...)` bumps `world.version`), `API/routes/manage.py` (staff `POST /evacuation-centres/{id}/status`), `SP/models.py` (`EvacCentre.evidence_ids`), `SP/tools.py:123`, `WEB/manage/FloodBriefing.tsx` (action on each centre row), `WEB/manage/manageApi.ts`, `packages/api-client` (`pnpm gen`).
   - Acceptance: `apps/api/tests/test_centres_api.py`. Marking `official_pps` without `evidence_id` or source URL gives 422. With one it writes an audit row, `GET /evacuation-centres` shows `official_pps`, the ETag changes, and the mock answer says "Official PPS". Undo returns it to `osm_candidate`. 401 without a staff token. Vitest: the editor button is disabled until evidence is chosen.
   - Lane: BE then FE.

2. **C-09 and W-03: resident "Report an issue here" and "collection day" requests.** Closes C-09 (MISSING) and the VR half of W-03.
   - Files: `API/routes/core.py` or a new `routes/report.py` (anonymous `POST /places/{id}/report` with `attribute` from the catalogue, no free text, fixed summary through `AG/agent.py:safe_vr_args(source="resident")`), `SP/vr_store.py` (reason `user_report`), `attributes.py` and `attributeCatalogue.ts` (add `collection_day` for waste points, mirrored), `WEB/places/PlaceCard.tsx` (button and "Request filed" state), `WEB/places/SourceBanner.tsx` (waste card button).
   - Acceptance: `apps/api/tests/test_report.py`. Anonymous POST creates a VR with `reason=user_report` and demand 1; a second POST gives demand 2 with no new row; an unknown element gives 404; an unknown attribute gives 422; the stored summary contains no user text; the claim value is never changed. Vitest DOM: the button files once and shows the demand. Resolve still needs staff.
   - Lane: BE then FE (small AI touch: the mock's "ask MBSA" line mentions the filed request).

3. **AX-01 and P-05: grey "not relevant" for edges the profile cannot use by type.** Closes the P0 PARTIAL and fixes the drive overlay.
   - Files: `API/geojson.py` (status `not_relevant` when `evaluate_edge` fails on `attribute == "type"`), `WEB/scene/styles.ts` (grey, thin, pattern), `StatusLegend.tsx`, `list/listModel.ts` mapStatus, `cesium/layers.tsx`. Regenerate the client if the status enum is typed.
   - Acceptance: `apps/api/tests/test_core.py::test_drive_layer_marks_footways_not_relevant` (footway is `not_relevant`, road is `ok`, a closed road is still `blocked`); `styles.test.ts` (grey plus a pattern, legend text "Not used by this profile"); the list view does not count it as "Not passable".
   - Lane: BE then FE.

4. **P-06 and P-08: renderer fallback chain.** Demo-day reliability.
   - Files: `WEB/scene/SceneHost.tsx` (`RendererBoundary` falls back to the next available view: Cesium, then Mapbox when a token exists, then list), `WEB/scene/cesium/CesiumScene.tsx` (if the Google tileset fails and a Cesium ion token exists, try `createOsmBuildingsAsync` before the globe notice), `selectView.ts`, read `site.scene.fallback`.
   - Acceptance: vitest `selectView.test.ts` (ordered fallback list from the keys); `SceneHost.dom.test.tsx` (a throwing Cesium child renders `MapboxLite` when a Mapbox token is present, else the list); a pure `tileFallback(env, siteScene)` function test (Google failure picks OSM Buildings only with a Cesium token).
   - Lane: FE.

5. **F-03 and F-16: show the flood margin in the legend and the Assumptions.** Closes a P0 PARTIAL and a P1 PARTIAL cheaply.
   - Files: `WEB/scene/StatusLegend.tsx` (when a scenario is active: "Classes use a margin of 0.5 m, indicative"), `WEB/manage/Assumptions.tsx`, `comparison.ts` (`assumptionRows` adds the scenario's `margin_m` and method), reading `/scenarios`.
   - Acceptance: vitest `StatusLegend.test.tsx` (margin line only with a scenario; no depth number); `comparison.test.tsx` (assumption rows include the margin and the "no published source" label).
   - Lane: FE.

6. **W-04 (and W-03 mock path): waste golden questions.** Closes W-04.
   - Files: `evals/golden/hero.yaml` (add 3-5: e-waste, composting, "when is collection", nearest recycling from the playground, an invented schedule), `AG/mock.py` (collection-day answer that files the VR from item 2 once it exists), `test_inapp_prompts.py`.
   - Acceptance: `pnpm golden` (mock) passes with 5-8 waste cases and `answered_without_citations: 0`; a case asserts "No collection schedule is recorded" and never a day or time; the validator rejects an invented schedule.
   - Lane: AI.

7. **B-03: content-hash provenance for flood scenarios.** Closes the P0 PARTIAL.
   - Files: `data/scripts/build_flood.py` (`scenarios()` at about line 770 adds `script_sha256`, `dem_sha256`, `params` {margin_m, stage_m, cell size}; the rebuild writes them, no rewrite mode, so a hash is never attached to a build that did not use it), `SP/models.py` (Scenario extra fields), `WEB/flood/floodPath.ts` and the popover ("Data version abc123"), `data/README.md`. Needs one seed rebuild by the data lane (cached DEM, no Overpass). Commit data separately.
   - Acceptance: `data/scripts/tests/test_flood_build.py::test_scenarios_carry_provenance_hashes` (hashes present, stable for the same input, change when the margin changes); `test_flood_api.py` returns them; popover vitest. Spec says "git hash"; a content hash is stricter, so note the deviation in the spec.
   - Lane: DATA.

8. **B-08 and M-06: recurring-questions view from anonymised question signatures.** Closes two P1 MISSING rows.
   - Design call for the team lead: store a structured signature, not words. Signature = intent (tool names called), resolved place ids, profile, scenario id, answer status. No user text is stored, so it is PDPA-safe and clusters exactly. The spec says "text only"; storing raw text conflicts with the project's PDPA stance (AGENTS.md, VR rule), so this deviation needs a ruling.
   - Files: `API/store.py` (new `question_log` table: signature, count, first and last seen), `API/routes/chat.py` (write after `done`), `API/routes/manage.py` (staff `GET /question-clusters?days=7`), `WEB/manage/Questions.tsx`, `ManagePage.tsx` (tab `questions`), `packages/api-client`.
   - Acceptance: `apps/api/tests/test_question_log.py` (two chats with the same place, profile and scenario but different wording give one cluster with count 2; no user text is in the DB; staff-only 401; the top 10 ordering); vitest for the tab.
   - Lane: BE then FE.

9. **G-05: plain-language failure explanation per failed journey.** Closes G-05.
   - Spec says "LLM". A deterministic explanation from engine facts is honest and free, and an LLM rephrase can be added later behind the mock: say so in the spec.
   - Files: `SP/sim.py` (`explain(task, route)` from the first FAIL/unknown element names), `API/routes/sim.py` (field on gap rows and failed samples), `WEB/manage/JourneyTests.tsx`, `simModel.ts`.
   - Acceptance: `test_sim.py::test_blocked_and_no_data_journeys_get_a_one_or_two_sentence_explanation_naming_elements` (readable names, never `seg-` ids, never "not reachable" for `no_data`); a vitest row render.
   - Lane: BE then FE.

10. **G-08: assert the invariants on the real seed.** Cheap, strengthens the "invariants in CI" claim.
    - Files: `packages/spatial/tests/test_flood.py` (`test_seed_edge_classes_are_monotonic_across_stages`, `test_seed_baseline_equals_no_scenario_for_routes`), skipped when the seed is absent.
    - Acceptance: both pass on `data/seed/elmina`; mutating one class in a copy makes the monotonic test fail.
    - Lane: BE.

11. **C-01: stream the deterministic status line early.** Improves perceived first-token time without breaking validation.
    - Files: `AG/run.py` (after `plan_route` returns, emit the `Route status: …` `text.delta` at once, and drop it from the final batch), `WEB/chat/chatReducer.ts` (already appends deltas).
    - Acceptance: `packages/agent/tests/test_run.py::test_status_line_arrives_before_final_answer` (a `FunctionModel` that delays `final_answer`: the first `text.delta` precedes `done` by the delay, the label appears once, and the text still passes the validator). Cannot prove the 2 s p50, which needs a live model.
    - Lane: AI.

12. **P-01: a bundle-size budget as a regression guard** (a proxy; the device measurement is still open).
    - Files: `apps/web/scripts/check-bundle-budget.mjs`, `package.json` build chain.
    - Acceptance: the build fails if the initial JS exceeds 200 KB gz or a new eager chunk imports Cesium or Mapbox.
    - Lane: FE.

13. **B-02: log the import counts and fix the spec text.**
    - Files: `data/scripts/import_osm.py` (write `base/counts.json`: walk, places, hydrology), `docs/03-product/mvp-spec.md` B-02 (buildings come from the Google or Cesium OSM tiles, not the base twin; bbox not polygon).
    - Acceptance: `data/scripts/tests` asserts the counts file shape; the spec text matches the product.
    - Lane: DATA and docs.

14. **C-08 Multilingual (explicitly ranked last).** BM and 中文 aliases from OSM `name:ms` and `name:zh` into `places.geojson` (needs a rebuild, network), mock language detection and BM/ZH answer templates, 3 goldens with the same tool calls in EN/BM/ZH, and a test that asserts identical tool calls.
    - Files: `data/scripts/import_osm.py`, `AG/mock.py`, `AG/template.py`, `evals/golden/hero.yaml`, `packages/agent/tests/test_multilingual.py`.
    - Acceptance: `test_multilingual.py` (same `plan_route` arguments for the three phrasings; place names unchanged; no "safe/selamat/安全").
    - Lane: AI and DATA.

Not code-only (listed so nobody picks them up): AX-05 survey, W-01 curation to 20-40 points, B-05 real `official_pps` entries (needs the 4 Oct 2024 relief-centre report), P-01 device timing, P-07 VoiceOver/TalkBack, G-02 LLM extras (paid model), W-05, F-15. Open decision for the team lead: `mapbox-gl` 3.33.0 is under Mapbox's proprietary licence (log R25 flag); replacing it needs a keyless basemap choice, so it is not scheduled here.

## P2 rows that are cheap wins

| ID | Status today | Cheap win | Files and acceptance | Lane |
|---|---|---|---|---|
| G-06 | MISSING | Before/after comparison of two sim runs (the J5 story, visible) | `API/routes/sim.py` (`GET /simulations/compare?a=&b=`, pure delta of counts per profile and outcome, over `SimStore.recent`), `WEB/manage/JourneyTests.tsx` ("Compare with previous run"). Test: after resolving a VR between two runs, `compare` shows a journey moving from `success_with_unknowns` to `success`; vitest renders the delta table. | BE then FE |
| F-11 | MISSING | Printable one-page briefing | `WEB/manage/FloodBriefing.tsx` (a "Print" button calling `window.print()`), a print stylesheet that hides the chrome and keeps the disclaimer and scenario provenance. Test: DOM test that the printable block contains the disclaimer, the scenario label and the data date. | FE |
| C-11 | MISSING | Voice input with the browser Speech API | `WEB/chat/ChatPanel.tsx` (mic button, feature-detected; fills the box and never auto-sends), `WEB/chat/useSpeech.ts`, a one-line notice that the browser's speech service processes the audio (NFR Privacy). Test: vitest with a fake `SpeechRecognition` (absent API hides the button; the result fills the input; no send). | FE |
| F-13 | MISSING (links only) | MET Malaysia warning banner, fails silently | `API/routes/flood.py` (`GET /met-warning`, short timeout, returns null on any error), `WEB/flood/DisclaimerBanner.tsx`. Test: mocked HTTP failure returns null and renders nothing; a mocked success is labelled "MET Malaysia warning, not ours". The live call cannot be tested offline. | BE then FE |
| M-08 | DONE already | none (`API/routes/manage.py:265` `/audit`, `WEB/manage/AuditHistory.tsx`) | | |
| F-14 | MISSING | Not cheap (per-scenario Dijkstra with cutoff, a new layer and legend): skip | | |
| F-15, W-05 | field or partner data | not code | | |
