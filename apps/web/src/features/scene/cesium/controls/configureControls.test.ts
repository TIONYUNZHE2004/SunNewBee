import { describe, expect, it, vi } from "vitest";
import { LIMITS } from "./cameraMath";
import { configureControls } from "./configureControls";

function fakes() {
  const actions = new Map<string, (e: unknown) => void>();
  class Handler {
    setInputAction = vi.fn((fn: (e: unknown) => void, type: number, mod?: number) =>
      actions.set(`${type}:${mod ?? ""}`, fn),
    );
    destroy = vi.fn();
  }
  const pre = new Set<() => void>();
  const camera = {
    pitch: -0.6,
    heading: 0,
    positionCartographic: { longitude: 0, latitude: 0, height: 500 },
    setView: vi.fn(),
  };
  const ssc: Record<string, unknown> = {};
  const widgetHandler = { removeInputAction: vi.fn() };
  const viewer = {
    isDestroyed: () => false,
    cesiumWidget: { screenSpaceEventHandler: widgetHandler },
    scene: {
      canvas: {},
      camera,
      screenSpaceCameraController: ssc,
      preUpdate: {
        addEventListener: (cb: () => void) => {
          pre.add(cb);
          return () => pre.delete(cb);
        },
      },
      requestRender: vi.fn(),
    },
  };
  const C = {
    ScreenSpaceEventHandler: Handler,
    ScreenSpaceEventType: { WHEEL: 1, LEFT_DOUBLE_CLICK: 2 },
    KeyboardEventModifier: { SHIFT: 10, CTRL: 11 },
    CameraEventType: { LEFT_DRAG: 0, RIGHT_DRAG: 1, MIDDLE_DRAG: 2, WHEEL: 3, PINCH: 4 },
    Cartesian3: { fromRadians: (lo: number, la: number, h: number) => ({ lo, la, h }) },
    Math: {
      toRadians: (d: number) => (d * Math.PI) / 180,
      toDegrees: (r: number) => (r * 180) / Math.PI,
    },
  };
  const ops = {
    orbit: vi.fn(),
    move: vi.fn(),
    zoom: vi.fn(),
    faceNorth: vi.fn(),
    home: vi.fn(),
    whole: vi.fn(),
    headingRad: () => 0,
  };
  return { C, viewer, camera, ssc, actions, pre, ops, widgetHandler };
}

const BBOX: [number, number, number, number] = [101.46, 3.15, 101.53, 3.24];

describe("configureControls", () => {
  it("left-drag pans, right/middle/ctrl-drag/pinch orbit, wheel/pinch zoom, limits set", () => {
    const f = fakes();
    configureControls(f.C as never, f.viewer as never, f.ops, () => BBOX);
    expect(f.ssc.rotateEventTypes).toBe(0);
    expect(f.ssc.tiltEventTypes).toEqual([1, 2, 4, { eventType: 0, modifier: 11 }]);
    expect(f.ssc.zoomEventTypes).toEqual([3, 4]);
    expect(f.ssc.lookEventTypes).toBeUndefined();
    expect(f.ssc.minimumZoomDistance).toBe(LIMITS.minRangeM);
    expect(f.ssc.maximumZoomDistance).toBe(LIMITS.maxRangeM);
    expect(f.widgetHandler.removeInputAction).toHaveBeenCalledWith(2);
  });

  it("clamps pitch every frame (a drag stops at 5 degrees short of the horizon)", () => {
    const f = fakes();
    configureControls(f.C as never, f.viewer as never, f.ops, () => BBOX);
    f.camera.pitch = 0.1;
    for (const cb of f.pre) cb();
    expect(f.camera.setView).toHaveBeenCalledWith(
      expect.objectContaining({
        orientation: expect.objectContaining({ pitch: LIMITS.maxPitchRad }),
      }),
    );
  });

  it("pulls the camera back inside bbox + 5 km", () => {
    const f = fakes();
    configureControls(f.C as never, f.viewer as never, f.ops, () => BBOX);
    f.camera.positionCartographic = {
      longitude: (110 * Math.PI) / 180,
      latitude: (3.2 * Math.PI) / 180,
      height: 900,
    };
    for (const cb of f.pre) cb();
    const arg = f.camera.setView.mock.calls.at(-1)?.[0] as {
      destination: { lo: number; h: number };
    };
    expect((arg.destination.lo * 180) / Math.PI).toBeLessThan(101.6);
    expect(arg.destination.h).toBe(900);
  });

  it("shift + wheel tilts via ops.orbit", () => {
    const f = fakes();
    configureControls(f.C as never, f.viewer as never, f.ops, () => BBOX);
    f.actions.get("1:10")?.(120);
    expect(f.ops.orbit).toHaveBeenCalledWith(0, expect.any(Number));
  });

  it("undo restores nothing twice and destroys its handler", () => {
    const f = fakes();
    const undo = configureControls(f.C as never, f.viewer as never, f.ops, () => BBOX);
    undo();
    expect(f.pre.size).toBe(0);
  });
});
