import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tier } from "../../shared/quality";
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
    const r1 = s.update(at(0, 0), MID);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toEqual({ key: "0,0", ring: 0, tier: "medium" });
    expect(r1).toEqual({ changed: true, pending: true });
    expect(s.active()).toHaveLength(1);
    for (let n = 2; n <= 25; n++) {
      s.update(at(0, 0), MID);
      expect(f.calls).toHaveLength(n);
    }
    const done = s.update(at(0, 0), MID);
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
    s.update(at(0, 0), MID);
    s.update(at(0, 0), MID);
    expect(performance.getEntriesByName(PLAN_MEASURE, "measure")).toHaveLength(2);
  });

  it("a planner slower than budgetMs still plans only one tile per call (and is counted)", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const f = fakePlanner(50);
    const s = createStreamer(f.plan, { budgetMs: 8 });
    for (let n = 1; n <= 5; n++) {
      s.update(at(3, 3), MID);
      expect(f.calls).toHaveLength(n);
    }
    expect(s.stats().overBudget).toBe(5);
    expect(s.stats().maxMs).toBeGreaterThanOrEqual(50);
  });

  it("leaving and returning reuses the cache: no re-plan", () => {
    const f = fakePlanner();
    const s = createStreamer(f.plan);
    for (let n = 0; n < 30; n++) s.update(at(0, 0), FAR);
    expect(f.calls).toHaveLength(9);
    const before = s.active().map((a) => a.content);
    // Away by 3 tiles: 9 new tiles (no overlap with the first 3 x 3).
    for (let n = 0; n < 30; n++) s.update(at(3, 0), FAR);
    expect(f.calls).toHaveLength(18);
    const r = s.update(at(0, 0), FAR);
    expect(f.calls).toHaveLength(18);
    expect(r).toEqual({ changed: true, pending: false });
    expect(s.active().map((a) => a.content.ribbons)).toEqual(before.map((c) => c.ribbons));
  });

  it("exceeding the LRU disposes each evicted content exactly once; shown content is never evicted", () => {
    const f = fakePlanner();
    const s = createStreamer(f.plan, { lru: 12 });
    for (const i of [0, 3, 6, 9]) for (let n = 0; n < 12; n++) s.update(at(i, 0), FAR);
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
    for (let n = 0; n < 12; n++) s.update(at(0, 0), FAR);
    const medium = s.active().map((a) => f.orig(a.content));
    s.setTier("high");
    const r = s.update(at(0, 0), FAR);
    expect(f.calls.at(-1)).toEqual({ key: "0,0", ring: 0, tier: "high" });
    expect(r.pending).toBe(true);
    // Still 9 tiles shown: 1 re-planned, 8 stale.
    expect(s.active()).toHaveLength(9);
    expect(f.disposed.get(medium[0] as TileContent)).toBe(1);
    for (let n = 0; n < 12; n++) s.update(at(0, 0), FAR);
    expect(f.calls.filter((c) => c.tier === "high")).toHaveLength(9);
    for (const c of medium) expect(f.disposed.get(c)).toBe(1);
    // Same tier again: nothing to do.
    s.setTier("high");
    expect(s.update(at(0, 0), FAR)).toEqual({ changed: false, pending: false });
  });

  it("invalidate re-plans like a tier change, at the same tier", () => {
    const f = fakePlanner();
    const s = createStreamer(f.plan);
    for (let n = 0; n < 12; n++) s.update(at(0, 0), FAR);
    s.invalidate();
    for (let n = 0; n < 12; n++) s.update(at(0, 0), FAR);
    expect(f.calls).toHaveLength(18);
    expect(f.calls.slice(9).every((c) => c.tier === "medium")).toBe(true);
  });

  it("a one-tile pan plans the new ring-0 tile first and keeps every overlapping tile shown", () => {
    const f = fakePlanner();
    const s = createStreamer(f.plan);
    for (let n = 0; n < 30; n++) s.update(at(0, 0), MID);
    s.update(at(1, 0), MID);
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
    for (let n = 0; n < 12; n++) s.update(at(0, 0), FAR);
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
    s.update(at(0, 0), 1400);
    expect(f.calls.length).toBe(before + 1);
    const near = s.active().find((a) => a.key === "0,0");
    expect(near?.content.lamps).toHaveLength(1);
    expect(farView(near!.content)).toBe(farView(near!.content));
  });
});

