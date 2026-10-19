import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type CrowdManifest, parseCrowdManifest } from "../assets/crowdManifest";
import type { ActiveTile } from "../stream/streamer";
import { tileOf } from "../stream/tiles";
import type { Agent } from "./agents";
import { crowdOverride, FILL_ID, fillCrowd, perTileTarget } from "./crowdOverride";
import { assignLooks } from "./crowdRules";
import { createLooksQueue } from "./looksQueue";

const pub = (p: string) => new URL(`../../../../../public${p}`, import.meta.url);
const crowd = parseCrowdManifest(
  JSON.parse(readFileSync(pub("/city/characters/crowd.json"), "utf8")),
).manifest as CrowdManifest;

const person = (id: string, pts: number[], over: Partial<Agent> = {}): Agent => ({
  id,
  kind: "person",
  variant: "office_man",
  path: Float32Array.from(pts),
  length: Math.hypot(pts[2]! - pts[0]!, pts[3]! - pts[1]!),
  speed: 1.35,
  offset: 0,
  ...over,
});

/** 30 x 12 people on a grid of crossing streets. */
const grid: Agent[] = [];
for (let i = 0; i < 30; i++)
  for (let j = 0; j < 12; j++)
    grid.push(
      j % 2
        ? person(`g${i}:${j}`, [i * 7, -10, i * 7, 200])
        : person(`g${i}:${j}`, [-10, i * 7 + j, 200, i * 7 + j]),
    );

/** A manual frame scheduler and a clock that advances 1 ms per read. */
function harness() {
  let clock = 0;
  const waiting: (() => void)[] = [];
  return {
    now: () => clock++,
    schedule: (cb: () => void) => {
      waiting.push(cb);
      return () => {
        const i = waiting.indexOf(cb);
        if (i >= 0) waiting.splice(i, 1);
      };
    },
    /** Runs one frame's callbacks; returns how many ran. */
    frame() {
      const run = waiting.splice(0);
      for (const cb of run) cb();
      return run.length;
    },
  };
}

describe("looksQueue: the look search in per-frame slices (GATE AC-D18)", () => {
  it("each frame gets one bounded slice, and every set's looks equal one search per set at once", async () => {
    const h = harness();
    const mem = new Map<string, number>();
    const q = createLooksQueue(mem, { budgetMs: 40, schedule: h.schedule, now: h.now });
    const sets = [grid.slice(0, 200), grid.slice(100, 360), grid.slice(150, 170)];
    const got: Map<string, number>[] = [];
    for (const s of sets) q.request(s, crowd.looks).then((m) => got.push(m));
    let frames = 0;
    while (q.pending > 0) {
      expect(h.frame()).toBe(1);
      frames++;
      await Promise.resolve();
    }
    await Promise.resolve();
    expect(frames).toBeGreaterThan(3);
    // The reference: one assignLooks per set, in order, on its own memory.
    const ref = new Map<string, number>();
    const want = sets.map((s) => assignLooks(s, crowd.looks, ref));
    expect(got.map((m) => [...m])).toEqual(want.map((m) => [...m]));
    expect([...mem]).toEqual([...ref]);
  });

  it("dispose stops the slices and rejects what is pending", async () => {
    const h = harness();
    const q = createLooksQueue(new Map(), { budgetMs: 2, schedule: h.schedule, now: h.now });
    const p = q.request(grid, crowd.looks);
    h.frame();
    q.dispose();
    await expect(p).rejects.toThrow(/disposed/);
    expect(h.frame()).toBe(0);
  });
});

describe("P10 crowd override (acceptance only)", () => {
  it("is honoured only with ?acceptance=1 and a sane N", () => {
    expect(crowdOverride("?crowd=400")).toBeNull();
    expect(crowdOverride("?demo=1&crowd=400")).toBeNull();
    expect(crowdOverride("?acceptance=1&crowd=400")).toBe(400);
    expect(crowdOverride("?acceptance=1")).toBeNull();
    expect(crowdOverride("?acceptance=1&crowd=-5")).toBeNull();
    expect(crowdOverride("?acceptance=1&crowd=1e9")).toBeNull();
    expect(crowdOverride("?acceptance=1&crowd=0")).toBeNull();
  });

  it("fills ring 0-1 tiles to the bubble density with copies on the tile's own paths, deterministically", () => {
    const tile = (i: number, ring: 0 | 1 | 2, n: number): ActiveTile => {
      const t = tileOf(i, 0);
      const agents: Agent[] = [];
      for (let k = 0; k < n; k++)
        agents.push(person(`t${i}:${k}`, [t.box.x0 + 10, k * 5, t.box.x0 + 200, k * 5]));
      agents.push({ ...person(`t${i}:car`, [0, 0, 10, 0]), kind: "vehicle", variant: "car" });
      return { key: t.key, tile: t, ring, content: { agents } as ActiveTile["content"] };
    };
    const active = [tile(0, 0, 20), tile(1, 1, 7), tile(2, 2, 20), tile(3, 1, 0)];
    const base = active.flatMap((a) => a.content.agents);
    const out = fillCrowd(base, active, 400);
    const target = perTileTarget(400);
    expect(target).toBeGreaterThan(300);
    const peopleOf = (prefix: string) =>
      out.filter((a) => a.kind === "person" && a.id.startsWith(prefix));
    expect(peopleOf("t0:")).toHaveLength(target);
    expect(peopleOf("t1:")).toHaveLength(target);
    expect(peopleOf("t2:")).toHaveLength(20); // ring 2: not filled
    expect(peopleOf("t3:")).toHaveLength(0); // no paths: nothing to copy
    expect(new Set(out.map((a) => a.id)).size).toBe(out.length);
    for (const a of out.filter((x) => x.id.includes(FILL_ID))) {
      const src = base.find((b) => a.id.startsWith(`${b.id}${FILL_ID}`));
      expect(src).toBeDefined();
      expect(a.path).toBe(src!.path);
    }
    expect(fillCrowd(base, active, 400).map((a) => [a.id, a.offset, a.speed])).toEqual(
      out.map((a) => [a.id, a.offset, a.speed]),
    );
  });
});
