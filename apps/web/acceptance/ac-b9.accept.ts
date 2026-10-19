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
  writeFileSync(join(OUT, "bubble-log.json"), `${JSON.stringify(log, null, 2)}\n`);
  expect(log.every((r) => r.decor > 0)).toBe(true);
});
