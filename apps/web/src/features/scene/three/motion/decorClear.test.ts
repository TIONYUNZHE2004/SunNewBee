import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { journeyHero } from "../../../journey/journeyStore";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import { createMotionUniforms, createRoleUniforms } from "../assets/roleMaterial";
import { heroXZ } from "../scene/useMotion";
import type { Agent } from "./agents";
import {
  densityShown,
  type HeroXZ,
  HOLD_KEEP_OUT_M,
  NEAR_CAMERA_PEOPLE_M,
  personClear,
  VEHICLE_CLEAR_M,
  vehicleClear,
} from "./crowdRules";
import { createMotionLayer } from "./motionLayer";

/**
 * ITER2 (owner demo video): decorative traffic beside / across her route and crowd figures at the
 * camera's feet; the drawn crowd at a trip time depended on the streamed union (AC-D17).
 */

const kit = () => ({
  group: "kit" as const,
  file: "x.glb",
  bytes: 1,
  repeat: "none" as const,
  frontage: "long" as const,
  fit: { xz: [0.5, 2], y: [0.5, 2] } as { xz: [number, number]; y: [number, number] },
  decorative: true,
  placement: null,
  jitter: {},
  variantByGroup: {},
  palettes: { default: [["#112233", "#445566", "#778899"]] as [string, string, string][] },
  variants: {
    v: {
      size: [1, 1.74, 1] as [number, number, number],
      lods: [{ node: "n", tris: 12, maxM: null }],
    },
  },
});
const manifest = (): Manifest => ({
  version: 1,
  as_of: "",
  precinctGroups: [],
  assets: { people: kit(), vehicles: kit() },
  landmarks: {},
});
const lib = (): AssetLibrary => ({
  geometry: () => new THREE.BoxGeometry(1, 1, 1),
  has: () => true,
  gpuBytes: () => 0,
  failed: [],
  dispose() {},
});
/** An agent standing at (x, z) (speed 0 on a 1 m path). */
const at = (id: string, kind: Agent["kind"], x: number, z: number): Agent => ({
  id,
  kind,
  variant: "v",
  path: new Float32Array([x, z, x + 0.001, z]),
  length: 0.001,
  speed: 0,
  offset: 0,
});
const drawnIds = (agents: Agent[], hero: HeroXZ | null, camera: THREE.Vector3) => {
  const layer = createMotionLayer(
    agents,
    lib(),
    manifest(),
    createRoleUniforms(),
    createMotionUniforms(),
    { hero: () => hero },
  );
  layer.tick(0, camera, undefined, true);
  const out: string[] = [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  layer.group.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh || !mesh.visible) return;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      const a = agents.find(
        (g) => Math.hypot((g.path[0] ?? 0) - p.x, (g.path[1] ?? 0) - p.z) < 0.01,
      );
      if (a) out.push(a.id);
    }
  });
  layer.dispose();
  return out.sort();
};

// She walks north-east from the origin; the camera stands ~10 m behind her.
const hero: HeroXZ = {
  x: 0,
  z: 0,
  yaw: 0,
  ahead: [
    [0, 0],
    [0, 10],
  ],
};
const camera = new THREE.Vector3(0, 4.2, -10);

describe("vehicles stay off her route and the camera line while a journey is shown", () => {
  it("a car beside her, across her next 10 m or between the camera and her is not drawn; far ones are", () => {
    const cars = [
      at("beside", "vehicle", 3.5, 1), // the f_007 pickup
      at("ahead", "vehicle", 4, 8), // the f_011 car across her path
      at("behind", "vehicle", 2, -6), // between the camera and her
      at("far", "vehicle", 30, 5),
    ];
    expect(drawnIds(cars, hero, camera)).toEqual(["far"]);
    // without a journey every car is drawn (the city's traffic is unchanged)
    expect(drawnIds(cars, null, camera)).toEqual(["ahead", "behind", "beside", "far"]);
  });

  it("vehicleClear: the margin is VEHICLE_CLEAR_M from her line, deterministic", () => {
    expect(vehicleClear(VEHICLE_CLEAR_M - 0.1, 5, hero, camera)).toBe(false);
    expect(vehicleClear(VEHICLE_CLEAR_M + 0.1, 5, hero, camera)).toBe(true);
    expect(vehicleClear(1, -3, hero, camera)).toBe(false);
    expect(vehicleClear(1, 1, null, camera)).toBe(true);
  });
});

