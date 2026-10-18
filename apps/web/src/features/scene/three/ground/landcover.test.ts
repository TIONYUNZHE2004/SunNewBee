import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import {
  LANDCOVER_COLOURS,
  LANDCOVER_ORDER,
  landcoverMesh,
  SHIMMER_AMPLITUDE,
  shimmerFactor,
  shimmerMaterial,
} from "./landcover";

describe("water shimmer", () => {
  it("the factor stays within 4 % of the base colour for any time and place", () => {
    expect(SHIMMER_AMPLITUDE).toBe(0.04);
    let lo = 2;
    let hi = 0;
    for (let t = 0; t < 60; t += 0.37)
      for (const x of [-900, -3, 0, 41, 700])
        for (const z of [-500, 0, 12, 333]) {
          const f = shimmerFactor(t, x, z);
          lo = Math.min(lo, f);
          hi = Math.max(hi, f);
        }
    expect(lo).toBeGreaterThanOrEqual(0.96 - 1e-9);
    expect(hi).toBeLessThanOrEqual(1.04 + 1e-9);
    expect(hi - lo).toBeGreaterThan(0.02);
  });

  it("modulates brightness only, so the hue stays base water and never the flood blue", () => {
    const base = new THREE.Color(LANDCOVER_COLOURS.water);
    const hsl = (c: THREE.Color) => c.getHSL({ h: 0, s: 0, l: 0 });
    for (const f of [0.96, 1, 1.04]) {
      const c = base.clone().multiplyScalar(f);
      expect(hsl(c).h).toBeCloseTo(hsl(base).h, 5);
    }
    expect(hsl(base).h).not.toBeCloseTo(hsl(new THREE.Color("#1e6fb8")).h, 1);
  });

  it("shimmerMaterial binds the shared uTime and keeps a distinct program key", () => {
    const uTime = { value: 0 };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    shimmerMaterial(mat, uTime, "water-only");
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    };
    // biome-ignore lint/suspicious/noExplicitAny: shader stub
    (mat.onBeforeCompile as any)(shader, null);
    expect(shader.uniforms.uTime).toBe(uTime);
    expect(shader.fragmentShader).toContain("0.04");
    expect(mat.customProgramCacheKey()).toContain("shimmer");
  });
});

const frame = createFrame([101.5, 3.18]);
const sq = (cls: string, e0 = 0): GeoJSON.Feature => {
  const pt = (e: number, n: number) => frame.toLonLat(e, -n);
  return {
    type: "Feature",
    properties: { class: cls },
    geometry: {
      type: "Polygon",
      coordinates: [[pt(e0, 0), pt(e0 + 100, 0), pt(e0 + 100, 100), pt(e0, 100), pt(e0, 0)]],
    },
  };
};
const fc = (...f: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: f,
});

describe("landcover", () => {
  it("base water is #7fb6c9 and no class is the flood blue", () => {
    expect(LANDCOVER_COLOURS.water).toBe("#7fb6c9");
    expect(Object.values(LANDCOVER_COLOURS).map((c) => c.toLowerCase())).not.toContain("#1e6fb8");
  });

  it("has every class from the brief, in draw order", () => {
    expect(LANDCOVER_COLOURS).toMatchObject({
      forest: "#6f9a5b",
      grass: "#9cc483",
      scrub: "#8fae6e",
      farmland: "#c9c98f",
      oil_palm: "#7d9a55",
      residential: "#e6e1d6",
      commercial: "#e0dbe4",
      industrial: "#d9d6cf",
      parking: "#c7c4bd",
      construction: "#c9b28d",
      bare: "#d8ccb3",
      water: "#7fb6c9",
    });
    expect(LANDCOVER_ORDER).toEqual([
      "farmland",
      "oil_palm",
      "forest",
      "grass",
      "scrub",
      "residential",
      "commercial",
      "industrial",
      "parking",
      "bare",
      "construction",
      "water",
    ]);
  });

  it("an unknown class gets #d8d3c8", () => {
    const c = landcoverMesh(fc(sq("lava")), frame).getAttribute("color");
    const want = new THREE.Color("#d8d3c8");
    expect(c.getX(0)).toBeCloseTo(want.r, 4);
    expect(c.getY(0)).toBeCloseTo(want.g, 4);
    expect(c.getZ(0)).toBeCloseTo(want.b, 4);
  });

  it("lifts follow the draw order between 0 and 0.04", () => {
    const yOf = (cls: string) =>
      landcoverMesh(fc(sq(cls)), frame)
        .getAttribute("position")
        .getY(0);
    const ys = LANDCOVER_ORDER.map(yOf);
    expect(ys[0]).toBeCloseTo(0, 5);
    expect(ys.at(-1)).toBeCloseTo(0.04, 5);
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
  });

  it("is flat and faces up, with no vertical faces", () => {
    const g = landcoverMesh(fc(sq("forest"), sq("grass", 200)), frame);
    const n = g.getAttribute("normal");
    const p = g.getAttribute("position");
    expect(p.count).toBeGreaterThanOrEqual(12);
    for (let i = 0; i < n.count; i++) {
      expect(n.getX(i)).toBe(0);
      expect(n.getY(i)).toBe(1);
      expect(n.getZ(i)).toBe(0);
    }
    for (let t = 0; t < p.count; t += 3) {
      expect(p.getY(t)).toBe(p.getY(t + 1));
      expect(p.getY(t + 1)).toBe(p.getY(t + 2));
      const cross =
        (p.getZ(t + 1) - p.getZ(t)) * (p.getX(t + 2) - p.getX(t)) -
        (p.getX(t + 1) - p.getX(t)) * (p.getZ(t + 2) - p.getZ(t));
      expect(cross).toBeGreaterThan(0);
    }
  });

  // Final fix D: one mesh, ~3.6 mm lifts between classes -> stripes at township range. The mesh is
  // drawn without depth writes, so triangle order is the paint order: it must follow LANDCOVER_ORDER.
  it("emits triangles grouped in LANDCOVER_ORDER whatever the feature order (unknown first)", () => {
    const g = landcoverMesh(
      fc(
        sq("water"),
        sq("forest", 200),
        sq("lava", 400),
        sq("residential", 600),
        sq("farmland", 800),
      ),
      frame,
    );
    const p = g.getAttribute("position");
    const ys: number[] = [];
    for (let t = 0; t < p.count; t += 3) ys.push(p.getY(t));
    expect(ys.length).toBe(10);
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThanOrEqual(ys[i - 1]!);
    // The unknown class (lift 0) comes before farmland (also lift 0), then forest, residential, water.
    const c = g.getAttribute("color");
    const lava = new THREE.Color("#d8d3c8");
    expect(c.getX(0)).toBeCloseTo(lava.r, 4);
    const water = new THREE.Color(LANDCOVER_COLOURS.water!);
    expect(c.getX(p.count - 1)).toBeCloseTo(water.r, 4);
  });

  it("skips malformed features without throwing", () => {
    const bad: GeoJSON.Feature = {
      type: "Feature",
      properties: { class: "forest" },
      geometry: { type: "Polygon", coordinates: [[[Number.NaN, 0]]] as never },
    };
    expect(landcoverMesh(fc(bad), frame).getAttribute("position").count).toBe(0);
  });
});
