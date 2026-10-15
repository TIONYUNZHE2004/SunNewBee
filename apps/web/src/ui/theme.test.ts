// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, loadTheme, useTheme } from "./theme";

const mql = (light: boolean) => ({ matches: light }) as MediaQueryList;

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  it("defaults to night when the device prefers dark", () => {
    expect(loadTheme(localStorage, mql(false))).toBe("night");
  });
  it("defaults to day when the device prefers light", () => {
    expect(loadTheme(localStorage, mql(true))).toBe("day");
  });
  it("a stored choice wins over the device", () => {
    localStorage.setItem("tl.theme", "day");
    expect(loadTheme(localStorage, mql(false))).toBe("day");
  });
  it("survives storage throwing (private window)", () => {
    const bad = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadTheme(bad, mql(false))).toBe("night");
  });
  it("applyTheme sets data-theme and toggle flips it", () => {
    applyTheme("day");
    expect(document.documentElement.dataset.theme).toBe("day");
    useTheme.getState().setTheme("night");
    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe("day");
    expect(document.documentElement.dataset.theme).toBe("day");
  });
  it("setTheme tolerates setItem throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => useTheme.getState().setTheme("night")).not.toThrow();
    vi.restoreAllMocks();
  });
});
