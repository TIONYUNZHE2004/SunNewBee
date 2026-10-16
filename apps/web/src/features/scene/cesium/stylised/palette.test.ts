import { describe, expect, it } from "vitest";
import { paletteFor } from "./palette";

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
  const night = paletteFor("night");
  it("night sky is darker than day sky", () => {
    expect(lum(night.sky)).toBeLessThan(lum(day.sky));
  });
  it("day and night differ on ground", () => {
    expect(day.ground).not.toBe(night.ground);
  });
  it("windowLit has two colours and ambient is lower at night", () => {
    expect(night.windowLit).toHaveLength(2);
    expect(day.windowLit).toHaveLength(2);
    expect(night.ambient).toBeLessThan(day.ambient);
  });
  it("every colour is a 6-digit hex", () => {
    for (const p of [day, night]) {
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
});
