// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScene } from "../sceneStore";
import { useCameraIntents } from "./camera";

const viewer = {
  isDestroyed: () => false,
  camera: { viewBoundingSphere: vi.fn(), flyToBoundingSphere: vi.fn() },
  scene: { requestRender: vi.fn() },
};
vi.mock("resium", () => ({ useCesium: () => ({ viewer }) }));

const ROUTE = {
  id: "r1",
  geojson: {
    type: "LineString" as const,
    coordinates: [
      [101.5, 3.2],
      [101.51, 3.21],
    ],
  },
};
const focusPoint = (id: string): [number, number] | null => (id === "p1" ? [101.5, 3.2] : null);

beforeEach(() => {
  useScene.getState().reset();
  viewer.camera.viewBoundingSphere.mockClear();
  viewer.camera.flyToBoundingSphere.mockClear();
});

describe("useCameraIntents on mount (style switch re-frames on the current focus)", () => {
  it("jumps to a route already in the store, and marks the camera as moved", () => {
    useScene.setState({ route: ROUTE });
    const onMoved = vi.fn();
    renderHook(() => useCameraIntents(focusPoint, onMoved));
    expect(viewer.camera.viewBoundingSphere).toHaveBeenCalledTimes(1);
    expect(viewer.camera.flyToBoundingSphere).not.toHaveBeenCalled();
    expect(onMoved).toHaveBeenCalledTimes(1);
  });

  it("jumps to the focused place, else the last camera.fly_to", () => {
    useScene.setState({ focusPlaceId: "p1" });
    const a = renderHook(() => useCameraIntents(focusPoint));
    expect(viewer.camera.viewBoundingSphere).toHaveBeenCalledTimes(1);
    expect(viewer.camera.viewBoundingSphere.mock.calls[0]?.[1].range).toBe(400);
    a.unmount();
    useScene.setState({ focusPlaceId: null, camera: { center: [101.5, 3.2], rangeM: 900 } });
    renderHook(() => useCameraIntents(focusPoint));
    expect(viewer.camera.viewBoundingSphere).toHaveBeenCalledTimes(2);
    expect(viewer.camera.viewBoundingSphere.mock.calls[1]?.[1].range).toBe(900);
  });

  it("leaves the camera alone when no intent stands, then follows new intents", () => {
    const onMoved = vi.fn();
    renderHook(() => useCameraIntents(focusPoint, onMoved));
    expect(viewer.camera.viewBoundingSphere).not.toHaveBeenCalled();
    expect(onMoved).not.toHaveBeenCalled();
    act(() => useScene.setState({ route: ROUTE }));
    // jsdom has no matchMedia, so no reduced motion: a new intent flies.
    expect(viewer.camera.flyToBoundingSphere).toHaveBeenCalledTimes(1);
    expect(viewer.camera.viewBoundingSphere).not.toHaveBeenCalled();
    expect(onMoved).toHaveBeenCalledTimes(1);
  });
});
