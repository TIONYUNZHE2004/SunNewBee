import * as THREE from "three";
import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { describe, expect, it } from "vitest";
import { statusStyle, WATER_COLOR } from "../../styles";
import { createFrame } from "../frame";
import { createFloodLayer, FLOOD_LIFT_M, FLOOD_ORDER } from "./floodLayer";

const frame = createFrame([101.5, 3.0]);
const ring = (x: number, y: number, s = 1e-3) => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
];
const water = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { surface_height_m: 7.5 },
      geometry: { type: "Polygon", coordinates: [ring(101.5, 3.0), ring(101.5003, 3.0003, 2e-4)] },
    },
    {
      type: "Feature",
      properties: { surface_height_m: 9 },
      geometry: { type: "MultiPolygon", coordinates: [[ring(101.51, 3.01)]] },
    },
  ],
};
const edge = (id: string, status: string, a: number) => ({
  type: "Feature",
  geometry: {
    type: "LineString",
    coordinates: [
      [101.5 + a * 1e-4, 3.0],
      [101.5 + a * 1e-4 + 1e-4, 3.0],
    ],
  },
  properties: { id, status },
});
const edges = {
  type: "FeatureCollection",
  features: [
    edge("a", "flooded_likely", 0),
    edge("b", "flooded_possible", 1),
    edge("c", "ok", 2),
    edge("d", "blocked", 3),
  ],
};

const meshOf = (g: THREE.Group) => g.children.find((o) => o instanceof THREE.Mesh) as THREE.Mesh;

