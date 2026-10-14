import { describe, expect, it } from "vitest";
import type { Citation } from "./chatReducer";
import { citationLabel, groupByElement } from "./citationLabel";

const c = (element_id: string, attribute: string, ref = 1): Citation => ({
  type: "citation",
  ref,
  evidence_id: `ev-${ref}`,
  element_id,
  attribute,
  status: "verified",
});

describe("citationLabel", () => {
  const names = new Map([["pl-mall", "Lakeside Mall"]]);
  it("uses the element name and a humanised attribute", () => {
    expect(citationLabel(c("pl-mall", "step_count"), names)).toBe("Lakeside Mall · Step count");
  });
  it("falls back by id prefix", () => {
    expect(citationLabel(c("seg-1-3", "surface"), names)).toBe("Path segment · Surface");
    expect(citationLabel(c("evc-osm-way-9", "source"), names)).toBe(
      "Evacuation candidate · Source",
    );
    expect(citationLabel(c("pl-x", "source"), names)).toBe("pl-x · Source");
    expect(citationLabel(c("other", "source"), names)).toBe("other · Source");
  });
});

describe("groupByElement", () => {
  it("groups by element in first-appearance order", () => {
    const g = groupByElement([c("a", "x", 1), c("b", "x", 2), c("a", "y", 3)]);
    expect(g.map((e) => e.element_id)).toEqual(["a", "b"]);
    expect(g[0]?.citations.map((x) => x.ref)).toEqual([1, 3]);
  });
});
