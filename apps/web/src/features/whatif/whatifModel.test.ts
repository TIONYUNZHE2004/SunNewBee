import { describe, expect, it } from "vitest";
import {
  actionKey,
  diffJourneys,
  diffLines,
  diffMeta,
  groupBySite,
  pct,
  plural,
  summaryBars,
  touchedLabels,
} from "./whatifModel";

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

describe("diff meta for the lite map and the list (Cycle 8)", () => {
  const line = [
    [101.5, 3.1],
    [101.6, 3.2],
  ];
  const fc = {
    type: "FeatureCollection",
    meta: {
      summary: {
        total: 5,
        reach_before: 4,
        reach_after: 5,
        confirmed_before: 0,
        confirmed_after: 1,
      },
      actions: ["Build a step-free ramp at a set of unnamed steps"],
      profile: "wheelchair",
      scope: "suite",
      imagined: true,
      changed_shown: 1,
    },
    features: [
      {
        geometry: { type: "LineString", coordinates: line },
        properties: {
          whatif: true,
          side: "before",
          status: "partly_unverified",
          journey: 0,
          from_name: "Car Park B",
          to_name: "Park toilet",
        },
      },
      {
        geometry: { type: "LineString", coordinates: line },
        properties: {
          whatif: true,
          side: "after",
          status: "confirmed",
          journey: 0,
          from_name: "Car Park B",
          to_name: "Park toilet",
        },
      },
      {
        geometry: { type: "LineString", coordinates: line },
        properties: { whatif: true, side: "touched", label: "a set of unnamed steps" },
      },
      {
        geometry: { type: "LineString", coordinates: line },
        properties: { side: "after", journey: 1, status: "confirmed" },
      },
    ],
  };

  it("copies the engine summary and actions", () => {
    const m = diffMeta(fc);
    expect(m?.summary.reach_after).toBe(5);
    expect(m?.actions).toEqual(["Build a step-free ramp at a set of unnamed steps"]);
    expect(m?.imagined).toBe(true);
    expect(diffMeta({})).toBeNull();
  });

  it("lists changed journeys and imagined paths, ignoring untagged features", () => {
    expect(diffJourneys(fc)).toEqual([
      { from: "Car Park B", to: "Park toilet", before: "partly_unverified", after: "confirmed" },
    ]);
    expect(touchedLabels(fc)).toEqual(["A set of unnamed steps"]);
  });

  it("prefers meta.changed, which keeps both statuses of a cut route", () => {
    const cut = {
      ...fc,
      meta: {
        ...fc.meta,
        changed: [
          { from_name: "Car Park B", to_name: "Park kiosk", before: "confirmed", after: "blocked" },
        ],
      },
    };
    expect(diffJourneys(cut)).toEqual([
      { from: "Car Park B", to: "Park kiosk", before: "confirmed", after: "blocked" },
    ]);
  });
});
