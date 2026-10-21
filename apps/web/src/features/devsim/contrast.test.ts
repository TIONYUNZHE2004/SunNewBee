/**
 * Q3 (DOM part): every text/background token pair the devsim bubbles and labels use reaches
 * 4.5:1 in both skins. Token values are read from index.css; translucent glass is composited over
 * both a white and a black map behind it (the worst case wins).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BADGE_STYLE } from "./EndCard";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
  "utf8",
);

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--c-([\w-]+):\s*([^;]+);/g))
    out[m[1] as string] = (m[2] as string).trim();
  return out;
}

type RGBA = [number, number, number, number];
function parse(c: string): RGBA {
  if (c.startsWith("#")) {
    const h = c.slice(1);
    return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).concat(1) as RGBA;
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`colour ${c}`);
  const [r, g, b, a = "1"] = (m[1] as string).split(",").map((s) => s.trim());
  return [Number(r), Number(g), Number(b), Number(a)];
}
const over = (top: RGBA, under: RGBA): RGBA => {
  const a = top[3];
  return [0, 1, 2]
    .map((i) => (top[i] as number) * a + (under[i] as number) * (1 - a))
    .concat(1) as RGBA;
};
const lum = (c: RGBA) => {
  const ch = [0, 1, 2].map((i) => {
    const v = (c[i] as number) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] as number) + 0.7152 * (ch[1] as number) + 0.0722 * (ch[2] as number);
};
function contrast(fg: RGBA, bg: RGBA): number {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x) as [number, number];
  return (a + 0.05) / (b + 0.05);
}

const WHITE: RGBA = [255, 255, 255, 1];
const BLACK: RGBA = [0, 0, 0, 1];
/** Worst contrast of fg on bg, bg composited over a white and a black map. */
const worst = (fg: string, bg: string) => {
  const b = parse(bg);
  return Math.min(...[WHITE, BLACK].map((m) => contrast(over(parse(fg), over(b, m)), over(b, m))));
};

const skins = { dark: block(":root,"), light: block(':root[data-skin="light"]') };

/** [text token, background token, where] — the pairs used by Bubble, RouteTag, labels, badges. */
const PAIRS: [string, string, string][] = [
  ["fg", "surface", "bubble text and speaker name, route tag body, end card text"],
  ["fg-soft", "surface", "route tag source line, end card subtitle and legend"],
  ["on-accent", "accent", "hypothetical development label"],
  ["fg", "glass", "Simulation badge, HUD, feedback badge"],
  ["on-status", "rose", "feedback counter"],
];

describe("Q3 contrast tokens (≥ 4.5:1)", () => {
  for (const [name, t] of Object.entries(skins))
    for (const [fg, bg, where] of PAIRS)
      it(`${name}: ${fg} on ${bg} (${where})`, () => {
        expect(t[fg], fg).toBeTruthy();
        expect(t[bg], bg).toBeTruthy();
        expect(worst(t[fg] as string, t[bg] as string)).toBeGreaterThanOrEqual(4.5);
      });

  it("end card source chips", () => {
    for (const s of Object.values(BADGE_STYLE))
      expect(worst(s.fg, s.bg)).toBeGreaterThanOrEqual(4.5);
  });
});
