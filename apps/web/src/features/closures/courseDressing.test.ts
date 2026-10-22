import { describe, expect, it } from "vitest";
import {
  arches,
  boundaryJunctions,
  CONE_MERGE_M,
  closedTag,
  courseDressing,
  kmMarkers,
  lineLength,
  MAX_CONES,
  metres,
} from "./courseDressing";
import { MARATHON } from "./fixtures";

// 0.009° of latitude ≈ 1,000 m
const north = (m: number) => [101.5, 3.1 + (m / 1000) * 0.009];

describe("T-031 course dressing (static)", () => {
  it("puts a km marker at every whole kilometre before the finish", () => {
    const line = [north(0), north(2500)];
    expect(lineLength(line)).toBeGreaterThan(2490);
    const km = kmMarkers(line);
    expect(km.map((k) => k.km)).toEqual([1, 2]);
    expect(metres(km[0]?.at as number[], north(0))).toBeCloseTo(1000, -1);
    expect(kmMarkers([north(0), north(900)])).toEqual([]);
  });

  it("one shared arch for a loop, start and finish arches otherwise, facing along the course", () => {
    expect(arches([north(0), north(500), north(10)]).map((a) => a.label)).toEqual([
      "START · FINISH",
    ]);
    const p2p = arches([north(0), north(500), north(1000)]);
    expect(p2p.map((a) => a.label)).toEqual(["START", "FINISH"]);
    expect(p2p[0]?.toward).toEqual(north(500));
    expect(p2p[1]?.toward).toEqual(north(500));
    expect(arches([north(0)])).toEqual([]);
  });

  it("cones go where another mapped edge meets the course, merged and capped", () => {
    const edges = [
      { id: "c1", coords: [north(0), north(100)] },
      { id: "c2", coords: [north(100), north(200)] },
      { id: "side", coords: [north(100), [101.501, 3.1009]] }, // meets the course at 100 m
      {
        id: "far",
        coords: [
          [101.6, 3.2],
          [101.61, 3.2],
        ],
      }, // touches nothing
    ];
    const cones = boundaryJunctions(new Set(["c1", "c2"]), edges);
    expect(cones).toHaveLength(1);
    expect(metres(cones[0] as number[], north(100))).toBeLessThan(1);
    // junctions closer than CONE_MERGE_M share one cone
    const near = [
      ...edges,
      { id: "c3", coords: [north(200), north(200 + CONE_MERGE_M / 2)] },
      { id: "side2", coords: [north(200 + CONE_MERGE_M / 2), [101.502, 3.1]] },
      { id: "side3", coords: [north(200), [101.503, 3.1]] },
    ];
    expect(boundaryJunctions(new Set(["c1", "c2", "c3"]), near)).toHaveLength(2);
    const many = Array.from({ length: 60 }, (_, i) => [
      { id: `c${i}`, coords: [north(i * 100), north(i * 100 + 100)] },
      { id: `s${i}`, coords: [north(i * 100), [101.6, 3.3 + i]] },
    ]).flat();
    const courseIds = new Set(many.filter((e) => e.id.startsWith("c")).map((e) => e.id));
    expect(boundaryJunctions(courseIds, many)).toHaveLength(MAX_CONES);
  });

  it("the closed tag is the engine's window in Elmina time", () => {
    // fixture closure 2026-10-25T22:00Z .. 2026-10-26T02:00Z
    expect(closedTag(MARATHON.impact)).toBe("Closed 06:00–10:00");
    const none = { ...MARATHON.impact, event: { ...MARATHON.impact.event, closures: [] } };
    expect(closedTag(none)).toBeNull();
    const d = courseDressing(MARATHON, []);
    expect(d.closed).toBe("Closed 06:00–10:00");
    expect(d.cones).toEqual([]);
  });
});
