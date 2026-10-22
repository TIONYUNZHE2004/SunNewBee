import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { HOOK, openScene } from "./support/bookmarks";

/**
 * AC-P2 (demo polish C10): the building move-in at Medium: p95 at most 33 ms, at most 150 draw
 * calls and at most 2.5 M triangles (headless, same machine). The dev demo plan
 * (`?devsim=provisional`, dev build only) is `plan.elmina.json`, the 45 s building plan (C7), so
 * the move-in plays on its 27-33 s window. Elmina seed, Stylised, Medium.
 * - display frames: `__tlAcceptance.measure(6, 0)` while the playback runs 27 -> 33 s;
 * - draws / triangles: paused at 27.5, 29, 30.5, 32, 33 s, the last perf sample of a 0.6 s
 *   `measure` at each (every frame forced), the maximum kept;
 * - the same paused draws / triangles at the close beats (`ACCEPTANCE_P2_CLOSE`, default Halim
 *   6 s, Farid 15 s, the worker 21 s, Zainab 35 s, Arjun 38 s; reported, not gated: AC-P2 is the
 *   move-in);
 * - the `bld` hook's move-in counts at 33 s.
 * Run against a dev server (`LLM_PROVIDER=mock pnpm dev`, map keys blank):
 *   ACCEPTANCE_BASE_URL=http://localhost:5185 pnpm --filter @tl/web acceptance -g "AC-P2"
 * Output: ACCEPTANCE_OUT, default `<main checkout>/.superpowers/sdd/2026-10-21-demo-polish/acceptance/C-align`.
 */
function defaultOut(): string {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  return join(dirname(common), ".superpowers/sdd/2026-10-21-demo-polish/acceptance/C-align");
}
const OUT = process.env.ACCEPTANCE_OUT ?? defaultOut();
/** The close beats sampled after the move-in (reported only). */
const CLOSE = (process.env.ACCEPTANCE_P2_CLOSE ?? "6,15,21,35,38").split(",").map(Number);

interface Summary {
  frames: number;
  medianFps: number;
  meanFps: number;
  p95FrameMs: number;
  perf: { drawCalls?: number; tris?: number; fps?: number } | null;
}
type Devsim = { seek(s: number): void; play(): void; pause(): void; state(): unknown };
type W = { __devsim?: Devsim; __tl?: { demo?: { set(k: string): void; state(): unknown } } };

const measure = (page: Page, s: number) =>
  page.evaluate(
    ({ h, s }) =>
      (window as unknown as Record<string, { measure(s: number, o: number): Promise<Summary> }>)[
        h
      ]?.measure(s, 0),
    { h: HOOK, s },
  ) as Promise<Summary>;

const seek = (page: Page, t: number) =>
  page.evaluate((t) => {
    const d = (window as unknown as W).__devsim;
    d?.pause();
    d?.seek(t);
  }, t);

