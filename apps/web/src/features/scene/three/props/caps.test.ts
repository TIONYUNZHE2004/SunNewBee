import { describe, expect, it } from "vitest";
import { PROP_CAPS } from "./caps";

describe("PROP_CAPS", () => {
  // Gate measurement (final fix C): hero-mid Medium was 2.64 M tris with 3500 trees (budget 2.5 M,
  // all passes). Trees cost ~0.23 M tris per 1000 there; 2300 measured 2.36 M (>= 5 % headroom).
  it("keeps Medium trees within the hero-mid tri budget, and not gutted (>= half of 3500)", () => {
    expect(PROP_CAPS.medium.trees).toBeLessThanOrEqual(2300);
    expect(PROP_CAPS.medium.trees).toBeGreaterThanOrEqual(1750);
  });
  it("orders every kind low <= medium <= high", () => {
    for (const k of Object.keys(PROP_CAPS.high) as (keyof typeof PROP_CAPS.high)[]) {
      expect(PROP_CAPS.low[k]).toBeLessThanOrEqual(PROP_CAPS.medium[k]);
      expect(PROP_CAPS.medium[k]).toBeLessThanOrEqual(PROP_CAPS.high[k]);
    }
  });
});
