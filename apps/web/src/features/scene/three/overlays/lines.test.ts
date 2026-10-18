import type * as THREE from "three";
import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { describe, expect, it } from "vitest";
import {
  createLineBatch,
  dashFromCesium,
  distanceFade,
  FADE_FAR_M,
  FADE_NEAR_M,
  LINE_DEPTH_BIAS,
  setDashScale,
} from "./lines";

const attr = (b: unknown, n: string) =>
  (b as LineSegments2).geometry.getAttribute(n) as THREE.BufferAttribute;

const line = new Float32Array([0, 0, 0, 10, 0, 0, 10, 0, 10]);
const mat = (o: unknown) => (o as LineSegments2).material as LineMaterial;

describe("createLineBatch", () => {
  it("depth-tests (AC-A2): depthTest true, no depth write, polygon offset, renderOrder >= 10", () => {
    const b = createLineBatch([line], { color: "#C53030", widthPx: 5 }, 0.4, 10);
    expect(mat(b).depthTest).toBe(true);
    expect(mat(b).polygonOffset).toBe(true);
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
    expect(mat(b).dashSize).toBeCloseTo(3, 6);
    expect(mat(b).gapSize).toBeCloseTo(9, 6);
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

  it("dashes are screen-constant: size scales with metres per pixel (mpp 4 is 4x mpp 1)", () => {
    const d = { sizePx: 12, pattern: 0xf000 };
    const b = createLineBatch([line], { color: "#fff", widthPx: 4, dash: d }, 0.4, 10);
    setDashScale(b, 1);
    const [on1, gap1] = [mat(b).dashSize, mat(b).gapSize];
    setDashScale(b, 4);
    expect(mat(b).dashSize).toBeCloseTo(4 * on1, 6);
    expect(mat(b).gapSize).toBeCloseTo(4 * gap1, 6);
    expect(mat(b).dashSize + mat(b).gapSize).toBeCloseTo(12 * 4, 6);
  });
});

describe("distanceFade (AC-A3)", () => {
  it("is 1 below 900 m and 0 from 1,500 m", () => {
    expect([FADE_NEAR_M, FADE_FAR_M]).toEqual([900, 1500]);
    expect(distanceFade(0)).toBe(1);
    expect(distanceFade(899)).toBe(1);
    expect(distanceFade(900)).toBe(1);
    expect(distanceFade(1500)).toBe(0);
    expect(distanceFade(7000)).toBe(0);
  });
  it("falls smoothly and monotonically in between", () => {
    expect(distanceFade(1200)).toBeCloseTo(0.5, 6);
    let prev = 1;
    for (let d = 900; d <= 1500; d += 20) {
      const f = distanceFade(d);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });
});

describe("fade batches", () => {
  it("every batch pulls toward the camera by a fraction of its distance", () => {
    const m = mat(createLineBatch([line], { color: "#fff", widthPx: 3 }, 0.4, 10));
    expect(m.vertexShader).toContain("uDepthBias");
    expect(m.uniforms.uDepthBias?.value).toBe(LINE_DEPTH_BIAS);
  });

  it("a faded batch carries the shader fade; a plain one does not", () => {
    const st = { color: "#fff", widthPx: 3 };
    const faded = mat(createLineBatch([line], st, 0.4, 10, undefined, true));
    expect(faded.fragmentShader).toContain("uFadeFar");
    expect(faded.vertexShader).toContain("vFadeDist = length( mvPosition.xyz )");
    expect(faded.uniforms.uFadeNear?.value).toBe(900);
    expect(faded.uniforms.uFadeFar?.value).toBe(1500);
    expect(mat(createLineBatch([line], st, 0.4, 10)).fragmentShader).not.toContain("uFadeFar");
  });
});
