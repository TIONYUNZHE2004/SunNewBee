import type * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createFrame } from "../frame";
import { createFloodLayer } from "./floodLayer";

const frame = createFrame([101.5, 3]);
const ring = [
  [101.5, 3],
  [101.501, 3],
  [101.501, 3.001],
  [101.5, 3.001],
  [101.5, 3],
];
const water = (kind = "likely_flooded") => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { class: kind, surface_height_m: 500 },
      geometry: { type: "Polygon", coordinates: [ring] },
    },
  ],
});

describe("flood presentation", () => {
  it("renders reflective animated water only for explicit likely_flooded evidence", () => {
    const l = createFloodLayer(water(), null, frame);
    const mesh = l.ground.getObjectByName("flood-fill") as THREE.Mesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat.uniforms.tDiffuse).toBeDefined();
    expect(mat.depthTest).toBe(true);
    expect(mat.depthWrite).toBe(false);
    l.update(7, 0.8);
    expect(mat.uniforms.time!.value).toBe(7);
    expect(mesh.position.y).toBeLessThan(3);
    l.update(0, 0);
    expect(mesh.position.y).toBe(0.3);
    expect(l.group.getObjectByName("flood-fill")).toBeUndefined();
    for (const kind of ["possible", "unknown", "base_water", ""]) {
      const other = createFloodLayer(water(kind), null, frame);
      expect(other.ground.getObjectByName("flood-fill")).toBeUndefined();
      other.dispose();
    }
    l.dispose();
  });

  it("keeps terrain possible, translucent, hatch-free and below roads", () => {
    const l = createFloodLayer(water("possible"), null, frame);
    const mesh = l.ground.getObjectByName("flood-fill-possible") as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    expect(mat.map).toBeNull();
    expect(mat.opacity).toBeLessThan(0.2);
    expect(mesh.renderOrder).toBeLessThan(1);
    expect(l.ground.getObjectByName("flood-possible-outline")).toBeTruthy();
    l.dispose();
  });

  it("disposes the reflection framebuffer as well as geometry and materials", () => {
    const l = createFloodLayer(water(), null, frame);
    const mesh = l.ground.getObjectByName("flood-fill") as THREE.Mesh & {
      getRenderTarget(): THREE.WebGLRenderTarget;
    };
    const target = vi.spyOn(mesh.getRenderTarget(), "dispose");
    const geometry = vi.spyOn(mesh.geometry, "dispose");
    l.dispose();
    expect(target).toHaveBeenCalledOnce();
    expect(geometry).toHaveBeenCalledOnce();
    expect(l.ground.children).toHaveLength(0);
  });

  it("only draws flooded status edges and is empty without evidence", () => {
    const edges = {
      features: ["flooded_likely", "flooded_possible", "ok", "blocked"].map((status) => ({
        properties: { status, id: status },
        geometry: { type: "LineString", coordinates: ring.slice(0, 2) },
      })),
    };
    const l = createFloodLayer(null, edges, frame);
    expect(l.group.children).toHaveLength(2);
    expect(l.group.children.every((o) => o.renderOrder === 12)).toBe(true);
    l.dispose();
    expect(createFloodLayer(null, null, frame).ground.children).toHaveLength(0);
  });
});
