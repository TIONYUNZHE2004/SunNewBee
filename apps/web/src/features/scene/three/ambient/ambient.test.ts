import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TIERS, type Tier } from "../../shared/quality";
import { createFrame } from "../frame";
import { boundaryOf, insideBoundary } from "../ground/boundary";
import { BIRD_FLAP_HZ, BIRD_MAX_BANK, birdBank, createAmbient } from "./ambient";

const frame = createFrame([101.5, 3.18]);
const DAY = { day: 1, dusk: 0, night: 0 };
const NIGHT = { day: 0, dusk: 0, night: 1 };
const make = (tier: Tier, seed = "s") => createAmbient(tier, frame, [101.5095, 3.1805], seed);
const parts = (a: ReturnType<typeof make>) => {
  const meshes = a.group.children.filter(
    (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh,
  );
  return {
    birds: meshes.find((m) => m.name === "ambient-birds"),
    clouds: meshes.find((m) => m.name === "ambient-cloud-shadows"),
  };
};
const positions = (m: THREE.InstancedMesh) => {
  const out: number[] = [];
  const mat = new THREE.Matrix4();
  for (let i = 0; i < m.count; i++) {
    m.getMatrixAt(i, mat);
    out.push(...new THREE.Vector3().setFromMatrixPosition(mat).toArray());
  }
  return out;
};

describe("createAmbient", () => {
  it("bird and cloud counts follow TIERS; Low has no clouds", () => {
    for (const tier of ["high", "medium", "low"] as const) {
      const { birds, clouds } = parts(make(tier));
      expect(birds?.count ?? 0).toBe(TIERS[tier].birds);
      expect(clouds?.count ?? 0).toBe(TIERS[tier].clouds);
    }
    expect(parts(make("low")).clouds).toBeUndefined();
  });

  it("birds fly at 40-90 m, clouds lie at y = 0.11", () => {
    const a = make("high");
    a.tick(1000, DAY);
    const { birds, clouds } = parts(a);
    const b = positions(birds as THREE.InstancedMesh);
    for (let i = 1; i < b.length; i += 3) {
      expect(b[i]).toBeGreaterThanOrEqual(40);
      expect(b[i]).toBeLessThanOrEqual(90);
    }
    const c = positions(clouds as THREE.InstancedMesh);
    for (let i = 1; i < c.length; i += 3) expect(c[i]).toBeCloseTo(0.11, 6);
  });

  it("birds hide above night 0.5; clouds hide when day is below 0.5", () => {
    const a = make("high");
    const { birds, clouds } = parts(a);
    a.tick(0, DAY);
    expect([birds?.visible, clouds?.visible]).toEqual([true, true]);
    a.tick(0, NIGHT);
    expect([birds?.visible, clouds?.visible]).toEqual([false, false]);
    a.tick(0, { day: 0.4, dusk: 0.6, night: 0 });
    expect([birds?.visible, clouds?.visible]).toEqual([true, false]);
    a.tick(0, { day: 0.2, dusk: 0.2, night: 0.6 });
    expect(birds?.visible).toBe(false);
  });

  it("is deterministic per seed and differs between seeds", () => {
    const at = (seed: string) => {
      const a = make("high", seed);
      a.tick(5000, DAY);
      const { birds, clouds } = parts(a);
      return [positions(birds as THREE.InstancedMesh), positions(clouds as THREE.InstancedMesh)];
    };
    expect(at("x")).toEqual(at("x"));
    expect(at("x")).not.toEqual(at("y"));
  });

  it("clouds drift 3 m/s", () => {
    const a = make("high");
    const { clouds } = parts(a);
    a.tick(0, DAY);
    const p0 = positions(clouds as THREE.InstancedMesh);
    a.tick(10_000, DAY);
    const p1 = positions(clouds as THREE.InstancedMesh);
    expect(Math.hypot(p1[0]! - p0[0]!, p1[2]! - p0[2]!)).toBeCloseTo(30, 3);
  });

  it("everything is decorative, unpickable, casts no shadow", () => {
    const a = make("high");
    expect(a.group.userData.decorative).toBe(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, -1, 0));
    a.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      expect(o.userData.decorative).toBe(true);
      expect(o.castShadow).toBe(false);
      const hits: THREE.Intersection[] = [];
      o.raycast(ray, hits);
      expect(hits).toEqual([]);
    });
  });

  it("dispose frees geometries and materials", () => {
    const a = make("high");
    let n = 0;
    a.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.addEventListener("dispose", () => n++);
      (o.material as THREE.Material).addEventListener("dispose", () => n++);
    });
    a.dispose();
    expect(n).toBeGreaterThanOrEqual(4);
  });

  it("birds flap: the material injects a uTime wing-flap vertex term, uTime follows real time", () => {
    expect(BIRD_FLAP_HZ).toBeGreaterThan(0);
    const a = make("high");
    const { birds } = parts(a);
    const mat = (birds as THREE.InstancedMesh).material as THREE.MeshBasicMaterial;
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    };
    mat.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );
    expect(shader.vertexShader).toContain("uniform float uTime;");
    expect(shader.vertexShader).toMatch(/sin\(\s*uTime/);
    expect(shader.vertexShader).toContain("transformed.y +=");
    expect(mat.customProgramCacheKey()).toContain("bird-flap");
    a.tick(12_345, DAY);
    expect(shader.uniforms.uTime?.value).toBeCloseTo(12.345, 6);
  });

  it("birds bank into their turns, bounded by BIRD_MAX_BANK; the inner wing dips", () => {
    expect(BIRD_MAX_BANK).toBeLessThanOrEqual(Math.PI / 4);
    for (const v of [0, 3, 6, 10, 40])
      for (const w of [-2, -0.05, -0.01, 0, 0.01, 0.05, 2]) {
        const b = birdBank(v, w);
        expect(Math.abs(b)).toBeLessThanOrEqual(BIRD_MAX_BANK + 1e-12);
        expect(Math.sign(b)).toBe(v * w === 0 ? 0 : Math.sign(w));
      }
    expect(birdBank(8, 8 / 300)).toBeGreaterThan(0.01);

    const a = make("high", "bank");
    a.tick(4000, DAY);
    const birds = parts(a).birds as THREE.InstancedMesh;
    const geo = birds.geometry;
    const pos = geo.getAttribute("position");
    // The two wing tips are the vertices with the largest |z|.
    const tips: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++)
      if (Math.abs(pos.getZ(i)) > 1) tips.push(new THREE.Vector3().fromBufferAttribute(pos, i));
    const mat = new THREE.Matrix4();
    for (let i = 0; i < birds.count; i++) {
      birds.getMatrixAt(i, mat);
      const q = new THREE.Quaternion();
      const centre = new THREE.Vector3();
      mat.decompose(centre, q, new THREE.Vector3());
      // Roll: the body's up vector tilts from world up by the bank angle.
      const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      expect(Math.acos(Math.min(1, upv.y))).toBeLessThanOrEqual(BIRD_MAX_BANK + 1e-6);
      expect(Math.acos(Math.min(1, upv.y))).toBeGreaterThan(1e-4);
      const w = tips.map((t) => t.clone().applyMatrix4(mat));
      const orbit = birdOrbitCentre(a, i);
      const d = w.map((t) => Math.hypot(t.x - orbit[0], t.z - orbit[1]));
      const inner = d[0]! < d[1]! ? w[0]! : w[1]!;
      const outer = d[0]! < d[1]! ? w[1]! : w[0]!;
      expect(inner.y).toBeLessThan(outer.y);
    }
  });
});

