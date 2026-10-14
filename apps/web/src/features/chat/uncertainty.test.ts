import { describe, expect, it } from "vitest";
import { describeUncertainty } from "./uncertainty";

describe("describeUncertainty", () => {
  it("prefers note text", () => {
    expect(
      describeUncertainty([
        { element_id: "e-1", attribute: "step_free", note: "Ramp not surveyed" },
      ]),
    ).toEqual(["Ramp not surveyed"]);
  });
  it("falls back to a readable attribute label, not raw ids", () => {
    expect(describeUncertainty([{ element_id: "e-1", attribute: "step_free" }])).toEqual([
      "Step free",
    ]);
  });
  it("skips empty items and handles undefined", () => {
    expect(describeUncertainty([{}])).toEqual([]);
    expect(describeUncertainty(undefined)).toEqual([]);
  });
});
