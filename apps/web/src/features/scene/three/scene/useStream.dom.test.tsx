// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Tier } from "../../cesium/stylised/quality";
import type { Engine, LodTick } from "../engine";
import { createFrame } from "../frame";
import { TILE_M } from "../stream/tiles";
import type { LayerData } from "./useGround";
import { useStream } from "./useStream";

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
    /** One LOD tick; returns whether a listener has more work. */
    tick(x: number, z: number, rangeM = 800) {
      let more = false;
      act(() => {
        for (const cb of e.cbs) if (cb({ target: { x, z }, rangeM, nowMs: 0 })) more = true;
      });
      return more;
    },
  };
  return e;
}

function mount(engine = fakeEngine(), over: { showroom?: boolean; tier?: Tier } = {}) {
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

  it("the showroom streams nothing", async () => {
    reset();
    const { engine, result } = mount(fakeEngine(), { showroom: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.cbs.size).toBe(0);
    expect(result.current.active).toEqual([]);
    expect(spy.warms).toBe(0);
  });
});
