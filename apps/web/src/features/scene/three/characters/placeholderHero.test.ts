import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { REST_TIMING } from "../journey/heroDriver";
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
    b.dispose();
  });
});
