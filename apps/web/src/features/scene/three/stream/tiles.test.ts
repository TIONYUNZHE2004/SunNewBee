import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Tier } from "../../shared/quality";
import { HERO_CENTRE } from "../bookmarks";
import { createFrame } from "../frame";
import {
  HERO_BOOST,
  type StreamKind,
  TILE_CAPS,
  TRIS_PER,
  tileCap,
  VERGE_PIECES_PER_CAP,
  VERGE_SHRUBS_PER_CAP,
} from "./caps";
import { activeTiles, TILE_M, tileAt } from "./tiles";

const frame = createFrame(HERO_CENTRE);
const KINDS = Object.keys(TRIS_PER) as StreamKind[];

describe("tileAt", () => {
  it("keys tiles from the origin and gives a shared edge to the higher index", () => {
    expect(tileAt(0, 0).key).toBe("0,0");
    expect(tileAt(249.999, 0).key).toBe("0,0");
    expect(tileAt(TILE_M, 0).key).toBe("1,0");
    expect(tileAt(-0.001, -TILE_M).key).toBe("-1,-1");
    expect(tileAt(-TILE_M, 0).key).toBe("-1,0");
    expect(tileAt(-0, -0).key).toBe("0,0");
    expect(tileAt(300, -300).box).toEqual({ x0: 250, z0: -500, x1: 500, z1: -250 });
  });
});

describe("activeTiles", () => {
  it("returns 1 + 8 + 16 tiles with rings 0/1/2 at 800 m", () => {
    const t = activeTiles({ x: 10, z: 10 }, 800);
    expect(t).toHaveLength(25);
    expect(t.filter((x) => x.ring === 0)).toHaveLength(1);
    expect(t.filter((x) => x.ring === 1)).toHaveLength(8);
    expect(t.filter((x) => x.ring === 2)).toHaveLength(16);
    expect(new Set(t.map((x) => x.tile.key)).size).toBe(25);
    expect(t[0]?.tile.key).toBe("0,0");
  });
  it("keeps ring 2 up to 1500 m and drops it beyond", () => {
    expect(activeTiles({ x: 0, z: 0 }, 1500)).toHaveLength(25);
    const t = activeTiles({ x: 0, z: 0 }, 2000);
    expect(t).toHaveLength(9);
    expect(t.every((x) => x.ring <= 1)).toBe(true);
  });
  it("orders ring first, then distance from the target", () => {
    const target = { x: 400, z: 100 };
    const t = activeTiles(target, 800);
    const d = (b: { x0: number; z0: number; x1: number; z1: number }) =>
      Math.hypot((b.x0 + b.x1) / 2 - target.x, (b.z0 + b.z1) / 2 - target.z);
    t.slice(1).forEach((cur, n) => {
      const prev = t[n];
      if (!prev) throw new Error("unreachable");
      expect(cur.ring).toBeGreaterThanOrEqual(prev.ring);
      if (cur.ring === prev.ring) expect(d(cur.tile.box)).toBeGreaterThanOrEqual(d(prev.tile.box));
    });
  });
  it("is deterministic", () => {
    const a = activeTiles({ x: -333, z: 777 }, 800).map((x) => x.tile.key);
    const b = activeTiles({ x: -333, z: 777 }, 800).map((x) => x.tile.key);
    expect(a).toEqual(b);
  });
});

describe("tileCap", () => {
  const inside = tileAt(0, 0);
  const outside = tileAt(5000, 5000);
  it("boosts by HERO_BOOST inside the hero radius only", () => {
    expect(HERO_BOOST).toBe(1.6);
    const base = TILE_CAPS.medium[0].trees;
    expect(tileCap("medium", 0, "trees", inside, frame)).toBe(Math.round(base * 1.6));
    expect(tileCap("medium", 0, "trees", outside, frame)).toBe(base);
  });
  it("is 0 at Low for every ring and kind", () => {
    for (const ring of [0, 1, 2] as const)
      for (const k of KINDS) expect(tileCap("low", ring, k, inside, frame)).toBe(0);
  });
  it("leaves only trees in ring 2", () => {
    for (const tier of ["high", "medium"] as const)
      for (const k of KINDS) if (k !== "trees") expect(TILE_CAPS[tier][2][k]).toBe(0);
  });
});

