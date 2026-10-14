import { describe, expect, it } from "vitest";
import { optionLabel, specFor } from "./attributeCatalogue";

describe("specFor", () => {
  it("numbers", () => {
    for (const k of ["step_count", "step_height_cm", "incline_pct", "width_m"]) {
      expect(specFor(k, null).kind).toBe("number");
      expect(specFor(k, "oops").kind).toBe("number");
    }
  });
  it("booleans", () => {
    for (const k of ["ramp", "tactile_paving", "lit", "seating_adjacent", "seating", "covered"])
      expect(specFor(k, null).kind).toBe("boolean");
  });
  it("enums with exact options, even for non-null values", () => {
    expect(specFor("wheelchair", "yes")).toEqual({
      kind: "enum",
      options: ["yes", "limited", "no"],
    });
    expect(specFor("wheelchair", true).kind).toBe("enum");
    expect(specFor("handrail", null).options).toEqual(["both", "one_side", "none"]);
    expect(specFor("sidewalk", null).options).toEqual(["both", "one_side", "none", "separate"]);
    expect(specFor("surface", null).options).toHaveLength(10);
    expect(specFor("surface_condition", null).options).toEqual(["good", "uneven", "obstructed"]);
    expect(specFor("kerb", null).options).toEqual(["flush", "lowered", "raised", "rolled"]);
    expect(specFor("shelter", null).options).toEqual(["covered", "partial", "none"]);
    expect(specFor("door_type", null).options).toHaveLength(6);
  });
  it("text keys", () => {
    expect(specFor("opening_hours", null).kind).toBe("text");
    expect(specFor("name", 3).kind).toBe("text");
  });
  it("other keys infer from the value, else text", () => {
    expect(specFor("custom", 2).kind).toBe("number");
    expect(specFor("custom", false).kind).toBe("boolean");
    expect(specFor("custom", "x").kind).toBe("text");
    expect(specFor("custom", null).kind).toBe("text");
    expect(specFor(undefined, null).kind).toBe("text");
  });
});

describe("optionLabel", () => {
  it("humanises", () => {
    expect(optionLabel("one_side")).toBe("One side");
    expect(optionLabel("paving_stones")).toBe("Paving stones");
    expect(optionLabel("yes")).toBe("Yes");
  });
});
