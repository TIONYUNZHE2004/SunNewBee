// @vitest-environment jsdom
import { act } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, newQueryClient, renderWithClient, stubFetch } from "../../../test/helpers";

// A fake viewer so SceneSetup's effects really run: the billable-tiles guard sits in one of them.
const viewer = {
  isDestroyed: () => false,
  scene: { canvas: {}, requestRender: () => {} },
  camera: { frustum: {} },
  canvas: { clientWidth: 800, clientHeight: 600 },
};
const setupRealistic = vi.fn((..._a: unknown[]) => () => {});

vi.mock("cesium", () => ({
  PerspectiveFrustum: class {},
  Camera: class {},
  GroundPolylinePrimitive: { isSupported: () => true },
  ScreenSpaceEventHandler: class {
    setInputAction() {}
    destroy() {}
  },
  ScreenSpaceEventType: { LEFT_CLICK: 0 },
  Math: { toRadians: (d: number) => d },
  Entity: class {},
}));
vi.mock("resium", () => ({
  Viewer: ({ children }: { children?: ReactNode }) => <div data-testid="viewer">{children}</div>,
  useCesium: () => ({ viewer }),
}));
vi.mock("./realistic", () => ({ setupRealistic: (...a: unknown[]) => setupRealistic(...a) }));
vi.mock("./frustumClone", () => ({ patchFrustumClone: () => {}, patchCameraPickRay: () => {} }));
vi.mock("./layers", () => ({
  AccessLayer: () => null,
  FloodLayer: () => null,
  WasteLayer: () => null,
}));
vi.mock("./PerfOverlay", () => ({ PerfOverlay: () => null, SlowBanner: () => null }));
vi.mock("./camera", () => ({ useCameraIntents: () => {} }));
vi.mock("./timeOfDay", () => ({ applyCesiumTime: () => {}, cesiumTimeStyle: () => ({}) }));
vi.mock("./controls/CameraControls", () => ({
  CameraControls: () => null,
  handleMapKey: () => {},
}));
vi.mock("./controls/cameraOps", () => ({ createCameraOps: () => ({}), frameNow: () => {} }));
vi.mock("./controls/configureControls", () => ({ configureControls: () => () => {} }));
vi.mock("./controls/cameraHeadingStore", () => ({ trackHeading: () => () => {} }));
vi.mock("./controls/movedInputs", () => ({ movedInputs: () => [] }));

const BUILDINGS = {
  attribution: [],
  buildings: { type: "FeatureCollection", features: [{ type: "Feature" }] },
  trees: { type: "FeatureCollection", features: [] },
};

beforeEach(() => {
  setupRealistic.mockClear();
  stubFetch(() => json({ detail: "not found" }, 404));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

async function mount(style: "realistic" | "stylised" | null, buildings: boolean) {
  const { useScene } = await import("../sceneStore");
  useScene.getState().reset();
  if (style) useScene.getState().setMapStyle(style);
  const qc = newQueryClient();
  qc.setQueryData(["buildings"], buildings ? BUILDINGS : null);
  const { default: CesiumScene } = await import("./CesiumScene");
  renderWithClient(<CesiumScene />, qc);
  await act(async () => {});
}

describe("CesiumScene billable tiles guard", () => {
  it("never calls setupRealistic for the Stylised style", async () => {
    await mount("stylised", true);
    expect(setupRealistic).not.toHaveBeenCalled();
  });

  it("never calls setupRealistic for the unchosen default on a world with buildings", async () => {
    await mount(null, true);
    expect(setupRealistic).not.toHaveBeenCalled();
  });

  it("calls setupRealistic once for Realistic (the guard is live, not vacuous)", async () => {
    await mount("realistic", false);
    expect(setupRealistic).toHaveBeenCalledTimes(1);
    expect(setupRealistic.mock.calls[0]?.[1]).toBe(viewer);
  });
});
