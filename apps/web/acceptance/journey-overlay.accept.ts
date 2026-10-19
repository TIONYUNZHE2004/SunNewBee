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

/** The UI elements over the map (page rects) intersecting `box`: anything drawn over the canvas. */
async function uiOver(page: Page, box: { x: number; y: number; w: number; h: number }) {
  return page.evaluate((b) => {
    const canvas = document.querySelector('[data-testid="three-scene"] canvas');
    const cr = canvas?.getBoundingClientRect();
    const area = cr ? cr.width * cr.height : Number.POSITIVE_INFINITY;
    const out: { x: number; y: number; w: number; h: number; what: string }[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (el === canvas || el.contains(canvas)) continue; // the canvas and its wrappers
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.width * r.height > area * 0.6) continue; // full-map overlay roots, not chrome
      if (r.right <= b.x || r.left >= b.x + b.w || r.bottom <= b.y || r.top >= b.y + b.h) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
      const id = el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? el.tagName;
      out.push({ x: r.left, y: r.top, w: r.width, h: r.height, what: id });
    }
    return out;
  }, box);
}

/** The 48 px crop around a marker anchor (canvas CSS px), in page px, with the UI-covered mask. */
async function markerCrop(page: Page, ax: number, ay: number) {
  const cr = (await page.evaluate(() => {
    const r = document.querySelector('[data-testid="three-scene"] canvas')?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  })) as { x: number; y: number; w: number; h: number };
  const px = cr.x + ax;
  const py = cr.y + ay;
  const onCanvas = ax >= 0 && ay >= 0 && ax <= cr.w && ay <= cr.h;
  const vp = page.viewportSize() as { width: number; height: number };
  const x0 = Math.max(0, Math.min(vp.width - 48, Math.round(px - 24)));
  const y0 = Math.max(0, Math.min(vp.height - 48, Math.round(py - 24)));
  const clip = { x: x0, y: y0, width: 48, height: 48 };
  const ui = await uiOver(page, { x: x0, y: y0, w: 48, h: 48 });
  const covers = (x: number, y: number) =>
    ui.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const mask = new Uint8Array(48 * 48);
  let clear = 0;
  for (let j = 0; j < 48; j++)
    for (let i = 0; i < 48; i++) {
      const x = x0 + i + 0.5;
      const y = y0 + j + 0.5;
      const inCanvas = x >= cr.x && y >= cr.y && x <= cr.x + cr.w && y <= cr.y + cr.h;
      if (inCanvas && !covers(x, y)) {
        mask[j * 48 + i] = 1;
        clear++;
      }
    }
  const hit = covers(px, py);
  return {
    px,
    py,
    onCanvas,
    clip,
    mask,
    clearShare: clear / (48 * 48),
    anchorCovered: !!hit,
    coverBy: hit?.what ?? "",
  };
}

/** Waits until the journey camera is driven and still (1 mm for 400 ms; at most 5 s). */
async function cameraSettled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        const j = (
          window as unknown as {
            __journey: { camera(): { driven: boolean; camera: [number, number, number] } | null };
          }
        ).__journey;
        const t0 = performance.now();
        let last: [number, number, number] | null = null;
        let since = t0;
        const tick = () => {
          const now = performance.now();
          const c = j.camera();
          const p = c?.camera ?? null;
          if (
            !c?.driven ||
            !p ||
            !last ||
            Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 0.001
          )
            since = now;
          last = p;
          if (now - since >= 400 || now - t0 > 5000) return done();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

test.describe("journey overlay (D-T7)", () => {
  test.beforeEach(async ({ page }) => {
    await openScene(page, "day");
    await askDemoJourney(page);
    expect(
      await hasJourneyHook(page),
      "window.__journey (dev builds and the demo preset): a missing hook fails, never skips",
    ).toBe(true);
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
      // the journey camera eases into its pose over 1 s of wall clock after the player takes it:
      // judge the hold's framing, not a frame of that hand-over
      await cameraSettled(page);
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
      // Marker: the 48 x 48 px around its anchor must not be a dark quad (prototype bug). The
      // anchor is in the map canvas's CSS px (not the page's), and only the marker's own pixels
      // count: pixels any UI element covers (header, status, HUD, card, mini-map, controls) are
      // masked out. The marker must be visible: its anchor inside the canvas and not under UI
      // (gate: the hold-6 marker sat under the header, so the old crop sampled the toggle pill).
      const ax = Number(await cards.getAttribute("data-anchor-x"));
      const ay = Number(await cards.getAttribute("data-anchor-y"));
      expect(Number.isFinite(ax) && Number.isFinite(ay), `hold ${p.eventIndex} anchored`).toBe(
        true,
      );
      const m = await markerCrop(page, ax, ay);
      console.log(
        `AC-D11 hold ${p.eventIndex} (${ev.kind}): anchor canvas (${ax.toFixed(0)}, ${ay.toFixed(0)}) page (${m.px.toFixed(0)}, ${m.py.toFixed(0)}), ${m.onCanvas ? "on canvas" : "OFF canvas"}, ${m.anchorCovered ? `under UI (${m.coverBy})` : "clear of UI"}, ${(m.clearShare * 100).toFixed(0)}% of the crop clear`,
      );
      expect(m.onCanvas, `hold ${p.eventIndex} marker on the map`).toBe(true);
      expect(m.anchorCovered, `hold ${p.eventIndex} marker under UI: ${m.coverBy}`).toBe(false);
      expect(m.clearShare, `hold ${p.eventIndex} marker crop clear of UI`).toBeGreaterThanOrEqual(
        0.5,
      );
      const png = await page.screenshot({ clip: m.clip });
      const img = await decodePng(page, png);
      const dark = fractionBelow(lumaHistogram(img, { mask: m.mask }), 0.04);
      expect(dark, `hold ${p.eventIndex} marker dark share`).toBeLessThan(0.25);
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
