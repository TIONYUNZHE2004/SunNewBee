import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { gotoBookmark, HOOK } from "./support/bookmarks";

/**
 * AC-B9 (task B-T8): within 150 m of the focus point street dressing is present, and the switch at
 * the bubble edge fades over >= 0.5 s with no single-frame pop. The vitest halves are
 * `detailBubble.test.ts` (membership, focus, fade timing, capped steps), `dressing/dressingLayer.test.ts`
 * (layer + fader) and `assets/cityInstances.test.ts` (LOD0 trees in the bubble). Here: at the street
 * bookmark the dressing is drawn; then the camera flies 400 m along the street over 4 s while a
 * frame is captured every 0.5 s (5 s in all) for review, and `data-dressing-*` is logged per frame.
 * Run (GPU, dev server on the seed):
 * `ACCEPTANCE_BASE_URL=http://localhost:5185 pnpm --filter @tl/web acceptance -g "AC-B9"`.
 */
const OUT =
  process.env.ACCEPTANCE_OUT ??
  "C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/journey-sim/acceptance/B-T8";

test("AC-B9: dressing inside the bubble; the edge fades (5 s capture)", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await gotoBookmark(page, "street");
  const scene = page.getByTestId("three-scene");
  await expect
    .poll(async () => Number(await scene.getAttribute("data-dressing-decor")), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const start = await page.evaluate(
    (h) =>
      (window as unknown as Record<string, { getPose(): Record<string, number> }>)[h]!.getPose(),
    HOOK,
  );
  // ~400 m east (1 deg lon ~ 111 km here)
  await page.evaluate(
    ([h, p]) =>
      (window as unknown as Record<string, { flyTo(p: unknown, ms: number): void }>)[
        h as string
      ]!.flyTo(p, 4000),
    [HOOK, { ...start, lon: (start.lon as number) + 400 / 111_000 }] as const,
  );
  // Sample the dressing's fade level every 20 ms for the whole 5 s (page side), plus a screenshot
  // every 0.5 s for review. The count alone is not the visual: instances fade by scale, so a
  // flight that crosses a stretch with no mapped decoration legitimately ends at zero, but never in
  // one step. The pop criterion is therefore on the fade level (largest drawn weight), exactly the
  // fader's contract: it falls by at most min(elapsed, BUBBLE_MAX_STEP_S) / BUBBLE_FADE_S per pass.
  await page.evaluate((h) => {
    const w = window as unknown as Record<string, unknown>;
    const api = w[h] as { dressingFade(): { maxW: number; decor: number } };
    const rows: { t: number; maxW: number; decor: number }[] = [];
    const t0 = performance.now();
    const id = setInterval(() => {
      const f = api.dressingFade();
      rows.push({ t: performance.now() - t0, maxW: f.maxW, decor: f.decor });
    }, 20);
    w.__b9 = { rows, stop: () => clearInterval(id) };
  }, HOOK);
  const log: { t: number; facts: number; decor: number }[] = [];
  for (let i = 0; i <= 10; i++) {
    await page.screenshot({ path: join(OUT, `bubble-${String(i).padStart(2, "0")}.png`) });
    log.push({
      t: i * 0.5,
      facts: Number(await scene.getAttribute("data-dressing-facts")),
      decor: Number(await scene.getAttribute("data-dressing-decor")),
    });
    await page.waitForTimeout(500);
  }
  const rows = await page.evaluate(() => {
    const b = (window as unknown as Record<string, { rows: unknown[]; stop(): void }>).__b9!;
    b.stop();
    return b.rows as { t: number; maxW: number; decor: number }[];
  });
  writeFileSync(
    join(OUT, "bubble-log.json"),
    `${JSON.stringify(log, null, 2)}
`,
  );
  writeFileSync(
    join(OUT, "bubble-fade.json"),
    `${JSON.stringify(rows)}
`,
  );

  expect(log[0]!.decor).toBeGreaterThan(0); // dressing is present at the street bookmark
  expect(Math.max(...rows.map((r) => r.maxW))).toBeGreaterThan(0.99);
  // Largest single-sample fall of the fade level, per unit of elapsed time, and the longest 1 -> 0 descent.
  let worstRate = 0;
  let descentFrom: number | null = null;
  let shortestDescent = Number.POSITIVE_INFINITY;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!;
    const b = rows[i]!;
    const dt = (b.t - a.t) / 1000;
    if (b.maxW < a.maxW) worstRate = Math.max(worstRate, (a.maxW - b.maxW) / Math.max(dt, 0.1));
    if (a.maxW >= 0.99 && b.maxW < a.maxW && descentFrom === null) descentFrom = a.t;
    if (descentFrom !== null && b.maxW <= 0.001) {
      shortestDescent = Math.min(shortestDescent, (b.t - descentFrom) / 1000);
      descentFrom = null;
    }
    if (descentFrom !== null && b.maxW > a.maxW) descentFrom = null; // went back up: not a full descent
  }
  writeFileSync(
    join(OUT, "bubble-fade-summary.json"),
    `${JSON.stringify({ samples: rows.length, worstRatePerS: worstRate, shortestDescentS: shortestDescent }, null, 2)}
`,
  );
  // No pop: the fade never falls faster than 1 / 0.5 s = 2 per s. A pass steps by at most 0.1 s of
  // fade (0.2), so the rate is measured over at least 100 ms; 2.5 leaves room for sampler jitter.
  expect(worstRate).toBeLessThanOrEqual(2.5);
  // A full 1 -> 0 descent takes at least the fade time (AC-B9: >= 0.5 s).
  if (Number.isFinite(shortestDescent)) expect(shortestDescent).toBeGreaterThanOrEqual(0.45);
});
