import { describe, expect, it } from "vitest";
import { NEUTRAL_COLOURS } from "../fallbackStyle";
import { type RoofBuilding, roofDressing } from "./roofPlan";

const rect = (w: number, d: number, x0 = 0): Array<[number, number]> => [
  [x0, 0],
  [x0 + w, 0],
  [x0 + w, -d],
  [x0, -d],
];
const big = (over: Partial<RoofBuilding> = {}): RoofBuilding => ({
  id: "big1",
  ring: rect(60, 30), // 1800 m2
  heightM: 12,
  kind: "industrial",
  archetype: "factory",
  ...over,
});

function inside(ring: Array<[number, number]>, x: number, z: number) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function edgeDist(ring: Array<[number, number]>, x: number, z: number) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]!;
    const [bx, bz] = ring[(i + 1) % ring.length]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}
const mats = (a: Float32Array) =>
  Array.from({ length: a.length / 16 }, (_, i) => Array.from(a.slice(i * 16, i * 16 + 16)));

describe("roofDressing", () => {
  it("puts units and skylights inside the roof, 1.0 m clear of the edge, at y = height", () => {
    for (const ring of [rect(60, 30), [...rect(60, 30)].reverse()]) {
      const r = roofDressing(big({ ring }), NEUTRAL_COLOURS);
      expect(r.units.length).toBeGreaterThan(0);
      expect(r.skylights.length).toBeGreaterThan(0);
      for (const m of [...mats(r.units), ...mats(r.skylights)]) {
        expect(m[13]).toBe(12);
        expect(inside(ring, m[12]!, m[14]!)).toBe(true);
        expect(edgeDist(ring, m[12]!, m[14]!)).toBeGreaterThanOrEqual(1.0);
      }
    }
  });

  it("keeps the whole unit and skylight footprint 1.0 m inside", () => {
    const ring = rect(60, 30);
    const r = roofDressing(big(), NEUTRAL_COLOURS);
    for (const m of [...mats(r.units), ...mats(r.skylights)]) {
      // Local box corners (+-0.5, y, +-0.5) through the matrix.
      for (const [sx, sz] of [
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
        [0.5, 0.5],
      ] as const) {
        const x = m[0]! * sx + m[8]! * sz + m[12]!;
        const z = m[2]! * sx + m[10]! * sz + m[14]!;
        expect(inside(ring, x, z)).toBe(true);
        expect(edgeDist(ring, x, z)).toBeGreaterThanOrEqual(1.0 - 1e-6);
      }
    }
  });

  it("places about one unit per 250 m2", () => {
    const r = roofDressing(big({ kind: "commercial", archetype: undefined }), NEUTRAL_COLOURS);
    expect(r.units.length / 16).toBeLessThanOrEqual(Math.floor(1800 / 250));
    expect(r.units.length / 16).toBeGreaterThanOrEqual(4);
    expect(r.skylights.length).toBe(0); // skylights are for factory / mall only
  });

  it("gives nothing below 600 m2", () => {
    const r = roofDressing(big({ ring: rect(24, 24) }), NEUTRAL_COLOURS); // 576 m2
    expect(r.units.length + r.skylights.length + r.band.length).toBe(0);
  });

  it("is deterministic per id and differs between ids", () => {
    const a = roofDressing(big(), NEUTRAL_COLOURS);
    const b = roofDressing(big(), NEUTRAL_COLOURS);
    expect(Array.from(a.units)).toEqual(Array.from(b.units));
    expect(Array.from(a.skylights)).toEqual(Array.from(b.skylights));
    const c = roofDressing(big({ id: "other" }), NEUTRAL_COLOURS);
    expect(Array.from(c.units)).not.toEqual(Array.from(a.units));
  });

  it("dresses nothing on a landmark (the modelled Lakeside Mall)", () => {
    const r = roofDressing(
      big({ id: "lakeside", archetype: "mall", isLandmark: true }),
      NEUTRAL_COLOURS,
    );
    expect(r.units.length + r.skylights.length + r.band.length).toBe(0);
  });

  it("skylights run every 12 m along the long axis, 1.5 m wide", () => {
    const r = roofDressing(big(), NEUTRAL_COLOURS);
    const m = mats(r.skylights);
    expect(m.length).toBe(Math.floor(60 / 12));
    // Long axis is x: centres spaced 12 m apart; width (local z scale) is 1.5 m.
    const xs = m.map((q) => q[12]!).sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBeCloseTo(12, 5);
    expect(Math.hypot(m[0]![8]!, m[0]![10]!)).toBeCloseTo(1.5, 5);
  });

  it("adds a 0.4 m edge band just inside the roof and uses the palette colours", () => {
    const ring = rect(60, 30);
    const r = roofDressing(big(), NEUTRAL_COLOURS);
    expect(r.band.length / 16).toBe(4);
    for (const m of mats(r.band)) {
      expect(Math.hypot(m[8]!, m[10]!)).toBeCloseTo(0.4, 5);
      expect(inside(ring, m[12]!, m[14]!)).toBe(true);
      expect(edgeDist(ring, m[12]!, m[14]!)).toBeCloseTo(0.2, 5);
    }
    expect(r.tint).toBe(NEUTRAL_COLOURS.roof);
    expect(r.edge).toBe(NEUTRAL_COLOURS.trim);
  });

  it("survives bad input", () => {
    expect(roofDressing(big({ ring: [] }), NEUTRAL_COLOURS).units.length).toBe(0);
    expect(roofDressing(big({ heightM: Number.NaN }), NEUTRAL_COLOURS).units.length).toBe(0);
  });
});
