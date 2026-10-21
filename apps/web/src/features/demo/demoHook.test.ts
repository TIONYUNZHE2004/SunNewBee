import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDemoHook,
  type DemoApi,
  installDemoHook,
  registerDemo,
  registerDemoState,
  resetDemoRegistry,
} from "./demoHook";

const api = (state: object): DemoApi & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    seek: vi.fn((t: number) => calls.push(`seek ${t}`)),
    play: vi.fn(() => calls.push("play")),
    pause: vi.fn(() => calls.push("pause")),
    state: () => state,
  };
};

afterEach(() => resetDemoRegistry());

describe("window.__tl.demo install", () => {
  it("installs only in dev or e2e builds", () => {
    const t: { __tl?: Record<string, unknown> } = { __tl: { other: 1 } };
    expect(installDemoHook({ dev: false }, t)).toBe(false);
    expect(installDemoHook({ dev: false, e2e: undefined }, t)).toBe(false);
    expect(t.__tl?.demo).toBeUndefined();
    expect(installDemoHook({ dev: false, e2e: "true" }, t)).toBe(true);
    expect(t.__tl?.demo).toBeDefined();
    expect(t.__tl?.other).toBe(1); // other __tl fields are kept
    const u: { __tl?: Record<string, unknown> } = {};
    expect(installDemoHook({ dev: true }, u)).toBe(true);
  });
});

describe("demo registry", () => {
  it("routes seek / play / pause to the selected key", () => {
    const nav = api({ t: 1 });
    const bld = api({ t: 2 });
    registerDemo("nav", nav);
    registerDemo("bld", bld);
    const h = createDemoHook();
    h.seek(3);
    h.play();
    h.set("bld");
    h.seek(4);
    h.pause();
    expect(nav.calls).toEqual(["seek 3", "play"]);
    expect(bld.calls).toEqual(["seek 4", "pause"]);
    expect(h.state()).toEqual({ key: "bld", registered: true, t: 2 });
  });

  it("merges extra state fields into the key's state, and unregisters them", () => {
    registerDemo("nav", api({ t: 5, beats: ["a"] }));
    const off = registerDemoState("nav", () => ({ routesBbox: { x0: 1 }, t: 6 }));
    registerDemoState("bld", () => ({ crane: true }));
    const h = createDemoHook();
    expect(h.state()).toEqual({
      key: "nav",
      registered: true,
      t: 6,
      beats: ["a"],
      routesBbox: { x0: 1 },
    });
    off();
    expect(h.state()).toEqual({ key: "nav", registered: true, t: 5, beats: ["a"] });
  });

  it("is a no-op for a key nothing registered, and ignores unknown keys", () => {
    const h = createDemoHook();
    h.set("bld");
    h.seek(1);
    expect(h.state()).toEqual({ key: "bld", registered: false });
    h.set("zzz" as never);
    expect(h.state().key).toBe("bld");
  });
});
