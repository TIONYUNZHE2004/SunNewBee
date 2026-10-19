import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { createMotionUniforms, createRoleUniforms } from "../assets/roleMaterial";
import type { Agent } from "./agents";
import type { CrowdKit } from "./crowdBake";
import { gaitAt } from "./crowdGait";
import { loadCrowdKit } from "./crowdKit";
import { createMotionLayer } from "./motionLayer";

/**
 * Gate fix round 2 (AC-D17, scrub equals play): while a journey's trip clock drives the crowd
 * (`tick(..., pure = true)`), facing and walk cycle are pure functions of t. A seek forward to t, a
 * seek back to t and a play to t draw every person identically (matrix, clip frames, blend).
 */
const pub = (p: string) => new URL(`../../../../../public${p}`, import.meta.url);
const readBuf = (p: string) => {
  const b = readFileSync(pub(p.split("?")[0] as string));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
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

/** People on an L-shaped path (a corner to turn at) and a closed square loop, near the camera. */
function people(): Agent[] {
  const l = new Float32Array([0, 0, 30, 0, 30, 30]);
  const sq = new Float32Array([-10, -10, -10, 10, 10, 10, 10, -10, -10, -10.5]);
  const out: Agent[] = [];
  for (let i = 0; i < 8; i++)
    out.push({
      id: `p${i}`,
      kind: "person",
      variant: "a",
      path: i % 2 ? sq : l,
      length: i % 2 ? 80 : 60,
      speed: 1.1 + 0.05 * i,
      offset: 3 * i,
    });
  return out;
}

type Drawn = Map<number, string>;

/** Runs `times` (seconds) through a fresh layer in pure mode; what each slot drew at the last. */
function drawAt(times: number[]): Drawn {
  const layer = createMotionLayer(
    people(),
    emptyLib,
    manifest,
    createRoleUniforms(),
    createMotionUniforms(),
    { crowd: kit },
  );
  layer.setDensity({ day: 1, dusk: 0, night: 0 });
  const crowd = layer.crowd as NonNullable<typeof layer.crowd>;
  let drawn: Drawn = new Map();
  const set = crowd.set.bind(crowd);
  crowd.set = ((i: number, lod: 0 | 1, m: THREE.Matrix4, f0: number, f1: number, t: number) => {
    drawn.set(
      i,
      JSON.stringify([lod, m.elements.map((v) => +v.toFixed(5)), f0, f1, +t.toFixed(5)]),
    );
    return set(i, lod, m, f0, f1, t);
  }) as typeof crowd.set;
  const cam = new THREE.Vector3(5, 20, 40);
  for (const t of times) {
    drawn = new Map();
    layer.tick(60_000 + t * 1000, cam, undefined, true);
  }
  layer.dispose();
  return drawn;
}

describe("crowd on the trip clock is a pure function of t (scrub equals play)", () => {
  it("seek forward, seek back and play to the same t draw every person the same", () => {
    for (const t of [12.3, 27.05, 41.9]) {
      const forward = drawAt([1, t]);
      const back = drawAt([t + 30, t]);
      const play: number[] = [];
      for (let s = t - 6; s < t; s += 1 / 60) play.push(s);
      play.push(t);
      const played = drawAt(play);
      expect(forward.size).toBeGreaterThan(0);
      expect(back).toEqual(forward);
      expect(played).toEqual(forward);
    }
  });

  it("gaitAt: walking phase from the distance walked; a standing agent idles on its own clock", () => {
    const walk = { stride: 1.2, duration: 1 };
    const idle = { stride: 0, duration: 3 };
    const a = gaitAt("x", 10, 1.2, 5, 1.5, walk, idle);
    expect(a.idle).toBe(false);
    expect(gaitAt("x", 10, 1.2, 99, 1.5, walk, idle)).toEqual(a);
    const s = gaitAt("x", 0, 0, 5, 1.5, walk, idle);
    expect(s.idle).toBe(true);
    expect(gaitAt("x", 0, 0, 5, 1.5, walk, idle)).toEqual(s);
  });
});
