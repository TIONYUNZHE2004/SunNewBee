// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useScene } from "../../sceneStore";
import type { Placement } from "../assets/fit";
import { createRoleUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import type { Site } from "../props/construction";
import type { ActiveTile, Ring, TileContent } from "../stream/streamer";
import { tileAt } from "../stream/tiles";
import { createSceneBus } from "./sceneBus";
import { useDecor } from "./useDecor";

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
  variant: "small_sedan",
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
    kits: new Map([["vehicles/small_sedan", cars]]),
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

const fakeEngine = () => ({ setDecor: vi.fn(), requestRender: vi.fn() });
const shared = site("0.0", 200);
const c0 = content(10, shared);
const c1 = content(260, shared);

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
    const ids = (m: Map<string, Placement[]>) =>
      (m.get("vehicles/small_sedan") ?? []).map((p) => p.id);
    expect(ids(setKits.mock.calls.at(-1)![0])).toEqual(["pk:10", "pk:260"]);
    const calls = setKits.mock.calls.length;
    act(() => useScene.getState().setDay({ on: true }));
    act(() => useScene.getState().setRollout({ on: true }));
    // No kit rebuild, no removal: the parked cars neither move nor fade (they are not residents).
    expect(setKits.mock.calls.length).toBe(calls);
    expect(ids(setKits.mock.calls.at(-1)![0])).toEqual(["pk:10", "pk:260"]);
  });
});