describe("crowd figures never at the camera's feet, and clear of her while she holds", () => {
  it("a person within NEAR_CAMERA_PEOPLE_M of the camera is not drawn", () => {
    const people = [
      at("atCamera", "person", 3, -12), // the giant head at the frame's corner
      at("street", "person", 20, 5),
    ];
    expect(drawnIds(people, hero, camera)).toEqual(["street"]);
    expect(drawnIds(people, null, camera)).toEqual(["atCamera", "street"]);
    expect(personClear(0, -10 + NEAR_CAMERA_PEOPLE_M + 0.1, null, camera)).toBe(true);
  });

  it("while she holds, nobody within HOLD_KEEP_OUT_M of her; walking, the 2 m keep-out applies", () => {
    const people = [at("near", "person", -4, -1), at("out", "person", -7, 2)];
    expect(drawnIds(people, { ...hero, hold: true }, camera)).toEqual(["out"]);
    expect(drawnIds(people, hero, camera)).toEqual(["near", "out"]);
    expect(personClear(HOLD_KEEP_OUT_M - 0.1, 0, { ...hero, hold: true }, camera)).toBe(false);
  });

  it("heroXZ publishes hold when her drawn clip is not the walk", () => {
    const pose = {
      distance_m: 0,
      x: 1,
      z: 2,
      y: 0,
      lon: 0,
      lat: 0,
      yaw: 0,
      clip: "walk" as const,
      clipTime: 0,
      walkRate: 1,
      groundKnown: true,
    };
    journeyHero.current = pose;
    expect(heroXZ()?.hold).toBeUndefined();
    journeyHero.current = { ...pose, clip: "sit_idle" };
    expect(heroXZ()?.hold).toBe(true);
  });
  afterEach(() => {
    journeyHero.current = null;
  });
});

describe("AC-D17: the drawn crowd does not depend on which streamed tiles are in the set", () => {
  it("an agent's density decision is its own (a tile streamed ahead of it changes nothing)", () => {
    const tileA = Array.from({ length: 40 }, (_, i) => at(`a${i}`, "person", 50 + i, 50));
    const tileB = Array.from({ length: 40 }, (_, i) => at(`b${i}`, "person", 50 + i, 60));
    /** The ids drawn from tile B (z = 60). */
    const shownB = (agents: Agent[]) => {
      const layer = createMotionLayer(
        agents,
        lib(),
        manifest(),
        createRoleUniforms(),
        createMotionUniforms(),
      );
      layer.setDensity({ day: 1, dusk: 0, night: 0 });
      layer.tick(0, new THREE.Vector3(70, 30, 55));
      const out: number[] = [];
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      layer.group.traverse((o) => {
        const mesh = o as THREE.InstancedMesh;
        if (!mesh.isInstancedMesh || !mesh.visible) return;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m);
          p.setFromMatrixPosition(m);
          if (Math.abs(p.z - 60) < 0.01) out.push(Math.round(p.x));
        }
      });
      layer.dispose();
      return out.sort((x, y) => x - y);
    };
    // B alone, then B with A streamed in ahead of it: the same people of B are drawn.
    const bAlone = shownB(tileB);
    expect(bAlone.length).toBeGreaterThan(0);
    expect(bAlone.length).toBeLessThan(40);
    expect(shownB([...tileA, ...tileB])).toEqual(bAlone);
    expect(shownB([...tileB, ...tileA])).toEqual(bAlone);
  });

  it("densityShown is a pure function of the id and the share", () => {
    expect(densityShown("x", 1)).toBe(true);
    expect(densityShown("x", 0)).toBe(false);
    expect(densityShown("abc", 0.5)).toBe(densityShown("abc", 0.5));
  });
});
