import { describe, expect, it } from "vitest";
import { WATER_COLOR } from "../../styles";
import { lerpPalette, paletteFor } from "./palette";

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("paletteFor", () => {
  const day = paletteFor("day");
  const dusk = paletteFor("dusk");
  const night = paletteFor("night");
  it("night sky is darker than day sky", () => {
    expect(lum(night.sky)).toBeLessThan(lum(day.sky));
  });
  it("dusk is between day and night: warmer sky than day, brighter than night", () => {
    expect(lum(dusk.sky)).toBeLessThan(lum(day.sky));
    expect(lum(dusk.sky)).toBeGreaterThan(lum(night.sky));
  });
  it("window glow and lit share rise from day to night", () => {
    expect(day.glow).toBe(0);
    expect(dusk.glow).toBeGreaterThan(0);
    expect(night.glow).toBe(1);
    expect(day.litFrac).toBeLessThan(dusk.litFrac);
    expect(dusk.litFrac).toBeLessThan(night.litFrac);
  });
  it("day and night differ on ground", () => {
    expect(day.ground).not.toBe(night.ground);
  });
  it("windowLit has two colours and ambient is lower at night", () => {
    expect(night.windowLit).toHaveLength(2);
    expect(day.windowLit).toHaveLength(2);
    expect(night.ambient).toBeLessThan(day.ambient);
  });
  it("decorative base water is visibly distinct from the flood-scenario water colour", () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
        number,
        number,
        number,
      ];
      const mx = Math.max(r, g, b);
      const d = mx - Math.min(r, g, b);
      if (d === 0) return 0;
      const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (const p of [day, dusk, night]) {
      expect(p.water.toLowerCase()).not.toBe(WATER_COLOR.toLowerCase());
      expect(Math.abs(hue(p.water) - hue(WATER_COLOR))).toBeGreaterThan(20); // teal-grey, not scenario blue
    }
  });
  it("every colour is a 6-digit hex", () => {
    for (const p of [day, dusk, night]) {
      const colours = [
        p.ground,
        p.road,
        p.water,
        p.sky,
        ...p.tree,
        p.trunk,
        ...p.car,
        ...Object.values(p.wall),
        ...Object.values(p.roof),
        ...p.windowLit,
        p.windowDark,
        p.sun.color,
      ];
      for (const c of colours) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it("lit windows have WCAG contrast >= 3 against night walls", () => {
    expect(contrast(night.windowLit[0], night.wall.warm)).toBeGreaterThanOrEqual(3);
  });
  it("lerpPalette is a at 0, b at 1, and mixes colours in between", () => {
    expect(lerpPalette(day, night, 0)).toEqual(day);
    expect(lerpPalette(day, night, 1)).toEqual(night);
    const mid = lerpPalette(day, night, 0.5);
    expect(mid.sky).not.toBe(day.sky);
    expect(mid.sky).not.toBe(night.sky);
    expect(mid.glow).toBeCloseTo(0.5);
  });
  it("every mood defines key/fill/bounce light, sky gradient and horizon", () => {
    for (const p of [day, dusk, night]) {
      for (const c of [p.light.key, p.light.fill, p.light.bounce, p.skyTop, p.horizon])
        expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(night.shadows).toBe(false);
    expect(day.bloom).toBe(false);
    expect(dusk.bloom && night.bloom).toBe(true);
  });
});
