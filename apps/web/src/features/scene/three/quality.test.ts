import { describe, expect, it } from "vitest";
import { THREE_TIERS } from "./quality";

describe("THREE_TIERS", () => {
  it("low has no shadows, AO or bloom", () => {
    expect(THREE_TIERS.low).toMatchObject({ shadows: false, ao: false, bloom: false });
  });
  it("pixel ratio does not increase from high to low", () => {
    expect(THREE_TIERS.high.maxPixelRatio).toBeGreaterThanOrEqual(THREE_TIERS.medium.maxPixelRatio);
    expect(THREE_TIERS.medium.maxPixelRatio).toBeGreaterThanOrEqual(THREE_TIERS.low.maxPixelRatio);
  });
});
