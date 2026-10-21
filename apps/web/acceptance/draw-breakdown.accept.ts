import { writeFileSync } from "node:fs";
import { type Page, test } from "@playwright/test";
import { HOOK, openScene } from "./support/bookmarks";

/**
 * Draw breakdown (C10p diagnostics): draw calls and triangles per scene group and pass (main,
 * override = the GTAO normal pass, shadow) on the devsim dev demo at the seeks in DIAG_SEEKS
 * (default the AC-P2 seeks), attributed from `renderer.info` deltas between per-object
 * `onBeforeRender` / `onBeforeShadow` hooks over 4 `measureUncapped` frames; then engine frames
 * against reported frames while it plays 27 -> 33 s. Post-process quads land on the key drawn
 * last in a pass. Output DIAG_OUT (JSON); DIAG_SHOTS=<prefix> also screenshots each seek;
 * DIAG_SP=0 drops the pre-C7 set pieces. Dev server as for AC-P2:
 *   ACCEPTANCE_BASE_URL=http://localhost:5185 pnpm --filter @tl/web acceptance -g "draw breakdown"
 */
const OUT = process.env.DIAG_OUT ?? "diag.json";
const SEEKS = (process.env.DIAG_SEEKS ?? "27.5,29,30.5,32,33").split(",").map(Number);

type Devsim = { seek(s: number): void; play(): void; pause(): void; state(): unknown };
type W = { __devsim?: Devsim; __devsimLayer?: { group: { parent: unknown } } };

const seek = (page: Page, t: number) =>
  page.evaluate((t) => {
    const d = (window as unknown as W).__devsim;
    d?.pause();
    d?.seek(t);
  }, t);

/** Installs per-object hooks on the main scene (idempotent; new objects get hooked each call). */
const install = (page: Page) =>
  page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: diagnostics
    const w = window as any;
    const scene = w.__devsimLayer?.group?.parent;
    if (!scene) return 0;
    // biome-ignore lint/suspicious/noExplicitAny: diagnostics
    w.__diag ??= { acc: {}, lastKey: "pre", lastCalls: 0, lastTris: 0, r: null };
    // biome-ignore lint/suspicious/noExplicitAny: diagnostics
    const D: any = w.__diag;
    const credit = (r: { info: { render: { calls: number; triangles: number } } }) => {
      const c = r.info.render.calls;
      const t = r.info.render.triangles;
      let dc = c - D.lastCalls;
      let dt = t - D.lastTris;
      if (dc < 0 || dt < 0) {
        dc = c;
        dt = t;
      }
      D.acc[D.lastKey] ??= { calls: 0, tris: 0 };
      const a = D.acc[D.lastKey];
      a.calls += dc;
      a.tris += dt;
      D.lastCalls = c;
      D.lastTris = t;
    };
    D.credit = credit;
    // biome-ignore lint/suspicious/noExplicitAny: diagnostics
    const keyOf = (o: any) => {
      const chain: string[] = [];
      let p = o;
      while (p && p !== scene) {
        chain.unshift(p.name || p.type);
        p = p.parent;
      }
      return chain.slice(0, 3).join("/");
    };
    let n = 0;
    // biome-ignore lint/suspicious/noExplicitAny: diagnostics
    scene.traverse((o: any) => {
      if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite)) return;
      if (o.__diag) return;
      o.__diag = true;
      n++;
      const key = keyOf(o);
      const ob = o.onBeforeRender;
      // biome-ignore lint/suspicious/noExplicitAny: diagnostics
      o.onBeforeRender = function (r: any, s: any, c: any, g: any, m: any, gr: any) {
        D.r = r;
        credit(r);
        const rt = r.getRenderTarget();
        const pass = m !== o.material && !Array.isArray(o.material) ? "override" : "main";
        D.lastKey = `${pass}${rt ? "" : ":screen"}|${key}`;
        return ob.call(this, r, s, c, g, m, gr);
      };
      const os = o.onBeforeShadow;
      // biome-ignore lint/suspicious/noExplicitAny: diagnostics
      o.onBeforeShadow = function (r: any, ...rest: any[]) {
        D.r = r;
        credit(r);
        D.lastKey = `shadow|${key}`;
        return os.call(this, r, ...rest);
      };
    });
    return n;
  });

test("draw breakdown: draws and triangles by group", async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await openScene(page, "day");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("tl.quality", "medium");
    } catch {}
  });
  await page.goto(
    `/?acceptance=1&sun=pinned&devsim=provisional${process.env.DIAG_SP === "0" ? "" : "&setpieces=preC7"}`,
  );
  await page.locator('[data-testid="three-scene"]').waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction((h) => h in window, HOOK, { timeout: 60_000 });
  await page.waitForFunction(() => !!(window as unknown as W).__devsim, null, { timeout: 60_000 });
  await page.waitForTimeout(8000);
  for (const t of [27.5, 30, 33]) {
    await seek(page, t);
    await page.waitForTimeout(800);
  }
  const out: Record<string, unknown> = {};
  for (const t of SEEKS) {
    await seek(page, t);
    await page.waitForTimeout(600);
    await install(page);
    const res = await page.evaluate(
      ({ h, N }) => {
        // biome-ignore lint/suspicious/noExplicitAny: diagnostics
        const w = window as any;
        const D = w.__diag;
        D.acc = {};
        D.lastKey = "pre";
        D.lastCalls = 0;
        D.lastTris = 0;
        const total = { calls: 0, tris: 0 };
        // one frame at a time so per-frame totals are known
        for (let i = 0; i < N; i++) {
          D.lastCalls = 0;
          D.lastTris = 0;
          D.lastKey = "pre";
          w[h].measureUncapped(1, 0);
          if (D.r) {
            D.credit(D.r);
            total.calls += D.r.info.render.calls;
            total.tris += D.r.info.render.triangles;
          }
        }
        const acc: Record<string, { calls: number; tris: number }> = {};
        for (const [k, v] of Object.entries(D.acc) as [string, { calls: number; tris: number }][])
          acc[k] = { calls: v.calls / N, tris: Math.round(v.tris / N) };
        const cam = w[h].cameraLocal();
        const off = w.__devsimLayer?.state()?.camera?.offset ?? [0, 0, 0];
        cam.push(Math.hypot(off[0], off[1], off[2]));
        return { total: { calls: total.calls / N, tris: total.tris / N }, acc, cam };
      },
      { h: HOOK, N: 4 },
    );
    out[String(t)] = res;
    if (process.env.DIAG_SHOTS)
      await page.screenshot({ path: `${process.env.DIAG_SHOTS}-${t}.png` });
  }
  // play: engine frames vs reported frames
  await seek(page, 27);
  await page.waitForTimeout(500);
  const play = await page.evaluate(async (h) => {
    // biome-ignore lint/suspicious/noExplicitAny: diagnostics
    const w = window as any;
    const f0 = w[h].frames();
    w.__devsim.play();
    const m = await w[h].measure(6, 0);
    const f1 = w[h].frames();
    w.__devsim.pause();
    return { engineFrames: f1 - f0, reported: m.frames, p95: m.p95FrameMs, perf: m.perf };
  }, HOOK);
  out.play = play;
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
});
