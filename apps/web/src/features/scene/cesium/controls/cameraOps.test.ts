import { describe, expect, it, vi } from "vitest";
import { LIMITS, orbitStep } from "./cameraMath";
import { createCameraOps } from "./cameraOps";

const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
class HPR {
  constructor(
    public heading: number,
    public pitch: number,
    public range: number,
  ) {}
}

function fakes(opts: { hit?: boolean } = {}) {
  const camera = {
    heading: 1,
    pitch: -0.6,
    position: v3(0, 0, 1000),
    positionCartographic: { longitude: 0, latitude: 0, height: 800 },
    pickEllipsoid: vi.fn(() => (opts.hit === false ? undefined : v3(0, 0, 0))),
    lookAt: vi.fn(),
    lookAtTransform: vi.fn(),
    move: vi.fn(),
    flyToBoundingSphere: vi.fn(),
    viewBoundingSphere: vi.fn(),
    flyTo: vi.fn(),
    setView: vi.fn(),
  };
  const viewer = {
    scene: { canvas: { clientWidth: 100, clientHeight: 100 }, camera, requestRender: vi.fn() },
  };
  const C = {
    Cartesian2: class {
      constructor(
        public x: number,
        public y: number,
      ) {}
    },
    Cartesian3: Object.assign(
      class {
        constructor(
          public x = 0,
          public y = 0,
          public z = 0,
        ) {}
      },
      {
        distance: (a: { z: number }, b: { z: number }) => Math.abs(a.z - b.z),
        fromRadians: () => v3(),
        fromDegrees: () => v3(),
        magnitude: (a: { x: number; y: number; z: number }) => Math.hypot(a.x, a.y, a.z),
        normalize: (a: unknown) => a,
      },
    ),
    HeadingPitchRange: HPR,
    BoundingSphere: class {
      constructor(
        public c: unknown,
        public r: number,
      ) {}
    },
    Rectangle: { fromDegrees: () => "rect" },
    Math: { toRadians: (d: number) => (d * Math.PI) / 180 },
    Matrix4: {
      IDENTITY: "I",
      multiplyByPointAsVector: (_m: unknown, p: { x: number; y: number; z: number }) => ({ ...p }),
    },
    Transforms: { eastNorthUpToFixedFrame: () => "enu" },
  };
  return { C, viewer, camera };
}

const FRAMING = { lon: 101.5, lat: 3.2, range_m: 1200, pitchDeg: -35 };
const BBOX: [number, number, number, number] = [101.46, 3.15, 101.53, 3.24];
const make = (f: ReturnType<typeof fakes>, onUserMove?: () => void) =>
  createCameraOps(
    f.C as never,
    f.viewer as never,
    () => FRAMING,
    () => BBOX,
    onUserMove,
  );

describe("createCameraOps", () => {
  it("orbit looks at the pivot with the orbitStep result (pitch clamped)", () => {
    const f = fakes();
    make(f).orbit(0.2, 5);
    const want = orbitStep({ heading: 1, pitch: -0.6, range: 1000 }, 0.2, 5);
    const hpr = f.camera.lookAt.mock.calls[0]?.[1] as HPR;
    expect(hpr.heading).toBeCloseTo(want.heading);
    expect(hpr.pitch).toBe(LIMITS.maxPitchRad);
    expect(hpr.range).toBeCloseTo(want.range);
    expect(f.viewer.scene.requestRender).toHaveBeenCalled();
  });

  it("move shifts the camera by a distance proportional to its height", () => {
    const f = fakes();
    make(f).move(0, 1);
    const d1 = f.camera.move.mock.calls[0]?.[1] as number;
    expect(d1).toBeGreaterThan(0);
    f.camera.positionCartographic.height = 1600;
    make(f).move(0, 1);
    expect(f.camera.move.mock.calls[1]?.[1]).toBeCloseTo(d1 * 2);
  });

  it("faceNorth turns the heading by minus the current heading", () => {
    const f = fakes();
    make(f).faceNorth();
    const hpr = f.camera.lookAt.mock.calls[0]?.[1] as HPR;
    expect(hpr.heading).toBeCloseTo(0);
  });

  it("every action reports a user move", () => {
    const f = fakes();
    const moved = vi.fn();
    const ops = make(f, moved);
    ops.orbit(0, 0);
    ops.move(1, 0);
    ops.zoom(0.5);
    ops.faceNorth();
    ops.home();
    ops.whole();
    ops.glideTo({ x: 1, y: 1 } as never);
    expect(moved).toHaveBeenCalledTimes(7);
  });

  it("glideTo flies to the clicked point at half the distance, keeping heading", () => {
    const f = fakes();
    make(f).glideTo({ x: 10, y: 10 } as never);
    expect(f.camera.pickEllipsoid).toHaveBeenCalledWith({ x: 10, y: 10 });
    const [sphere, o] = f.camera.flyToBoundingSphere.mock.calls[0] as unknown as [
      unknown,
      { offset: HPR; duration: number },
    ];
    expect(sphere).toBeDefined();
    expect(o.offset.heading).toBe(1);
    expect(o.offset.pitch).toBe(-0.6);
    expect(o.offset.range).toBe(500);
    expect(o.duration).toBe(0.8);
  });

  it("glideTo never goes below the minimum range", () => {
    const f = fakes();
    f.camera.position = v3(0, 0, 40);
    make(f).glideTo({ x: 1, y: 1 } as never);
    const o = f.camera.flyToBoundingSphere.mock.calls[0]?.[1] as unknown as { offset: HPR };
    expect(o.offset.range).toBe(LIMITS.minRangeM);
  });

  it("glideTo on the sky falls back to zooming about the centre", () => {
    const f = fakes({ hit: false });
    make(f).glideTo({ x: 1, y: 1 } as never);
    expect(f.camera.flyToBoundingSphere).not.toHaveBeenCalled();
    expect(f.camera.lookAt).toHaveBeenCalledTimes(1);
  });
});
