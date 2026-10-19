# T-021 backend checks

The implementation is `d4649d8` on `local/backend-engineer`. Real API calls used the Elmina seed, own ports 8021/5191 and `LLM_PROVIDER=mock`.

`api-routes.json` saves six POST `/routes` responses. Every step partitions the chosen route segments in travel order, starts/ends on its graph geometry, and uses physical edge lengths. Five routes have 3–8 steps. Car Park B → playground has nine, including a real uncertainty boundary; the backend retains all turns/boundaries. The AI summary must disclose any merged/omitted steps. Map eye-check is **not run** and remains control-owned.

Checks passed:

- 89 tests: maneuver thresholds, geometry orientation, curved/duplicate geometry, crossings, access/rule boundaries, zero-edge routes, and existing routing.
- 66 tests: maneuvers and route tools.
- 17 core API tests.
- Required agent/API compatibility: **1,120 passed**, 220.34 seconds.
- `pnpm lint` (existing frontend warnings remain), workspace typecheck, and generated API client.
- Real curl `/places`, `/layers/access`, `/routes`, mock `/chat`: no chat error, route highlight emitted, 16,352 access features.

No paid model calls. No local e2e, as instructed. AI wording/validator changes are on the AI engineer branch and were not included in these checks. Full CI and visual review remain required before control merges.

Latest checkpoint: see [the world-integrity follow-up](../2026-10-20-world-integrity/README.md). AI `c9da379` is integrated. All previous 9+13 saved cases now meet the stated no-model-directions policy. The expanded 15-case probe still accepts two wrong orientation instructions: clockwise onto a left-turn street and following that street in the opposite direction. Full Python: **2,338 passed / 37 skipped**. Merge remains on hold for canonical route prose from checked structured fields and green control CI. Rest/sidewalk/flood and earlier endpoint contract notes are acknowledged.
