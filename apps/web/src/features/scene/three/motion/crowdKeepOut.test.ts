import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { createMotionUniforms, createRoleUniforms } from "../assets/roleMaterial";
import { type Agent, smoothYaw } from "./agents";
import type { CrowdKit } from "./crowdBake";
import { corridor, HAVE_SEED, routeTiles } from "./crowdCorridor.fixture";
import { loadCrowdKit } from "./crowdKit";
import { type HeroXZ, KEEP_OUT_M, polylineDistance } from "./crowdRules";
import { createMotionLayer } from "./motionLayer";

/**
 * P8 player test (C-T8): the hero walks the whole D-T4 demo route at the plan's pace (heading
 * smoothed as the hero driver does) through the crowd planned on the seed; every tick, every drawn
 * crowd person (read back from the BatchedMesh matrices) stays >= 2 m from her and from her next
 * 10 m. The crowd reads only her position and heading.
 */
const pub = (p: string) => new URL(`../../../../../public${p}`, import.meta.url);
const readBuf = (p: string) => {
  const b = readFileSync(pub(p.split("?")[0] as string));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const DEMO_PACE = JSON.parse(
  readFileSync(new URL("../../../journey/fixtures/demoPlan.json", import.meta.url), "utf8"),
).pace_m_per_s as number;

const emptyLib = {
  geometry: () => null,
  has: () => false,
  gpuBytes: () => 0,
  failed: [],
  dispose() {},
};
const manifest = { version: 1, as_of: "", precinctGroups: [], assets: {}, landmarks: {} } as never;

let kit: CrowdKit;
beforeAll(async () => {
  kit = await loadCrowdKit({
    fetchJson: async (u) => JSON.parse(readFileSync(pub(u), "utf8")),
    loadGlb: async (u) => readBuf(u),
  });
}, 30_000);

describe.skipIf(!HAVE_SEED)("P8: crowd keep-out over the full demo playback", () => {
  it("no drawn person within 2 m of the hero or her next 10 m; people step aside without jumps", () => {
    const c = corridor();
    const all = c.plan(routeTiles(c)).filter((a) => a.kind === "person");
    // People whose path comes within 60 m of the route: the ones she can meet.
    const meet = all.filter((a: Agent) => {
      for (let i = 0; i < a.path.length; i += 2)
        for (const [x, z] of c.route)
          if (Math.hypot((a.path[i] as number) - x, (a.path[i + 1] as number) - z) < 60)
            return true;
      return false;
    });
    expect(meet.length).toBeGreaterThan(50);
    let hero: HeroXZ | null = null;
    const layer = createMotionLayer(
      meet,
      emptyLib,
      manifest,
      createRoleUniforms(),
      createMotionUniforms(),
      { crowd: kit, hero: () => hero },
    );
    const crowd = layer.crowd!;
    const total = c.cum[c.cum.length - 1] as number;
    const dt = 0.1;
    const mat = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const last = new Map<number, THREE.Vector3>();
    let minHero = Infinity;
    let minZone = Infinity;
    let maxJump = 0;
    let quick = 0;
    let intoObstacle = 0;
    let nearby = 0;
    let yaw = c.at(0).yaw;
    const steps = Math.ceil(total / DEMO_PACE / dt);
    for (let k = 0; k <= steps; k++) {
      const t = k * dt;
      const p = c.at(t * DEMO_PACE);
      yaw = k === 0 ? p.yaw : smoothYaw(yaw, p.yaw, dt);
      const m = t * DEMO_PACE;
      // As heroLayer publishes it: her next 10 m of route every 0.25 m (position data only).
      const ahead: [number, number][] = [];
      for (let j = 1; j <= 40; j++) {
        const q = c.at(m + j * 0.25);
        ahead.push([q.x, q.z]);
      }
      hero = { x: p.x, z: p.z, yaw, ahead };
      // Scored against the real route s..s+10 m (vertices included), not the sampled copy.
      const zone = c.slice(m, m + 10);
      layer.tick(t * 1000, new THREE.Vector3(p.x, 30, p.z));
      for (let i = 0; i < crowd.slots; i++) {
        const mesh = crowd.meshes.find((m) => m.getVisibleAt(i));
        if (!mesh) {
          last.delete(i);
          continue;
        }
        mesh.getMatrixAt(i, mat);
        pos.setFromMatrixPosition(mat);
        const dh = Math.hypot(pos.x - hero.x, pos.z - hero.z);
        if (dh < 15) nearby++;
        minHero = Math.min(minHero, dh);
        minZone = Math.min(minZone, polylineDistance(pos.x, pos.z, zone));
        if (c.inObstacle(pos.x, pos.z)) intoObstacle++;
        const prev = last.get(i);
        if (prev) {
          const j = Math.hypot(pos.x - prev.x, pos.z - prev.z);
          if (j > 0.5) quick++;
          maxJump = Math.max(maxJump, j);
        }
        last.set(i, (prev ?? new THREE.Vector3()).copy(pos));
      }
    }
    layer.dispose();
    // The hero met people (the test is not vacuous), and none came inside the zone.
    expect(nearby).toBeGreaterThan(100);
    expect(minHero).toBeGreaterThanOrEqual(KEEP_OUT_M);
    expect(minZone).toBeGreaterThanOrEqual(KEEP_OUT_M);
    // Nobody is pushed into a footprint or water.
    expect(intoObstacle).toBe(0);
    // Walking <= 1.5 m/s plus stepping aside. The zone follows her real path ahead, so a corner no
    // longer sweeps it sideways: at most a few > 0.5 m steps per 0.1 s over the walk, none of 1 m.
    expect(maxJump).toBeLessThan(1);
    expect(quick).toBeLessThanOrEqual(4);
  }, 120_000);
});
