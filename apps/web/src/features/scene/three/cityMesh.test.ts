import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../lib/api";
import { WATER_COLOR } from "../styles";
import { buildCityGeometry, KIND_COLOUR, PARK_Y, WATER_Y } from "./cityMesh";
import { createFrame } from "./frame";

const frame = createFrame([101.5, 3.0]);

/** Axis-aligned square of `size` metres, lower-left corner at local (x, z), as a lon/lat ring. */
function square(x: number, z: number, size = 10, clockwise = false): [number, number][] {
  const pts: [number, number][] = [
    [x, z],
    [x + size, z],
    [x + size, z + size],
    [x, z + size],
  ];
  const ring = pts.map(([px, pz]) => frame.toLonLat(px, pz));
  const out = clockwise ? ring.reverse() : ring;
  return [...out, out[0]!];
}

const poly = (ring: unknown) => ({ type: "Polygon", coordinates: [ring] });
const fc = (features: unknown[]) => ({ type: "FeatureCollection", features });
const feat = (geometry: unknown, properties: Record<string, unknown> = {}) => ({
  type: "Feature",
  geometry,
  properties,
});

function layer(over: Partial<Record<"buildings" | "parks" | "water", unknown>> = {}) {
  return {
    attribution: [],
    buildings: fc([]),
    parks: fc([]),
    water: fc([]),
    trees: fc([]),
    ...over,
  } as unknown as BuildingsLayer;
}

const pos = (g: THREE.BufferGeometry) => g.getAttribute("position");

