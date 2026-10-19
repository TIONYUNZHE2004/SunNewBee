import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  applyGroundDetail,
  DETAIL_AMPLITUDE,
  detailBrightness,
  detailColour,
  valueNoise,
} from "./groundDetail";
import { LANDCOVER_COLOURS } from "./landcover";

const pts: [number, number][] = [];
for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) pts.push([i * 3.7 - 70, j * 2.9 - 55]);

describe("ground detail brightness", () => {
  it("value noise stays in [0, 1] and varies", () => {
    const vs = pts.map(([x, z]) => valueNoise(x / 6, z / 6));
    expect(Math.min(...vs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...vs)).toBeLessThanOrEqual(1);
    expect(Math.max(...vs) - Math.min(...vs)).toBeGreaterThan(0.3);
  });

  it("is deterministic", () => {
    expect(detailBrightness("grass", 12.3, -4.5)).toBe(detailBrightness("grass", 12.3, -4.5));
  });

  it("detail colours stay within +-6 % of the base for every class", () => {
    expect(DETAIL_AMPLITUDE).toBe(0.06);
    for (const [cls, hex] of Object.entries(LANDCOVER_COLOURS)) {
      const base = new THREE.Color(hex);
      for (const [x, z] of pts) {
        const c = detailColour(cls, hex, x, z);
        for (const k of ["r", "g", "b"] as const) {
          const ratio = c[k] / base[k];
          expect(ratio).toBeGreaterThanOrEqual(0.94 - 1e-9);
          expect(ratio).toBeLessThanOrEqual(1.06 + 1e-9);
        }
      }
    }
  });

  it("really modulates land (both brighter and darker than base) and speckles grass and bare", () => {
    const f = pts.map(([x, z]) => detailBrightness("grass", x, z));
    expect(Math.max(...f)).toBeGreaterThan(1.02);
    expect(Math.min(...f)).toBeLessThan(0.98);
    const specks = pts.filter(([x, z]) => detailBrightness("grass", x, z) <= 0.94 + 1e-9).length;
    expect(specks).toBeGreaterThan(0);
    expect(specks / pts.length).toBeLessThan(0.1); // sparse
    // other classes get no speckle floor hit beyond noise
    const noSpeck = pts.map(([x, z]) => detailBrightness("residential", x, z));
    expect(Math.min(...noSpeck)).toBeGreaterThan(0.94);
  });

  it("water is unaffected and never approaches the flood blue", () => {
    const flood = new THREE.Color("#1e6fb8");
    const water = new THREE.Color(LANDCOVER_COLOURS.water);
    for (const [x, z] of pts) {
      expect(detailBrightness("water", x, z)).toBe(1);
      const c = detailColour("water", LANDCOVER_COLOURS.water!, x, z);
      expect(c.equals(water)).toBe(true);
      const d = Math.hypot(c.r - flood.r, c.g - flood.g, c.b - flood.b);
      expect(d).toBeGreaterThan(0.25);
    }
  });
});

describe("applyGroundDetail", () => {
  const compile = (m: THREE.Material) => {
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: "void main() {\n#include <begin_vertex>\n}",
      fragmentShader: "void main() {\n#include <color_fragment>\n}",
    };
    m.onBeforeCompile(shader as never, {} as never);
    return shader;
  };

  it("patches the shader with the shared uTime and a stable programme cache key", () => {
    const uTime = { value: 0 };
    const a = new THREE.MeshStandardMaterial({ vertexColors: true });
    const b = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyGroundDetail(a, { uTime });
    applyGroundDetail(b, { uTime });
    const k = a.customProgramCacheKey();
    expect(k).toContain("groundDetail");
    expect(a.customProgramCacheKey()).toBe(k);
    expect(b.customProgramCacheKey()).toBe(k);
    const s = compile(a);
    expect(s.uniforms.uTime).toBe(uTime);
    expect(s.fragmentShader).toContain("diffuseColor.rgb");
    expect(s.fragmentShader).toContain("vDetXZ");
    expect(s.vertexShader).toContain("vDetXZ");
  });

  it("chains the earlier patch and key (shimmer) rather than replacing them", () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true });
    let called = false;
    m.onBeforeCompile = () => {
      called = true;
    };
    applyGroundDetail(m, { uTime: { value: 0 } });
    compile(m);
    expect(called).toBe(true);
    expect(m.customProgramCacheKey()).toContain("groundDetail");
  });
});
