// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Tier } from "../../shared/quality";
import type { Engine, LodTick } from "../engine";
import { createFrame } from "../frame";
import { TILE_M } from "../stream/tiles";
import type { LayerData } from "./useGround";
import { MERGE_INTERVAL_MS, shouldMerge, useStream } from "./useStream";

// Counts plans and warm-ups; a plan is trivial content tagged with its tile, ring and tier.
const spy = vi.hoisted(() => ({
  plans: [] as { key: string; ring: number; tier: string }[],
  warms: 0,
  order: [] as string[],
}));
vi.mock("../stream/tilePlan", async (orig) => {
  const mod = await orig<typeof import("../stream/tilePlan")>();
  return {
    ...mod,
    planTile: (_inp: unknown, tile: { key: string }, ring: number, tier: string) => {
      spy.plans.push({ key: tile.key, ring, tier });
      spy.order.push("plan");
      return { kits: new Map(), lamps: [], agents: [], signs: [], ribbons: [] };
    },
    warmPlanners: () => {
      spy.warms++;
      spy.order.push("warm");
    },
  };
});

const frame = createFrame([101.5099, 3.1813]);
const walk = { type: "FeatureCollection", features: [] } as unknown as LayerData;

function fakeEngine() {
  const e = {
    cbs: new Set<(t: LodTick) => boolean | undefined>(),
    requestLodTick: vi.fn(),
    onLodTick: vi.fn((cb: (t: LodTick) => boolean | undefined) => {
      e.cbs.add(cb);
      return () => {
        e.cbs.delete(cb);
      };
    }),
    /** The LOD clock: each tick is one 250 ms LOD interval later. */
    clock: 0,
    /** One LOD tick; returns whether a listener has more work. */
    tick(x: number, z: number, rangeM = 800) {
      let more = false;
      e.clock += 250;
      const nowMs = e.clock;
      act(() => {
        for (const cb of e.cbs) if (cb({ target: { x, z }, rangeM, nowMs })) more = true;
      });
      return more;
    },
  };
  return e;
}

/** A fake planning Worker: replies to each `plan` on a later task with a trivial tile. */
function fakeWorker() {
  const w = {
    plans: [] as { key: string; ring: number; tier: string }[],
    inits: 0,
    /** Plans posted and not yet answered, and the most ever at once. */
    open: 0,
    maxOpen: 0,
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: Event) => void) | null,
    postMessage(m: { type: string; key: string; ring: number; tier: string; seq: number }) {
      if (m.type === "init") {
        w.inits++;
        return;
      }
      w.plans.push({ key: m.key, ring: m.ring, tier: m.tier });
      w.open++;
      w.maxOpen = Math.max(w.maxOpen, w.open);
      setTimeout(() => {
        w.open--;
        w.onmessage?.({
          data: {
            seq: m.seq,
            ms: 1,
            content: {
              kits: new Map(),
              lamps: [],
              agents: [],
              signs: [],
              ribbons: [],
              facades: false,
            },
          },
        } as MessageEvent);
      });
    },
    terminate() {},
  };
  return w;
}

function mount(
  engine = fakeEngine(),
  over: { showroom?: boolean; tier?: Tier; planWorker?: () => Worker | null } = {},
) {
  const r = renderHook(
    (p: { tier: Tier; showroom: boolean }) =>
      useStream({
        engine: engine as unknown as Engine,
        frame,
        tier: p.tier,
        detailsOn: true,
        walk,
        buildings: null,
        loaded: null,
        showroom: p.showroom,
        facadeSrc: null,
        planWorker: over.planWorker,
      }),
    { initialProps: { tier: over.tier ?? "medium", showroom: over.showroom ?? false } },
  );
  return { engine, ...r };
}
const reset = () => {
  spy.plans.length = 0;
  spy.order.length = 0;
  spy.warms = 0;
};

