# Frontend redesign: quality report (Task 17)

Branch `feat/redesign-two-screens`, run on 2026-10-16. The independent evaluator (step 5) is run by the controller and is not recorded here.

## Automated checks (mock LLM, tiny fixture where noted)

| Check | Result | Notes |
|---|---|---|
| `pnpm lint` | PASS | Biome prints one config-migration info; no errors. |
| `uv run pytest -q` | PASS (after fix) | 2 failures at first (see Findings); 842 passed. Mock-backed. |
| `pnpm -r --if-present typecheck` | PASS | |
| `pnpm -r --if-present test` | PASS | 53 files, 342 vitest tests. |
| `pnpm gen && git diff --exit-code packages/api-client` | PASS | No drift. |
| `pnpm golden` | PASS | 13/13, mock LLM (not live). |
| `pnpm --filter @tl/web build` | PASS | Cesium assets OK. |
| `pnpm --filter @tl/web e2e` | PASS | 9/9, tiny fixture, mock LLM, list view. |

## Lighthouse (Chrome DevTools MCP, navigation mode)

The MCP tool reports Accessibility, Best Practices, SEO and Agentic Browsing; it excludes Performance. A separate performance trace of `/` (desktop, no throttling, Vite dev server) gave LCP 530 ms and CLS 0.00.

| Page | Theme | Device | A11y | Best practices |
|---|---|---|---|---|
| `/` | day | desktop | 100 | 81 |
| `/` | day | mobile | 100 | 77 |
| `/` | night | desktop | 100 | 81 |
| `/` | night | mobile | 100 | 77 |
| `/tickets` | night | desktop / mobile | 100 / 100 | 100 / 100 |
| `/tickets` | day | desktop / mobile | 100 / 100 | 100 / 100 |
| `/` with an answer and evidence cards (snapshot) | night, day | desktop | 100, 100 | 100, 100 |

Target accessibility >= 95 on both screens in both themes: met. The `/` best-practices gap is a Cesium deprecation warning (`createImageBitmap imageOrientation`), a third-party issue. SEO misses (meta description, robots.txt, llms.txt) are not part of the target.

Caveat: these `/` audits ran with the real 3D tiles loaded (see Cost), so contrast of text over the map canvas is not measurable by Lighthouse. The list view is covered by the e2e and the in-repo accessibility tests, not by Lighthouse.

## Keyboard and responsive

| Check | Result |
|---|---|
| Tab order on `/`: skip link, Perspective radios, theme button, attribution, map settings, conversation controls, starters, input | PASS (DOM order) |
| Escape closes the settings popover and returns focus to its button | PASS (real browser and e2e) |
| `/tickets` resolve flow controls are native, tabbable (ticket rows, staff access, solution radios, value input, file) | PASS (DOM); the click-driven flow is in e2e. Not run end to end by keyboard, to avoid mutating the local DB. |
| 1440 wide: header 66 + main 641 + footer 25 = viewport height, no double scroll, input and footer visible | PASS |
| 1024 wide: same layout, assistant input and footer visible | PASS |
| 820 wide: no horizontal scroll, header controls do not overlap, map 410 px then assistant (reachable by one scroll) | PASS |
| 390x844 (emulated): `scrollWidth` = 390, header wraps to two rows (123 px), no overlap, assistant starters visible below a 472 px map | PASS |
| FloodNote vs settings button at 390 | PASS by source (`max-w-[min(24rem,calc(100%-5rem))]` leaves room for the button); not seen in a browser |

## Real 3D look (Cesium, Google Photorealistic)

| Check | Result |
|---|---|
| Shader compiles under Cesium 1.146, Night tint applied | PASS: no console errors or warnings after toggling to night |
| Night readable: markers, orange access paths and the blue route stay legible; panels use night tokens | PASS |
| Routes legible over the tiles (day and night, township view and the route fly-to) | PASS |
| Building proportions and scale | PASS at the route fly-to (buildings, car parks, lake in proportion); not assessed at the home range |
| Camera tilt and range | Home is `range_m` 6000 at -45 deg (from `site.json`): a township view where about 250 pins are crowded. Left unchanged (a design choice, not a defect). |

## Cost and load count

The keyless override (`GOOGLE_MAPS_API_KEY= ... pnpm dev`) did not take effect: on Windows an empty environment variable is dropped, so `loadEnv` read the real keys from `.env`. Every `/` load therefore fetched billable Google 3D tiles. About 12 loads of `/` occurred (4 Lighthouse navigation audits, plus a trace reload, reloads and page opens), over the budget of 6. No keys were printed in this report; one public browser key was visible in a network listing and is not reproduced. Live LLM: none (mock only).

## Findings fixed

- `fix(web)` a8972cc: two pytest drift guards pointed at files the redesign moved (`features/chat/suggestions.ts` to `features/assistant/starters.ts`; `features/manage/attributeCatalogue.ts` to `features/tickets/`). The prompts test now parses the resident starters and runs them through the mock and validator. AGENTS.md and `data/demo/README.md` paths updated.
- Legacy tokens (`text-brand`, `bg-card`, `text-ink-soft`) in kept components are aliases of the theme variables in `index.css`, so they follow the theme. Night contrast on evidence cards and badges passed Lighthouse (100), so no component changes were needed.

## Remaining issues

- Management starters ("Which places are cut off at +3 m", "Which areas are isolated at +5 m", "Which routes to the mall are cut off at +3 m", "Tell me about a place") get `cannot_answer` from the mock. The resident starters are all answered. The old "mock answers every chip" invariant does not hold for the Management starters; the agent lane should add mock intents or reword the chips.
- Home view is township-wide with dense pins; consider clustering or a closer default range.
- `data/demo/*.jsonl` replays were recorded against the old chips and have not been re-recorded.
- DEV: Windows needs a different keyless method (for example `.env.local` override or a `TL_NO_MAP` flag) to avoid billable tiles in audits.
