#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
/**
 * Development Simulation contact sheet (spec AC-C3) and prototype probe capture (AC-C1 fixture).
 *
 *   node scripts/devsim/contact_sheet.mjs [--proto http://127.0.0.1:5191] [--product http://127.0.0.1:5173]
 *        [--out <dir>] [--probe-fixture <json path>]
 *
 * Seeks the prototype (and, when --product is given, the product) to the 12 baseline times,
 * screenshots both at 1440x860 and composes a 2-column grid PNG (prototype left, product right)
 * with time labels, via an HTML grid screenshotted by Playwright (sharp is not a dependency).
 * With --probe-fixture it also writes the prototype's probe() at the 12 times as JSON.
 * Output goes to --out (default: the QA scratch dir); never commit it.
 */
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(resolve(import.meta.dirname, "../../apps/web/package.json"));
const { chromium } = require("@playwright/test");

export const TIMES = [2, 7, 11, 19, 24, 30, 37, 41, 48, 54, 60, 65];
export const VIEWPORT = { width: 1440, height: 860 };
const STARTER =
  "Simulate a 30-storey, 500-home tower near Lakeside Mall, from construction to daily life";

function args() {
  const a = process.argv.slice(2);
  const get = (k, d) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : d;
  };
  return {
    proto: get("--proto", "http://127.0.0.1:5191"),
    product: get("--product", null),
    out: get("--out", "C:/Users/shaoxian04/AppData/Local/Temp/claude/devsim-qa"),
    probeFixture: get("--probe-fixture", null),
  };
}

export async function openProto(browser, url, opts = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, ...opts });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.__devsim?.seek, null, { timeout: 90_000 });
  await page.evaluate(() => window.__devsim.pause());
  return { ctx, page };
}

/** Product side: Management tab -> starter -> wait for window.__devsim. */
export async function openProduct(browser, url, opts = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, ...opts });
  const page = await ctx.newPage();
  await page.goto(url);
  await page
    .getByRole("tab", { name: /management/i })
    .or(page.getByText(/^management$/i))
    .first()
    .click();
  await page.getByText(STARTER, { exact: false }).first().click();
  await page.waitForFunction(() => window.__devsim?.state?.(), null, { timeout: 120_000 });
  // The 3D canvas mounts after __devsim and autoplay starts once the plan is in: wait for the
  // canvas, let the tiles settle, then pause (an earlier pause is overridden by autoplay).
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("canvas")).some(
        (c) => c.getBoundingClientRect().width > 300 && c.getBoundingClientRect().height > 200,
      ),
    null,
    { timeout: 120_000 },
  );
  await page.waitForTimeout(8000);
  await page.evaluate(() => window.__devsim.pause?.());
  return { ctx, page };
}

/** Pause, seek, let frames render (rects and pixels come from the last rendered frame), shoot. */
export async function seekShot(page, t) {
  await page.evaluate(
    (s) =>
      new Promise((res) => {
        window.__devsim.pause?.();
        window.__devsim.seek(s);
        // at least three frames, then until the 3D view has rendered this t (probe renderedT)
        let n = 0;
        const step = () => {
          n++;
          const r = window.__devsim.probe?.()?.renderedT;
          const want = window.__devsim.state?.()?.t ?? s;
          if (n < 3 || (r !== undefined && r !== want && n < 120)) requestAnimationFrame(step);
          else res();
        };
        requestAnimationFrame(step);
      }),
    t,
  );
  await page.waitForTimeout(450);
  return page.screenshot({ type: "png" });
}

async function main() {
  const o = args();
  mkdirSync(o.out, { recursive: true });
  const browser = await chromium.launch({
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
  });
  const shots = { proto: [], product: [] };
  const probes = [];
  {
    const { ctx, page } = await openProto(browser, o.proto);
    for (const t of TIMES) {
      shots.proto.push(await seekShot(page, t));
      if (o.probeFixture) probes.push(await page.evaluate(() => window.__devsim.probe()));
    }
    await ctx.close();
  }
  if (o.product) {
    const { ctx, page } = await openProduct(browser, o.product);
    for (const t of TIMES) shots.product.push(await seekShot(page, t));
    await ctx.close();
  }
  if (o.probeFixture) {
    mkdirSync(dirname(o.probeFixture), { recursive: true });
    writeFileSync(
      o.probeFixture,
      `${JSON.stringify({ viewport: VIEWPORT, times: TIMES, capturedFrom: "docs/03-product/prototypes/developer-lens/index.html", probes }, null, 2)}\n`,
    );
    console.log("probe fixture:", o.probeFixture);
  }
  const img = (b) => `<img src="data:image/png;base64,${b.toString("base64")}">`;
  const cell = (b, label) =>
    `<figure>${b ? img(b) : '<div class="none">no product</div>'}<figcaption>${label}</figcaption></figure>`;
  const rows = TIMES.map(
    (t, i) =>
      `<div class="row"><div class="t">t = ${t} s</div>${cell(shots.proto[i], "prototype")}${cell(shots.product[i], "product")}</div>`,
  ).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#111;color:#eee;font:14px system-ui}
.row{display:grid;grid-template-columns:70px 1fr 1fr;gap:6px;padding:4px 6px;align-items:start}
.t{font-weight:700;padding-top:6px}figure{margin:0}img{width:100%;display:block}
figcaption{font-size:11px;opacity:.7}.none{aspect-ratio:1440/860;display:grid;place-items:center;background:#222}
</style>${rows}`;
  const sheet = await browser.newPage({ viewport: { width: 1800, height: 900 } });
  await sheet.setContent(html);
  await sheet.waitForTimeout(500);
  const outPng = join(o.out, "contact-sheet.png");
  await sheet.screenshot({ path: outPng, fullPage: true });
  console.log("contact sheet:", outPng);
  await browser.close();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
