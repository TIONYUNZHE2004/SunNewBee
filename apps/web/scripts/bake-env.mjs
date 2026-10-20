// Bakes the scene environment (RoomEnvironment through PMREMGenerator.fromScene, sigma ENV_SIGMA)
// into public/city/env/room-pmrem.bin.gz (gzip) so the engine never runs the PMREM shaders at page load
// (ITER2 AC-D18: their link waited 434-814 ms in the first frame). Re-run after a three upgrade:
//   pnpm --filter @tl/web exec node scripts/bake-env.mjs
// Output: a 16-byte header (magic "TLEN", width u32, height u32, version u32) then RGBA half floats.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public/city/env/room-pmrem.bin.gz");
const server = await createServer({
  root,
  server: { port: 5299, strictPort: false },
  logLevel: "error",
});
await server.listen();
const url = server.resolvedUrls?.local[0] ?? "http://localhost:5299/";
const browser = await chromium.launch({
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage();
  await page.goto(`${url}scripts/bake-env.html`);
  await page.waitForFunction(() => "__bakeEnv" in window, null, { timeout: 60000 });
  const r = await page.evaluate(() => window.__bakeEnv());
  if (r.type !== 1016) throw new Error(`expected HalfFloatType (1016), got ${r.type}`);
  const head = Buffer.alloc(16);
  head.write("TLEN", 0, "ascii");
  head.writeUInt32LE(r.width, 4);
  head.writeUInt32LE(r.height, 8);
  head.writeUInt32LE(1, 12);
  const body = Buffer.from(Uint16Array.from(r.data).buffer);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, gzipSync(Buffer.concat([head, body]), { level: 9 }));
  console.log(`baked ${r.width}x${r.height} -> ${out}`);
} finally {
  await browser.close();
  await server.close();
}
