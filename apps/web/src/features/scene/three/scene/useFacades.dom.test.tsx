// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import type * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { Tier } from "../../shared/quality";
import { createMotionUniforms, createRoleUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import type { FacadeBuilding } from "../facade/facadeLayer";
import { facadeFor } from "../facade/facadePlan";
import { type ActiveTile, farView, type Ring, type TileContent } from "../stream/streamer";
import { tileAt } from "../stream/tiles";
import { FACADE_SLOT, useFacades } from "./useFacades";

const building = (id: string, x: number): FacadeBuilding => ({
  ring: [
    [x, 0],
    [x + 20, 0],
    [x + 20, 12],
    [x, 12],
  ],
  heightM: 9.6,
  minHeightM: 0,
  spec: facadeFor({ id, heightM: 9.6, kind: "commercial" }, null),
});
const content = (facades: FacadeBuilding[] | undefined): TileContent => ({
  kits: new Map(),
  lamps: [],
  agents: [],
  signs: [],
  ribbons: [],
  facades,
});
const tile = (x: number, ring: Ring, c: TileContent): ActiveTile => {
  const t = tileAt(x, 0);
  return { key: t.key, tile: t, ring, content: c };
};

type Decor = { group: THREE.Object3D; dispose(): void } | null;
function fakeEngine() {
  return { setDecor: vi.fn(), motion: createMotionUniforms(), requestRender: vi.fn() };
}
const slotCalls = (e: ReturnType<typeof fakeEngine>): Decor[] =>
  e.setDecor.mock.calls.filter(([s]) => s === FACADE_SLOT).map(([, d]) => d as Decor);
const built = (e: ReturnType<typeof fakeEngine>) => slotCalls(e).filter((d) => d !== null);
const roleUniforms = createRoleUniforms();

function mount(active: ActiveTile[], tier: Tier = "medium") {
  const engine = fakeEngine();
  const baseBytes = { current: 0 };
  const r = renderHook(
    (p: { active: ActiveTile[]; tier: Tier }) =>
      useFacades({
        engine: engine as unknown as Engine,
        active: p.active,
        tier: p.tier,
        roleUniforms,
        baseBytes,
      }),
    { initialProps: { active, tier } },
  );
  return { engine, ...r };
}

describe("useFacades (P4-H: facades stream per tile, ring <= 1)", () => {
  const c0 = content([building("near", 10)]);
  const c1 = content([building("ring1", 260)]);
  const c2 = content([building("ring2", 510)]); // a stale ring-1 plan shown at ring 2

  it("one layer for the ring 0-1 tiles only; decorative, casts no shadow", async () => {
    const { engine, result } = mount([tile(10, 0, c0), tile(260, 1, c1), tile(510, 2, c2)]);
    await waitFor(() => expect(built(engine)).toHaveLength(1));
    const layer = built(engine)[0]!;
    expect(layer.group.userData.decorative).toBe(true);
    const meshes = layer.group.children as THREE.InstancedMesh[];
    expect(meshes.length).toBeGreaterThan(0);
    for (const m of meshes) {
      expect(m.castShadow).toBe(false);
      expect(m.userData.decorative).toBe(true);
    }
    // Windows of two buildings (near, ring1), none of the ring-2 one: its x range (510..530) is empty.
    const xs: number[] = [];
    for (const m of meshes)
      for (let i = 0; i < m.count; i++) xs.push(m.instanceMatrix.array[i * 16 + 12] as number);
    expect(xs.some((x) => x < 40)).toBe(true);
    expect(xs.some((x) => x > 250 && x < 290)).toBe(true);
    expect(xs.some((x) => x > 500)).toBe(false);
    await waitFor(() => expect(result.current.facadesOn).toBe(true));
  });

  it("is rebuilt only when the ring 0-1 set of plans changes, and the old layer stays until replaced", async () => {
    const { engine, rerender } = mount([tile(10, 0, c0), tile(260, 1, c1)]);
    await waitFor(() => expect(built(engine)).toHaveLength(1));
    // Same plans in a new active array (another tile planned at ring 2): no rebuild.
    rerender({ active: [tile(10, 0, c0), tile(260, 1, c1), tile(510, 2, c2)], tier: "medium" });
    await new Promise((r) => setTimeout(r, 10));
    expect(built(engine)).toHaveLength(1);
    // A ring-1 tile gets its own plan: one rebuild, with no null in between (no flash).
    rerender({
      active: [tile(10, 0, c0), tile(260, 1, content([building("other", 270)]))],
      tier: "medium",
    });
    await waitFor(() => expect(built(engine)).toHaveLength(2));
    expect(slotCalls(engine)).not.toContain(null);
  });

  it("Low and the far view (> 1500 m, facades stripped) draw none; unmount clears the slot", async () => {
    const { engine, rerender, unmount, result } = mount([tile(10, 0, c0)]);
    await waitFor(() => expect(built(engine)).toHaveLength(1));
    rerender({ active: [tile(10, 0, c0)], tier: "low" });
    await waitFor(() => expect(slotCalls(engine).at(-1)).toBeNull());
    expect(result.current.facadesOn).toBe(false);
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
