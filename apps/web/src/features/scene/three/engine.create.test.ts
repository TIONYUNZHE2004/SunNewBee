// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// No WebGL here: a fake renderer, and a PMREM generator that fails part-way through construction.
const spy = vi.hoisted(() => ({
  rendererDispose: vi.fn(),
  contextLoss: vi.fn(),
  pmremDispose: vi.fn(),
}));
vi.mock("three", async (orig) => {
  const t = await orig<typeof import("three")>();
  class FakeRenderer {
    toneMapping = 0;
    outputColorSpace = "";
    shadowMap = { type: 0, enabled: false };
    info = { autoReset: true };
    debug: { onShaderError: unknown } = { onShaderError: null };
    dispose = spy.rendererDispose;
    forceContextLoss = spy.contextLoss;
  }
  class FailingPmrem {
    fromScene(): never {
      throw new Error("PMREM failed");
    }
    dispose = spy.pmremDispose;
  }
  return { ...t, WebGLRenderer: FakeRenderer, PMREMGenerator: FailingPmrem };
});

describe("createEngine", () => {
  it("a failure after the renderer exists releases what was made, loses the context and rethrows", async () => {
    const { createEngine } = await import("./engine");
    const canvas = document.createElement("canvas");
    const remove = vi.spyOn(canvas, "removeEventListener");
    expect(() => createEngine(canvas, "medium")).toThrow("PMREM failed");
    expect(spy.pmremDispose).toHaveBeenCalledTimes(1);
    expect(spy.rendererDispose).toHaveBeenCalledTimes(1);
    expect(spy.contextLoss).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("webglcontextlost", expect.any(Function));
  });
});
