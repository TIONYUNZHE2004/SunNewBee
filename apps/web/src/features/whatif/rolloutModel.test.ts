import { describe, expect, it } from "vitest";
import { kindAt, phase, pointAlong, routeAt, stageRows } from "./rolloutModel";

const r = {
  id: "wheelchair:park-b",
  statuses: ["partly_unverified", "partly_unverified", "blocked", "no_data"],
  route_ids: ["rt-a", "rt-b", null, null],
};

describe("rollout playback", () => {
  it("colours residents by their status at the stage", () => {
    expect([0, 1, 2, 3].map((s) => kindAt(r, s))).toEqual(["reach", "reach", "cutOff", "noData"]);
  });
  it("walks the stage's route, and a cut-off resident stays on its last route, not moving", () => {
    expect(routeAt(r, 1)).toEqual({ routeId: "rt-b", moving: true });
    expect(routeAt(r, 2)).toEqual({ routeId: "rt-b", moving: false });
    expect(routeAt({ id: "x", statuses: ["no_data"], route_ids: [null] }, 0)).toEqual({
      routeId: null,
      moving: false,
    });
  });
  it("interpolates along a line by length", () => {
    const line = [
      [0, 0],
      [2, 0],
      [2, 2],
    ];
    expect(pointAlong(line, 0)).toEqual([0, 0]);
    expect(pointAlong(line, 0.5)).toEqual([2, 0]);
    expect(pointAlong(line, 0.75)).toEqual([2, 1]);
    expect(pointAlong(line, 2)).toEqual([2, 2]);
    expect(pointAlong([[1, 1]], 0.4)).toEqual([1, 1]);
  });
  it("phase is deterministic in [0, 1) and stage rows copy the counts", () => {
    expect(phase("a")).toBe(phase("a"));
    expect(phase("a")).toBeGreaterThanOrEqual(0);
    expect(phase("a")).toBeLessThan(1);
    const rows = stageRows(
      { wheelchair: { stage_p3m: { total: 30, reach: 27, confirmed: 0, cut_off: 2, no_data: 1 } } },
      "stage_p3m",
    );
    expect(rows).toEqual([{ profile: "wheelchair", reach: 27, total: 30, cutOff: 2 }]);
  });
});
