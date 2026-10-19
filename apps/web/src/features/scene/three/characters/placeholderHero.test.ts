import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { REST_TIMING } from "../journey/heroDriver";
import { HERO_BENCH, HERO_CLIP_S } from "./benchGeometry";
import { HERO_CLIPS, HERO_DISPLAY_SCALE } from "./hero";
import { BENCH_SEAT_TRUE_M, createPlaceholderHero, createRestBench } from "./placeholderHero";

const GROUND = 0.08;

function figureBox(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  const box = new THREE.Box3();
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.visible || c.userData.heroPart === "ring" || c.userData.heroPart === "disc")
      return;
    let hidden = false;
    for (let p: THREE.Object3D | null = c; p; p = p.parent) if (!p.visible) hidden = true;
    if (hidden) return;
    m.geometry.computeBoundingBox();
    box.union((m.geometry.boundingBox as THREE.Box3).clone().applyMatrix4(m.matrixWorld));
  });
  return box;
}

describe("placeholder hero", () => {
  it("implements the Hero interface with the six clips", () => {
    const h = createPlaceholderHero();
    expect(h.object3d).toBeInstanceOf(THREE.Object3D);
    for (const clip of HERO_CLIPS) expect(() => h.play(clip, 0.3, 1)).not.toThrow();
    h.dispose();
  });

  it("stands 2.2-2.5 m tall (R-J3: 1.55 x true 1.55 m)", () => {
    const h = createPlaceholderHero();
    h.setPose({ x: 0, y: 0, z: 0 }, 0);
    h.play("idle", 0, 0);
    const b = figureBox(h.object3d);
    const height = b.max.y - b.min.y;
    expect(HERO_DISPLAY_SCALE).toBe(1.55);
    expect(height).toBeGreaterThanOrEqual(2.2);
    expect(height).toBeLessThanOrEqual(2.5);
    h.dispose();
  });

  it("has a yellow ground ring", () => {
    const h = createPlaceholderHero();
    let ring: THREE.Mesh | null = null;
    h.object3d.traverse((c) => {
      if (c.userData.heroPart === "ring") ring = c as THREE.Mesh;
    });
    expect(ring).not.toBeNull();
    const col = ((ring as unknown as THREE.Mesh).material as THREE.MeshBasicMaterial).color;
    expect(col.r).toBeGreaterThan(0.9);
    expect(col.g).toBeGreaterThan(0.6);
    expect(col.b).toBeLessThan(0.4);
    h.dispose();
  });

  it("keeps feet and walker legs within 3 cm of the ground in every clip", () => {
    const h = createPlaceholderHero();
    h.setPose({ x: 12, y: GROUND, z: -4 }, 1.1);
    for (const clip of HERO_CLIPS) {
      for (let t = 0; t <= 4; t += 0.05) {
        h.play(clip, t, clip === "walk" ? 1.6 : 0);
        const cs = h.contacts();
        expect(cs.filter((c) => c.name.startsWith("foot")).length).toBe(2);
        expect(cs.filter((c) => c.name.startsWith("walker")).length).toBe(4);
        for (const c of cs) {
          expect(Math.abs(c.y - GROUND), `${clip} ${c.name} @${t.toFixed(2)}`).toBeLessThanOrEqual(
            0.03,
          );
        }
      }
    }
    h.dispose();
  });

  it("steps while walking (feet trade places) and stands still in idle", () => {
    const h = createPlaceholderHero();
    h.setPose({ x: 0, y: 0, z: 0 }, 0);
    const lead = (t: number, clip: "walk" | "idle") => {
      h.play(clip, t, 1);
      const [l, r] = h.contacts().filter((c) => c.name.startsWith("foot")) as unknown as [
        { z: number },
        { z: number },
      ];
      return l.z - r.z;
    };
    const w = [0, 0.25, 0.5, 0.75].map((t) => lead(t, "walk"));
    expect(Math.max(...w)).toBeGreaterThan(0.05);
    expect(Math.min(...w)).toBeLessThan(-0.05);
    expect(Math.abs(lead(0.25, "idle") - lead(0.9, "idle"))).toBeLessThan(1e-9);
    h.dispose();
  });

  it("parks the walker beside her while seated and holds it while walking", () => {
    const h = createPlaceholderHero();
    h.setPose({ x: 0, y: 0, z: 0 }, 0);
    const walkerX = () => {
      const ws = h.contacts().filter((c) => c.name.startsWith("walker"));
      return ws.reduce((s, c) => s + c.x, 0) / ws.length;
    };
    const walkerZ = () => {
      const ws = h.contacts().filter((c) => c.name.startsWith("walker"));
      return ws.reduce((s, c) => s + c.z, 0) / ws.length;
    };
    h.play("walk", 0.2, 1);
    expect(Math.abs(walkerX())).toBeLessThan(0.05);
    expect(walkerZ()).toBeGreaterThan(0.5); // in front of her
    h.play("sit_idle", 0.5, 0);
    expect(Math.abs(walkerX())).toBeGreaterThan(0.9); // beside her
    h.play("sit_down", REST_TIMING.sitDownS + 1, 0); // past the end: the last frame
    expect(Math.abs(walkerX())).toBeGreaterThan(0.9);
    h.play("stand_up", REST_TIMING.standUpS + 1, 0);
    expect(Math.abs(walkerX())).toBeLessThan(0.05);
    h.dispose();
  });

  it("turns her head in look", () => {
    const h = createPlaceholderHero();
    let head: THREE.Object3D | null = null;
    h.object3d.traverse((c) => {
      if (c.userData.heroPart === "head") head = c;
    });
    expect(head).not.toBeNull();
    const yaws = [0.5, 1.2, 2.2, 3].map((t) => {
      h.play("look", t, 0);
      return (head as unknown as THREE.Object3D).rotation.y;
    });
    expect(Math.max(...yaws)).toBeGreaterThan(0.3);
    expect(Math.min(...yaws)).toBeLessThan(-0.3);
    h.dispose();
  });

  it("never takes picks (raycast is a no-op on every mesh)", () => {
    const h = createPlaceholderHero();
    h.setPose({ x: 0, y: 0, z: 0 }, 0);
    h.object3d.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(h.object3d, true)).toEqual([]);
    h.dispose();
  });

  it("disposes every geometry and material it owns", () => {
    const h = createPlaceholderHero();
    let n = 0;
    const seen = new Set<unknown>();
    h.object3d.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      for (const r of [m.geometry, m.material as THREE.Material]) {
        if (seen.has(r)) continue;
        seen.add(r);
        r.addEventListener("dispose", () => n++);
      }
    });
    h.dispose();
    expect(n).toBe(seen.size);
  });
});

