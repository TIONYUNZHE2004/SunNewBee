import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type CrowdManifest, parseCrowdManifest } from "../assets/crowdManifest";
import { tileOf } from "../stream/tiles";
import { type Agent, alongPath, type Pose2 } from "./agents";
import { corridor, HAVE_SEED, routeTiles } from "./crowdCorridor.fixture";
import { assignLooks, type HeroXZ, type KeepOutMemory, keepOut, lookJob } from "./crowdRules";
import { refAlong, refAssignLooks, refKeepOut } from "./crowdRules.reference.fixture";

/**
 * GATE AC-D18 (crowd part): the optimised path walk, keep-out and look search must give exactly the
 * results of the code they replace (kept verbatim in crowdRules.reference.fixture.ts), and the look
 * search must run in slices without changing its result.
 */

const pub = (p: string) => new URL(`../../../../../public${p}`, import.meta.url);
const crowd = parseCrowdManifest(
  JSON.parse(readFileSync(pub("/city/characters/crowd.json"), "utf8")),
).manifest as CrowdManifest;

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const person = (id: string, pts: number[], over: Partial<Agent> = {}): Agent => {
  let length = 0;
  for (let i = 0; i + 3 < pts.length; i += 2)
    length += Math.hypot(pts[i + 2]! - pts[i]!, pts[i + 3]! - pts[i + 1]!);
  return {
    id,
    kind: "person",
    variant: "office_man",
    path: Float32Array.from(pts),
    length,
    speed: 1.35,
    offset: 0,
    ...over,
  };
};

/** Random wiggly paths in a 300 m square (some with repeated points), dense enough for collisions. */
function randomCrowd(seed: number, count: number): Agent[] {
  const r = rng(seed);
  const out: Agent[] = [];
  for (let k = 0; k < count; k++) {
    const pts: number[] = [r() * 300, r() * 300];
    const n = 1 + Math.floor(r() * 8);
    for (let i = 0; i < n; i++) {
      const lx = pts[pts.length - 2]!;
      const lz = pts[pts.length - 1]!;
      if (r() < 0.15) pts.push(lx, lz);
      else pts.push(lx + (r() - 0.5) * 80, lz + (r() - 0.5) * 80);
    }
    out.push(person(`p${seed}:${k}`, pts, r() < 0.1 ? { variant: "jogger" } : {}));
  }
  return out;
}

describe("alongPath (binary search) matches the linear walk", () => {
  it("at every arc length, including the ends, zero-length segments and out-of-range lengths", () => {
    const r = rng(7);
    const a: Pose2 = { x: 0, z: 0, yaw: 0 };
    const b: Pose2 = { x: 0, z: 0, yaw: 0 };
    const paths: Float32Array[] = [
      Float32Array.from([0, 0, 0, 0]),
      Float32Array.from([0, 0, 0, 0, 3, 4, 3, 4, 3, 4]),
      Float32Array.from([1, 1, 1, 1, 1, 1]),
    ];
    for (let k = 0; k < 200; k++) paths.push(randomCrowd(k, 1)[0]!.path);
    for (const p of paths) {
      let len = 0;
      for (let i = 0; i + 3 < p.length; i += 2)
        len += Math.hypot(p[i + 2]! - p[i]!, p[i + 3]! - p[i + 1]!);
      const ss = [-1, 0, len, len + 1, len * 0.5];
      for (let i = 0; i < 60; i++) ss.push((r() * 1.2 - 0.1) * len);
      for (const s of ss) {
        alongPath(p, s, a);
        refAlong(p, s, b);
        expect(a.x).toBeCloseTo(b.x, 4);
        expect(a.z).toBeCloseTo(b.z, 4);
        expect(a.yaw).toBeCloseTo(b.yaw, 9);
      }
    }
  });
});

