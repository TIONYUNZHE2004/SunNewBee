import { describe, expect, it } from "vitest";
import { biggestGaps, GAP_BANDS, type GapItem, gapBand, gapSummary, parseGaps } from "./gapModel";

const item = (o: Partial<GapItem>): GapItem => ({
  id: "x",
  kind: "segment",
  name: "X",
  type: "footway",
  unknown: 1,
  stale: 0,
  relevant: 3,
  demand: 0,
  attributes: [],
  band: "some",
  coords: [],
  ...o,
});

describe("gapBand", () => {
  it("maps the share of unchecked facts to three bands", () => {
    expect(gapBand(0, 3)).toBe("checked");
    expect(gapBand(1, 3)).toBe("some");
    expect(gapBand(1, 2)).toBe("some");
    expect(gapBand(2, 3)).toBe("many");
    expect(gapBand(1, 1)).toBe("many");
    expect(gapBand(3, 3)).toBe("many");
  });
  it("draws nothing as checked when no fact is relevant", () => {
    expect(gapBand(0, 0)).toBeNull();
  });
  it("gives every band a different pattern and honest wording", () => {
    expect(new Set(Object.values(GAP_BANDS).map((b) => b.pattern)).size).toBe(3);
    expect(Object.values(GAP_BANDS).map((b) => b.label)).toEqual([
      "Fully checked",
      "Some facts missing",
      "Many facts missing",
    ]);
  });
});

describe("biggestGaps", () => {
  it("orders by demand, then unknown count, and drops fully checked items", () => {
    const rows = biggestGaps([
      item({ id: "a", name: "A", demand: 0, unknown: 3 }),
      item({ id: "b", name: "B", demand: 2, unknown: 1 }),
      item({ id: "c", name: "C", demand: 2, unknown: 2 }),
      item({ id: "d", name: "D", demand: 5, unknown: 0 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
  it("caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => item({ id: `e${i}`, name: `E${i}` }));
    expect(biggestGaps(many, 5)).toHaveLength(5);
  });
});

describe("parseGaps", () => {
  it("reads edges and places with counts", () => {
    const rows = parseGaps({
      features: [
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 2],
              [3, 4],
            ],
          },
          properties: {
            id: "seg-1",
            kind: "segment",
            type: "footway",
            name: null,
            unknown_count: 2,
            stale_count: 1,
            relevant_count: 3,
            demand: 4,
            unknown_attributes: ["incline_pct", "width_m"],
          },
        },
        {
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: { id: "toilet-1", kind: "amenity", type: "toilet", name: "Park toilet" },
        },
        { geometry: { type: "Point", coordinates: [1, 2] }, properties: {} },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "seg-1",
      name: "Unnamed footway",
      band: "many",
      demand: 4,
    });
    expect(rows[1]).toMatchObject({ kind: "amenity", unknown: 0, band: null });
  });
  it("tolerates junk", () => {
    expect(parseGaps(null)).toEqual([]);
    expect(parseGaps({})).toEqual([]);
  });
});

describe("gapSummary", () => {
  it("says facts not yet checked, never unsafe", () => {
    const s = gapSummary(item({ unknown: 2, stale: 1, demand: 3 }));
    expect(s).toBe("2 facts not yet checked, 1 out of date. Asked about 3 times");
    expect(gapSummary(item({ unknown: 1 }))).toBe("1 fact not yet checked");
    expect(s).not.toMatch(/unsafe|inaccessible/i);
  });
});
