import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import { ARCH, createMarathonCourse } from "./marathonCourse";

const canvas = () =>
  ({ width: 1, height: 1, getContext: () => null }) as unknown as HTMLCanvasElement;

const d = {
  arches: [
    {
      label: "START",
      at: [101.5, 3.1] as [number, number],
      toward: [101.5, 3.101] as [number, number],
    },
    {
      label: "FINISH",
      at: [101.51, 3.1] as [number, number],
      toward: [101.509, 3.1] as [number, number],
    },
  ],
  km: [{ km: 1, at: [101.505, 3.1] as [number, number] }],
  cones: [[101.502, 3.1] as [number, number], [101.503, 3.1] as [number, number]],
  closed: "Closed 06:00–10:00",
};

describe("marathon course dressing overlay (T-031)", () => {
  it("draws arches across the course, cones, km markers and the closed tag, never picked", () => {
    const child = createMarathonCourse(d, createFrame([101.5, 3.1]), canvas);
    expect(child.counts()).toEqual({ arches: 2, km: 1, cones: 2, tags: 1 });
    const sprites: THREE.Sprite[] = [];
    child.group.traverse((o) => {
      if (o instanceof THREE.Sprite) sprites.push(o);
    });
    expect(sprites.map((s) => s.userData.text)).toEqual([
      "START",
      "FINISH",
      "1 km",
      "Closed 06:00–10:00",
    ]);
    // the closed tag stacks one row above the start arch's label
    expect(sprites[3]?.position.toArray()).toEqual(sprites[0]?.position.toArray());
    expect(sprites[3]?.center.y).toBeLessThan(0);
    // the start course runs north (local -z): the crossbar (local x) stays east-west
    const arch = child.group.children.find((o) => o instanceof THREE.Group) as THREE.Group;
    expect(Math.abs(Math.cos(arch.rotation.y))).toBeCloseTo(1, 3);
    expect(arch.children.some((m) => m.position.y === ARCH.height)).toBe(true);
    const cones = child.group.children.filter((o) => o instanceof THREE.InstancedMesh);
    expect(cones.map((c) => (c as THREE.InstancedMesh).count)).toEqual([2, 2]);
    child.setResolution?.(1440, 900);
    child.setView?.({ x: 0, y: 500, z: 0 }, 0, 40);
    expect(sprites[0]?.scale.y).toBeGreaterThan(0);
    child.dispose();
  });
});
