import type * as THREE from "three";
import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { describe, expect, it } from "vitest";
import { createLineBatch, DASH_M_PER_PX, dashFromCesium } from "./lines";

const attr = (b: unknown, n: string) =>
  (b as LineSegments2).geometry.getAttribute(n) as THREE.BufferAttribute;

const line = new Float32Array([0, 0, 0, 10, 0, 0, 10, 0, 10]);
const mat = (o: unknown) => (o as LineSegments2).material as LineMaterial;

describe("createLineBatch", () => {
  it("draws in the overlay pass: depthTest false and renderOrder >= 10", () => {
    const b = createLineBatch([line], { color: "#C53030", widthPx: 5 }, 0.4, 10);
    expect(mat(b).depthTest).toBe(false);
    expect(mat(b).depthWrite).toBe(false);
    expect(b.renderOrder).toBeGreaterThanOrEqual(10);
    expect(mat(b).worldUnits).toBe(false);
    expect(mat(b).linewidth).toBe(5);
  });

  it("lifts every vertex to liftM", () => {
    const b = createLineBatch([line], { color: "#fff", widthPx: 2 }, 0.4, 10) as LineSegments2;
    const start = attr(b, "instanceStart");
    const end = attr(b, "instanceEnd");
    expect(start.count).toBe(2);
    for (let i = 0; i < 2; i++) {
      expect(start.getY(i)).toBeCloseTo(0.4, 6);
      expect(end.getY(i)).toBeCloseTo(0.4, 6);
    }
  });

  it("keeps the dash running across the vertices of one polyline", () => {
    const b = createLineBatch(
      [line],
      { color: "#fff", widthPx: 4, dash: { sizePx: 12, pattern: 0xf000 } },
      0.4,
      10,
    ) as LineSegments2;
    const ds = attr(b, "instanceDistanceStart");
    const de = attr(b, "instanceDistanceEnd");
    expect(ds.getX(0)).toBe(0);
    expect(de.getX(0)).toBeCloseTo(10, 4);
    expect(ds.getX(1)).toBeCloseTo(10, 4);
    expect(de.getX(1)).toBeCloseTo(20, 4);
  });

  it("dash of 12 px with 0xf000 is 3 px on and 9 px off", () => {
    const d = dashFromCesium({ dashLength: 12, dashPattern: 0xf000 });
    expect(d).toEqual({ sizePx: 12, pattern: 0xf000 });
    const b = createLineBatch([line], { color: "#fff", widthPx: 4, dash: d }, 0.4, 10);
    expect(mat(b).dashed).toBe(true);
    expect(mat(b).dashSize).toBeCloseTo(3 * DASH_M_PER_PX, 6);
    expect(mat(b).gapSize).toBeCloseTo(9 * DASH_M_PER_PX, 6);
  });

  it("applies opacity and skips lines under two points", () => {
    const b = createLineBatch(
      [line, new Float32Array([1, 0, 1])],
      { color: "#fff", widthPx: 2, opacity: 0.6 },
      0.4,
      10,
    ) as LineSegments2;
    expect(mat(b).opacity).toBe(0.6);
    expect(attr(b, "instanceStart").count).toBe(2);
  });
});
