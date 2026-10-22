import { describe, expect, it } from "vitest";
import { WIDTH_BY_TYPE } from "../scene/shared/roads";
import { createRoutePath, ROADSIDE_KERB_M, roadsideRuns } from "./routePath";

// A local frame that is the identity: [lon, lat] are already [x, z] metres.
const id = (lon: number, lat: number): [number, number] => [lon, lat];
const plan = (polyline: [number, number][], spans: [number, number, "PASS"][]) => ({
  polyline: polyline as never,
  spans: spans as never,
});
const STREET_OFF = (WIDTH_BY_TYPE.street as number) / 2 + ROADSIDE_KERB_M;

describe("roadside offset (walkers keep to a road's verge, never its centre line)", () => {
  // east 100 m along a street, then north 60 m along a footway
  const p = plan(
    [
      [0, 0],
      [100, 0],
      [100, 60],
    ],
    [
      [0, 100, "PASS"],
      [100, 160, "PASS"],
    ],
  );

  it("without the option the path is the centre line, as before", () => {
    const path = createRoutePath(p, id);
    expect(path.pointAt(50)).toEqual([50, 0]);
  });

  it("on a street the walker is beside the carriageway, left of travel, on the verge", () => {
    const path = createRoutePath(p, id, { roadside: roadsideRuns(p.spans, ["street", "footway"]) });
    const [x, z] = path.pointAt(50);
    expect(Math.abs(x - 50)).toBeLessThan(2.5); // the mitred corner stretches the line slightly
    // left of travel with y up is (dz, -dx): heading +x, left is -z
    expect(z).toBeCloseTo(-STREET_OFF);
    expect(Math.abs(z)).toBeGreaterThan((WIDTH_BY_TYPE.street as number) / 2);
  });

  it("a footway keeps its own line, away from the street it leaves", () => {
    const path = createRoutePath(p, id, { roadside: roadsideRuns(p.spans, ["street", "footway"]) });
    expect(path.pointAt(160)).toEqual([100, 60]);
    // plan metres still run end to end
    expect(path.planLength).toBe(160);
  });

  it("the ribbon runs (spanLines) follow the same offset line", () => {
    const path = createRoutePath(p, id, { roadside: roadsideRuns(p.spans, ["street", "footway"]) });
    const pts = path.spanLines()[0]?.points as Float32Array;
    // first point at the start of the street, offset to the verge
    expect(pts[2]).toBeCloseTo(-STREET_OFF);
  });

  it("a major road gets its wider half width", () => {
    const q = plan(
      [
        [0, 0],
        [0, 80],
      ],
      [[0, 80, "PASS"]],
    );
    const path = createRoutePath(q, id, { roadside: roadsideRuns(q.spans, ["major_road"]) });
    const [x] = path.pointAt(40);
    // heading +z: left of travel (dz, -dx) is +x
    expect(x).toBeCloseTo((WIDTH_BY_TYPE.major_road as number) / 2 + ROADSIDE_KERB_M);
  });

  it("no types (an old payload) means no offset", () => {
    expect(roadsideRuns(p.spans, [])).toEqual([]);
    expect(roadsideRuns(p.spans, undefined)).toEqual([]);
    const path = createRoutePath(p, id, { roadside: roadsideRuns(p.spans, undefined) });
    expect(path.pointAt(50)).toEqual([50, 0]);
  });
});
