import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createRoleUniforms } from "../assets/roleMaterial";
import { createSignLayer, SIGNS_PER_PAGE } from "./signLayer";
import type { SignPlacement } from "./signPlan";

const sign = (i: number): SignPlacement => ({
  id: `sign-${i}`,
  text: `Shop ${i}`,
  x: i * 5,
  y: 3,
  z: 2,
  yaw: 0,
  widthM: 3,
  source: {
    url: "https://www.openstreetmap.org/way/1",
    label: "OpenStreetMap",
    asOf: "2026-10-17",
  },
});

/** A canvas stand-in: jsdom has no 2D context. Records the texts drawn. */
function fakeCanvas(drawn: string[]) {
  const ctx = {
    font: "",
    fillStyle: "",
    textBaseline: "",
    textAlign: "",
    fillRect() {},
    measureText: (t: string) => ({ width: t.length * 30 }),
    save() {},
    restore() {},
    scale() {},
    translate() {},
    fillText: (t: string) => drawn.push(t),
  };
  return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

describe("createSignLayer", () => {
  it("makes each sign pickable with { kind: 'sign', id }, not decorative", () => {
    const layer = createSignLayer([sign(0), sign(1)], createRoleUniforms(), () => fakeCanvas([]));
    const meshes = layer.group.children as THREE.Mesh[];
    expect(meshes).toHaveLength(2);
    expect(meshes.map((m) => m.userData.pick)).toEqual([
      { kind: "sign", id: "sign-0" },
      { kind: "sign", id: "sign-1" },
    ]);
    expect(meshes.every((m) => m.userData.decorative !== true)).toBe(true);
    layer.dispose();
  });

  it("draws the sign text only (no logos) and pages 64 signs per atlas", () => {
    const drawn: string[] = [];
    const n = SIGNS_PER_PAGE + 1;
    const layer = createSignLayer(
      Array.from({ length: n }, (_, i) => sign(i)),
      createRoleUniforms(),
      () => fakeCanvas(drawn),
    );
    expect(drawn).toHaveLength(n);
    expect(drawn[3]).toBe("Shop 3");
    const maps = new Set(
      (layer.group.children as THREE.Mesh[]).map(
        (m) => (m.material as THREE.MeshStandardMaterial).map,
      ),
    );
    expect(maps.size).toBe(2);
    layer.dispose();
  });

  it("glows with uLightGlow: dark by day, lit at night", () => {
    const u = createRoleUniforms();
    const layer = createSignLayer([sign(0)], u, () => fakeCanvas([]));
    const m = layer.group.children[0] as THREE.Mesh;
    const mat = m.material as THREE.MeshStandardMaterial;
    const render = () =>
      m.onBeforeRender({} as never, {} as never, {} as never, {} as never, mat, {} as never);
    u.uLightGlow.value = 0;
    render();
    expect(mat.emissiveIntensity).toBe(0);
    u.uLightGlow.value = 0.2;
    render();
    expect(mat.emissiveIntensity).toBeCloseTo(0.2, 6);
    u.uLightGlow.value = 1;
    render();
    expect(mat.emissiveIntensity).toBeCloseTo(1, 6);
    layer.dispose();
  });

  it("positions and turns each sign, and dispose frees geometry and texture", () => {
    const layer = createSignLayer([{ ...sign(2), yaw: Math.PI / 2 }], createRoleUniforms(), () =>
      fakeCanvas([]),
    );
    const m = layer.group.children[0] as THREE.Mesh;
    expect(m.position.toArray()).toEqual([10, 3, 2]);
    expect(m.rotation.y).toBeCloseTo(Math.PI / 2, 6);
    let freed = 0;
    m.geometry.addEventListener("dispose", () => freed++);
    (m.material as THREE.MeshStandardMaterial).map?.addEventListener("dispose", () => freed++);
    layer.dispose();
    expect(freed).toBe(2);
  });
});