describe("flood layer", () => {
  it("is flat: every vertex sits at y = 0.30 m (no depth, no surface)", () => {
    const layer = createFloodLayer(water, edges, frame);
    const pos = meshOf(layer.ground).geometry.getAttribute("position");
    expect(pos.count).toBeGreaterThan(6);
    for (let i = 0; i < pos.count; i++) expect(Math.abs(pos.getY(i) - 0.3)).toBeLessThan(1e-6);
    expect(FLOOD_LIFT_M).toBe(0.3);
    // surface_height_m (7.5 / 9) is a display value of the scenario, never geometry: the fill's
    // x/z bounds are exactly the input polygons' local bbox.
    const corners = [101.5, 101.51].flatMap((x0) => [3.0, 3.01].map((y0) => [x0, y0] as const));
    const locals = corners.flatMap(([x0, y0]) => [
      frame.toLocal(x0, y0),
      frame.toLocal(x0 + 1e-3, y0 + 1e-3),
    ]);
    const box = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
    expect(box.min.x).toBeCloseTo(Math.min(...locals.map((l) => l[0])), 3);
    expect(box.max.x).toBeCloseTo(Math.max(...locals.map((l) => l[0])), 3);
    expect(box.min.z).toBeCloseTo(Math.min(...locals.map((l) => l[1])), 3);
    expect(box.max.z).toBeCloseTo(Math.max(...locals.map((l) => l[1])), 3);
    expect(box.max.y - box.min.y).toBeLessThan(1e-6);
  });

  it("triangulates the first polygon around its hole (area = outer - hole + the multipolygon)", () => {
    const layer = createFloodLayer(water, null, frame);
    const pos = meshOf(layer.ground).geometry.getAttribute("position");
    // a 1e-3 deg square minus a 2e-4 one, plus the MultiPolygon square
    const area = (g: THREE.BufferGeometry) => {
      const p = g.getAttribute("position");
      let a = 0;
      for (let i = 0; i < p.count; i += 3)
        a +=
          Math.abs(
            (p.getX(i + 1) - p.getX(i)) * (p.getZ(i + 2) - p.getZ(i)) -
              (p.getX(i + 2) - p.getX(i)) * (p.getZ(i + 1) - p.getZ(i)),
          ) / 2;
      return a;
    };
    const full = area(meshOf(createFloodLayer(water, null, frame).ground).geometry);
    const sq = (s: number) => {
      const [x0, z0] = frame.toLocal(101.5, 3.0);
      const [x1, z1] = frame.toLocal(101.5 + s, 3.0 + s);
      return Math.abs((x1 - x0) * (z1 - z0));
    };
    expect(full / (sq(1e-3) - sq(2e-4) + sq(1e-3))).toBeCloseTo(1, 2);
    expect(pos.count % 3).toBe(0);
  });

  it("is #1e6fb8 at alpha 0.55 with a hatch texture, drawn below the status lines", () => {
    const m = meshOf(createFloodLayer(water, null, frame).ground);
    const mat = m.material as THREE.MeshBasicMaterial;
    expect(mat.color.getHexString()).toBe(new THREE.Color(WATER_COLOR).getHexString());
    expect(WATER_COLOR).toBe("#1e6fb8");
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBeCloseTo(0.55, 6);
    expect(mat.depthWrite).toBe(false);
    expect(mat.map).toBeInstanceOf(THREE.Texture);
    expect(mat.map?.wrapS).toBe(THREE.RepeatWrapping);
    expect(m.renderOrder).toBe(FLOOD_ORDER.fill);
    expect(FLOOD_ORDER.fill).toBeLessThan(10);
    expect(FLOOD_ORDER.fill).toBeGreaterThan(7);
  });

  it("hatch: 45 degree lines, 4 px wide on a 12 px pitch", () => {
    const tex = (
      meshOf(createFloodLayer(water, null, frame).ground).material as THREE.MeshBasicMaterial
    ).map as THREE.DataTexture;
    const { width, height, data } = tex.image as {
      width: number;
      height: number;
      data: Uint8Array;
    };
    expect([width, height]).toEqual([12, 12]);
    const dark = (x: number, y: number) => data[(y * 12 + x) * 4]! < 255;
    let n = 0;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if (dark(x, y)) n++;
    expect(n).toBe(12 * 4);
    // constant along the diagonal x + y
    expect(dark(0, 0)).toBe(dark(5, 7)); // x + y = 12 = 0 mod 12
    expect(dark(3, 0)).toBe(dark(2, 1));
  });

  it("never uses the base-water colour in any material or uniform of the flood group", () => {
    const base = new THREE.Color("#7fb6c9").getHex();
    const seen: number[] = [];
    for (const part of ["group", "ground"] as const) {
      createFloodLayer(water, edges, frame)[part].traverse((o) => {
        const mat = (o as THREE.Mesh).material as
          | (THREE.Material & {
              color?: THREE.Color;
              uniforms?: Record<string, { value: unknown }>;
            })
          | undefined;
        if (!mat) return;
        if (mat.color) seen.push(mat.color.getHex());
        for (const u of Object.values(mat.uniforms ?? {}))
          if (u.value instanceof THREE.Color) seen.push(u.value.getHex());
      });
    }
    expect(seen.length).toBeGreaterThanOrEqual(3); // fill + two edge batches
    expect(seen).not.toContain(base);
  });

  it("the fill is main-scene ground, depth tested, never in the overlay group", () => {
    const layer = createFloodLayer(water, edges, frame);
    expect(layer.group.children.some((o) => o.name === "flood-fill")).toBe(false);
    const m = meshOf(layer.ground);
    const mat = m.material as THREE.MeshBasicMaterial;
    // Buildings must occlude it: a draped ground tint, never paint over a roof.
    expect(mat.depthTest).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.polygonOffset).toBe(true);
    expect(mat.polygonOffsetFactor).toBeLessThan(-6); // beats every ground band (-1..-5) and lamp pools (-6)
    expect(m.renderOrder).toBeGreaterThan(7);
  });

  it("draws only flooded edges, in the flood styles, 2 px wider, at order 12", () => {
    const layer = createFloodLayer(water, edges, frame);
    const lines = layer.group.children;
    const mats = lines.map((o) => (o as THREE.Mesh).material as LineMaterial);
    expect(mats).toHaveLength(2);
    const byColour = new Map(mats.map((m) => [m.dashed, m]));
    const likely = statusStyle("flooded_likely");
    const possible = statusStyle("flooded_possible");
    expect(byColour.get(false)?.color.getHexString()).toBe(
      new THREE.Color(likely.color).getHexString(),
    );
    expect(byColour.get(false)?.linewidth).toBe(likely.width + 2);
    expect(byColour.get(true)?.color.getHexString()).toBe(
      new THREE.Color(possible.color).getHexString(),
    );
    expect(byColour.get(true)?.linewidth).toBe(possible.width + 2);
    for (const o of lines) expect(o.renderOrder).toBe(FLOOD_ORDER.edges);
    expect(FLOOD_ORDER.edges).toBe(12);
  });

  it("is empty without data, and disposes cleanly", () => {
    const none = createFloodLayer(null, null, frame);
    expect(none.group.children).toHaveLength(0);
    const layer = createFloodLayer(water, edges, frame);
    expect(() => layer.dispose()).not.toThrow();
    expect(layer.group.children).toHaveLength(0);
  });
});

describe("low-lying terrain areas (T-029)", () => {
  it("are drawn apart in the 'possibly flooded' colour, never as river water", () => {
    const mixed = {
      type: "FeatureCollection",
      features: [
        water.features[0],
        {
          type: "Feature",
          properties: { class: "possible", area_m2: 3600 },
          geometry: { type: "Polygon", coordinates: [ring(101.52, 3.02)] },
        },
      ],
    };
    const layer = createFloodLayer(mixed, null, frame);
    const byName = Object.fromEntries(layer.ground.children.map((m) => [m.name, m as THREE.Mesh]));
    expect(Object.keys(byName).sort()).toEqual(["flood-fill", "flood-fill-possible"]);
    const color = (n: string) =>
      `#${((byName[n]?.material as THREE.MeshBasicMaterial).color as THREE.Color).getHexString()}`;
    expect(color("flood-fill-possible").toLowerCase()).toBe(
      statusStyle("flooded_possible").color.toLowerCase(),
    );
    expect(color("flood-fill").toLowerCase()).not.toBe(color("flood-fill-possible").toLowerCase());
    layer.dispose();
  });
});
