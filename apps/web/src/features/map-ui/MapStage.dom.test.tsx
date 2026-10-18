// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newQueryClient, renderWithClient } from "../../test/helpers";

// The 3D renderer crashes on mount; the integration under test is what MapStage shows next.
vi.mock("../scene/cesium/CesiumScene", () => ({
  default: () => {
    throw new Error("WebGL context lost");
  },
}));
vi.mock("../scene/mapbox/MapboxLite", () => ({ default: () => <div data-testid="mapbox" /> }));
vi.mock("../scene/list/ListView", () => ({ ListView: () => <div data-testid="list-view" /> }));

const BUILDINGS = {
  attribution: [],
  buildings: { type: "FeatureCollection", features: [{ type: "Feature" }] },
  trees: { type: "FeatureCollection", features: [] },
};

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  // MapStage keeps a once-per-page auto-select flag at module level: fresh modules per test.
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  HTMLCanvasElement.prototype.getContext = vi.fn((kind: string) =>
    kind === "webgl2" ? ({} as never) : null,
  ) as never;
  history.replaceState(null, "", "/");
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
  vi.restoreAllMocks();
});

async function mount(mapboxToken: string) {
  const { ENV } = await import("../../lib/env");
  ENV.googleKey = "";
  ENV.cesiumToken = "";
  ENV.mapboxToken = mapboxToken;
  const { MapStage } = await import("./MapStage");
  const { useScene } = await import("../scene/sceneStore");
  useScene.getState().reset();
  const qc = newQueryClient();
  qc.setQueryData(["buildings"], BUILDINGS);
  qc.setQueryData(["scenarios"], []);
  renderWithClient(<MapStage />, qc);
  return useScene;
}

describe("MapStage renderer crash", () => {
  it("with Mapbox: falls back to Mapbox and says why", async () => {
    const useScene = await mount("pk.test");
    expect(await screen.findByTestId("mapbox")).toBeInTheDocument();
    expect(useScene.getState().rendererFailed).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The 3D map could not be shown on this device. Showing the 2D map instead.",
    );
    expect(screen.queryByTestId("list-view")).toBeNull();
  });

  it("without Mapbox: falls back to the list and says why", async () => {
    const useScene = await mount("");
    expect(await screen.findByTestId("list-view")).toBeInTheDocument();
    expect(useScene.getState().rendererFailed).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The map could not be shown on this device. Showing the list instead.",
    );
  });
});
