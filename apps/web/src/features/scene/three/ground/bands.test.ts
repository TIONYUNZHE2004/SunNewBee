import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import {
  GROUND_BANDS,
  groundMaterial,
  LANDCOVER_MAX_Y,
  MARKING_Y,
  PARK_Y,
  ROAD_Y,
  VERGE_Y,
  WATER_Y,
} from "./bands";
import { createGroundLayer } from "./groundLayer";
import { LANDCOVER_ORDER, landcoverMesh } from "./landcover";
import type { Ribbon } from "./ribbons";

const ORDER = ["landcover", "parks", "water", "verges", "roads", "markings"] as const;

describe("ground bands", () => {
  it("ground, land cover, parks and base water stay within 0.06 m, below the 0.08 m road lift", () => {
    for (const y of [LANDCOVER_MAX_Y, PARK_Y, WATER_Y]) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(0.06);
      expect(y).toBeLessThan(ROAD_Y);
    }
    expect(ROAD_Y).toBe(0.08);
    expect(MARKING_Y).toBeGreaterThan(ROAD_Y);
  });

  it("lifts rise land cover < parks < base water < verges < roads < markings", () => {
    expect(VERGE_Y).toBe(0.07);
    const ys = [LANDCOVER_MAX_Y, PARK_Y, WATER_Y, VERGE_Y, ROAD_Y, MARKING_Y];
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
  });

  it("polygonOffset and renderOrder are strictly increasing in the same order", () => {
    for (let i = 1; i < ORDER.length; i++) {
      const lo = GROUND_BANDS[ORDER[i - 1]!];
      const hi = GROUND_BANDS[ORDER[i]!];
      expect(hi.order).toBeGreaterThan(lo.order);
      expect(hi.offset).toBeLessThan(lo.offset); // more negative pulls towards the camera
      expect(groundMaterial(ORDER[i]!).polygonOffsetFactor).toBe(hi.offset);
    }
  });

  it("the land-cover mesh never rises above its band, base-water class included", () => {
    const frame = createFrame([101.5, 3.18]);
    const features = LANDCOVER_ORDER.map((cls, i) => {
      const pt = (e: number, n: number) => frame.toLonLat(e + i * 200, -n);
      return {
        type: "Feature" as const,
        properties: { class: cls },
        geometry: {
          type: "Polygon" as const,
          coordinates: [[pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100), pt(0, 0)]],
        },
      };
    });
    const g = landcoverMesh({ type: "FeatureCollection", features }, frame);
    const p = g.getAttribute("position");
    let max = 0;
    for (let i = 0; i < p.count; i++) max = Math.max(max, p.getY(i));
    expect(max).toBeLessThanOrEqual(LANDCOVER_MAX_Y + 1e-6);
  });

  it("the ground layer's meshes use the band offsets and render orders", () => {
    const r = (kind: Ribbon["kind"], marking = false): Ribbon => ({
      kind,
      marking,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    });
    const lc = new THREE.BufferGeometry();
    lc.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
    const layer = createGroundLayer([r("major"), r("major", true)], lc, "high");
    const got = layer.group.children.map((o) => {
      const m = o as THREE.Mesh;
      return [m.renderOrder, (m.material as THREE.Material).polygonOffsetFactor];
    });
    expect(got).toEqual([
      [GROUND_BANDS.landcover.order, GROUND_BANDS.landcover.offset],
      [GROUND_BANDS.roads.order, GROUND_BANDS.roads.offset],
      [GROUND_BANDS.markings.order, GROUND_BANDS.markings.offset],
    ]);
  });
});
