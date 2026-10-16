// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, loadChoice, skinFor, startThemeClock, themeAt, useTheme } from "./theme";

// Kuala Lumpur is UTC+8 all year (no DST): 07:00 KL = 23:00 UTC the previous day.
const kl = (h: number, m: number) => new Date(Date.UTC(2026, 9, 16, h - 8, m));

describe("themeAt (Asia/Kuala_Lumpur, independent of the machine timezone)", () => {
  it.each([
    [6, 59, "night"],
    [7, 0, "day"],
    [17, 59, "day"],
    [18, 0, "dusk"],
    [19, 29, "dusk"],
    [19, 30, "night"],
    [0, 0, "night"],
  ] as const)("%i:%i KL is %s", (h, m, want) => {
    expect(themeAt(kl(h, m))).toBe(want);
  });
});

describe("skinFor", () => {
  it("day and dusk share the light chrome, night is dark", () => {
    expect(skinFor("day")).toBe("light");
    expect(skinFor("dusk")).toBe("light");
    expect(skinFor("night")).toBe("dark");
  });
});

describe("loadChoice", () => {
  beforeEach(() => localStorage.clear());
  it("defaults to auto", () => expect(loadChoice(localStorage)).toBe("auto"));
  it.each(["auto", "day", "dusk", "night"])("keeps a stored %s", (v) => {
    localStorage.setItem("tl.theme", v);
    expect(loadChoice(localStorage)).toBe(v);
  });
  it("ignores junk", () => {
    localStorage.setItem("tl.theme", "purple");
    expect(loadChoice(localStorage)).toBe("auto");
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
    expect(loadChoice(bad)).toBe("auto");
  });
});

describe("theme store", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("applyTheme sets data-theme and data-skin", () => {
    applyTheme("dusk");
    expect(document.documentElement.dataset.theme).toBe("dusk");
    expect(document.documentElement.dataset.skin).toBe("light");
  });

  it("a manual choice is shown and persisted", () => {
    useTheme.getState().setChoice("night");
    expect(useTheme.getState().theme).toBe("night");
    expect(localStorage.getItem("tl.theme")).toBe("night");
    expect(document.documentElement.dataset.skin).toBe("dark");
  });

  it("auto follows the clock and switches live at 18:00", () => {
    vi.setSystemTime(kl(17, 59));
    useTheme.getState().setChoice("auto");
    expect(useTheme.getState().theme).toBe("day");
    const stop = startThemeClock(60_000);
    vi.setSystemTime(kl(18, 0));
    vi.advanceTimersByTime(60_000);
    expect(useTheme.getState().theme).toBe("dusk");
    stop();
  });

  it("the clock never overrides a manual choice", () => {
    vi.setSystemTime(kl(12, 0));
    useTheme.getState().setChoice("night");
    const stop = startThemeClock(60_000);
    vi.advanceTimersByTime(60_000);
    expect(useTheme.getState().theme).toBe("night");
    stop();
  });

  it("setChoice tolerates setItem throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => useTheme.getState().setChoice("day")).not.toThrow();
    vi.restoreAllMocks();
  });
});