// Review Focus 2: the stream must fit what is left of the frame budget at any position.
describe("stream tri budget", () => {
  const BASELINE_MEDIUM = 2.0e6;
  const BUDGET_MEDIUM = 2.5e6;
  /** High has no stated budget: allow its stream twice Medium's slice. */
  const SLICE: Record<Tier, number> = {
    low: 0,
    medium: BUDGET_MEDIUM - BASELINE_MEDIUM,
    high: 2 * (BUDGET_MEDIUM - BASELINE_MEDIUM),
  };
  function streamTris(tier: Tier, target: { x: number; z: number }, rangeM: number): number {
    let sum = 0;
    for (const { tile, ring } of activeTiles(target, rangeM))
      for (const k of KINDS) sum += tileCap(tier, ring, k, tile, frame) * TRIS_PER[k][ring];
    return sum;
  }
  // Hero centre is the worst case (every active tile boosted); also sample elsewhere.
  const targets = [
    { x: 0, z: 0 },
    { x: -125, z: -125 },
    { x: 124, z: 124 },
    { x: 900, z: -600 },
    { x: 4000, z: 4000 },
  ];
  for (const tier of ["low", "medium", "high"] as const)
    for (const rangeM of [150, 800, 1500])
      it(`${tier} at ${rangeM} m stays inside its slice`, () => {
        for (const target of targets) {
          const tris = streamTris(tier, target, rangeM);
          expect(tris).toBeLessThanOrEqual(SLICE[tier]);
          if (tier === "medium") expect(BASELINE_MEDIUM + tris).toBeLessThanOrEqual(BUDGET_MEDIUM);
        }
      });
  it("counts verges and parked cars in the Medium sum (ruling P4-X: one budget for both lanes)", () => {
    const hero = { x: 0, z: 0 };
    const kindTris = (k: StreamKind, ring: 0 | 1) =>
      activeTiles(hero, 800)
        .filter((a) => a.ring === ring)
        .reduce((n, a) => n + tileCap("medium", ring, k, a.tile, frame) * TRIS_PER[k][ring], 0);
    expect(KINDS).toEqual(expect.arrayContaining(["verges", "parking", "parked"]));
    for (const ring of [0, 1] as const) expect(kindTris("parked", ring)).toBeGreaterThan(0);
    expect(kindTris("verges", 0)).toBeGreaterThan(0);
    // Ruling P4-Z: no Medium ring 1 verges (their planning broke the 8 ms hitch budget).
    expect(kindTris("verges", 1)).toBe(0);
  });
  it("does not gut Medium (the worst case uses at least 30 percent of its slice)", () => {
    expect(streamTris("medium", { x: 0, z: 0 }, 800)).toBeGreaterThan(0.3 * SLICE.medium);
  });
});

// 9a review: the verges cap must price what planTileVerges really draws per cap unit.
describe("verge accounting", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
  );
  const lod0 = (v: string) => manifest.assets.trees.variants[v].lods[0].tris as number;
  it("one cap unit = VERGE_PIECES_PER_CAP strip pieces (2 tris) plus, at ring 0, VERGE_SHRUBS_PER_CAP LOD0 shrubs", () => {
    const strips = 2 * VERGE_PIECES_PER_CAP;
    // planVerges' mix: 30 % hedges, 70 % round bushes.
    const shrub = 0.7 * lod0("shrub_round") + 0.3 * lod0("shrub_hedge");
    expect(TRIS_PER.verges[0]).toBeGreaterThanOrEqual(strips + VERGE_SHRUBS_PER_CAP * shrub);
    expect(TRIS_PER.verges[1]).toBeGreaterThanOrEqual(strips);
    expect(TRIS_PER.verges[2]).toBeGreaterThanOrEqual(strips);
  });
});
