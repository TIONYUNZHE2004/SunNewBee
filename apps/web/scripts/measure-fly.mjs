// Streaming hitch measurement (P4 Task 15 fly test, P5 Task 5): fly hero-mid -> probe-c -> probe-a
// -> hero-mid three times at Medium and report every `tl:*` User Timing measure (max and p95 by
// name), the frames, and the renderer memory per loop (drift). Three.js Stylised (the default; never
// the Cesium Realistic style: billable Google tiles).
//
// Needs a running dev server on mock (from the repo root: `LLM_PROVIDER=mock pnpm dev`), then:
//   pnpm --filter @tl/web exec node scripts/measure-fly.mjs [--base http://localhost:5173]
//     [--out <dir>] [--swiftshader] [--quiet-ms 4000]
// Runs headless Chromium on the GPU (ANGLE d3d11) by default; SwiftShader is 4-7 s a frame and
// useless for timing. Numbers are indicative (one machine). Pass: no `tl:stream-*` measure > 16 ms.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const BASE = opt("--base", "http://localhost:5173");
const OUT = opt("--out", ".");
mkdirSync(OUT, { recursive: true });

const BOOK = {
  "hero-mid": [101.5095, 3.1805, 800],
  "probe-a": [101.50863, 3.1666, 800],
  "probe-c": [101.53193, 3.1725, 800],
};

function init({ tier, theme, noWorker }) {
  // --no-worker: the main-thread planning path (A/B against the Worker).
  if (noWorker) delete window.Worker;
  try {
    localStorage.setItem("tl.quality", tier);
    localStorage.setItem("tl.theme", theme);
  } catch {}
  const t = new EventTarget();
  window.__THREE_DEVTOOLS__ = t;
  window.__tlR = [];
  t.addEventListener("observe", (e) => {
    const d = e.detail;
    if (d && d.info && typeof d.render === "function") window.__tlR.push(d);
  });
  window.__tlM = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        if (e.name.startsWith("tl:"))
          window.__tlM.push({ n: e.name, s: e.startTime, d: e.duration });
    }).observe({ type: "measure", buffered: true });
  } catch {}
  window.__tlF = [];
  window.__tlRec = false;
  const loop = (ts) => {
    if (window.__tlRec) window.__tlF.push(ts);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

async function open(browser, view, tier, theme, errors) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(init, { tier, theme, noWorker: args.includes("--no-worker") });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning")
      errors.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  await page.goto(`${BASE}/?bookmark=${view}&perf=1`);
  await page.getByTestId("three-scene").waitFor({ state: "visible", timeout: 120_000 });
  await page.waitForFunction(
    () => {
      const s = document.querySelector('[data-testid="three-scene"]');
      return (
        Number(s?.getAttribute("data-frames") ?? 0) > 0 &&
        s?.getAttribute("data-assets") !== "loading"
      );
    },
    null,
    { timeout: 180_000, polling: 500 },
  );
  return { context, page };
}

/** data-tiles > 0 and unchanged, and no tl:* measure, for >= quietMs. */
async function settle(page, quietMs = Number(opt("--quiet-ms", "4000")), maxMs = 120_000) {
  const t0 = Date.now();
  let lastTiles = -1;
  let lastM = -1;
  let since = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await page.evaluate(() => ({
      tiles: Number(
        document.querySelector('[data-testid="three-scene"]')?.getAttribute("data-tiles") ?? 0,
      ),
      m: window.__tlM.length,
    }));
    if (s.tiles !== lastTiles || s.m !== lastM) {
      lastTiles = s.tiles;
      lastM = s.m;
      since = Date.now();
    } else if (s.tiles > 0 && Date.now() - since >= quietMs)
      return { tiles: s.tiles, ms: Date.now() - t0 };
    await page.waitForTimeout(250);
  }
  return { tiles: lastTiles, ms: Date.now() - t0, timeout: true };
}

const mem = (page) =>
  page.evaluate(() => {
    const r = window.__tlR.at(-1);
    return r
      ? {
          renderers: window.__tlR.length,
          geometries: r.info.memory.geometries,
          textures: r.info.memory.textures,
          calls: r.info.render.calls,
          tris: r.info.render.triangles,
        }
      : null;
  });

