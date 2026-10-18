// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tier } from "../../cesium/stylised/quality";
import { useScene } from "../../sceneStore";
import type { Placement } from "../assets/fit";
import { createRoleUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import type { Site } from "../props/construction";
import { type ActiveTile, farView, type Ring, type TileContent } from "../stream/streamer";
import { tileAt } from "../stream/tiles";
import { createSceneBus } from "./sceneBus";
import { useDecor } from "./useDecor";
import { LOTS_SLOT, lotPartsOf, useLots } from "./useLots";

const site = (id: string, x: number): Site => ({
  id,
  poly: [
    [
      [x, 0],
      [x + 60, 0],
      [x + 60, 40],
      [x, 40],
    ],
  ],
});
const car = (id: string, x: number): Placement => ({
  id,
  asset: "vehicles",
  variant: "sedan",
  x,
  z: 10,
  yaw: 0,
  sx: 1,
  sy: 1,
  sz: 1,
  palette: ["#000", "#000", "#000"],
});
const content = (x: number, s: Site): TileContent => {
  const cars = [car(`pk:${x}`, x + 5)];
  return {
    kits: new Map([["vehicles/sedan", cars]]),
    lamps: [],
    agents: [],
    signs: [],
    ribbons: [],
    parking: { stalls: new Float32Array([x + 5, 10, 0]), cars },
    tracks: new Float32Array([x + 2, 20, x + 50, 20]),
    gravel: [s],
  };
};
const tile = (x: number, ring: Ring, c: TileContent): ActiveTile => {
  const t = tileAt(x, 0);
  return { key: t.key, tile: t, ring, content: c };
};

type Decor = { group: THREE.Object3D; dispose(): void } | null;
const fakeEngine = () => ({ setDecor: vi.fn(), requestRender: vi.fn() });
const slotCalls = (e: ReturnType<typeof fakeEngine>): Decor[] =>
  e.setDecor.mock.calls.filter(([s]) => s === LOTS_SLOT).map(([, d]) => d as Decor);
const built = (e: ReturnType<typeof fakeEngine>) => slotCalls(e).filter((d) => d !== null);

function mount(active: ActiveTile[], tier: Tier = "medium") {
  const engine = fakeEngine();
  const r = renderHook(
    (p: { active: ActiveTile[]; tier: Tier }) =>
      useLots({ engine: engine as unknown as Engine, active: p.active, tier: p.tier }),
    { initialProps: { active, tier } },
  );
  return { engine, ...r };
}

// One site spans both tiles: it is tinted once.
const shared = site("0.0", 200);
const c0 = content(10, shared);
const c1 = content(260, shared);

describe("useLots (Task 10b: stall markings and construction ground per active tile)", () => {
  it("merges the active tiles into one decorative layer; a shared site is tinted once", () => {
    const parts = lotPartsOf([tile(10, 0, c0), tile(260, 1, c1)], "medium")!;
    expect(parts.stalls).toHaveLength(2);
    expect(parts.tracks).toHaveLength(2);
    expect(parts.gravel).toEqual([shared]);
    const { engine, result } = mount([tile(10, 0, c0), tile(260, 1, c1)]);
    const b = built(engine);
    expect(b).toHaveLength(1);
    expect(result.current.lotsOn).toBe(true);
    let n = 0;
    b[0]!.group.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      n++;
      expect(o.userData.decorative).toBe(true);
    });
    expect(n).toBe(2);
  });

  it("rebuilds only when the planned lists change (a re-published active set keeps the layer)", () => {
    const { engine, rerender } = mount([tile(10, 0, c0), tile(260, 1, c1)]);
    rerender({ active: [tile(10, 0, c0), tile(260, 1, c1)], tier: "medium" });
    expect(built(engine)).toHaveLength(1);
    rerender({ active: [tile(10, 0, c0)], tier: "medium" });
    expect(built(engine)).toHaveLength(2);
  });

  it("Low, the far view and unmount draw none", () => {
    const low = mount([tile(10, 0, c0)], "low");
    expect(built(low.engine)).toHaveLength(0);
    expect(low.result.current.lotsOn).toBe(false);
    const far = mount([tile(10, 0, farView(c0))]);
    expect(built(far.engine)).toHaveLength(0);
    const on = mount([tile(10, 0, c0)]);
    on.unmount();
    expect(slotCalls(on.engine).at(-1)).toBeNull();
  });
});

describe("parked cars (Task 10b ruling: decorative, static, never faded)", () => {
  afterEach(() => {
    useScene.getState().setDay({ on: false });
    useScene.getState().setRollout({ on: false });
  });

  it("ride the kit buckets (setKits) and stay there with Day or Rollout playback on", () => {
    const setKits = vi.fn();
    const engine = fakeEngine();
    const active = [tile(10, 0, c0), tile(260, 1, c1)];
    renderHook(() =>
      useDecor({
        engine: engine as unknown as Engine,
        frame: null,
        tier: "medium",
        active,
        centre: null,
        showroom: false,
        roleUniforms: createRoleUniforms(),
        setKits,
        bus: createSceneBus(),
      }),
    );
    const ids = (m: Map<string, Placement[]>) => (m.get("vehicles/sedan") ?? []).map((p) => p.id);
    expect(ids(setKits.mock.calls.at(-1)![0])).toEqual(["pk:10", "pk:260"]);
    const calls = setKits.mock.calls.length;
    act(() => useScene.getState().setDay({ on: true }));
    act(() => useScene.getState().setRollout({ on: true }));
    // No kit rebuild, no removal: the parked cars neither move nor fade (they are not residents).
    expect(setKits.mock.calls.length).toBe(calls);
    expect(ids(setKits.mock.calls.at(-1)![0])).toEqual(["pk:10", "pk:260"]);
  });
});