/** The orbit centre of bird i (the ambient exposes it for tests). */
function birdOrbitCentre(a: ReturnType<typeof make>, i: number): [number, number] {
  const c = a.birdOrbits?.[i];
  if (!c) throw new Error("no orbit");
  return c;
}

describe("createAmbient with the Elmina outline (A-T4)", () => {
  // A 2.4 km square outline rotated 30 degrees about the frame origin (not axis-aligned): clouds
  // spread over +-1.5 km, so some decals are wholly inside and some cross it.
  const ll = (x: number, z: number) => frame.toLonLat(x, z);
  const rot = ([x, z]: [number, number]): [number, number] => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    return [x * c - z * s, x * s + z * c];
  };
  const corners: [number, number][] = [
    [-1200, -1200],
    [1200, -1200],
    [1200, 1200],
    [-1200, 1200],
  ];
  const ring = corners.map(rot);
  const b = boundaryOf(
    { type: "Polygon", coordinates: [[...ring, ring[0]!].map(([x, z]) => ll(x, z))] },
    frame,
  )!;
  const rows = (m: THREE.InstancedMesh) => {
    const mat = new THREE.Matrix4();
    const out: { x: number; z: number; s: number }[] = [];
    for (let i = 0; i < m.count; i++) {
      m.getMatrixAt(i, mat);
      const e = mat.elements;
      // Column length, not decompose's scale (three resets a singular matrix's scale to 1).
      out.push({ x: e[12]!, z: e[14]!, s: Math.hypot(e[0]!, e[1]!, e[2]!) });
    }
    return out;
  };

  it("hides birds outside and cloud decals with a corner outside; refresh redoes it after a move", () => {
    const a = createAmbient("high", frame, frame.toLonLat(0, 0), "s", b);
    a.tick(1000, DAY);
    const { birds, clouds } = parts(a);
    for (const r of rows(birds as THREE.InstancedMesh))
      expect(r.s === 0, JSON.stringify(r)).toBe(!insideBoundary(b, r.x, r.z));
    let shown = 0;
    for (const r of rows(clouds as THREE.InstancedMesh)) {
      if (r.s === 0) continue;
      shown++;
      // Every corner of the (axis-aligned, size x size) decal lies inside the rotated outline.
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const)
        expect(insideBoundary(b, r.x + (dx * r.s) / 2, r.z + (dz * r.s) / 2)).toBe(true);
    }
    expect(shown, "some cloud decals stay shown").toBeGreaterThan(0);
    expect(shown, "some cloud decals are hidden").toBeLessThan(TIERS.high.clouds);
    expect(shown + rows(clouds as THREE.InstancedMesh).filter((r) => r.s === 0).length).toBe(
      TIERS.high.clouds,
    );
    a.group.position.set(10000, 0, 0);
    a.refresh();
    for (const r of rows(birds as THREE.InstancedMesh)) expect(r.s).toBe(0);
    for (const r of rows(clouds as THREE.InstancedMesh)) expect(r.s).toBe(0);
  });
});
