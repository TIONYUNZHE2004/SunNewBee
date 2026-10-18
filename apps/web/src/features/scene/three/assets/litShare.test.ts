import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { glowFor } from "../mood";
import { loadAssetLibrary } from "./library";
import { parseManifest } from "./manifest";

const CITY = resolve(__dirname, "../../../../../public/city");
const { manifest } = parseManifest(
  JSON.parse(readFileSync(resolve(CITY, "manifest.json"), "utf8")),
);

const readGlb = async (url: string) => {
  const b = readFileSync(resolve(CITY, url.replace(/^\/city\//, "").split("?")[0] as string));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** Mirrors roleMaterial.ts: glass = floor(g*7+0.5) === 3, lit when b < uLitShare. */
function litShare(
  color: { count: number; getY(i: number): number; getZ(i: number): number },
  threshold: number,
) {
  let glass = 0;
  let lit = 0;
  for (let i = 0; i < color.count; i++) {
    if (Math.floor(color.getY(i) * 7 + 0.5) !== 3) continue;
    glass++;
    if (color.getZ(i) < threshold) lit++;
  }
  return { glass, lit, share: glass ? lit / glass : 0 };
}

const ASSETS = ["highrise", "link_intermediate", "shop_office", "kanopi", "mall"];

describe("night lit-window share per glass archetype (packed glbs)", () => {
  it("is in [0.35, 0.65] at the night uLitShare", async () => {
    expect(manifest).not.toBeNull();
    const threshold = glowFor({ day: 0, dusk: 0, night: 1 }).uLitShare;
    const lib = await loadAssetLibrary(manifest!, { loadGlb: readGlb, assets: ASSETS });
    expect(lib.failed).toEqual([]);
    const rows: string[] = [];
    for (const id of ASSETS) {
      const spec = manifest!.assets[id]!;
      for (const variant of Object.keys(spec.variants)) {
        const g = lib.geometry(id, variant, 0);
        const col = g?.getAttribute("color");
        expect(col, `${id}/${variant} has colour`).toBeDefined();
        const r = litShare(col as never, threshold);
        rows.push(`${id}/${variant} glass=${r.glass} share=${r.share.toFixed(3)}`);
        expect(r.glass, `${id}/${variant} has glass`).toBeGreaterThan(0);
        expect(r.share, `${id}/${variant}`).toBeGreaterThanOrEqual(0.35);
        expect(r.share, `${id}/${variant}`).toBeLessThanOrEqual(0.65);
      }
    }
    console.log(rows.join("\n"));
    lib.dispose();
  });
});
