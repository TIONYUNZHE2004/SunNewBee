// Draws, triangles, GPU MB and fps at the six probe views (P4 any-position budget), Medium tier,
// three.js engine only (never the Cesium Realistic style: billable Google tiles).
//
// Needs a running dev server on mock (from the repo root: `LLM_PROVIDER=mock pnpm dev`), then:
//   pnpm --filter @tl/web exec node scripts/measure-probes.mjs [--base http://localhost:5173]
//     [--shots <dir>] [--swiftshader] [--settle-ms 4000]
// Reads the `?perf=1` overlay ("<fps> fps · <ms> ms · <draws> draws · <M> M tris · ≈<MB> MB · tier")
// after the streamer has filled its tiles (`data-tiles` steady). Numbers are indicative (one
// machine, software GL with --swiftshader). Budget at Medium: ≤ 150 draws, ≤ 2.5 M tris, ≤ 150 MB.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const BASE = opt("--base", "http://localhost:5173");
const SHOTS = opt("--shots", null);
const SETTLE_MS = Number(opt("--settle-ms", "4000"));
const SWIFT = args.includes("--swiftshader");
const VIEWS = ["hero-mid", "township", "probe-a", "probe-b", "probe-c", "probe-d"];
const BUDGET = { draws: 150, tris: 2.5, mb: 150 };

const parse = (text) => {
  const num = (re) => {
    const m = re.exec(text);
    return m ? Number(m[1]) : null;
  };
  return {
    fps: num(/(\d+)\s*fps/),
    draws: num(/(\d+)\s*draws/),
    tris: num(/([\d.]+)\s*M tris/),
    mb: num(/≈\s*([\d.]+)\s*MB/),
    tier: /·\s*(high|medium|low)\b/.exec(text)?.[1] ?? null,
  };
};

const browser = await chromium.launch({
  args: SWIFT ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [],
});
const rows = [];
try {
  for (const view of VIEWS) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      try {
        localStorage.setItem("tl.quality", "medium");
      } catch {
        /* storage blocked: the tier stays auto */
      }
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/?bookmark=${view}&perf=1`);
    const scene = page.getByTestId("three-scene");
    await scene.waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForFunction(
      () => {
        const s = document.querySelector('[data-testid="three-scene"]');
        const a = s?.getAttribute("data-assets");
        return Number(s?.getAttribute("data-frames") ?? 0) > 0 && a !== "loading";
      },
      null,
      { timeout: 120_000 },
    );
    // The streamer plans one tile per 250 ms LOD tick: wait until data-tiles holds for 3 s.
    let last = -1;
    let since = Date.now();
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
      const n = Number((await scene.getAttribute("data-tiles")) ?? 0);
      if (n !== last) {
        last = n;
        since = Date.now();
      } else if (n > 0 && Date.now() - since > 3000) break;
      await page.waitForTimeout(250);
    }
    // Let facades (idle build), LOD buckets and the trailing LOD tick settle.
    await page.waitForTimeout(SETTLE_MS);
    // Several overlay samples (motion keeps frames coming); keep the worst draws / tris.
    const overlay = page.locator("div.font-mono", { hasText: "draws" }).first();
    let worst = null;
    for (let i = 0; i < 8; i++) {
      const p = parse((await overlay.textContent()) ?? "");
      if (!worst || (p.draws ?? 0) > (worst.draws ?? 0) || (p.tris ?? 0) > (worst.tris ?? 0))
        worst = { ...p, fps: worst ? Math.min(worst.fps ?? p.fps, p.fps ?? 0) : p.fps };
      await page.waitForTimeout(400);
    }
    const row = { view, tiles: last, ...worst };
    row.ok =
      (row.draws ?? Infinity) <= BUDGET.draws &&
      (row.tris ?? Infinity) <= BUDGET.tris &&
      (row.mb ?? Infinity) <= BUDGET.mb;
    rows.push(row);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: join(SHOTS, `probe-${view}.png`) });
    }
    console.log(JSON.stringify(row));
    await context.close();
  }
} finally {
  await browser.close();
}

console.log("\nview      | tiles | draws | M tris | MB  | fps | tier   | budget");
for (const r of rows)
  console.log(
    `${r.view.padEnd(9)} | ${String(r.tiles).padStart(5)} | ${String(r.draws).padStart(5)} | ${String(
      r.tris,
    ).padStart(6)} | ${String(r.mb).padStart(3)} | ${String(r.fps).padStart(3)} | ${String(
      r.tier,
    ).padEnd(6)} | ${r.ok ? "within" : "OVER"}`,
  );