describe("placeholder hero: crossfade and flags", () => {
  const headYaw = (h: ReturnType<typeof createPlaceholderHero>) => {
    let y = 0;
    h.object3d.traverse((c) => {
      if (c.userData.heroPart === "head") y = c.rotation.y;
    });
    return y;
  };
  it("blends the outgoing clip into the new one by `blend`", () => {
    const h = createPlaceholderHero();
    h.play("look", 0.75, 0); // head fully turned (sin = 1)
    const full = headYaw(h);
    expect(full).toBeGreaterThan(0.7);
    h.play("look", 0.75, 0, { prevClip: "walk", prevTime: 0.3, blend: 0.25 });
    expect(headYaw(h)).toBeCloseTo(full * 0.25, 6);
    h.play("look", 0.75, 0, { prevClip: "walk", prevTime: 0.3, blend: 1 });
    expect(headYaw(h)).toBeCloseTo(full, 9);
    h.dispose();
  });

  it("keeps every contact on the ground through fades between any two clips", () => {
    const h = createPlaceholderHero();
    h.setPose({ x: 0, y: GROUND, z: 0 }, 0.4);
    for (const a of HERO_CLIPS)
      for (const b of HERO_CLIPS)
        for (const blend of [0, 0.3, 0.7]) {
          h.play(b, 0.4, 1, { prevClip: a, prevTime: 0.6, blend });
          for (const c of h.contacts())
            expect(Math.abs(c.y - GROUND), `${a}->${b} ${blend} ${c.name}`).toBeLessThanOrEqual(
              0.03,
            );
        }
    h.dispose();
  });

  it("plants every foot and walker leg on uneven ground when a ground sampler is set", () => {
    const h = createPlaceholderHero();
    // a kerb: footway 0.08 m for x < 0.5, lawn 0.018 m beyond (the AC-D10 bench case)
    const step = (x: number) => (x < 0.5 ? 0.08 : 0.018);
    h.setPose({ x: 0, y: 0.08, z: 0 }, Math.PI / 2); // facing +x: the walker crosses the kerb
    h.setGround?.((x) => step(x));
    for (const clip of HERO_CLIPS)
      for (const t of [0, 0.3, 0.6]) {
        h.play(clip, t, 1);
        for (const c of h.contacts())
          expect(Math.abs(c.y - step(c.x)), `${clip} ${c.name}`).toBeLessThanOrEqual(0.03);
      }
    // without a sampler everything stands at the root's height again
    h.setGround?.(null);
    h.play("idle", 0, 0);
    for (const c of h.contacts()) expect(Math.abs(c.y - 0.08)).toBeLessThan(1e-6);
    h.dispose();
  });

  it("is not flagged decorative (it is the simulation subject); picks pass through by raycast", () => {
    const h = createPlaceholderHero();
    h.object3d.traverse((c) => expect(c.userData.decorative).toBeUndefined());
    expect(h.object3d.userData.journeyHero).toBe(true);
    h.dispose();
  });
});

