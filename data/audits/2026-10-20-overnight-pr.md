Route answers can select the wrong endpoints or hide important gaps. This branch binds facts and highlights to the selected journey, renders deterministic maneuvers, applies mapped vehicle one-way tags, and keeps inferred zero-edge entrance connections unverified. Linked centres and flood-island membership use mapped entrances and mode-specific road snaps. Undated rest/sidewalk verifications cannot establish checked access. The importer rejects topology without original OSM node identities, and ticket impact excludes unusable staff checks.

**Merge status: HOLD.** AI c586d46 rejects the older wrong-turn cases through its no-model-directions policy, with deterministic app steps. Four ordinary wrong-turn paraphrases still pass the complete validator in English, Malay and Chinese. Reproduction: `data/audits/2026-10-20-zero-route/probe_remaining_navigation.py` (four accepted dishonest cases; nine expected controls/results pass). Require a correction that keeps arbitrary model navigation prose out of the published route answer, the new contract acknowledgements, and green CI before merging.

Validation:

- Latest backend: 209 affected rest/sidewalk/routing/access/flood/tool/API checks PASS; 141 flood/entrance/direction checks PASS plus one route-vs-island API test.
- Latest AI integration: 53 direction/closure checks PASS; original nine saved probes PASS after explicit policy-aligned control updates and descriptive controls.
- Final integrated agent/API after all backend source changes and AI c586d46: 1,163 PASS in 197.21 s, including all 23 cache-body checks. All 22 final recording signatures/replay loads verified, with validated bodies preserved (fb271a6).
- Lint PASS; OpenAPI generation and zero client drift PASS; golden 23/23 mock PASS, no fallbacks or rejected attempts. Frontend source is unchanged this round; previous workspace typecheck passed.
- Real seed controls: walking remains 416.4 m; drive chat 113.3 m retains road-end/legal-turn caveats and mapped-end wording. Walking flood-island totals stay 20/29 (+3/+5 m); driving changes 12→21 / 25→35 through consistent road snaps. Baseline zero; likely/possible totals unchanged. Saved in `data/audits/2026-10-20-special-verification/`.
- Crafted HTTP cases verify undated rest/sidewalk handling and shared centre-entrance routing/island results; they are not claims of repaired seed entrances. The seed has no undated verified claims or explicit entrance lists.
- No local e2e, live model calls, GitHub PR or CI run by this worker. Control opens the PR.

Limits: seed topology still uses legacy coordinate-derived IDs; bounded source-service calls failed without seed writes. Legal turn relations/changing directions remain unmodelled. Island counts describe graph components, not individual legal, verified or rest-constrained journeys. Visual map review remains control-owned. Ordinary-destination closure policy still needs Yunzhe's ruling.

The lists cover the whole comparison with control, including previously pushed P1 and T-020 work.

## Touches Backend

- `apps/api/README.md`
- `apps/api/src/townshiplens_api/geojson.py`
- `apps/api/src/townshiplens_api/routes/core.py`
- `apps/api/tests/test_access_estimates.py`
- `apps/api/tests/test_core.py`
- `apps/api/tests/test_api_flood_entrances.py`
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
- `packages/spatial/tests/test_tools_access.py`
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
