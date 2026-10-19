import { describe, expect, it } from "vitest";
import { bannerParts, describeUncertainty, groupUncertainty } from "./uncertainty";

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

describe("bannerParts", () => {
  it("lists unchecked facts under 'Not checked yet' and other caveats as notes", () => {
    const p = bannerParts([
      { attribute: "incline_pct", note: "Stroller: incline not checked yet (limit 8.3%)" },
      { attribute: "closure", note: "Closed (staff report): Jalan A until 20 Oct 2026" },
      { attribute: "rest_gap", note: "Longest stretch without a rest point is about 110 m" },
    ]);
    expect(p.heading).toBe("Not checked yet");
    expect(p.unchecked).toEqual(["Stroller: incline not checked yet (limit 8.3%)"]);
    expect(p.notes).toEqual([
      "Closed (staff report): Jalan A until 20 Oct 2026",
      "Longest stretch without a rest point is about 110 m",
    ]);
  });
  it("uses 'Please note' when there are only notes", () => {
    const p = bannerParts([{ attribute: "demo_values", note: "Demo values, not yet surveyed" }]);
    expect(p.heading).toBe("Please note");
    expect(p.unchecked).toEqual([]);
  });
  it("is neutral when a partial answer has no items", () => {
    const p = bannerParts([]);
    expect(p.heading).toBe("Please note");
    expect(p.notes).toEqual(["Some details are unconfirmed."]);
  });
});

describe("groupUncertainty", () => {
  it("collapses only exact duplicates, with a count, in first-seen order", () => {
    expect(groupUncertainty(["a", "b", "a", "c", "a", "b"])).toEqual(["a (x3)", "b (x2)", "c"]);
    expect(groupUncertainty(["a", "a "])).toEqual(["a", "a "]);
    expect(groupUncertainty([])).toEqual([]);
  });
});