const browser = await chromium.launch({
  args: args.includes("--swiftshader")
    ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    : ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const results = [];
const save = () => writeFileSync(join(OUT, "fly.json"), JSON.stringify(results, null, 2));
try {
  {
    const errors = [];
    const { context, page } = await open(browser, "hero-mid", "medium", "day", errors);
    await settle(page);
    await page.waitForTimeout(1500);
    const fly = async (id) => {
      const [lon, lat, r] = BOOK[id];
      await page.evaluate(
        async ([lon, lat, r]) => {
          const { useScene } = await import("/src/features/scene/sceneStore.ts");
          useScene
            .getState()
            .applyIntent({ kind: "camera.fly_to", center: [lon, lat], range_m: r });
        },
        [lon, lat, r],
      );
      await page.waitForTimeout(2200); // FLY_MS 1800
      return settle(page);
    };
    const before = await mem(page);
    results.push({ at: "before loop 1", mem: before });
    console.log("before", JSON.stringify(before));
    await page.evaluate(() => {
      window.__tlM0 = window.__tlM.length;
      window.__tlF = [];
      window.__tlRec = true;
    });
    const TRACE = opt("--trace", null);
    let tracing = !!TRACE;
    if (TRACE)
      await browser.startTracing(page, {
        path: TRACE,
        screenshots: false,
        categories: [
          "devtools.timeline",
          "disabled-by-default-devtools.timeline",
          "disabled-by-default-v8.cpu_profiler",
          "v8.execute",
          "toplevel",
          "blink.user_timing",
          "v8",
          "disabled-by-default-v8.gc",
        ],
      });
    for (let loop = 1; loop <= 3; loop++) {
      if (tracing && loop === Number(opt("--trace-loops", "1")) + 1) {
        await browser.stopTracing();
        tracing = false;
      }
      const legs = [];
      for (const id of ["probe-c", "probe-a", "hero-mid"]) legs.push({ id, ...(await fly(id)) });
      await page.waitForTimeout(1000);
      const m = await mem(page);
      results.push({ at: `after loop ${loop}`, mem: m, legs });
      console.log(`loop ${loop}`, JSON.stringify(m), JSON.stringify(legs));
      save();
    }
    if (tracing) await browser.stopTracing();
    const stats = await page.evaluate(() => {
      window.__tlRec = false;
      const ms = window.__tlM.slice(window.__tlM0);
      const f = window.__tlF;
      const frames = [];
      for (let i = 1; i < f.length; i++) frames.push([f[i - 1], f[i] - f[i - 1]]);
      const by = (n) => ms.filter((e) => e.n === n);
      const mx = (a) => Math.max(0, ...a.map((e) => e.d));
      const p95 = (a) => {
        const s = a.map((e) => e.d).sort((x, y) => x - y);
        return s.length ? s[Math.floor(0.95 * (s.length - 1))] : 0;
      };
      const frameOf = (t) => {
        for (const [s, d] of frames) if (t >= s && t < s + d) return d;
        return null;
      };
      const names = {};
      for (const n of [...new Set(ms.map((e) => e.n))].sort()) {
        const l = by(n);
        names[n] = {
          n: l.length,
          max: mx(l),
          p95: p95(l),
          over8: l.filter((e) => e.d > 8).length,
          over16: l.filter((e) => e.d > 16).length,
        };
      }
      // The gate: every main-thread streaming task during the fly (ruling P5-15: the load-time
      // tl:stream-init and the cold first merge happen before this window and are not gated).
      const stream = ms.filter((e) => e.n.startsWith("tl:stream-") && e.n !== "tl:stream-init");
      // The worst streaming tasks, each with the measures nested in it (what it spent its time on).
      const worst = [...stream]
        .sort((a, b) => b.d - a.d)
        .slice(0, 8)
        .map((w) => ({
          ...w,
          inside: ms
            .filter((e) => e !== w && e.s >= w.s && e.s + e.d <= w.s + w.d + 0.1)
            .map((e) => `${e.n} ${e.d.toFixed(1)}`),
        }));
      const plans = [...by("tl:stream-plan"), ...by("tl:worker-plan")];
      const sortedFrames = frames.map((x) => x[1]).sort((a, b) => b - a);
      return {
        names,
        streamMax: mx(stream),
        worstStream: worst,
        pass16: mx(stream) <= 16,
        passScope:
          "max of tl:stream-* measures recorded during the 3 fly loops (after the first settle at hero-mid); load-time tl:stream-init and the cold first merge are outside the gate (ruling P5-15)",
        planP95: p95(plans),
        planMax: mx(plans),
        maxFrameWithStream: Math.max(
          0,
          ...stream.map((e) => frameOf(e.s)).filter((x) => x !== null),
        ),
        frames: frames.length,
        maxFrame: sortedFrames[0] ?? 0,
        top5Frames: sortedFrames.slice(0, 5),
        framesOver50: sortedFrames.filter((d) => d > 50).length,
        framesOver100: sortedFrames.filter((d) => d > 100).length,
      };
    });
    const loads = await page.evaluate(() =>
      window.__tlM
        .slice(0, window.__tlM0)
        .filter((e) => e.n.startsWith("tl:stream-"))
        .sort((a, b) => b.d - a.d)
        .slice(0, 8),
    );
    results.push({ at: "stats", stats, beforeFlyWorst: loads, errors });
    console.log(JSON.stringify(stats), errors.length);
    console.log(
      `fly gate (${stats.passScope}): max ${stats.streamMax.toFixed(1)} ms -> ${stats.pass16 ? "PASS" : "FAIL"} (<= 16 ms)`,
    );
    save();
    await context.close();
  }
} finally {
  await browser.close();
}
