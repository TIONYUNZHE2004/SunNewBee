import { expect, type Page, test } from "@playwright/test";
import { DEMO_CHIP, journeyCardContent } from "../src/features/journey/cardContent";
import { miniMapLayout } from "../src/features/journey/miniMap";
import type { JourneyEvent, JourneyPlan } from "../src/features/journey/timeline";
import { openScene } from "./support/bookmarks";
import { askDemoJourney, hasJourneyHook, journey } from "./support/journey";
import { fractionBelow, lumaHistogram } from "./support/pixels";
import { decodePng } from "./support/scene";

/**
 * AC-D11 (cards and markers) and AC-D12 (always-on label, mini-map hero dot) on the §2 demo route:
 * Elmina seed, Stylised map, mock LLM. Run with a dev server on the seed:
 * `ACCEPTANCE_BASE_URL=http://localhost:5183 pnpm --filter @tl/web acceptance -g "AC-D11|AC-D12"`.
 *
 * Uses the player hook `window.__journey` (D-T8; installed in dev builds and the demo preset):
 * `seek`, `play`, `pause`, `setCam`, `total`, `phases` (event phases carry `event` and
 * `eventIndex`), `plan` and `hero()` -> the rendered hero (D-T6): `distance_m` is the route metre
 * the 3D hero was posed at, so the dot check measures the drawn hero, not the timeline. Skips only where the hook is not installed (a production build).
 */

interface HookPhase {
  kind: string;
  t0: number;
  t1: number;
  event?: JourneyEvent;
  eventIndex?: number;
}

async function hook<T>(page: Page, fn: string): Promise<T | null> {
  return page.evaluate((f) => {
    const j = (window as unknown as Record<string, Record<string, unknown> | undefined>).__journey;
    const v = j?.[f];
    return (typeof v === "function" ? (v as () => unknown).call(j) : (v ?? null)) as never;
  }, fn);
}

const frames = (page: Page, n = 2) =>
  page.evaluate(
    (k) =>
      new Promise<void>((r) => {
        let i = 0;
        const f = () => (++i >= k ? r() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );

test.describe("journey overlay (D-T7)", () => {
  test.beforeEach(async ({ page }) => {
    await openScene(page, "day");
    await askDemoJourney(page);
    test.skip(
      !(await hasJourneyHook(page)),
      "window.__journey is installed in dev builds and the demo preset only",
    );
  });

  test("AC-D11: one card per hold, fully inside the viewport, plan text, demo chip, no opaque markers", async ({
    page,
  }) => {
    const { total, phases } = await journey.info(page);
    expect(total).toBeGreaterThan(80);
    await journey.pause(page);
    const vp = page.viewportSize() as { width: number; height: number };
    const holds = (phases as HookPhase[]).filter((p) => p.kind === "event" && p.event);
    expect(holds.length).toBeGreaterThan(0);
    console.log(`AC-D11: ${holds.length} holds checked`);
    for (const p of holds) {
      await journey.seek(page, (p.t0 + p.t1) / 2);
      await frames(page);
      const cards = page.getByTestId("journey-card");
      await expect(cards).toHaveCount(1);
      const box = await cards.boundingBox();
      expect(box).not.toBeNull();
      const b = box as { x: number; y: number; width: number; height: number };
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
      const ev = p.event as JourneyEvent;
      const c = journeyCardContent(ev);
      await expect(cards.getByRole("heading")).toHaveText(ev.title);
      await expect(cards).toContainText(ev.body);
      await expect(cards.getByTestId("card-source")).toContainText(c.source);
      await expect(cards.getByText(DEMO_CHIP, { exact: true })).toHaveCount(ev.demo ? 1 : 0);
      if (ev.demo) await expect(cards).not.toContainText(/\bverified\b/i);
      // Marker: the 48 x 48 px around its anchor must not be a dark quad (prototype bug).
      const ax = Number(await cards.getAttribute("data-anchor-x"));
      const ay = Number(await cards.getAttribute("data-anchor-y"));
      if (Number.isFinite(ax) && Number.isFinite(ay) && ax > 24 && ay > 24) {
        const png = await page.screenshot({
          clip: { x: ax - 24, y: ay - 24, width: 48, height: 48 },
        });
        const img = await decodePng(page, png);
        expect(fractionBelow(lumaHistogram(img), 0.04)).toBeLessThan(0.25);
      }
    }
  });

  test("AC-D12: the Simulation label is visible in 100% of sampled frames of a full playback", async ({
    page,
  }) => {
    const { total } = await journey.info(page);
    await journey.seek(page, 0);
    await journey.play(page);
    const t0 = Date.now();
    let samples = 0;
    let labelled = 0;
    while (Date.now() - t0 < (total + 1) * 1000) {
      samples++;
      if (await page.getByTestId("journey-sim-label").isVisible()) labelled++;
      await page.waitForTimeout(100);
    }
    console.log(`AC-D12 label: ${labelled}/${samples} samples over ${total.toFixed(1)} s`);
    expect(samples).toBeGreaterThan(total * 5);
    expect(labelled).toBe(samples);
  });

  test("AC-D12: the mini-map hero dot tracks hero() within 3 px over a full playback", async ({
    page,
  }) => {
    const { total } = await journey.info(page);
    const plan = await hook<JourneyPlan>(page, "plan");
    expect(plan, "window.__journey.plan").toBeTruthy();
    const mm = miniMapLayout(plan as JourneyPlan, 220, 10);
    await journey.seek(page, 0);
    await journey.play(page);
    const t0 = Date.now();
    let samples = 0;
    let worst = 0;
    while (Date.now() - t0 < (total + 1) * 1000) {
      // dot and hero read in one evaluate (one task), so both describe the same instant
      const r = await page.evaluate(() => {
        const dot = document.querySelector(
          '[data-testid="journey-minimap-hero"]',
        ) as SVGCircleElement | null;
        const svg = dot?.ownerSVGElement;
        const hero = (
          window as unknown as { __journey: { hero(): { distance_m: number } | null } }
        ).__journey.hero();
        if (!dot || !svg || !hero) return null;
        const m = svg.getScreenCTM() as DOMMatrix;
        const b = dot.getBoundingClientRect();
        return {
          cx: b.x + b.width / 2,
          cy: b.y + b.height / 2,
          m: [m.a, m.b, m.c, m.d, m.e, m.f],
          d: hero.distance_m,
        };
      });
      if (r) {
        samples++;
        const [x, y] = mm.heroAt(r.d);
        const [a, b, c, d, e, f] = r.m as [number, number, number, number, number, number];
        const px = a * x + c * y + e;
        const py = b * x + d * y + f;
        worst = Math.max(worst, Math.hypot(px - r.cx, py - r.cy));
      }
      await page.waitForTimeout(100);
    }
    console.log(`AC-D12 mini-map dot: worst ${worst.toFixed(2)} px over ${samples} samples`);
    expect(samples).toBeGreaterThan(total * 5);
    expect(worst).toBeLessThanOrEqual(3);
  });
});