test("AC-P2: building move-in at Medium (p95, draws, triangles)", async ({ page }) => {
  test.setTimeout(6 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const gpu = await openScene(page, "day");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("tl.quality", "medium");
    } catch {
      /* the quality check below fails */
    }
  });
  await page.goto("/?acceptance=1&sun=pinned&devsim=provisional");
  await page.locator('[data-testid="three-scene"]').waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction((h) => h in window, HOOK, { timeout: 60_000 });
  await page.waitForFunction(() => !!(window as unknown as W).__devsim, null, {
    timeout: 60_000,
  });
  const quality = await page.evaluate(() => localStorage.getItem("tl.quality"));
  expect(quality).toBe("medium");
  // let the city, crowd kit and worker kit load, then warm the move-in (programs, kit meshes)
  await page.waitForTimeout(8000);
  for (const t of [27.5, 30, 33]) {
    await seek(page, t);
    await page.waitForTimeout(800);
  }

  // draws and triangles across the move-in (paused, every frame forced)
  const samples: { t: number; drawCalls: number; tris: number; p95: number }[] = [];
  for (const t of [27.5, 29, 30.5, 32, 33]) {
    await seek(page, t);
    await page.waitForTimeout(400);
    const m = await measure(page, 0.6);
    samples.push({
      t,
      drawCalls: m.perf?.drawCalls ?? -1,
      tris: m.perf?.tris ?? -1,
      p95: m.p95FrameMs,
    });
  }
  // the close beats (reported, not gated)
  const close: typeof samples = [];
  for (const t of CLOSE) {
    await seek(page, t);
    await page.waitForTimeout(400);
    const m = await measure(page, 0.6);
    close.push({
      t,
      drawCalls: m.perf?.drawCalls ?? -1,
      tris: m.perf?.tris ?? -1,
      p95: m.p95FrameMs,
    });
  }
  // display frames while it plays 27 -> 33 s
  await seek(page, 27);
  await page.waitForTimeout(500);
  // long tasks while it plays (main-thread stalls the frame summary drops as idle gaps > 500 ms)
  await page.evaluate(() => {
    const w = window as unknown as { __p2Long?: number[] };
    w.__p2Long = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__p2Long?.push(Math.round(e.duration));
    }).observe({ type: "longtask" });
  });
  await page.evaluate(() => (window as unknown as W).__devsim?.play());
  const t0 = Date.now();
  const play = await measure(page, 6);
  const playWallS = (Date.now() - t0) / 1000;
  const playT = await page.evaluate(
    () => ((window as unknown as W).__devsim?.state() as { t?: number } | null)?.t ?? null,
  );
  const longTasks = await page.evaluate(
    () => (window as unknown as { __p2Long?: number[] }).__p2Long ?? [],
  );
  await page.evaluate(() => (window as unknown as W).__devsim?.pause());
  // uncapped render cost (renderNow + gl.finish) paused at the busiest move-in beats
  const uncapped: Record<string, unknown> = {};
  for (const t of [29, 30.5, 32]) {
    await seek(page, t);
    await page.waitForTimeout(400);
    uncapped[String(t)] = await page.evaluate(
      (h) =>
        (window as unknown as Record<string, { measureUncapped(n: number, o: number): unknown }>)[
          h
        ]?.measureUncapped(120, 0),
      HOOK,
    );
  }
  await seek(page, 33);
  await page.waitForTimeout(600);
  const counts = await page.evaluate(() => {
    const d = (window as unknown as W).__tl?.demo;
    d?.set("bld");
    return d?.state();
  });
  const name = "ac-p2";
  await page.screenshot({ path: join(OUT, `${name}-33s.png`) });

  const maxDraws = Math.max(...samples.map((s) => s.drawCalls));
  const maxTris = Math.max(...samples.map((s) => s.tris));
  const result = {
    task: "demo polish C-align AC-P2 (45 s building plan, dev demo)",
    capturedAt: new Date().toISOString(),
    gpu,
    quality,
    play,
    playWallS,
    playT,
    longTasks,
    uncapped,
    samples,
    close,
    maxDraws,
    maxTris,
    counts,
    pass: play.p95FrameMs <= 33 && maxDraws <= 150 && maxTris <= 2_500_000,
  };
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `[AC-P2] play p95 ${play.p95FrameMs.toFixed(2)} ms median ${(1000 / play.medianFps).toFixed(2)} ms ` +
      `(${play.frames} frames); max draws ${maxDraws}; max tris ${maxTris}; ${JSON.stringify(samples)}; close ${JSON.stringify(close)}`,
  );
  expect(play.frames).toBeGreaterThan(0);
  expect(maxDraws).toBeGreaterThan(0);
  expect(play.p95FrameMs).toBeLessThanOrEqual(33);
  expect(maxDraws).toBeLessThanOrEqual(150);
  expect(maxTris).toBeLessThanOrEqual(2_500_000);
});
