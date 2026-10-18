import { describe, expect, it } from "vitest";
import {
  GAP_BANDS,
  type GapItem,
  gapBand,
  gapCoverage,
  gapLines,
  gapRows,
  gapSummary,
  gapSummaryLine,
  gapsActive,
  gapsApplicable,
  parseGaps,
} from "./gapModel";

const item = (o: Partial<GapItem>): GapItem => ({
  id: "x",
  kind: "segment",
  name: "X",
  type: "footway",
  unknown: 1,
  stale: 0,
  reported: 0,
  demo: 0,
  relevant: 3,
  demand: 0,
  journey: 0,
  named: true,
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

describe("gapRows", () => {
  it("orders by demand, then journey impact, then facts missing; drops fully checked items", () => {
    const rows = gapRows([
      item({ id: "a", name: "Low street", unknown: 3 }),
      item({ id: "b", name: "Asked street", unknown: 1, demand: 4 }),
      item({ id: "c", name: "Journey street", unknown: 1, journey: 7 }),
      item({ id: "d", name: "Fine street", unknown: 0, demand: 9 }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(["Asked street", "Journey street", "Low street"]);
  });

  it("aggregates a street into one row and focuses its first segment", () => {
    const seg = (id: string, demand = 0) =>
      item({
        id,
        name: "Jalan Hopea U15/17D",
        unknown: 3,
        demand,
        coords: [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
      });
    const rows = gapRows([seg("s1"), seg("s2", 2), seg("s3")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "street",
      count: 3,
      unknown: 9,
      demand: 2,
      firstId: "s2",
    });
    expect(rows[0]?.detail).toBe(
      "3 path segments, 3 facts each not yet checked. Asked about 2 times",
    );
    expect(rows[0]?.at).toEqual([3, 4]);
  });

  it("collapses unnamed segments into a single row", () => {
    const rows = gapRows([
      item({ id: "u1", named: false, name: "Unnamed footway", unknown: 2 }),
      item({ id: "u2", named: false, name: "Unnamed footway", unknown: 2 }),
      item({ id: "p", kind: "amenity", name: "Park toilet", unknown: 1 }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(["2 unnamed path segments", "Park toilet"]);
    expect(rows[0]?.kind).toBe("unnamed");
  });

  it("mentions journeys, in words", () => {
    const [r] = gapRows([item({ id: "a", unknown: 1, journey: 3 })]);
    expect(r?.detail).toContain("Checking would confirm 3 journeys in the latest test run");
  });

  it("caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => item({ id: `e${i}`, name: `E${i}` }));
    expect(gapRows(many, 5)).toHaveLength(5);
  });
});

describe("gapSummaryLine", () => {
  const seg = (id: string, unknown: number, relevant = 3) => item({ id, unknown, relevant });
  it("states the computed numbers as a finding", () => {
    const items = [
      seg("a", 3),
      seg("b", 3),
      seg("c", 0),
      item({ id: "p", kind: "place", unknown: 1 }),
    ];
    expect(gapSummaryLine(items, "wheelchair")).toBe(
      "Most paths are not yet checked: 2 of 3 for wheelchair travel.",
    );
  });
  it("formats large numbers", () => {
    const items = [
      ...Array.from({ length: 16137 }, (_, i) => seg(`x${i}`, 3)),
      ...Array.from({ length: 11 }, (_, i) => seg(`y${i}`, 0)),
    ];
    expect(gapSummaryLine(items, "wheelchair")).toBe(
      "Most paths are not yet checked: 16,137 of 16,148 for wheelchair travel.",
    );
  });
  it("is calmer when most paths are checked, and silent with nothing relevant", () => {
    expect(gapSummaryLine([seg("a", 1), seg("b", 0), seg("c", 0)], "stroller")).toBe(
      "1 of 3 paths have facts not yet checked for stroller travel.",
    );
    expect(gapSummaryLine([seg("a", 0, 0)], "default")).toBe("");
  });
});

describe("demo values in the gap summary (Task 55)", () => {
  it("mentions demo values when some paths rest on them", () => {
    const items = [
      item({ id: "a", unknown: 3, demo: 3 }),
      item({ id: "b", unknown: 0 }),
      item({ id: "c", unknown: 0 }),
    ];
    expect(gapSummaryLine(items, "stroller")).toBe(
      "1 of 3 paths have facts not yet checked for stroller travel. 1 of them rest on demo values, not yet surveyed.",
    );
  });
  it("says nothing about demo values when there are none", () => {
    expect(gapSummaryLine([item({ id: "a", unknown: 1 })], "stroller")).not.toMatch(/demo/);
  });
  it("a row names its demo values and parseGaps reads demo_count", () => {
    expect(gapSummary(item({ unknown: 3, demo: 3 }))).toBe(
      "3 facts not yet checked, 3 demo values, not yet surveyed",
    );
    const [g] = parseGaps({
      features: [
        {
          geometry: { type: "LineString", coordinates: [] },
          properties: { id: "s", unknown_count: 2, relevant_count: 3, demo_count: 2 },
        },
      ],
    });
    expect(g?.demo).toBe(2);
    expect(g?.band).toBe("many");
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

describe("profile applicability", () => {
  it("applies only to profiles with route-deciding facts", () => {
    for (const p of ["stroller", "wheelchair", "older_adult_rest"])
      expect(gapsApplicable(p)).toBe(true);
    for (const p of ["default", "drive"]) expect(gapsApplicable(p)).toBe(false);
    expect(gapsActive(true, "default")).toBe(false);
    expect(gapsActive(false, "stroller")).toBe(false);
    expect(gapsActive(true, "stroller")).toBe(true);
  });
});

describe("gapLines", () => {
  it("keeps only banded lines, with the band as a property", () => {
    const line = (id: string, unknown: number, relevant: number) => ({
      geometry: {
        type: "LineString",
        coordinates: [
          [1, 2],
          [3, 4],
        ],
      },
      properties: { id, unknown_count: unknown, relevant_count: relevant },
    });
    const fc = gapLines({
      features: [line("a", 0, 3), line("b", 1, 3), line("c", 3, 3), line("d", 0, 0)],
    });
    expect(fc.features.map((f) => f.properties?.gap_band)).toEqual(["checked", "some", "many"]);
  });
});

describe("reported facts", () => {
  it("are named in the summary", () => {
    expect(gapSummary(item({ unknown: 2, reported: 1 }))).toBe(
      "2 facts not yet checked, 1 only reported",
    );
  });
});

describe("gapCoverage", () => {
  it("counts relevant paths, those with an unchecked fact and those on demo values", () => {
    const seg = (unknown: number, demo = 0, relevant = 3) =>
      ({ kind: "segment", relevant, unknown, demo }) as unknown as GapItem;
    const place = { kind: "place", relevant: 2, unknown: 2, demo: 0 } as unknown as GapItem;
    expect(gapCoverage([seg(0), seg(2, 1), seg(1), seg(0, 0, 0), place])).toEqual({
      paths: 3,
      open: 2,
      demo: 1,
    });
  });
});
