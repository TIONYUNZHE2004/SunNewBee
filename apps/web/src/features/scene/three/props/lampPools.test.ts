import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Placement } from "../assets/fit";
import { createRoleUniforms } from "../assets/roleMaterial";
import { glowFor } from "../mood";
import { createLampPools, LAMP_HEADS, LAMP_POOL_SIZE_M, LAMP_POOL_Y, lampHeads } from "./lampPools";

const lamp = (i: number): Placement => ({
  id: `l${i}`,
  asset: "furniture",
  variant: "lamp_single",
  x: i * 10,
  z: -i * 4,
  yaw: 0,
  sx: 1,
  sy: 1,
  sz: 1,
  palette: ["#000", "#000", "#000"],
});

describe("createLampPools", () => {
  it("is one pool per lit head, 14 m quads lying at y = 0.12 under the head", () => {
    const u = createRoleUniforms();
    const pools = createLampPools([lamp(0), lamp(1), lamp(2)], u);
    expect(pools.mesh.count).toBe(3);
    expect(LAMP_POOL_SIZE_M).toBe(14);
    expect(LAMP_POOL_Y).toBe(0.12);
    const m = new THREE.Matrix4();
    pools.mesh.getMatrixAt(1, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    // yaw 0: the head is on the arm's local +x, 1.33 m from the pole at (10, -4)
    expect(p.x).toBeCloseTo(10 + (LAMP_HEADS.lamp_single?.[0]?.[0] ?? Number.NaN), 6);
    expect(p.z).toBeCloseTo(-4, 6);
    expect(p.y).toBeCloseTo(0.12, 6);
    pools.mesh.geometry.computeBoundingBox();
    const size = pools.mesh.geometry.boundingBox?.getSize(new THREE.Vector3());
    expect(size?.x).toBeCloseTo(14, 6);
    expect(size?.y).toBeCloseTo(0, 6);
    expect(size?.z).toBeCloseTo(14, 6);
    pools.dispose();
  });

  it("opacity follows glowFor: 0 by day, 1 at night", () => {
    const u = createRoleUniforms();
    const pools = createLampPools([lamp(0)], u);
    u.uLightGlow.value = glowFor({ day: 1, dusk: 0, night: 0 }).uLightGlow;
    expect(pools.opacity()).toBe(0);
    u.uLightGlow.value = glowFor({ day: 0, dusk: 0, night: 1 }).uLightGlow;
    expect(pools.opacity()).toBe(1);
    u.uLightGlow.value = 0.5;
    expect(pools.opacity()).toBeCloseTo(0.5, 9);
    const mat = pools.mesh.material as THREE.MeshBasicMaterial;
    const shader = {
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    };
    // biome-ignore lint/suspicious/noExplicitAny: shader stub
    (mat.onBeforeCompile as any)(shader, null);
    expect(shader.uniforms.uLightGlow).toBe(u.uLightGlow);
    expect(shader.fragmentShader).toContain("clamp(uLightGlow, 0.0, 1.0)");
    pools.dispose();
  });

  it("is additive, depth-write free, ordered above the ground bands and below overlays", () => {
    const pools = createLampPools([lamp(0)], createRoleUniforms());
    const mat = pools.mesh.material as THREE.MeshBasicMaterial;
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect(mat.depthWrite).toBe(false);
    expect(mat.transparent).toBe(true);
    expect(pools.mesh.renderOrder).toBeGreaterThan(5);
    expect(pools.mesh.renderOrder).toBeLessThan(10);
    pools.dispose();
  });

  it("is decorative, unpickable and casts no shadow", () => {
    const pools = createLampPools([lamp(0), lamp(1)], createRoleUniforms());
    expect(pools.mesh.userData.decorative).toBe(true);
    expect(pools.mesh.castShadow).toBe(false);
    expect(pools.mesh.receiveShadow).toBe(false);
    const hits: THREE.Intersection[] = [];
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0));
    pools.mesh.raycast(ray, hits);
    expect(hits).toEqual([]);
    pools.dispose();
  });

  it("puts the heads where the model's arm points: rotated with the lamp, two for a double", () => {
    const quarter = { ...lamp(0), yaw: Math.PI / 2 };
    const [h] = lampHeads(quarter);
    // a quarter turn about +y takes local +x to world -z
    expect(h?.[0]).toBeCloseTo(0, 6);
    expect(h?.[2]).toBeCloseTo(-1.33, 6);
    expect(h?.[1]).toBeCloseTo(8.8, 6);
    expect(lampHeads({ ...lamp(0), variant: "lamp_double" })).toHaveLength(2);
    const pools = createLampPools([{ ...lamp(0), variant: "lamp_double" }], createRoleUniforms());
    expect(pools.mesh.count).toBe(2);
    expect(pools.halos.geometry.getAttribute("position").count).toBe(2);
    pools.dispose();
  });

  it("dispose frees geometry, material and texture", () => {
    const pools = createLampPools([lamp(0)], createRoleUniforms());
    let n = 0;
    const mat = pools.mesh.material as THREE.MeshBasicMaterial;
    pools.mesh.geometry.addEventListener("dispose", () => n++);
    mat.addEventListener("dispose", () => n++);
    mat.map?.addEventListener("dispose", () => n++);
    pools.dispose();
    expect(n).toBe(3); // the pool's (the halo's are freed with it)
  });
});
