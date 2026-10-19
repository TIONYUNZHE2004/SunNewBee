Route answers can select the wrong endpoints or omit important data gaps. This branch binds route facts and map highlights to the selected journey, adds deterministic route maneuvers, and prevents the reproduced wrong-way drive from Car Park B to the playground. It also rejects imported graph topology without original OSM node identities and keeps unusable staff checks out of ticket-impact counts.

**Merge status: BLOCKED.** Backend implementation is ready for review. The integrated AI maneuver changes still accept four dishonest navigation statements and cause one closure-warning regression. The real mock drive chat also omits the engine’s road-end/legal-turn warnings and claims arrival 123.3 m short of the destination. The AI hand-off is on board tasks T-021 and T-017. Require those fixes and green CI before merging.

Validation:

- Required agent/API check before the AI integration: 1,120 passed.
- Latest integration: 1,125 passed, one failed (`test_detour_closure_is_named`); 23 demo-cache tests separately passed.
- Affected spatial/routing/tool/import checks: 186 passed; final direction/access/import checks: 72 passed; flood-tool/core API checks: 40 passed.
- `pnpm lint`, workspace typecheck, generated API client with zero drift: PASS.
- Golden: 23/23 mock, zero fallbacks or rejected attempts. All 22 Elmina recordings refreshed and current signatures checked.
- Real curl checks: places, access layer, chat, six walking routes and four driving controls. Saved under `data/audits/2026-10-20-{t021,driving}/`.
- No local e2e, no paid model calls, no GitHub PR or CI run by this overnight worker.

Limits: committed seed topology still uses legacy coordinate-derived IDs. Both bounded Overpass mirror attempts timed out, with no seed writes. Legal turn restrictions and changing directions remain unmodelled. Five deep-spot routes have 3–8 maneuvers; the longer hero route retains nine rather than deleting a real turn or uncertainty boundary. Control still owns visual map review.

The file lists below cover the whole comparison with control, including previously pushed P1 and T-020 work.

## Touches Backend

- `apps/api/README.md`
- `apps/api/src/townshiplens_api/geojson.py`
- `apps/api/src/townshiplens_api/routes/core.py`
- `apps/api/tests/test_access_estimates.py`
- `apps/api/tests/test_core.py`
- `apps/api/tests/test_manage.py`
- `apps/api/tests/test_selection.py`
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
- `data/audits/2026-10-20-t021/README.md`
- `data/audits/2026-10-20-t021/api-routes.json`
- `data/audits/2026-10-20-t021/drive-arrival-chat.json`
- `data/audits/2026-10-20-t021/probe_ai_steps.json`
- `data/audits/2026-10-20-t021/probe_ai_steps.py`
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
- `packages/spatial/tests/test_direction.py`
- `packages/spatial/tests/test_impact.py`
- `packages/spatial/tests/test_maneuvers.py`
- `packages/spatial/tests/test_routing.py`
- `packages/spatial/tests/test_tools_access.py`

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

## Generated client

- `packages/api-client/openapi.json`
- `packages/api-client/src/schema.d.ts`
