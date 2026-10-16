import { describe, expect, it } from "vitest";
import { actionKey, diffLines, groupBySite, pct, plural, summaryBars } from "./whatifModel";

const line = [
  [101.5, 3.18],
  [101.51, 3.181],
];

describe("diffLines", () => {
  it("splits before / after / touched and ignores anything not tagged whatif", () => {
    const fc = {
      features: [
        {
          geometry: { type: "LineString", coordinates: line },
          properties: { whatif: true, side: "before" },
        },
        {
          geometry: { type: "LineString", coordinates: line },
          properties: { whatif: true, side: "after" },
        },
        {
          geometry: { type: "LineString", coordinates: line },
          properties: { whatif: true, side: "touched" },
        },
        { geometry: { type: "LineString", coordinates: line }, properties: { side: "after" } },
        {
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: { whatif: true, side: "after" },
        },
        {
          geometry: { type: "LineString", coordinates: [[1, 2]] },
          properties: { whatif: true, side: "after" },
        },
      ],
    };
    const d = diffLines(fc);
    expect(d.before).toHaveLength(1);
    expect(d.after).toHaveLength(1);
    expect(d.touched).toHaveLength(1);
    expect(diffLines(null)).toEqual({ before: [], after: [], touched: [] });
  });
});

describe("summaryBars", () => {
  it("copies the engine's numbers and adds the river-only bar when present", () => {
    const bars = summaryBars(
      {
        total: 50,
        reach_before: 47,
        reach_after: 46,
        reach_stage_only: 45,
        confirmed_before: 0,
        confirmed_after: 2,
      },
      "evacuation",
    );
    expect(bars.map((b) => b.label)).toEqual([
      "Reach a centre",
      "Reach a centre (river rise only)",
      "Confirmed route",
    ]);
    expect(bars[0]).toMatchObject({ today: 47, whatIf: 46, total: 50 });
    expect(bars[1]).toMatchObject({ whatIf: 45 });
    expect(summaryBars({ total: 5 }, "suite")[0]?.label).toBe("Have a mapped route");
  });
  it("pct and actionKey", () => {
    expect(pct(1, 4)).toBe(25);
    expect(pct(1, 0)).toBe(0);
    expect(actionKey({ kind: "verify_fact", element_id: "e", attribute: "width_m" })).toBe(
      "verify_fact:e:width_m",
    );
  });
});

describe("groupBySite", () => {
  it("groups checks by place, keeps plan order and collects tickets", () => {
    const g = groupBySite([
      {
        element_id: "a",
        path_label: "the street on Jalan X",
        check: "incline",
        journeys_relying: 1,
      },
      { element_id: "b", path_label: "an unnamed path", check: "width", journeys_relying: 2 },
      {
        element_id: "a",
        path_label: "the street on Jalan X",
        check: "steps",
        journeys_relying: 3,
        ticket_id: "vr-1",
      },
    ]);
    expect(g.map((x) => [x.where, x.checks, x.journeys, x.ticketIds])).toEqual([
      ["The street on Jalan X", ["incline", "steps"], 3, ["vr-1"]],
      ["An unnamed path", ["width"], 2, []],
    ]);
    expect(plural(1, "journey")).toBe("1 journey");
    expect(plural(2, "journey")).toBe("2 journeys");
  });
});
