Route answers can select the wrong endpoints or hide important gaps. This branch binds facts and highlights to the selected journey, renders deterministic maneuvers, applies mapped vehicle one-way tags, and keeps inferred zero-edge connections unverified. Linked centres and flood-island membership use mapped entrances and mode-specific road snaps. Undated rest/sidewalk claims cannot establish checked access. Active closures or scenario FAIL exclude rest stops; possible flood/unassessed coverage keeps them unverified across route search and centre summaries. The importer requires original OSM node identities; the loader rejects ambiguous IDs, inconsistent geometry and negative/non-finite lengths before routing. Ticket impact excludes unusable staff checks.

**Merge status: HOLD.** AI c9da379 closes all earlier saved 9+13 navigation cases. Two direction-reversal paraphrases still pass full validation: clockwise onto a left-turn street, and following the selected street in the opposite direction. Expanded reproduction: `data/audits/2026-10-20-zero-route/probe_remaining_navigation.py` (13 expected outcomes pass, 2 accepted bad instructions). A real mock answer also drops the explicit flood/coverage warnings on a required rest stop; saved in data/audits/2026-10-20-rest-availability/mock-chat.json. Require canonical route prose that preserves checked structured fields and applicable engine warnings, plus the new rest-availability contract acknowledgement and green control CI.

Validation:

- Current input-metric guard fc8c284: **67 loader/API/flood-build tests PASS**, lint PASS; healthy seed HTTP controls unchanged. **23 current replay-body checks PASS in 104.47 s**. Metadata 86b9951: 22/22 Elmina signatures/replay loads pass with bodies byte-preserved; three Tiny files untouched. The prior broader checkpoints below predate this input-only guard.

- Rest availability: 101 initial affected checks; final 23 spatial / 5 API tests PASS; required full agent/API compatibility **1,188 PASS in 198.35 s** at that checkpoint, including then-current cache-body checks. Real curl before/after confirms flooded/closed stops no longer satisfy the rest limit.
- New loader/walkway/API checks: 41 PASS. The AI-reported undated walkway fixture now has a dated positive control and explicit undated/expired controls.
- Fixed the prior duplicate API/spatial flood test filename; repository-wide collection succeeds.
- Latest AI direction/closure checks: 72 PASS. Original nine saved cases PASS; previous thirteen expanded cases PASS before the two new orientation proofs.
- Previous round whole Python suite: **2,338 PASS / 37 skipped in 315.51 s**, including all agent/API and 23 demo-cache body checks. This predates rest-availability 87a11ae; the later rest-availability compatibility result is listed above. The first run found one malformed synthetic flood fixture; `5b8af8a` gives independent samples distinct nodes without changing coordinates or flood assertions. Final 56 focused flood-build/world/API checks also PASS. Interrupted partial runs are not counted.
- Lint PASS; golden 23/23 mock PASS, zero fallbacks or rejected attempts. Rest-availability metadata refresh `6feb312` / correction `6a82222`: final 22/22 Elmina replay signatures pass with event bodies byte-preserved; three Tiny-world recordings are restored byte-for-byte. Final demo/cache tests: **35 PASS in 101.20 s** after that correction. API schemas and frontend source are unchanged this round; their earlier generation/type checks passed.
- Current real seed loads all 16,120 edges / 232 places / 11,736 consistent node positions. Real HTTP controls: walking 416.4 m, driving 113.3 m, expected place matches, 16,352 access features, drive chat with mapped-end and road-end/legal-turn caveats.
- Previous backend checkpoints: 209 verification/routing/access/flood/tool/API checks and 141 flood/entrance/direction checks PASS; walking island totals 20/29 (+3/+5 m), drive 21/35 after consistent snaps; baseline zero and likely/possible totals unchanged.
- No local e2e, live model calls, GitHub PR or CI run by this worker. Control opens the PR. Own app stopped; both ports checked closed.

Limits: loader/source guards do not establish authentic junction identity for the legacy coordinate-derived seed. The coherent source-backed rebuild remains blocked: exact cache readiness is 3/15 required road-query answers, with twelve missing. The latest one-request primary-mirror recovery probe timed out after 18.43 s; data/audits/2026-10-20-topology-cache/README.md records the evidence. Earlier bounded service failures remain documented. No seed writes or further retries followed. Legal turn relations/changing directions remain unmodelled. Island counts are graph indicators, not individual checked evacuation routes. Visual map review and the ordinary-destination closure-policy ruling remain control/Yunzhe-owned.

The lists cover the whole comparison with control, including previously pushed P1 and T-020 work.

## Touches Backend

