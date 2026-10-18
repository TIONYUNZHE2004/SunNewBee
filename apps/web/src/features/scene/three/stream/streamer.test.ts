import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tier } from "../../cesium/stylised/quality";
import type { Placement } from "../assets/fit";
import { createStreamer, farView, PLAN_MEASURE, type Ring, type TileContent } from "./streamer";
import { activeTiles, TILE_M, type Tile } from "./tiles";

const pl = (id: string, asset: string, variant: string): Placement => ({
  id,
  asset,
  variant,
  x: 0,
  z: 0,
  yaw: 0,
  sx: 1,
  sy: 1,
  sz: 1,
  palette: ["#111111", "#222222", "#333333"],
});

/** A fake planner: counts plans per tile/ring/tier and disposes per content. */
function fakePlanner(slowMs = 0) {
  const calls: { key: string; ring: Ring; tier: Tier }[] = [];
  const disposed = new Map<TileContent, number>();
  const made: TileContent[] = [];
  const plan = (tile: Tile, ring: Ring, tier: Tier): TileContent => {
    calls.push({ key: tile.key, ring, tier });
    if (slowMs > 0) vi.advanceTimersByTime(slowMs);
    const c: TileContent = {
      kits: new Map([
        [`trees/rain_tree`, [pl(`${tile.key}:t`, "trees", "rain_tree")]],
        [`furniture/lamp_single`, [pl(`${tile.key}:l`, "furniture", "lamp_single")]],
      ]),
      lamps: [pl(`${tile.key}:l`, "furniture", "lamp_single")],
      agents: [
        {
          id: `${tile.key}:a`,
          kind: "person",
          variant: "v",
          path: new Float32Array(4),
          length: 1,
          speed: 1,
          offset: 0,
        },
      ],
      signs: [],
      ribbons: [
        {
          positions: new Float32Array(9),
          indices: new Uint32Array([0, 1, 2]),
          kind: "major",
        },
      ],
      facades: ring <= 1 ? [] : undefined,
      dispose() {
        disposed.set(c, (disposed.get(c) ?? 0) + 1);
      },
    };
    made.push(c);
    return c;
  };
  /** The planned content behind an active entry (the far view keeps the ribbons array). */
  const orig = (c: TileContent) => made.find((m) => m.ribbons === c.ribbons) as TileContent;
  return { plan, calls, disposed, made, orig };
}

const at = (i: number, j: number) => ({ x: (i + 0.5) * TILE_M, z: (j + 0.5) * TILE_M });
const MID = 800; // rings 0-2: 25 tiles
const FAR = 2000; // rings 0-1: 9 tiles

afterEach(() => {
  vi.useRealTimers();
});

