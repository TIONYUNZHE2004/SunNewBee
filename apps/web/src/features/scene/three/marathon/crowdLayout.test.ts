import { describe, expect, it } from "vitest";
import { shotStart, TOTAL_S } from "../../../closures/marathonCinematic";
import {
  ARCH_CLUSTER,
  GRID_ROW_M,
  JUNCTION_GAP_M,
  LANES_M,
  localPath,
  MAX_SPECTATORS,
  runnerPlacement,
  SPECTATOR_SIDE_M,
  spectatorPlacements,
} from "./crowdLayout";

// a straight 1 km course heading east (+x)
const p = localPath([
  [0, 0],
  [1000, 0],
]);

describe("T-031 marathon crowd layout", () => {
  it("runners wait in a grid behind the start, then jog east in lanes, facing the course", () => {
    const lead = runnerPlacement(p, 0, 0);
    expect(lead).toMatchObject({ x: 0, z: 0, moving: false });
    const row1 = runnerPlacement(p, 0, LANES_M.length); // second row, centre lane
    expect(row1.x).toBeCloseTo(-GRID_ROW_M);
    const lane1 = runnerPlacement(p, 0, 1);
    expect(Math.abs(lane1.z)).toBeCloseTo(Math.abs(LANES_M[1]));
    const mid = runnerPlacement(p, shotStart("run") + 9, 0);
    expect(mid.x).toBeCloseTo(500, 0);
    expect(mid.moving).toBe(true);
    expect(mid.yaw).toBeCloseTo(Math.PI / 2); // facing +x
    expect(runnerPlacement(p, TOTAL_S, 0)).toMatchObject({ x: 1000, moving: false });
  });

  it("spectators stand beside the course facing it, cluster at the start, none at junctions", () => {
    const all = spectatorPlacements(p, []);
    expect(all.length).toBeLessThanOrEqual(MAX_SPECTATORS);
    // start and (separate) finish clusters first
    const start = all.slice(0, ARCH_CLUSTER);
    expect(start.every((s) => Math.hypot(s.x, s.z) < 15)).toBe(true);
    const line = all.slice(ARCH_CLUSTER * 2);
    expect(line.every((s) => Math.abs(Math.abs(s.z) - SPECTATOR_SIDE_M) < 1e-6)).toBe(true);
    expect(line.some((s) => s.z > 0) && line.some((s) => s.z < 0)).toBe(true);
    for (const s of line) {
      // facing the course (toward z = 0)
      const fz = Math.cos(s.yaw);
      expect(Math.sign(fz)).toBe(-Math.sign(s.z));
    }
    const gap = spectatorPlacements(p, [[320, 0]]);
    expect(gap.some((s) => Math.hypot(s.x - 320, s.z) < JUNCTION_GAP_M)).toBe(false);
  });
});
