// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import type * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { Tier } from "../../shared/quality";
import type { RoofInput } from "../assets/plan";
import { createRoleUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import { podiumDeck } from "../facade/podiumDeck";
import { NEUTRAL_COLOURS } from "../fallbackStyle";
import { type ActiveTile, farView, type Ring, type TileContent } from "../stream/streamer";
import { planRoofs } from "../stream/tilePlan";
import { tileAt } from "../stream/tiles";
import { ROOF_SLOT, useRoofs } from "./useRoofs";

const roof = (id: string, x: number, deck = false): RoofInput[] => {
  const b: RoofInput["b"] = {
    id,
    ring: [
      [x, 0],
      [x + 60, 0],
      [x + 60, -40],
      [x, -40],
    ],
    heightM: 10,
    kind: "industrial",
    isLandmark: deck,
  };
  const d = deck ? podiumDeck(b, []) : null;
  return [d ? { b, palette: NEUTRAL_COLOURS, deck: d } : { b, palette: NEUTRAL_COLOURS }];
};
const content = (roofs: TileContent["roofs"]): TileContent => ({
  kits: new Map(),
  lamps: [],
  agents: [],
  signs: [],
  ribbons: [],
  roofs,
});
const tile = (x: number, ring: Ring, c: TileContent): ActiveTile => {
  const t = tileAt(x, 0);
  return { key: t.key, tile: t, ring, content: c };
};

type Decor = { group: THREE.Object3D; dispose(): void } | null;
const fakeEngine = () => ({ setDecor: vi.fn(), requestRender: vi.fn() });
const slotCalls = (e: ReturnType<typeof fakeEngine>): Decor[] =>
  e.setDecor.mock.calls.filter(([s]) => s === ROOF_SLOT).map(([, d]) => d as Decor);
const built = (e: ReturnType<typeof fakeEngine>) => slotCalls(e).filter((d) => d !== null);
const roleUniforms = createRoleUniforms();

function mount(active: ActiveTile[], tier: Tier = "medium") {
  const engine = fakeEngine();
  const r = renderHook(
    (p: { active: ActiveTile[]; tier: Tier }) =>
      useRoofs({
        engine: engine as unknown as Engine,
        active: p.active,
        tier: p.tier,
        roleUniforms,
      }),
    { initialProps: { active, tier } },
  );
  return { engine, ...r };
}

/** x of every instance of every mesh in the layer. */
function xs(d: Decor): number[] {
  const out: number[] = [];
  d?.group.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!m.isInstancedMesh) return;
    for (let i = 0; i < m.count; i++) out.push(m.instanceMatrix.array[i * 16 + 12] as number);
  });
  return out;
}

describe("useRoofs (Task 8: dressed roofs stream per tile, ring <= 1)", () => {
  const c0 = content(planRoofs(roof("near", 10)));
  const c1 = content(planRoofs(roof("kanopi-podium", 260, true)));
  const c2 = content(planRoofs(roof("ring2", 510))); // a stale ring-1 plan shown at ring 2

  it("one layer for the ring 0-1 tiles only, with the podium deck; decorative, no shadows", async () => {
    const { engine, result } = mount([tile(10, 0, c0), tile(260, 1, c1), tile(510, 2, c2)]);
    await waitFor(() => expect(built(engine)).toHaveLength(1));
    const layer = built(engine)[0]!;
    expect(layer.group.userData.decorative).toBe(true);
    expect(layer.group.getObjectByName("roof_deck")).toBeDefined();
    layer.group.traverse((o) => {
      expect(o.userData.decorative).toBe(true);
      expect(o.castShadow).toBe(false);
    });
    const x = xs(layer);
    expect(x.some((v) => v < 80)).toBe(true);
    expect(x.some((v) => v > 250 && v < 330)).toBe(true);
    expect(x.some((v) => v > 500)).toBe(false);
    await waitFor(() => expect(result.current.roofsOn).toBe(true));
  });

  it("is rebuilt only when the ring 0-1 set of plans changes, never via null", async () => {
    const { engine, rerender } = mount([tile(10, 0, c0)]);
    await waitFor(() => expect(built(engine)).toHaveLength(1));
    // The same plan after a ring change (planRoofs is memoised per input): no rebuild.
    rerender({ active: [tile(10, 1, c0), tile(510, 2, c2)], tier: "medium" });
    await new Promise((r) => setTimeout(r, 10));
    expect(built(engine)).toHaveLength(1);
    rerender({ active: [tile(10, 0, c0), tile(260, 1, c1)], tier: "medium" });
    await waitFor(() => expect(built(engine)).toHaveLength(2));
    expect(slotCalls(engine)).not.toContain(null);
  });

  it("Low and the far view draw none; unmount clears the slot", async () => {
    const { engine, rerender, unmount, result } = mount([tile(10, 0, c0)]);
    await waitFor(() => expect(built(engine)).toHaveLength(1));
    rerender({ active: [tile(10, 0, c0)], tier: "low" });
    await waitFor(() => expect(slotCalls(engine).at(-1)).toBeNull());
    expect(result.current.roofsOn).toBe(false);
    rerender({ active: [tile(10, 0, farView(c0))], tier: "medium" });
    await new Promise((r) => setTimeout(r, 10));
    expect(slotCalls(engine).at(-1)).toBeNull();
    rerender({ active: [tile(10, 0, c0)], tier: "medium" });
    await waitFor(() => expect(built(engine)).toHaveLength(2));
    unmount();
    expect(slotCalls(engine).at(-1)).toBeNull();
  });

  it("a Medium <-> High tier change does not rebuild; Medium -> Low clears", async () => {
    const { engine, rerender } = mount([tile(10, 0, c0)]);
    await waitFor(() => expect(built(engine)).toHaveLength(1));
    rerender({ active: [tile(10, 0, c0)], tier: "high" });
    await new Promise((r) => setTimeout(r, 10));
    expect(built(engine)).toHaveLength(1);
    rerender({ active: [tile(10, 0, c0)], tier: "medium" });
    await new Promise((r) => setTimeout(r, 10));
    expect(built(engine)).toHaveLength(1);
    rerender({ active: [tile(10, 0, c0)], tier: "low" });
    await waitFor(() => expect(slotCalls(engine).at(-1)).toBeNull());
  });
});
