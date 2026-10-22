import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPARE_RIBBON_STYLE } from "../../scene/styles";

declare const process: { cwd(): string };
const root = process.cwd();
const css: string = readFileSync(`${root}/src/index.css`, "utf8");
function block(selector: string): Record<string, string> {
  const i = css.indexOf(selector);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]),
  );
}
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * lin(((n >> 16) & 255) / 255) +
    0.7152 * lin(((n >> 8) & 255) / 255) +
    0.0722 * lin((n & 255) / 255)
  );
};
const contrast = (a: string, b: string) => {
  const [hi = 0, lo = 0] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const skins = {
  light: block(':root[data-skin="light"]'),
  dark: block(':root[data-skin="dark"]'),
};

describe("compare overlay colours are project tokens (night/dark mode)", () => {
  it("the overlay components carry no hex colour literals", () => {
    const dir = `${root}/src/features/journey/compare`;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx") && !x.includes(".test.")))
      expect(readFileSync(`${dir}/${f}`, "utf8"), f).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it.each(Object.entries(skins))("%s: route hues match the 3D ribbons", (_n, s) => {
    expect(s["c-cmp-fastest"]).toBe(COMPARE_RIBBON_STYLE.fastest);
    expect(s["c-cmp-recommended"]).toBe(COMPARE_RIBBON_STYLE.recommended);
    expect(s["c-cmp-unknown"]).toBe(COMPARE_RIBBON_STYLE.unchecked);
    expect(s["c-cmp-fail"]).toBe(COMPARE_RIBBON_STYLE.stop);
  });

  it.each(Object.entries(skins))("%s: tag text and notes pass AA on their backgrounds", (_n, s) => {
    const v = (k: string) => s[k] ?? "";
    for (const bg of ["c-cmp-fail-tint", "c-cmp-unknown-tint", "c-surface"]) {
      expect(contrast(v("c-fg"), v(bg)), `fg on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v("c-cmp-demo-note"), v(bg)), `note on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(v("c-cmp-resident"), v("c-surface"))).toBeGreaterThanOrEqual(4.5);
    // key pills: dark ink on the ribbon hues (white was 3.0–4.1:1); the hues are fixed to match the
    // 3D ribbons, so the red key stays just under AA (4.2:1) for its 10 px bold capitals
    for (const k of ["c-cmp-fastest", "c-cmp-recommended", "c-cmp-unknown", "c-cmp-info"])
      expect(contrast(v("c-cmp-on-tone"), v(k)), k).toBeGreaterThanOrEqual(4.3);
    expect(contrast(v("c-cmp-on-tone"), v("c-cmp-fail"))).toBeGreaterThanOrEqual(4.15);
  });
});
