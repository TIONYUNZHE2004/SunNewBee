import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createRoleUniforms } from "../assets/roleMaterial";
import { createSignLayer, SIGNS_PER_PAGE, signIdAt } from "./signLayer";
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
  it("batches one mesh per page and resolves every sign id from its faces", () => {
    const n = SIGNS_PER_PAGE * 2 + 5;
    const signs = Array.from({ length: n }, (_, i) => sign(i));
    const layer = createSignLayer(signs, createRoleUniforms(), () => fakeCanvas([]));
    const meshes = layer.group.children as THREE.Mesh[];
    expect(meshes.length).toBeLessThanOrEqual(3);
    expect(meshes.every((m) => m.userData.pick.kind === "sign")).toBe(true);
    expect(meshes.every((m) => m.userData.decorative !== true)).toBe(true);
    const seen: string[] = [];
    for (const m of meshes) {
      const faces = (m.geometry.getIndex()?.count ?? 0) / 3;
      for (let f = 0; f < faces; f++) seen.push(signIdAt(m, f) as string);
    }
    // two triangles per sign, each resolving to its own id
    expect(seen).toHaveLength(n * 2);
    expect([...new Set(seen)]).toEqual(signs.map((s) => s.id));
    layer.dispose();
  });

  it("signIdAt is null without a face or ids", () => {
    const layer = createSignLayer([sign(0)], createRoleUniforms(), () => fakeCanvas([]));
    const m = layer.group.children[0] as THREE.Mesh;
    expect(signIdAt(m, 0)).toBe("sign-0");
    expect(signIdAt(m, 1)).toBe("sign-0");
    expect(signIdAt(m, 2)).toBeNull();
    expect(signIdAt(m, undefined)).toBeNull();
    expect(signIdAt(m, -1)).toBeNull();
    expect(signIdAt({ userData: {} } as THREE.Object3D, 0)).toBeNull();
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

  it("glows with uLightGlow once per page: dark by day, lit at night", () => {
    const u = createRoleUniforms();
    const layer = createSignLayer([sign(0), sign(1)], u, () => fakeCanvas([]));
    expect(layer.group.children).toHaveLength(1);
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

  it("places each quad in front of its facade, turned by yaw", () => {
    const layer = createSignLayer(
      [{ ...sign(2), yaw: Math.PI / 2, widthM: 4 }],
      createRoleUniforms(),
      () => fakeCanvas([]),
    );
    const m = layer.group.children[0] as THREE.Mesh;
    const p = m.geometry.getAttribute("position");
    const n = m.geometry.getAttribute("normal");
    // yaw 90 degrees: the face looks along +x and the width runs along z
    expect(n.getX(0)).toBeCloseTo(1, 6);
    expect(n.getZ(0)).toBeCloseTo(0, 6);
    expect(p.getX(0)).toBeCloseTo(10, 6);
    expect(Math.abs(p.getZ(0) - p.getZ(1))).toBeGreaterThan(1.5);
    layer.dispose();
  });

  it("releases the page canvas after the GPU upload, and dispose frees geometry and texture", () => {
    const layer = createSignLayer([sign(0)], createRoleUniforms(), () => fakeCanvas([]));
    const m = layer.group.children[0] as THREE.Mesh;
    const tex = (m.material as THREE.MeshStandardMaterial).map as THREE.CanvasTexture;
    const big = tex.image as HTMLCanvasElement;
    expect(big.width).toBe(1024);
    tex.onUpdate?.(tex);
    expect((tex.image as HTMLCanvasElement).width).toBe(1);
    expect(big.width).toBe(1);
    let freed = 0;
    m.geometry.addEventListener("dispose", () => freed++);
    tex.addEventListener("dispose", () => freed++);
    layer.dispose();
    expect(freed).toBe(2);
  });
});