describe("useStream", () => {
  it("warms the planner caches once, before any streamed tick plans a tile", async () => {
    reset();
    const { engine } = mount();
    // Before the warm-up nothing is planned, even on a tick.
    engine.tick(0, 0);
    expect(spy.plans).toHaveLength(0);
    await waitFor(() => expect(spy.warms).toBe(1));
    await waitFor(() => expect(engine.requestLodTick).toHaveBeenCalled());
    engine.tick(0, 0);
    expect(spy.order).toEqual(["warm", "plan"]);
  });

  it("flying across 10 tiles never builds more than one tile per LOD tick", async () => {
    reset();
    const { engine, result } = mount();
    await waitFor(() => expect(engine.cbs.size).toBe(1));
    let max = 0;
    for (let x = 0; x <= 10 * TILE_M; x += 25) {
      const before = spy.plans.length;
      engine.tick(x, 10);
      max = Math.max(max, spy.plans.length - before);
    }
    expect(max).toBe(1);
    expect(spy.plans.length).toBeGreaterThan(10);
    // The active tiles follow the target, ring 0 first; the centre is the target tile's.
    const a = result.current.active;
    expect(a[0]?.key).toBe("10,0");
    expect(a[0]?.ring).toBe(0);
    expect(result.current.centre).toEqual([10.5 * TILE_M, 0.5 * TILE_M]);
  });

  it("a tier change re-plans every tile at the new tier, one per tick, keeping the old tiles shown", async () => {
    reset();
    const { engine, result, rerender } = mount();
    await waitFor(() => expect(engine.cbs.size).toBe(1));
    for (let i = 0; i < 12; i++) engine.tick(10, 10, 2000);
    expect(result.current.active).toHaveLength(9);
    const asks = engine.requestLodTick.mock.calls.length;
    rerender({ tier: "high", showroom: false });
    await waitFor(() => expect(engine.requestLodTick.mock.calls.length).toBeGreaterThan(asks));
    engine.tick(10, 10, 2000);
    expect(spy.plans.at(-1)).toEqual({ key: "0,0", ring: 0, tier: "high" });
    expect(result.current.active).toHaveLength(9);
    for (let i = 0; i < 12; i++) engine.tick(10, 10, 2000);
    expect(spy.plans.filter((p) => p.tier === "high")).toHaveLength(9);
  });

  it("filling 25 tiles publishes a bounded number of merges: first ring 0 at once, then at most one per MERGE_INTERVAL_MS, then the end", async () => {
    reset();
    const { engine, result } = mount();
    await waitFor(() => expect(engine.cbs.size).toBe(1));
    const published: number[] = [];
    let last = result.current.active;
    let ticks = 0;
    let more = true;
    while (more && ticks < 100) {
      more = engine.tick(10, 10);
      ticks++;
      if (result.current.active !== last) {
        last = result.current.active;
        published.push(last.length);
      }
    }
    expect(ticks).toBe(25);
    // The first tick (the ring-0 tile) is merged at once; the last state is merged when the fill ends.
    expect(published[0]).toBe(1);
    expect(published.at(-1)).toBe(25);
    const fillMs = ticks * 250;
    expect(published.length).toBeLessThanOrEqual(1 + Math.ceil(fillMs / MERGE_INTERVAL_MS) + 1);
    expect(published.length).toBeLessThan(25);
    // Not filling: every change merges at once (a one-tile pan's ring-0 upgrade).
    const n = published.length;
    engine.tick(10 + TILE_M, 10);
    expect(result.current.active).not.toBe(last);
    expect(n).toBeGreaterThan(1);
  });

  it("shouldMerge: always when not filling or on a new ring-0 plan, else once per interval", () => {
    expect(shouldMerge({ pending: false, ring0Changed: false, sinceLastMs: 0 })).toBe(true);
    expect(shouldMerge({ pending: true, ring0Changed: true, sinceLastMs: 0 })).toBe(true);
    expect(shouldMerge({ pending: true, ring0Changed: false, sinceLastMs: 999 })).toBe(false);
    expect(
      shouldMerge({ pending: true, ring0Changed: false, sinceLastMs: MERGE_INTERVAL_MS }),
    ).toBe(true);
  });

  it("with a Worker: init once, no main-thread warm-up or plan, one plan in flight, results shown on later ticks", async () => {
    reset();
    const w = fakeWorker();
    const { engine, result } = mount(fakeEngine(), { planWorker: () => w as unknown as Worker });
    await waitFor(() => expect(engine.cbs.size).toBe(1));
    expect(w.inits).toBe(1);
    for (let i = 0; i < 60 && result.current.active.length < 9; i++) {
      engine.tick(10, 10, 2000);
      // At most one plan posted and unanswered at a time.
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(result.current.active).toHaveLength(9);
    expect(result.current.active[0]?.key).toBe("0,0");
    expect(w.plans.length).toBe(9);
    expect(w.maxOpen).toBe(1);
    expect(spy.warms).toBe(0);
    expect(spy.plans).toHaveLength(0);
  });

  it("the showroom streams nothing", async () => {
    reset();
    const { engine, result } = mount(fakeEngine(), { showroom: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.cbs.size).toBe(0);
    expect(result.current.active).toEqual([]);
    expect(spy.warms).toBe(0);
  });
});