describe("keepOut (allocation-free) matches the original", () => {
  it("for heroes with and without a path ahead, over many people and frames", () => {
    const r = rng(11);
    for (let h = 0; h < 60; h++) {
      const hero: HeroXZ = { x: r() * 20, z: r() * 20, yaw: (r() - 0.5) * 2 * Math.PI };
      if (h % 2 === 0) {
        const ahead: [number, number][] = [];
        let x = hero.x;
        let z = hero.z;
        let yaw = hero.yaw;
        for (let i = 0; i < 40; i++) {
          yaw += (r() - 0.5) * 0.3;
          x += Math.sin(yaw) * 0.25;
          z += Math.cos(yaw) * 0.25;
          ahead.push([x, z]);
        }
        hero.ahead = ahead;
      }
      const memA: KeepOutMemory[] = [];
      const memB: KeepOutMemory[] = [];
      for (let p = 0; p < 40; p++) {
        memA.push({});
        memB.push({});
      }
      for (let f = 0; f < 10; f++)
        for (let p = 0; p < 40; p++) {
          const x = hero.x + (r() - 0.5) * 30;
          const z = hero.z + (r() - 0.5) * 30;
          const got = keepOut(x, z, hero, memA[p]!);
          const want = refKeepOut(x, z, hero, memB[p]!);
          expect(got).toEqual(want);
          expect(memA[p]).toEqual(memB[p]);
        }
    }
  });
});

describe("look search: incremental, cached and sliced, same looks", () => {
  it("assignLooks equals the all-pairs original on random dense crowds", () => {
    for (const seed of [1, 2, 3]) {
      const people = randomCrowd(seed, 180);
      expect([...assignLooks(people, crowd.looks)]).toEqual([
        ...refAssignLooks(people, crowd.looks),
      ]);
    }
  });

  it("with memory, over a streamed sequence of sets, the looks and memory match step by step", () => {
    const all = randomCrowd(9, 400);
    const sets = [all.slice(0, 150), all.slice(50, 250), all.slice(40, 400), all.slice(300, 330)];
    const memA = new Map<string, number>();
    const memB = new Map<string, number>();
    for (const set of sets) {
      expect([...assignLooks(set, crowd.looks, memA)]).toEqual([
        ...refAssignLooks(set, crowd.looks, memB),
      ]);
      expect([...memA]).toEqual([...memB]);
    }
  });

  it("slices of any size give the same result, and memory changes only when the job is done", () => {
    const people = randomCrowd(5, 250);
    const want = assignLooks(people, crowd.looks);
    for (const budget of [1, 3, 17]) {
      let clock = 0;
      const now = () => clock++;
      const mem = new Map<string, number>([["someone-else", 0]]);
      const job = lookJob(people, crowd.looks, mem);
      let steps = 0;
      while (!job.step(budget, now)) {
        steps++;
        expect(job.done).toBe(false);
        expect([...mem]).toEqual([["someone-else", 0]]);
      }
      expect(steps).toBeGreaterThan(0);
      expect([...job.result()]).toEqual([...want]);
      expect(mem.size).toBe(people.length);
    }
  });

  it("survivors cost no neighbour search: only the newly streamed people are searched", () => {
    const all = randomCrowd(13, 300);
    const mem = new Map<string, number>();
    const first = lookJob(all.slice(0, 250), crowd.looks, mem);
    while (!first.step(Number.POSITIVE_INFINITY));
    expect(first.searched).toBe(250);
    const second = lookJob(all, crowd.looks, mem);
    while (!second.step(Number.POSITIVE_INFINITY));
    expect(second.searched).toBe(50);
  });

  it.skipIf(!HAVE_SEED)(
    "equals the original on the seed demo corridor (route tiles + ring 1)",
    () => {
      const c = corridor();
      const tiles = routeTiles(c);
      const people = c.plan(tiles).filter((a) => a.kind === "person" && a.variant !== "cyclist");
      expect(people.length).toBeGreaterThan(300);
      expect([...assignLooks(people, crowd.looks)]).toEqual([
        ...refAssignLooks(people, crowd.looks),
      ]);
      // A streamed step: one more ring of tiles around the first route tile arrives.
      const t0 = tiles[0]!;
      const i = Math.floor(t0.box.x0 / 250);
      const j = Math.floor(t0.box.z0 / 250);
      const more = c
        .plan([tileOf(i - 1, j - 1)])
        .filter((a) => a.kind === "person" && a.variant !== "cyclist");
      const memA = new Map<string, number>();
      const memB = new Map<string, number>();
      assignLooks(people, crowd.looks, memA);
      refAssignLooks(people, crowd.looks, memB);
      const next = [
        ...people.slice(100),
        ...more.filter((m) => !people.some((p) => p.id === m.id)),
      ];
      expect([...assignLooks(next, crowd.looks, memA)]).toEqual([
        ...refAssignLooks(next, crowd.looks, memB),
      ]);
    },
  );
});
