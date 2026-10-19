// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { Tier } from "../../shared/quality";
import { createMotionUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import { GROUND_BANDS, VERGE_Y } from "../ground/bands";
import type { Site } from "../props/construction";
import { type ActiveTile, farView, type Ring, type TileContent } from "../stream/streamer";
import { tileAt } from "../stream/tiles";
import { ROADS_SLOT, useRoads } from "./useGround";
import { GROUND_DECOR_SLOT, groundDecorPartsOf, useGroundDecor } from "./useGroundDecor";

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
const content = (o: { strips?: Float32Array; x?: number; site?: Site } = {}): TileContent => ({
  kits: new Map(),
  lamps: [],
  agents: [],
  signs: [],
  ribbons: [],
  verges: o.strips ? { strips: o.strips, skirts: new Float32Array(0), shrubs: [] } : undefined,
  ...(o.site && o.x !== undefined
    ? {
        parking: { stalls: new Float32Array([o.x + 5, 10, 0]), cars: [] },
        tracks: new Float32Array([o.x + 2, 20, o.x + 50, 20]),
        gravel: [o.site],
      }
    : {}),
});
const tile = (x: number, ring: Ring, c: TileContent): ActiveTile => {
  const t = tileAt(x, 0);
  return { key: t.key, tile: t, ring, content: c };
};

type Decor = { group: THREE.Group; dispose(): void } | null;
function fakeEngine() {
  return { setDecor: vi.fn(), motion: createMotionUniforms(), requestRender: vi.fn() };
}
const slotCalls = (e: ReturnType<typeof fakeEngine>, slot = GROUND_DECOR_SLOT): Decor[] =>
  e.setDecor.mock.calls.filter(([s]) => s === slot).map(([, d]) => d as Decor);
const built = (e: ReturnType<typeof fakeEngine>, slot = GROUND_DECOR_SLOT) =>
  slotCalls(e, slot).filter((d): d is NonNullable<Decor> => d !== null);

function mount(active: ActiveTile[], tier: Tier = "medium") {
  const engine = fakeEngine();
  const r = renderHook(
    (p: { active: ActiveTile[]; tier: Tier }) =>
      useGroundDecor({ engine: engine as unknown as Engine, active: p.active, tier: p.tier }),
    { initialProps: { active, tier } },
  );
  return { engine, ...r };
}

// One site spans both tiles: it is tinted once.
const shared = site("0.0", 200);
const c0 = content({ strips: piece(10), x: 10, site: shared });
const c1 = content({ strips: piece(260), x: 260, site: shared });

describe("useGroundDecor (verges + construction ground of the active tiles, one draw)", () => {
  it("one merged decorative mesh; a shared site is tinted once", () => {
    const parts = groundDecorPartsOf([tile(10, 0, c0), tile(260, 1, c1)], "medium")!;
    expect(parts.strips).toHaveLength(2);
    expect(parts.tracks).toHaveLength(2);
    expect(parts.gravel).toEqual([shared]);
    const { engine, result } = mount([tile(10, 0, c0), tile(260, 1, c1), tile(510, 2, content())]);
    expect(built(engine)).toHaveLength(1);
    const layer = built(engine)[0]!;
    expect(layer.group.userData.decorative).toBe(true);
    const meshes = layer.group.children as THREE.Mesh[];
    expect(meshes).toHaveLength(1);
    expect(meshes[0]!.renderOrder).toBe(GROUND_BANDS.decor.order);
    expect(meshes[0]!.userData.decorative).toBe(true);
    expect(result.current.decorOn).toBe(true);
  });

  it("verges alone or construction ground alone still draw", () => {
    expect(built(mount([tile(10, 0, content({ strips: piece(10) }))]).engine)).toHaveLength(1);
    expect(built(mount([tile(10, 0, content({ x: 10, site: shared }))]).engine)).toHaveLength(1);
  });

  it("rebuilds only when the planned lists change (a re-published active set keeps the mesh)", () => {
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
    expect(low.result.current.decorOn).toBe(false);

    const far = mount([tile(10, 0, farView(c0))]);
    expect(built(far.engine)).toHaveLength(0);
    expect(far.result.current.decorOn).toBe(false);

    const m = mount([tile(10, 0, c0)]);
    m.unmount();
    expect(slotCalls(m.engine).at(-1)).toBeNull();
  });
});

describe("useRoads carries the stall lines (folded into the road-markings mesh)", () => {
  it("the active tiles' stalls reach the roads layer's markings mesh; Low draws none", () => {
    const engine = fakeEngine();
    const r = renderHook(
      (p: { tier: Tier }) =>
        useRoads({
          engine: engine as unknown as Engine,
          active: [tile(10, 0, c0), tile(260, 1, c1)],
          tier: p.tier,
        }),
      { initialProps: { tier: "medium" as Tier } },
    );
    const roads = built(engine, ROADS_SLOT);
    expect(roads).toHaveLength(1);
    const meshes = roads[0]!.group.children as THREE.Mesh[];
    expect(meshes.map((m) => m.renderOrder)).toEqual([GROUND_BANDS.markings.order]);
    // Two stalls, 6 triangles each.
    expect(meshes[0]!.geometry.index!.count / 3).toBe(12);
    r.rerender({ tier: "low" });
    expect(built(engine, ROADS_SLOT)).toHaveLength(1);
  });
});
