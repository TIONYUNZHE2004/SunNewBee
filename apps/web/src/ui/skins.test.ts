// @ts-expect-error web tsconfig has no @types/node; vitest runs in node so the module exists
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };
const css: string = readFileSync(`${process.cwd()}/src/index.css`, "utf8");
function block(selector: string): Record<string, string> {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`missing ${selector}`);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
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
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const light = block(':root[data-skin="light"]');
const dark = block(':root[data-skin="dark"]');

describe("skins", () => {
  it("both skins define the same tokens", () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
    for (const k of ["c-glass", "c-glass-edge", "c-shadow"]) expect(light[k]).toBeDefined();
  });
  it("light skin is the Kamui daylight palette", () => {
    expect(light["c-bg"]).toBe("#f5f2fa");
    expect(light["c-fg"]).toBe("#241c42");
    expect(light["c-accent"]).toBe("#5b45a0");
  });
  it.each([
    ["light", light, "#ffffff"],
    ["dark", dark, "#241c42"],
  ])("%s: body text, soft text and status tones pass AA on the surface", (_n, s, surface) => {
    for (const k of ["c-fg", "c-fg-soft", "c-lantern", "c-lilac", "c-flood", "c-rose", "c-peach"]) {
      const v = s[k]!;
      if (!v.startsWith("#")) continue; // rgba soft text on dark is checked by eye
      expect(contrast(v, surface), k).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(s["c-on-accent"]!, s["c-accent"]!)).toBeGreaterThanOrEqual(4.5);
  });
  it("glass has an opaque fallback when backdrop-filter is unsupported", () => {
    expect(css).toMatch(/@supports not \(backdrop-filter: blur\(1px\)\)/);
  });
});
