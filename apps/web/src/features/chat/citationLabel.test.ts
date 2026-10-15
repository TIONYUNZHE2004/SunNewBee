import { describe, expect, it } from "vitest";
import type { Citation } from "./chatReducer";
import { elementName, groupByElement } from "./citationLabel";

const c = (element_id: string, attribute: string, ref = 1): Citation => ({
  type: "citation",
  ref,
  evidence_id: `ev-${ref}`,
  element_id,
  attribute,
  status: "verified",
});

describe("elementName", () => {
  const names = new Map([["pl-mall", "Lakeside Mall"]]);
  it("uses the element name, then falls back by id prefix, then the id", () => {
    expect(elementName("pl-mall", names)).toBe("Lakeside Mall");
    expect(elementName("seg-1-3", names)).toBe("Path segment");
    expect(elementName("evc-osm-way-9", names)).toBe("Evacuation candidate");
    expect(elementName("pl-x", names)).toBe("pl-x");
  });
});

describe("groupByElement", () => {
  it("groups by element in first-appearance order", () => {
    const g = groupByElement([c("a", "x", 1), c("b", "x", 2), c("a", "y", 3)]);
    expect(g.map((e) => e.element_id)).toEqual(["a", "b"]);
    expect(g[0]?.citations.map((x) => x.ref)).toEqual([1, 3]);
  });
});