describe("createStreamer (Review Focus 1)", () => {
  it("plans at most one tile per update, ring 0 first, until all 25 are planned", () => {
    const f = fakePlanner();
    const s = createStreamer(f.plan);
    const r1 = s.update(at(0, 0), MID, 0);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toEqual({ key: "0,0", ring: 0, tier: "medium" });
    expect(r1).toEqual({ changed: true, pending: true });
    expect(s.active()).toHaveLength(1);
    for (let n = 2; n <= 25; n++) {
      s.update(at(0, 0), MID, n);
      expect(f.calls).toHaveLength(n);
    }
    const done = s.update(at(0, 0), MID, 99);
    expect(f.calls).toHaveLength(25);
    expect(done).toEqual({ changed: false, pending: false });
    expect(s.active()).toHaveLength(25);
    // Plan order and the active list both follow activeTiles: ring 0, then 1, then 2.
    const want = activeTiles(at(0, 0), MID);
    expect(f.calls.map((c) => c.key)).toEqual(want.map((w) => w.tile.key));
    expect(s.active().map((a) => a.ring)).toEqual(want.map((w) => w.ring));
  });

  it("each plan is a User Timing measure (tl:stream-plan) for the browser run", () => {
    performance.clearMeasures?.(PLAN_MEASURE);
    const s = createStreamer(fakePlanner().plan);
    s.update(at(0, 0), MID, 0);
    s.update(at(0, 0), MID, 1);
    expect(performance.getEntriesByName(PLAN_MEASURE, "measure")).toHaveLength(2);
  });

  it("a planner slower than budgetMs still plans only one tile per call (and is counted)", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const f = fakePlanner(50);
    const s = createStreamer(f.plan, { budgetMs: 8 });
    for (let n = 1; n <= 5; n++) {
      s.update(at(3, 3), MID, n);
      expect(f.calls).toHaveLength(n);
    }
    expect(s.stats().overBudget).toBe(5);
    expect(s.stats().maxMs).toBeGreaterThanOrEqual(50);
  });

  it("leaving and returning reuses the cache: no re-plan", () => {
    const f = fakePlanner();
    const s = createStreamer(f.plan);
    for (let n = 0; n < 30; n++) s.update(at(0, 0), FAR, n);
    expect(f.calls).toHaveLength(9);
    const before = s.active().map((a) => a.content);
    // Away by 3 tiles: 9 new tiles (no overlap with the first 3 x 3).
    for (let n = 0; n < 30; n++) s.update(at(3, 0), FAR, n);
    expect(f.calls).toHaveLength(18);
    const r = s.update(at(0, 0), FAR, 100);
    expect(f.calls).toHaveLength(18);
    expect(r).toEqual({ changed: true, pending: false });
    expect(s.active().map((a) => a.content.ribbons)).toEqual(before.map((c) => c.ribbons));
  });

  it("exceeding the LRU disposes each evicted content exactly once; shown content is never evicted", () => {
    const f = fakePlanner();
    const s = createStreamer(f.plan, { lru: 12 });
    for (const i of [0, 3, 6, 9]) for (let n = 0; n < 12; n++) s.update(at(i, 0), FAR, n);
    expect(f.made).toHaveLength(36);
    // 36 planned, 12 kept: 24 evicted, each disposed once; the 9 shown are not disposed.
    expect([...f.disposed.values()].every((n) => n === 1)).toBe(true);
    expect(f.disposed.size).toBe(24);
    for (const a of s.active()) expect(f.disposed.has(f.orig(a.content))).toBe(false);
    s.dispose();
    expect(f.disposed.size).toBe(36);
    expect([...f.disposed.values()].every((n) => n === 1)).toBe(true);
    s.dispose();
    expect([...f.disposed.values()].every((n) => n === 1)).toBe(true);
  });

  it("setTier invalidates every tile and re-plans it; the old content shows until replaced, then is disposed once", () => {
    const f = fakePlanner();
    const s = createStreamer(f.plan);
    for (let n = 0; n < 12; n++) s.update(at(0, 0), FAR, n);
    const medium = s.active().map((a) => f.orig(a.content));
    s.setTier("high");
    const r = s.update(at(0, 0), FAR, 20);
    expect(f.calls.at(-1)).toEqual({ key: "0,0", ring: 0, tier: "high" });
    expect(r.pending).toBe(true);
    // Still 9 tiles shown: 1 re-planned, 8 stale.
    expect(s.active()).toHaveLength(9);
    expect(f.disposed.get(medium[0] as TileContent)).toBe(1);
    for (let n = 0; n < 12; n++) s.update(at(0, 0), FAR, 30 + n);
    expect(f.calls.filter((c) => c.tier === "high")).toHaveLength(9);
    for (const c of medium) expect(f.disposed.get(c)).toBe(1);
    // Same tier again: nothing to do.
    s.setTier("high");
    expect(s.update(at(0, 0), FAR, 99)).toEqual({ changed: false, pending: false });
  });

  it("invalidate re-plans like a tier change, at the same tier", () => {
    const f = fakePlanner();
    const s = createStreamer(f.plan);
    for (let n = 0; n < 12; n++) s.update(at(0, 0), FAR, n);
    s.invalidate();
    for (let n = 0; n < 12; n++) s.update(at(0, 0), FAR, n);
    expect(f.calls).toHaveLength(18);
    expect(f.calls.slice(9).every((c) => c.tier === "medium")).toBe(true);
  });

  it("a one-tile pan plans the new ring-0 tile first and keeps every overlapping tile shown", () => {
    const f = fakePlanner();
    const s = createStreamer(f.plan);
    for (let n = 0; n < 30; n++) s.update(at(0, 0), MID, n);
    s.update(at(1, 0), MID, 100);
    // Near detail first: the new target tile (shown with its old ring-1 plan) is upgraded before
    // the five new ring-2 tiles that have nothing to show yet.
    expect(f.calls.at(-1)).toEqual({ key: "1,0", ring: 0, tier: "medium" });
    // The 20 tiles of the new set that overlap the old one all stay shown.
    expect(s.active().length).toBe(20);
    const rings = s.active().map((a) => a.ring);
    expect([...rings].sort()).toEqual(rings);
  });

  it("beyond 1500 m: rings 0-1 only, and only trees and roads", () => {
    const f = fakePlanner();
    const s = createStreamer(f.plan);
    for (let n = 0; n < 12; n++) s.update(at(0, 0), FAR, n);
    const act = s.active();
    expect(act).toHaveLength(9);
    expect(Math.max(...act.map((a) => a.ring))).toBe(1);
    for (const a of act) {
      expect([...a.content.kits.keys()]).toEqual(["trees/rain_tree"]);
      expect(a.content.lamps).toEqual([]);
      expect(a.content.agents).toEqual([]);
      expect(a.content.signs).toEqual([]);
      expect(a.content.facades).toBeUndefined();
      expect(a.content.ribbons).toHaveLength(1);
    }
    // Closer than 1500 m the same plans show in full (no re-plan), and the far view is memoised.
    const before = f.calls.length;
    s.update(at(0, 0), 1400, 50);
    expect(f.calls.length).toBe(before + 1);
    const near = s.active().find((a) => a.key === "0,0");
    expect(near?.content.lamps).toHaveLength(1);
    expect(farView(near!.content)).toBe(farView(near!.content));
  });
});
