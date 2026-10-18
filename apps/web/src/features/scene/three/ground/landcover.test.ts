import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import { LANDCOVER_COLOURS, LANDCOVER_ORDER, landcoverMesh } from "./landcover";

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

  it("skips malformed features without throwing", () => {
    const bad: GeoJSON.Feature = {
      type: "Feature",
      properties: { class: "forest" },
      geometry: { type: "Polygon", coordinates: [[[Number.NaN, 0]]] as never },
    };
    expect(landcoverMesh(fc(bad), frame).getAttribute("position").count).toBe(0);
  });
});