describe("buildCityGeometry", () => {
  it("one square building, height 9, is 30 vertices from y 0 to 9", () => {
    const g = buildCityGeometry(
      layer({ buildings: fc([feat(poly(square(0, 0)), { height_m: 9 })]) }),
      frame,
    );
    g.buildings.computeBoundingBox();
    expect(g.buildings.boundingBox!.max.y).toBeCloseTo(9, 6);
    expect(g.buildings.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(pos(g.buildings).count).toBe(30);
    expect(g.bounds.max.y).toBeCloseTo(9, 6);
    expect(g.skipped).toBe(0);
  });

  it.each([false, true])("walls face outward (clockwise input = %s)", (clockwise) => {
    const g = buildCityGeometry(
      layer({ buildings: fc([feat(poly(square(0, 0, 10, clockwise)), { height_m: 9 })]) }),
      frame,
    );
    const p = pos(g.buildings);
    const n = g.buildings.getAttribute("normal");
    let walls = 0;
    for (let t = 0; t < p.count; t += 3) {
      if (Math.abs(n.getY(t)) > 0.5) continue; // roof
      walls++;
      const cx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3;
      const cz = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3;
      const dot = n.getX(t) * (cx - 5) + n.getZ(t) * (cz - 5);
      expect(dot).toBeGreaterThan(0);
      // The winding agrees with the stored normal (front face outward).
      const a = new THREE.Vector3().fromBufferAttribute(p, t);
      const b = new THREE.Vector3().fromBufferAttribute(p, t + 1);
      const c = new THREE.Vector3().fromBufferAttribute(p, t + 2);
      const face = b.sub(a).cross(c.sub(a)).normalize();
      expect(face.x * n.getX(t) + face.z * n.getZ(t)).toBeGreaterThan(0.99);
    }
    expect(walls).toBe(8);
  });

  it("prefers display_height_m over height_m, and falls back to height_m without it", () => {
    const g = buildCityGeometry(
      layer({
        buildings: fc([
          feat(poly(square(0, 0)), { height_m: 9, display_height_m: 31.2 }),
          feat(poly(square(30, 0)), { height_m: 12 }),
        ]),
      }),
      frame,
    );
    const p = pos(g.buildings);
    const tops = new Set<number>();
    for (let i = 0; i < p.count; i++) tops.add(Math.round(p.getY(i) * 10) / 10);
    expect([...tops].sort((a, b) => a - b)).toEqual([0, 12, 31.2]);
  });

  it("min_height_m 3 lifts the wall base to y = 3", () => {
    const g = buildCityGeometry(
      layer({ buildings: fc([feat(poly(square(0, 0)), { height_m: 9, min_height_m: 3 })]) }),
      frame,
    );
    g.buildings.computeBoundingBox();
    expect(g.buildings.boundingBox!.min.y).toBeCloseTo(3, 6);
    expect(g.buildings.boundingBox!.max.y).toBeCloseTo(9, 6);
  });

  it("MultiPolygon, 2-point ring and non-finite coordinates are skipped and counted", () => {
    const good = feat(poly(square(0, 0)), { height_m: 9 });
    const multi = feat({ type: "MultiPolygon", coordinates: [[square(20, 0)]] });
    const two = feat(poly([frame.toLonLat(40, 0), frame.toLonLat(50, 0)]));
    const nan = feat(poly([...square(60, 0).slice(0, 3), [Number.NaN, 3]]));
    let g!: ReturnType<typeof buildCityGeometry>;
    expect(() => {
      g = buildCityGeometry(layer({ buildings: fc([good, multi, two, nan]) }), frame);
    }).not.toThrow();
    expect(g.skipped).toBe(3);
    expect(pos(g.buildings).count).toBe(30);
  });

  it("a zero-area footprint is skipped and counted", () => {
    const line = [0, 5, 10, 0].map((x) => frame.toLonLat(x, 0));
    const g = buildCityGeometry(layer({ buildings: fc([feat(poly(line))]) }), frame);
    expect(g.skipped).toBe(1);
    expect(pos(g.buildings).count).toBe(0);
  });

  it("empty or null layer gives empty geometries", () => {
    for (const l of [null, undefined, layer()]) {
      const g = buildCityGeometry(l, frame);
      expect(g.skipped).toBe(0);
      expect(pos(g.buildings).count).toBe(0);
      expect(pos(g.parks).count).toBe(0);
      expect(pos(g.water).count).toBe(0);
    }
  });

  it("parks sit at PARK_Y and water at WATER_Y, never in the flood colour", () => {
    const g = buildCityGeometry(
      layer({
        parks: fc([feat(poly(square(30, 0)))]),
        water: fc([feat(poly(square(60, 0)))]),
      }),
      frame,
    );
    expect(pos(g.parks).count).toBeGreaterThan(0);
    expect(pos(g.water).count).toBeGreaterThan(0);
    for (let i = 0; i < pos(g.parks).count; i++) expect(pos(g.parks).getY(i)).toBeCloseTo(PARK_Y);
    for (let i = 0; i < pos(g.water).count; i++) expect(pos(g.water).getY(i)).toBeCloseTo(WATER_Y);
    const flood = new THREE.Color(WATER_COLOR);
    const col = g.water.getAttribute("color");
    const c = new THREE.Color(col.getX(0), col.getY(0), col.getZ(0));
    expect(c.getHex()).not.toBe(flood.getHex());
  });

  it("water holes are not filled", () => {
    const outer = square(0, 0, 100);
    const hole = square(40, 40, 20, true);
    const g = buildCityGeometry(
      layer({ water: fc([feat({ type: "Polygon", coordinates: [outer, hole] })]) }),
      frame,
    );
    let area = 0;
    const p = pos(g.water);
    for (let t = 0; t < p.count; t += 3) {
      area +=
        Math.abs(
          (p.getX(t + 1) - p.getX(t)) * (p.getZ(t + 2) - p.getZ(t)) -
            (p.getX(t + 2) - p.getX(t)) * (p.getZ(t + 1) - p.getZ(t)),
        ) / 2;
    }
    expect(area).toBeCloseTo(100 * 100 - 20 * 20, 0);
  });

  it("vertex colour follows KIND_COLOUR[kind]", () => {
    const g = buildCityGeometry(
      layer({
        buildings: fc([
          feat(poly(square(0, 0)), { height_m: 9, kind: "industrial" }),
          feat(poly(square(30, 0)), { height_m: 9, kind: "residential" }),
        ]),
      }),
      frame,
    );
    const col = g.buildings.getAttribute("color");
    const at = (i: number) => new THREE.Color(col.getX(i), col.getY(i), col.getZ(i)).getHex();
    expect(at(0)).toBe(new THREE.Color(KIND_COLOUR.industrial).getHex());
    expect(at(30)).toBe(new THREE.Color(KIND_COLOUR.residential).getHex());
    expect(at(0)).not.toBe(at(30));
  });

  it("ground covers the building bounds plus a 500 m margin", () => {
    const g = buildCityGeometry(
      layer({ buildings: fc([feat(poly(square(0, 0)), { height_m: 9 })]) }),
      frame,
    );
    expect(g.ground.center[0]).toBeCloseTo(5, 3);
    expect(g.ground.center[1]).toBeCloseTo(5, 3);
    expect(g.ground.size[0]).toBeCloseTo(10 + 1000, 3);
    expect(g.ground.size[1]).toBeCloseTo(10 + 1000, 3);
  });
});
