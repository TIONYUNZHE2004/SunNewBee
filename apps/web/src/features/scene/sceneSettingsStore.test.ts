// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const load = async () => {
  vi.resetModules();
  return (await import("./sceneSettingsStore")).useSceneSettings;
};

describe("sceneSettingsStore pathStatus", () => {
  beforeEach(() => localStorage.clear());

  it("AC-A1: defaults to off on a fresh profile", async () => {
    const s = await load();
    expect(s.getState().pathStatus).toBe(false);
  });

  it("persists the choice across a reload (fresh module, same localStorage)", async () => {
    const s = await load();
    s.getState().setPathStatus(true);
    expect(localStorage.getItem("tl.pathStatus")).toBe("true");
    expect((await load()).getState().pathStatus).toBe(true);
    (await load()).getState().setPathStatus(false);
    expect((await load()).getState().pathStatus).toBe(false);
  });

  it("ignores garbage in storage", async () => {
    localStorage.setItem("tl.pathStatus", "banana");
    expect((await load()).getState().pathStatus).toBe(false);
  });
});