/** A fake async plan client: each plan waits until `resolveNext()`; superseding as PlanClient does. */
function fakeClient() {
  const f = fakePlanner();
  const waiting: {
    tile: Tile;
    ring: Ring;
    tier: Tier;
    resolve: (c: TileContent) => void;
    reject: (e: Error) => void;
  }[] = [];
  const client = {
    mode: "worker" as const,
    plan(tile: Tile, ring: Ring, tier: Tier) {
      return new Promise<TileContent>((resolve, reject) => {
        for (const w of waiting.splice(0)) {
          const e = new Error("superseded");
          e.name = "Superseded";
          w.reject(e);
        }
        waiting.push({ tile, ring, tier, resolve, reject });
      });
    },
    dispose() {},
  };
  /** Completes the waiting plan with the fake planner's content (late results included). */
  const resolveWith = (w: (typeof waiting)[number]) => w.resolve(f.plan(w.tile, w.ring, w.tier));
  return { f, client, waiting, resolveWith };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createStreamer with an async plan client (Review Focus 4)", () => {
  it("keeps one plan in flight and applies its result on a later update", async () => {
    const { f, client, waiting, resolveWith } = fakeClient();
    const ready = vi.fn();
    const s = createStreamer(client, { onReady: ready });
    expect(s.update(at(0, 0), MID)).toEqual({ changed: false, pending: true });
    s.update(at(0, 0), MID);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.tile.key).toBe("0,0");
    resolveWith(waiting.splice(0)[0]!);
    await flush();
    expect(ready).toHaveBeenCalledTimes(1);
    const r = s.update(at(0, 0), MID);
    expect(r.changed).toBe(true);
    expect(s.active()[0]?.key).toBe("0,0");
    expect(f.calls).toHaveLength(1);
    expect(waiting).toHaveLength(1); // the next tile is in flight
  });

  it("never applies a result whose tile left the active set (and disposes it once)", async () => {
    const { f, client, waiting, resolveWith } = fakeClient();
    const s = createStreamer(client);
    s.update(at(0, 0), FAR);
    const w = waiting[0]!;
    expect(w.tile.key).toBe("0,0");
    // The result lands, then the camera flies 10 tiles away before the next update applies it.
    resolveWith(waiting.splice(0)[0] ?? w);
    await flush();
    s.update(at(10, 0), FAR);
    s.update(at(10, 0), FAR);
    expect(s.active().some((a) => a.key === "0,0")).toBe(false);
    const stale = f.made[0]!;
    expect(f.disposed.get(stale)).toBe(1);
    s.dispose();
    expect(f.disposed.get(stale)).toBe(1);
  });

  it("never applies a result planned for a tier that changed meanwhile", async () => {
    const { f, client, waiting, resolveWith } = fakeClient();
    const s = createStreamer(client);
    s.update(at(0, 0), FAR);
    const w = waiting.splice(0)[0]!;
    s.setTier("high");
    resolveWith(w);
    await flush();
    s.update(at(0, 0), FAR);
    expect(s.active()).toHaveLength(0);
    expect(f.disposed.get(f.made[0]!)).toBe(1);
    // The re-plan is at the new tier.
    expect(waiting.at(-1)?.tier).toBe("high");
  });

  it("a superseded in-flight plan is replaced by the current job (tier change)", async () => {
    const { client, waiting } = fakeClient();
    const s = createStreamer(client);
    s.update(at(0, 0), FAR);
    const first = waiting[0]!;
    s.setTier("high");
    s.update(at(0, 0), FAR);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).not.toBe(first);
    expect(waiting[0]?.tier).toBe("high");
  });

  it("fills all 9 tiles one plan at a time; LRU eviction disposes each content exactly once", async () => {
    const { f, client, waiting, resolveWith } = fakeClient();
    const s = createStreamer(client, { lru: 9 });
    const fill = async (x: number) => {
      for (let i = 0; i < 40; i++) {
        s.update(at(x, 0), FAR);
        expect(waiting.length).toBeLessThanOrEqual(1);
        const w = waiting.splice(0)[0];
        if (!w) break;
        resolveWith(w);
        await flush();
      }
      s.update(at(x, 0), FAR);
    };
    await fill(0);
    expect(s.active()).toHaveLength(9);
    await fill(5);
    expect(s.active()).toHaveLength(9);
    for (const n of f.disposed.values()) expect(n).toBe(1);
    // The first fill's 9 tiles were all evicted (none overlaps the second).
    expect(f.made.slice(0, 9).every((c) => f.disposed.get(c) === 1)).toBe(true);
    s.dispose();
    for (const c of f.made) expect(f.disposed.get(c)).toBe(1);
  });

  it("a failed plan shows nothing for that tile instead of re-planning forever", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, waiting } = fakeClient();
    const s = createStreamer(client);
    s.update(at(0, 0), FAR);
    waiting.splice(0)[0]!.reject(new Error("boom"));
    await flush();
    s.update(at(0, 0), FAR);
    expect(s.active()[0]?.key).toBe("0,0");
    expect(s.active()[0]?.content.ribbons).toEqual([]);
    expect(waiting[0]?.tile.key).not.toBe("0,0");
  });
});
