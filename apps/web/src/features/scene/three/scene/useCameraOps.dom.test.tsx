// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LonLat } from "../../geo";
import { useScene } from "../../sceneStore";
import { BOOKMARKS, DEFAULT_BOOKMARK } from "../bookmarks";
import type { Pose } from "../cameraRig";
import type { Engine } from "../engine";
import { createFrame } from "../frame";
import { useCameraOps } from "./useCameraOps";

const frame = createFrame([101.5, 3.2]);
const places = new Map<string, LonLat>([["p1", [101.505, 3.205]]]);
// Stable across renders: a fresh ref each render would re-run the ops effect forever.
const hostRef = { current: null };

function fakeEngine() {
  const rig = { set: vi.fn((_p: Pose) => {}), flyTo: vi.fn(), get: vi.fn() };
  return { rig, setViewOffset: vi.fn() } as unknown as Engine & { rig: typeof rig };
}

function mount(engine: Engine) {
  return renderHook(() => useCameraOps({ engine, frame, bbox: undefined, places, hostRef }));
}

const firstPose = (e: ReturnType<typeof fakeEngine>) => e.rig.set.mock.calls[0]?.[0] as Pose;

beforeEach(() => {
  useScene.getState().reset();
  history.replaceState(null, "", "/");
});

describe("useCameraOps on mount (style switch re-frames on the current focus)", () => {
  it("opens on the start bookmark when no intent stands", () => {
    const e = fakeEngine();
    mount(e);
    const b = BOOKMARKS[DEFAULT_BOOKMARK];
    expect(e.rig.set).toHaveBeenCalledTimes(1);
    expect(firstPose(e).rangeM).toBe(b.rangeM);
    expect(firstPose(e).target).toEqual(frame.toLocal(b.centre[0], b.centre[1]));
  });

  it("opens on a route already in the store", () => {
    useScene.setState({
      route: {
        id: "r1",
        geojson: {
          type: "LineString",
          coordinates: [
            [101.5, 3.2],
            [101.51, 3.21],
          ],
        },
      },
    });
    const e = fakeEngine();
    mount(e);
    expect(e.rig.set).toHaveBeenCalledTimes(1);
    expect(firstPose(e).target).toEqual(frame.toLocal(101.505, 3.205));
    expect(firstPose(e).pitchDeg).toBe(-45);
    expect(e.rig.flyTo).not.toHaveBeenCalled();
  });

  it("opens on the focused place, else the last camera.fly_to", () => {
    useScene.setState({ focusPlaceId: "p1" });
    const a = fakeEngine();
    mount(a);
    expect(firstPose(a).target).toEqual(frame.toLocal(101.505, 3.205));
    expect(firstPose(a).rangeM).toBe(400);

    useScene.setState({ focusPlaceId: null, camera: { center: [101.51, 3.21], rangeM: 900 } });
    const b = fakeEngine();
    mount(b);
    expect(firstPose(b).target).toEqual(frame.toLocal(101.51, 3.21));
    expect(firstPose(b).rangeM).toBe(900);
  });
});