- `apps/api/README.md`
- `apps/api/src/townshiplens_api/geojson.py`
- `apps/api/src/townshiplens_api/routes/core.py`
- `apps/api/tests/test_access_estimates.py`
- `apps/api/tests/test_api_flood_entrances.py`
- `apps/api/tests/test_api_world_integrity.py`
- `apps/api/tests/test_api_rest_availability.py`
- `apps/api/tests/test_core.py`
- `apps/api/tests/test_manage.py`
- `apps/api/tests/test_selection.py`
- `apps/api/tests/test_sidewalk_verification.py`
- `apps/api/tests/test_verification_expiry.py`
- `config/profiles/drive.yaml`
- `data/README.md`
- `data/audits/2026-10-18-t018-path-map.json`
- `data/audits/2026-10-18-t020-access.json`
- `data/audits/2026-10-19-backend-ai-review/api_expiry_probe.py`
- `data/audits/2026-10-19-backend-ai-review/engine_ai_probes.py`
- `data/audits/2026-10-19-backend-ai-review/fix-api-smoke.json`
- `data/audits/2026-10-19-backend-ai-review/fix-live-retest-three.json`
- `data/audits/2026-10-19-backend-ai-review/fix-live-six.json`
- `data/audits/2026-10-19-backend-ai-review/fix-results.json`
- `data/audits/2026-10-19-backend-ai-review/fix_live_round.py`
- `data/audits/2026-10-19-backend-ai-review/report.json`
- `data/audits/2026-10-20-driving/README.md`
- `data/audits/2026-10-20-driving/route-comparison.json`
- `data/audits/2026-10-20-rest-availability/README.md`
- `data/audits/2026-10-20-rest-availability/api-before.json`
- `data/audits/2026-10-20-rest-availability/api-after.json`
- `data/audits/2026-10-20-rest-availability/seed-availability.json`
- `data/audits/2026-10-20-rest-availability/seed-api-controls.json`
- `data/audits/2026-10-20-rest-availability/mock-chat.json`
- `data/audits/2026-10-20-route-metrics/README.md`
- `data/audits/2026-10-20-route-metrics/api-before.json`
- `data/audits/2026-10-20-route-metrics/api-after.json`
- `data/audits/2026-10-20-route-metrics/seed-api-controls.json`
- `data/audits/2026-10-20-topology-cache/README.md`
- `data/audits/2026-10-20-topology-cache/readiness.json`
- `data/audits/2026-10-20-topology-cache/recovery-probe.json`
- `data/audits/2026-10-20-overnight-pr.md`
- `data/audits/2026-10-20-special-verification/README.md`
- `data/audits/2026-10-20-special-verification/api-after.json`
- `data/audits/2026-10-20-special-verification/flood-api-after.json`
- `data/audits/2026-10-20-special-verification/flood-seed-comparison.json`
- `data/audits/2026-10-20-special-verification/real-seed-controls.json`
- `data/audits/2026-10-20-t021/README.md`
- `data/audits/2026-10-20-t021/api-routes.json`
- `data/audits/2026-10-20-t021/drive-arrival-chat.json`
- `data/audits/2026-10-20-t021/probe_ai_steps.json`
- `data/audits/2026-10-20-t021/probe_ai_steps.py`
- `data/audits/2026-10-20-world-integrity/README.md`
- `data/audits/2026-10-20-world-integrity/api-controls.json`
- `data/audits/2026-10-20-zero-route/README.md`
- `data/audits/2026-10-20-zero-route/api-comparison.json`
- `data/audits/2026-10-20-zero-route/drive-chat-after-ai.json`
- `data/audits/2026-10-20-zero-route/final-api-controls.json`
- `data/audits/2026-10-20-zero-route/probe_remaining_navigation.json`
- `data/audits/2026-10-20-zero-route/probe_remaining_navigation.py`
- `data/audits/2026-10-20-zero-route/source-identity-probe.json`
- `data/audits/2026-10-20-zero-route/zero-chat.json`
- `data/demo/0af26933f0c732d8.jsonl`
- `data/demo/0bab7dac777c26c1.jsonl`
- `data/demo/31e807dbfc287101.jsonl`
- `data/demo/340ea9c2667bc50e.jsonl`
- `data/demo/36deace948994e68.jsonl`
- `data/demo/43352ab4bb0385ef.jsonl`
- `data/demo/4ea4d575990ccc81.jsonl`
- `data/demo/4f3199e23212cbcf.jsonl`
- `data/demo/52fd5a8da6079304.jsonl`
- `data/demo/810d7379264e97d1.jsonl`
- `data/demo/88e27a845c11e308.jsonl`
- `data/demo/8d4567fba8b0bdd0.jsonl`
- `data/demo/9e55f4c0894f0164.jsonl`
- `data/demo/a175b723788558d9.jsonl`
- `data/demo/ac2afa190c9f40b9.jsonl`
- `data/demo/bb7b1594753b9094.jsonl`
- `data/demo/bba09eeb7ea4b306.jsonl`
- `data/demo/c9495dfeb181f462.jsonl`
- `data/demo/cf2e79cf5e0efe83.jsonl`
- `data/demo/db7c2bc4ca95419d.jsonl`
- `data/demo/ef8046225e137506.jsonl`
- `data/demo/faa39f225c4b96a8.jsonl`
- `data/scripts/audit_access.py`
- `data/scripts/import_osm.py`
- `data/scripts/tests/test_area_snap.py`
- `data/scripts/tests/test_flood_build.py`
- `data/scripts/tests/test_major_roads.py`
- `data/scripts/tests/test_seed_regression.py`
- `data/scripts/tests/test_split.py`
- `data/seed/elmina/access/overlay.geojson`
- `data/seed/elmina/base/walk.geojson`
- `packages/spatial/README.md`
- `packages/spatial/src/townshiplens_spatial/access.py`
- `packages/spatial/src/townshiplens_spatial/direction.py`
- `packages/spatial/src/townshiplens_spatial/evaluate.py`
- `packages/spatial/src/townshiplens_spatial/flood.py`
- `packages/spatial/src/townshiplens_spatial/impact.py`
- `packages/spatial/src/townshiplens_spatial/maneuvers.py`
- `packages/spatial/src/townshiplens_spatial/models.py`
- `packages/spatial/src/townshiplens_spatial/rollout.py`
- `packages/spatial/src/townshiplens_spatial/routing.py`
- `packages/spatial/src/townshiplens_spatial/sim.py`
- `packages/spatial/src/townshiplens_spatial/tools.py`
- `packages/spatial/src/townshiplens_spatial/twm.py`
- `packages/spatial/src/townshiplens_spatial/world.py`
- `packages/spatial/tests/test_access.py`
- `packages/spatial/tests/test_centre_entrances.py`
- `packages/spatial/tests/test_direction.py`
- `packages/spatial/tests/test_flood_entrances.py`
- `packages/spatial/tests/test_impact.py`
- `packages/spatial/tests/test_maneuvers.py`
- `packages/spatial/tests/test_routing.py`
- `packages/spatial/tests/test_special_verification.py`
- `packages/spatial/tests/test_rest_availability.py`
- `packages/spatial/tests/test_tools_access.py`
- `packages/spatial/tests/test_walkways.py`
- `packages/spatial/tests/test_world_integrity.py`
- `packages/spatial/tests/test_zero_route.py`

