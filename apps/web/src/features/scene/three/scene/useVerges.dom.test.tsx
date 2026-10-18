// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { Tier } from "../../cesium/stylised/quality";
import { createMotionUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import { VERGE_Y } from "../ground/bands";
import { type ActiveTile, farView, type Ring, type TileContent } from "../stream/streamer";
import { tileAt } from "../stream/tiles";
import { useVerges, VERGE_SLOT } from "./useVerges";

const piece = (x0: number) =>
  new Float32Array([
    x0,
    VERGE_Y,
    3,
    x0 + 2,
    VERGE_Y,
    3,
    x0,
    VERGE_Y,
    4.5,
    x0 + 2,
    VERGE_Y,
    3,
    x0 + 2,
    VERGE_Y,
    4.5,
    x0,
    VERGE_Y,
    4.5,
  ]);
const content = (strips?: Float32Array): TileContent => ({
  kits: new Map(),
  lamps: [],
  agents: [],
  signs: [],
  ribbons: [],
  verges: strips ? { strips, shrubs: [] } : undefined,
});
const tile = (x: number, ring: Ring, c: TileContent): ActiveTile => {
  const t = tileAt(x, 0);
  return { key: t.key, tile: t, ring, content: c };
};

type Decor = { group: THREE.Group; dispose(): void } | null;
function fakeEngine() {
  return { setDecor: vi.fn(), motion: createMotionUniforms(), requestRender: vi.fn() };
}
const slotCalls = (e: ReturnType<typeof fakeEngine>): Decor[] =>
  e.setDecor.mock.calls.filter(([s]) => s === VERGE_SLOT).map(([, d]) => d as Decor);
const built = (e: ReturnType<typeof fakeEngine>) =>
  slotCalls(e).filter((d): d is NonNullable<Decor> => d !== null);

function mount(active: ActiveTile[], tier: Tier = "medium") {
  const engine = fakeEngine();
  const r = renderHook(
    (p: { active: ActiveTile[]; tier: Tier }) =>
      useVerges({ engine: engine as unknown as Engine, active: p.active, tier: p.tier }),
    { initialProps: { active, tier } },
  );
  return { engine, ...r };
}

describe("useVerges (Task 9: streamed grass verges)", () => {
  const c0 = content(piece(10));
  const c1 = content(piece(260));

  it("one merged verge mesh for the active tiles' strips: decorative, verges on", () => {
    const { engine, result } = mount([tile(10, 0, c0), tile(260, 1, c1), tile(510, 2, content())]);
    expect(built(engine)).toHaveLength(1);
    const layer = built(engine)[0]!;
    expect(layer.group.userData.decorative).toBe(true);
    const meshes = layer.group.children as THREE.Mesh[];
    expect(meshes).toHaveLength(1);
    expect(meshes[0]!.geometry.getAttribute("position").count).toBe(12);
    expect(result.current.vergesOn).toBe(true);
  });

  it("rebuilds only when the set of strips changes (a new active list with the same plans keeps it)", () => {
    const { engine, rerender } = mount([tile(10, 0, c0), tile(260, 1, c1)]);
    expect(built(engine)).toHaveLength(1);
    rerender({ active: [tile(10, 0, c0), tile(260, 1, c1)], tier: "medium" });
    expect(built(engine)).toHaveLength(1);
    rerender({ active: [tile(10, 0, c0)], tier: "medium" });
    expect(built(engine)).toHaveLength(2);
    expect(built(engine)[1]!.group.children).toHaveLength(1);
  });

  it("Low (even with stale content) and the far view draw none; unmount clears the slot", () => {
    const low = mount([tile(10, 0, c0)], "low");
    expect(built(low.engine)).toHaveLength(0);
    expect(low.result.current.vergesOn).toBe(false);

    const far = mount([tile(10, 0, farView(c0))]);
    expect(built(far.engine)).toHaveLength(0);
    expect(far.result.current.vergesOn).toBe(false);

    const m = mount([tile(10, 0, c0)]);
    m.unmount();
    expect(slotCalls(m.engine).at(-1)).toBeNull();
  });
});
