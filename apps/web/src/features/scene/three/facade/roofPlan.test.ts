import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../../lib/api";
import { roofInputs } from "../assets/plan";
import { buildCityGeometry } from "../cityMesh";
import { NEUTRAL_COLOURS } from "../fallbackStyle";
import { createFrame } from "../frame";
import { largeRoofTint, ROOF_TINTS, type RoofBuilding, roofDressing } from "./roofPlan";

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

  it("adds a 0.4 m edge band on the flat cap inside the 0.5 m bevel, the large-roof tint and the palette trim", () => {
    const ring = rect(60, 30);
    const r = roofDressing(big(), NEUTRAL_COLOURS);
    expect(r.band.length / 16).toBe(4);
    for (const m of mats(r.band)) {
      expect(Math.hypot(m[8]!, m[10]!)).toBeCloseTo(0.4, 5);
      expect(inside(ring, m[12]!, m[14]!)).toBe(true);
      expect(edgeDist(ring, m[12]!, m[14]!)).toBeCloseTo(0.7, 5);
      // it stops short of the corners: its length is the edge minus the bevel and band at both ends
      const len = Math.hypot(m[0]!, m[2]!);
      expect([60, 30].map((e) => e - 1.8)).toContainEqual(expect.closeTo(len, 5));
    }
    expect(r.tint).toBe(largeRoofTint("big1", ring));
    expect(r.edge).toBe(NEUTRAL_COLOURS.trim);
  });

  it("survives bad input", () => {
    expect(roofDressing(big({ ring: [] }), NEUTRAL_COLOURS).units.length).toBe(0);
    expect(roofDressing(big({ heightM: Number.NaN }), NEUTRAL_COLOURS).units.length).toBe(0);
  });
});

/** HSL saturation of a #rrggbb colour (0 grey .. 1 pure hue). */
function saturation(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const hi = Math.max(...c);
  const lo = Math.min(...c);
  const l = (hi + lo) / 2;
  const d = hi - lo;
  return d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
}

describe("largeRoofTint (owner's P3 note: flat grey roofs)", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
  ) as { assets: Record<string, { palettes: Record<string, string[][]> }> };

  it("the palette roofs of the big-building archetypes are greys (before)", () => {
    const roofs = new Set<string>([NEUTRAL_COLOURS.roof]);
    for (const k of ["generic", "factory", "mall", "school", "shop_office", "highrise", "mosque"])
      for (const list of Object.values(manifest.assets[k]!.palettes))
        for (const p of list) roofs.add(p[1]!);
    for (const c of roofs) expect(saturation(c)).toBeLessThan(0.12);
  });

  it("keeps a palette roof that is already coloured (Denai Alam terracotta)", () => {
    expect(largeRoofTint("b1", rect(60, 30), "#8a4b35")).toBeNull();
    expect(largeRoofTint("b1", rect(60, 30), "#4a4e55")).toBe(largeRoofTint("b1", rect(60, 30)));
  });

  it("gives every roof of 600 m2 or more a non-grey tint from the documented set, deterministic per id", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const t = largeRoofTint(`b${i}`, rect(60, 30));
      expect(t).not.toBeNull();
      expect(ROOF_TINTS).toContain(t);
      expect(saturation(t!)).toBeGreaterThan(0.15);
      expect(largeRoofTint(`b${i}`, [...rect(60, 30)].reverse())).toBe(t);
      seen.add(t!);
    }
    expect(seen.size).toBeGreaterThan(1);
    for (const c of ROOF_TINTS) expect(c).not.toBe("#7fb6c9"); // never reads as base water
  });

  it("leaves small roofs (under 600 m2) and bad rings alone", () => {
    expect(largeRoofTint("s", rect(24, 24))).toBeNull();
    expect(largeRoofTint("s", [])).toBeNull();
  });
});

describe("roof units are seated on the rendered roof (P5 Task 6, whole Elmina seed)", () => {
  it("every unit and skylight base sits on the top of its building's drawn extrusion, over no other footprint", () => {
    const seed = (p: string) =>
      JSON.parse(
        readFileSync(
          new URL(`../../../../../../../data/seed/elmina/${p}`, import.meta.url),
          "utf8",
        ),
      );
    const frame = createFrame(seed("site.json").center);
    const layer = { buildings: seed("base/buildings.geojson") } as unknown as BuildingsLayer;
    const g = buildCityGeometry(layer, frame);
    // The rendered top of each building: the highest vertex of the triangles it owns.
    const pos = g.buildings.getAttribute("position");
    const index = g.buildings.index;
    const vert = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    const top = new Map<string, number>();
    g.faces.ids.forEach((id, bi) => {
      const end = g.faces.starts[bi + 1] ?? (index ? index.count : pos.count) / 3;
      let y = Number.NEGATIVE_INFINITY;
      for (let t = g.faces.starts[bi]!; t < end; t++)
        for (let k = 0; k < 3; k++) y = Math.max(y, pos.getY(vert(t, k)));
      top.set(id, y);
    });
    const feet = g.footprints.map((f) => {
      const xs = f.ring.map((p) => p[0]);
      const zs = f.ring.map((p) => p[1]);
      return {
        id: f.id,
        ring: f.ring as Array<[number, number]>,
        x0: Math.min(...xs),
        z0: Math.min(...zs),
        x1: Math.max(...xs),
        z1: Math.max(...zs),
      };
    });
    let n = 0;
    for (const { b, palette } of roofInputs(g.footprints, layer, null, frame)) {
      const d = roofDressing(b, palette);
      for (const m of [...mats(d.units), ...mats(d.skylights)]) {
        n++;
        expect(Math.abs(m[13]! - top.get(b.id)!)).toBeLessThanOrEqual(0.01);
        const [x, z] = [m[12]!, m[14]!];
        const over = feet.filter(
          (f) =>
            f.id !== b.id &&
            x >= f.x0 &&
            x <= f.x1 &&
            z >= f.z0 &&
            z <= f.z1 &&
            inside(f.ring, x, z),
        );
        expect(over.map((f) => f.id)).toEqual([]);
      }
    }
    expect(n).toBeGreaterThan(1000);
  }, 120_000);
});