## Touches AI

- `evals/audit_probes.py`
- `evals/audits/2026-10-18-t017/T-019-findings.md`
- `evals/audits/2026-10-18-t017/live_round.py`
- `evals/audits/2026-10-18-t017/round2-t019-mock.json`
- `evals/audits/2026-10-18-t017/round2-t019-openrouter.json`
- `evals/audits/2026-10-18-t017/round3-t019-openrouter.json`
- `evals/audits/2026-10-18-t017/round4-t019-openrouter.json`
- `evals/audits/2026-10-18-t017/round5-t020-openrouter.json`
- `evals/audits/2026-10-20-route-binding/probe_answers.json`
- `evals/audits/2026-10-20-route-binding/probe_answers.py`
- `evals/audits/2026-10-20-route-binding/probe_guards.json`
- `evals/audits/2026-10-20-route-binding/probe_guards.py`
- `evals/golden/hero.yaml`
- `evals/tests/test_independent_audit.py`
- `packages/agent/README.md`
- `packages/agent/src/townshiplens_agent/agent.py`
- `packages/agent/src/townshiplens_agent/cli.py`
- `packages/agent/src/townshiplens_agent/demo.py`
- `packages/agent/src/townshiplens_agent/events.py`
- `packages/agent/src/townshiplens_agent/facts.py`
- `packages/agent/src/townshiplens_agent/labels.py`
- `packages/agent/src/townshiplens_agent/localize.py`
- `packages/agent/src/townshiplens_agent/memory.py`
- `packages/agent/src/townshiplens_agent/mock.py`
- `packages/agent/src/townshiplens_agent/prompts/system.md`
- `packages/agent/src/townshiplens_agent/record.py`
- `packages/agent/src/townshiplens_agent/route_binding.py`
- `packages/agent/src/townshiplens_agent/run.py`
- `packages/agent/src/townshiplens_agent/steps.py`
- `packages/agent/src/townshiplens_agent/template.py`
- `packages/agent/src/townshiplens_agent/validate.py`
- `packages/agent/tests/test_demo.py`
- `packages/agent/tests/test_inapp_prompts.py`
- `packages/agent/tests/test_localize.py`
- `packages/agent/tests/test_mock.py`
- `packages/agent/tests/test_place_provenance_transport.py`
- `packages/agent/tests/test_route_binding.py`
- `packages/agent/tests/test_run.py`
- `packages/agent/tests/test_scope.py`
- `packages/agent/tests/test_steps.py`

## Touches Frontend

- `apps/web/README.md`
- `apps/web/src/features/assistant/RouteSummary.tsx`
- `apps/web/src/features/assistant/starters.ts`
- `apps/web/src/features/map-ui/SettingsPopover.dom.test.tsx`
- `apps/web/src/features/scene/StatusLegend.test.tsx`
- `apps/web/src/features/scene/StatusLegend.tsx`
- `apps/web/src/features/scene/mapbox/MapboxLite.tsx`
- `apps/web/src/features/scene/status.test.ts`
- `apps/web/src/features/scene/status.ts`
- `apps/web/src/features/scene/styles.test.ts`
- `apps/web/src/features/scene/styles.ts`
- `apps/web/src/lib/routeStatus.test.ts`
- `apps/web/src/lib/routeStatus.ts`

## Touches Generated

- `packages/api-client/openapi.json`
- `packages/api-client/src/schema.d.ts`
