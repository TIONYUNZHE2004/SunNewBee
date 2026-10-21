// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createRoleUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import type { Agent } from "../motion/agents";
import type { MotionDriver } from "../motion/motionClock";
import type { ActiveTile } from "../stream/streamer";
import { tileAt } from "../stream/tiles";
import { createSceneBus } from "./sceneBus";
import type { LoadedAssets } from "./useCityAssets";
import { useMotion } from "./useMotion";

// The crowd kit fails (legacy people, no look search) and the layer is a stub that records disposal:
// this test is about the layer's lifecycle, not its drawing.
vi.mock("../motion/crowdKit", () => ({
  CROWD_LOAD_TIMEOUT_MS: 1,
  loadCrowdKit: () => Promise.reject(new Error("no kit in tests")),
}));
const built: { group: THREE.Group; disposed: boolean; ids: string[] }[] = [];
vi.mock("../motion/motionLayer", () => ({
  crowdPeopleOf: (a: Agent[]) => a,
  createMotionLayer: (agents: Agent[]) => {
    const rec = { group: new THREE.Group(), disposed: false, ids: agents.map((a) => a.id) };
    built.push(rec);
    return {
      group: rec.group,
      crowd: null,
      tick() {},
      setOpacity() {},
      setDensity() {},
      dispose() {
        rec.disposed = true;
      },
    };
  },
}));

const agent = (id: string): Agent => ({
  id,
  kind: "vehicle",
  variant: "small_sedan",
  path: Float32Array.from([0, 0, 50, 0]),
  length: 50,
  speed: 10,
  offset: 0,
});
const tile = (x: number, ids: string[]): ActiveTile => {
  const t = tileAt(x, 0);
  return {
    key: t.key,
    tile: t,
    ring: 0,
    content: { agents: ids.map(agent) } as unknown as ActiveTile["content"],
  };
};

function setup() {
  const prepared: (() => void)[] = [];
  const engine = {
    setMotion: vi.fn(),
    requestRender: vi.fn(),
    motion: { uTime: { value: 0 }, uSway: { value: 0 }, uLimb: { value: 0 } },
    prepare: () => new Promise<void>((r) => prepared.push(r)),
  };
  const bus = createSceneBus();
  const loaded = { lib: {}, manifest: {} } as unknown as LoadedAssets;
  const sectionRef = { current: null };
  const roleUniforms = createRoleUniforms();
  const props = (active: ActiveTile[], l: LoadedAssets | null) => ({
    engine: engine as unknown as Engine,
    tier: "high" as const,
    active,
    loaded: l,
    showroom: false,
    roleUniforms,
    sectionRef,
    bus,
  });
  const driver = () => bus.getState().driver as MotionDriver;
  const shown = () => driver().group.children;
  // Settles everything pending (the kit's rejection re-runs the build once more).
  const flush = async () => {
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        for (const r of prepared.splice(0)) r();
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  };
  return { props, loaded, shown, flush };
}

describe("useMotion layer lifecycle (GATE fix round 1)", () => {
  it("an agent-set change keeps the old layer drawn until the new one is prepared, then disposes it", async () => {
    built.length = 0;
    const s = setup();
    const { rerender } = renderHook((p) => useMotion(p), {
      initialProps: s.props([tile(10, ["a", "b"])], s.loaded),
    });
    await s.flush();
    const first = built.at(-1)!;
    expect(s.shown()).toContain(first.group);
    rerender(s.props([tile(10, ["a", "c"])], s.loaded));
    const second = built.at(-1)!;
    expect(second).not.toBe(first);
    // Not prepared yet: the old layer is still drawn (no blank frame).
    expect(s.shown()).toContain(first.group);
    expect(first.disposed).toBe(false);
    await s.flush();
    expect(s.shown()).toContain(second.group);
    expect(s.shown()).not.toContain(first.group);
    expect(first.disposed).toBe(true);
  });

  it("loaded -> null (asset library disposed) clears and disposes the drawn layer at once", async () => {
    built.length = 0;
    const s = setup();
    const active = [tile(10, ["a", "b"])];
    const { rerender } = renderHook((p) => useMotion(p), {
      initialProps: s.props(active, s.loaded),
    });
    await s.flush();
    const layer = built.at(-1)!;
    expect(s.shown()).toContain(layer.group);
    rerender(s.props(active, null));
    expect(s.shown()).not.toContain(layer.group);
    expect(layer.disposed).toBe(true);
    // A build still being prepared when the library goes is never shown.
    rerender(s.props(active, s.loaded));
    const pending = built.at(-1)!;
    rerender(s.props(active, null));
    await s.flush();
    expect(s.shown()).not.toContain(pending.group);
    expect(pending.disposed).toBe(true);
  });
});
