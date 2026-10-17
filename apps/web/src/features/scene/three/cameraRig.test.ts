import { describe, expect, it, vi } from "vitest";
import {
  type CameraRig,
  clampPose,
  createThreeCameraOps,
  LIMITS,
  type Pose,
  poseToCamera,
  tweenPose,
  viewOffsetFor,
} from "./cameraRig";

const base: Pose = { target: [0, 0], rangeM: 100, pitchDeg: -45, headingDeg: 0 };
const bounds = { min: [-1000, -1000] as [number, number], max: [1000, 1000] as [number, number] };

describe("poseToCamera", () => {
  it("puts the camera south of and above the target at heading 0", () => {
    const c = poseToCamera(base);
    expect(c.position[0]).toBeCloseTo(0);
    expect(c.position[1]).toBeCloseTo(70.71, 1);
    expect(c.position[2]).toBeCloseTo(70.71, 1);
    expect(c.target).toEqual([0, 0, 0]);
  });
  it("puts the camera west of the target at heading 90", () => {
    const c = poseToCamera({ ...base, headingDeg: 90 });
    expect(c.position[0]).toBeCloseTo(-70.71, 1);
    expect(c.position[2]).toBeCloseTo(0);
  });
});

describe("clampPose", () => {
  it("clamps range and pitch", () => {
    expect(clampPose({ ...base, rangeM: 1 }, bounds).rangeM).toBe(LIMITS.minRangeM);
    expect(clampPose({ ...base, rangeM: 1e6 }, bounds).rangeM).toBe(LIMITS.maxRangeM);
    expect(clampPose({ ...base, pitchDeg: 0 }, bounds).pitchDeg).toBe(-5);
    expect(clampPose({ ...base, pitchDeg: -90 }, bounds).pitchDeg).toBe(-89);
  });
  it("pulls the target back within 5000 m of the bounds", () => {
    const p = clampPose({ ...base, target: [99999, -99999] }, bounds);
    expect(p.target).toEqual([6000, -6000]);
  });
});

describe("tweenPose", () => {
  const b: Pose = { target: [100, 50], rangeM: 500, pitchDeg: -30, headingDeg: 10 };
  it("hits both ends", () => {
    const a = { ...base, headingDeg: 350 };
    expect(tweenPose(a, b, 0)).toEqual(a);
    const end = tweenPose(a, b, 1);
    expect(end.target).toEqual(b.target);
    expect(end.rangeM).toBe(500);
    expect(((end.headingDeg % 360) + 360) % 360).toBeCloseTo(10);
  });
  it("takes the shortest heading arc", () => {
    const m = tweenPose({ ...base, headingDeg: 350 }, b, 0.5);
    expect(((m.headingDeg % 360) + 360) % 360).toBeCloseTo(0);
  });
});

describe("viewOffsetFor", () => {
  it("shifts by half the panel", () => {
    expect(viewOffsetFor(1440, 900, 400)).toEqual([1440, 900, 200, 0, 1440, 900]);
    expect(viewOffsetFor(1440, 900, 0)[2]).toBe(0);
  });
});

describe("createThreeCameraOps", () => {
  const make = () => {
    let pose = { ...base };
    const rig: CameraRig = {
      get: () => pose,
      set: vi.fn((p: Pose) => {
        pose = p;
      }),
      flyTo: vi.fn(),
      pick: vi.fn(() => [10, 20] as [number, number]),
    };
    const moved = vi.fn();
    const homePose: Pose = { ...base, rangeM: 800 };
    const ops = createThreeCameraOps(
      rig,
      () => homePose,
      () => ({ ...base, rangeM: 7000 }),
      moved,
    );
    return { rig, ops, moved, homePose };
  };

  it("zoom halves the range and reports a user move", () => {
    const { rig, ops, moved } = make();
    ops.zoom(0.5);
    expect(rig.get().rangeM).toBe(50);
    expect(moved).toHaveBeenCalled();
  });
  it("faceNorth sets heading 0", () => {
    const { rig, ops } = make();
    rig.set({ ...base, headingDeg: 120 });
    ops.faceNorth();
    expect(rig.get().headingDeg).toBeCloseTo(0);
  });
  it("home flies to the home pose, calling onUserMove first", () => {
    const { rig, ops, moved, homePose } = make();
    ops.home();
    expect(rig.flyTo).toHaveBeenCalledWith(homePose, expect.any(Number));
    expect(moved.mock.invocationCallOrder[0]).toBeLessThan(
      (rig.flyTo as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0,
    );
  });
  it("move shifts the target along the heading (forward = north at heading 0)", () => {
    const { rig, ops } = make();
    ops.move(0, 1);
    expect(rig.get().target[0]).toBeCloseTo(0);
    expect(rig.get().target[1]).toBeLessThan(0); // z = -north
  });
  it("glideTo flies to the picked ground point", () => {
    const { rig, ops } = make();
    ops.glideTo({ x: 5, y: 5 });
    const arg = (rig.flyTo as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Pose;
    expect(arg.target).toEqual([10, 20]);
    expect(arg.rangeM).toBe(50);
  });
  it("headingRad reports radians", () => {
    const { rig, ops } = make();
    rig.set({ ...base, headingDeg: 90 });
    expect(ops.headingRad()).toBeCloseTo(Math.PI / 2);
  });
});
