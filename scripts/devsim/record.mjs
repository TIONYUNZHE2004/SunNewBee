#!/usr/bin/env node
import { mkdirSync, renameSync } from "node:fs";
/**
 * Records a Playwright video of the full 66 s playback at 1440x860 for the prototype and,
 * with --product, the product.
 *
 *   node scripts/devsim/record.mjs [--proto http://127.0.0.1:5191] [--product http://127.0.0.1:5173] [--out <dir>]
 *
 * Output (webm) goes to --out (default: the QA scratch dir); never commit it.
 */
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { openProduct, openProto, VIEWPORT } from "./contact_sheet.mjs";

const require = createRequire(resolve(import.meta.dirname, "../../apps/web/package.json"));
const { chromium } = require("@playwright/test");

const a = process.argv.slice(2);
const get = (k, d) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : d);
const proto = get("--proto", "http://127.0.0.1:5191");
const product = get("--product", null);
const out = get("--out", "C:/Users/shaoxian04/AppData/Local/Temp/claude/devsim-qa");
mkdirSync(out, { recursive: true });

async function record(browser, name, open, url) {
  const dir = join(out, `video-${name}`);
  const { ctx, page } = await open(browser, url, { recordVideo: { dir, size: VIEWPORT } });
  // Restart from 0 and play in real time for the full run.
  await page.evaluate(() => {
    window.__devsim.seek(0);
    window.__devsim.play();
  });
  const total = await page.evaluate(() => window.__devsim.total ?? 66);
  await page.waitForTimeout((total + 1.5) * 1000);
  const video = page.video();
  await ctx.close();
  const dest = join(out, `${name}.webm`);
  renameSync(await video.path(), dest);
  console.log(`${name}:`, dest);
}

const browser = await chromium.launch({
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
await record(browser, "prototype", openProto, proto);
if (product) await record(browser, "product", openProduct, product);
await browser.close();
