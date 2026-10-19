// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, newQueryClient, renderWithClient, stubFetch } from "../../../test/helpers";

// The Viewer renders its children so the overlays mount; no WebGL, so useCesium has no viewer.
vi.mock("resium", () => ({
  Viewer: ({ children }: { children?: ReactNode }) => <div data-testid="viewer">{children}</div>,
  useCesium: () => ({ viewer: undefined }),
  Entity: () => null,
  LabelGraphics: () => null,
  PointGraphics: () => null,
  PolygonGraphics: () => null,
  PolylineGraphics: () => null,
}));
vi.mock("./frustumClone", () => ({ patchFrustumClone: () => {}, patchCameraPickRay: () => {} }));
vi.mock("./DayLayer", () => ({ DayLayer: () => <div data-testid="day-layer" /> }));
vi.mock("./RolloutLayer", () => ({ RolloutLayer: () => <div data-testid="rollout-layer" /> }));
vi.mock("./PerfOverlay", () => ({
  PerfOverlay: () => <div data-testid="perf-overlay" />,
  SlowBanner: () => null,
}));
// The real overlay layers, each wrapped in a marker so the test can see it mounted.
vi.mock("./layers", async (importOriginal) => {
  const m = await importOriginal<typeof import("./layers")>();
  return {
    AccessLayer: () => (
      <div data-testid="access-layer">
        <m.AccessLayer />
      </div>
    ),
    FloodLayer: () => (
      <div data-testid="flood-layer">
        <m.FloodLayer />
      </div>
    ),
    WasteLayer: () => (
      <div data-testid="waste-layer">
        <m.WasteLayer />
      </div>
    ),
  };
});

const BUILDINGS = {
  attribution: [],
  buildings: { type: "FeatureCollection", features: [{ type: "Feature" }] },
  trees: { type: "FeatureCollection", features: [] },
};

beforeEach(() => {
  stubFetch(() => json({ detail: "not found" }, 404));
});

async function mount(style: "realistic" | "stylised", buildings: boolean) {
  const { useScene } = await import("../sceneStore");
  useScene.getState().reset();
  useScene.getState().setMapStyle(style);
  const qc = newQueryClient();
  if (buildings) qc.setQueryData(["buildings"], BUILDINGS);
  const { default: CesiumScene } = await import("./CesiumScene");
  const r = renderWithClient(<CesiumScene />, qc);
  await act(async () => {});
  return r;
}

describe("CesiumScene renders Realistic only", () => {
  // The first test pays for the cold import of the whole Cesium bundle.
  it("Realistic mounts the access, flood and waste overlays, the Day and Rollout layers and the perf overlay", async () => {
    await mount("realistic", false);
    for (const id of [
      "access-layer",
      "flood-layer",
      "waste-layer",
      "day-layer",
      "rollout-layer",
      "perf-overlay",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    const map = screen.getByRole("region", { name: /3D map/ });
    expect(map.style.background).toBe("");
  }, 60_000);

  it("ignores a Stylised style: no stylised sky behind the viewer", async () => {
    await mount("stylised", true);
    const map = screen.getByRole("region", { name: /3D map/ });
    expect(map.style.background).toBe("");
    expect(screen.getByTestId("access-layer")).toBeInTheDocument();
  }, 60_000);
});