describe("rest bench", () => {
  it("has its seat at 0.45 m true x the hero scale", () => {
    const b = createRestBench();
    let seat: THREE.Mesh | null = null;
    b.object3d.traverse((c) => {
      if (c.userData.benchPart === "seat") seat = c as THREE.Mesh;
    });
    expect(seat).not.toBeNull();
    b.object3d.updateMatrixWorld(true);
    const s = seat as unknown as THREE.Mesh;
    s.geometry.computeBoundingBox();
    const top = (s.geometry.boundingBox as THREE.Box3).clone().applyMatrix4(s.matrixWorld).max.y;
    expect(BENCH_SEAT_TRUE_M).toBe(0.45);
    expect(top).toBeCloseTo(0.45 * HERO_DISPLAY_SCALE, 2);
    // the seat's front edge sits HERO_BENCH.frontEdgeZ behind her root (the asset manifest's bench)
    const front = (s.geometry.boundingBox as THREE.Box3).clone().applyMatrix4(s.matrixWorld).max.z;
    expect(front).toBeCloseTo(HERO_BENCH.frontEdgeZ * HERO_DISPLAY_SCALE, 6);
    b.dispose();
  });

  it("matches the asset manifest's seat and backrest boxes exactly (x the display scale)", () => {
    const b = createRestBench();
    b.object3d.updateMatrixWorld(true);
    for (const part of ["seat", "back"] as const) {
      let m: THREE.Mesh | null = null;
      b.object3d.traverse((c) => {
        if (c.userData.benchPart === part) m = c as THREE.Mesh;
      });
      const mesh = m as unknown as THREE.Mesh;
      mesh.geometry.computeBoundingBox();
      const box = (mesh.geometry.boundingBox as THREE.Box3).clone().applyMatrix4(mesh.matrixWorld);
      const want = HERO_BENCH[part];
      for (let i = 0; i < 3; i++) {
        expect(box.min.getComponent(i)).toBeCloseTo(
          (want.min[i] as number) * HERO_DISPLAY_SCALE,
          6,
        );
        expect(box.max.getComponent(i)).toBeCloseTo(
          (want.max[i] as number) * HERO_DISPLAY_SCALE,
          6,
        );
      }
    }
    expect(HERO_BENCH.seat).toEqual({ min: [-0.65, 0.39, -0.57], max: [0.65, 0.45, -0.21] });
    expect(HERO_BENCH.back).toEqual({ min: [-0.65, 0.57, -0.62], max: [0.65, 0.87, -0.55] });
    expect(HERO_BENCH.hipTravelM).toBeCloseTo(0.28, 9);
    expect(HERO_DISPLAY_SCALE).toBe(1.55);
    b.dispose();
  });

  it("seated, the hips travel HERO_BENCH.hipTravelM back onto the seat while the root stays put", () => {
    const h = createPlaceholderHero();
    h.setPose({ x: 0, y: 0, z: 0 }, 0);
    let upper: THREE.Object3D | null = null;
    h.object3d.traverse((c) => {
      if (c.userData.heroPart === "upper") upper = c;
    });
    const u = upper as unknown as THREE.Object3D;
    h.play("idle", 0, 0);
    expect(u.position.z).toBeCloseTo(0, 9);
    h.play("sit_idle", 0.3, 0);
    expect(u.position.z * HERO_DISPLAY_SCALE).toBeCloseTo(
      -HERO_BENCH.hipTravelM * HERO_DISPLAY_SCALE,
      9,
    );
    expect(h.object3d.position.z).toBe(0);
    // halfway through sit_down she is halfway back
    h.play("sit_down", HERO_CLIP_S.sit_down / 2, 0);
    expect(u.position.z).toBeCloseTo(-HERO_BENCH.hipTravelM / 2, 6);
    h.dispose();
  });
});
