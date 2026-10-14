import { describe, expect, it } from "vitest";
import { activeLens, suggestionsFor } from "./suggestions";

describe("suggestions", () => {
  it("offers 4 / 3 / 1 chips per lens", () => {
    expect(suggestionsFor("access")).toHaveLength(4);
    expect(suggestionsFor("flood")).toHaveLength(3);
    expect(suggestionsFor("waste")).toHaveLength(1);
  });
  it("has no duplicate questions", () => {
    const all = (["access", "flood", "waste"] as const).flatMap(suggestionsFor);
    expect(new Set(all).size).toBe(all.length);
  });
  it("picks the active lens: flood, then waste, then access", () => {
    expect(activeLens({ access: true, flood: true, waste: true })).toBe("flood");
    expect(activeLens({ access: true, flood: false, waste: true })).toBe("waste");
    expect(activeLens({ access: false, flood: false, waste: false })).toBe("access");
  });
});
