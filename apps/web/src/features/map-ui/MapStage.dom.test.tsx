// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, newQueryClient, renderWithClient, stubFetch } from "../../test/helpers";

// The 3D renderer crashes on mount; the integration under test is what MapStage shows next.
vi.mock("../scene/three/ThreeScene", () => ({
  default: () => {
    if (globalThis.__threeOk) return <div data-testid="three-scene" />;
    throw new Error("WebGL context lost");
  },
}));
vi.mock("../scene/cesium/CesiumScene", () => ({
  default: () => <div data-testid="cesium-scene" />,
}));
vi.mock("../scene/mapbox/MapboxLite", () => ({ default: () => <div data-testid="mapbox" /> }));
vi.mock("../scene/list/ListView", () => ({ ListView: () => <div data-testid="list-view" /> }));

const BUILDINGS = {
  attribution: [],
  buildings: { type: "FeatureCollection", features: [{ type: "Feature" }] },
  trees: { type: "FeatureCollection", features: [] },
};

declare global {
  var __threeOk: boolean | undefined;
}

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  // MapStage keeps a once-per-page auto-select flag at module level: fresh modules per test.
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  HTMLCanvasElement.prototype.getContext = vi.fn((kind: string) =>
    kind === "webgl2" ? ({} as never) : null,
  ) as never;
  globalThis.__threeOk = false;
  history.replaceState(null, "", "/");
  localStorage.clear();
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

describe("MapStage renderer crash (Stylised, Three.js crashes)", () => {
  it("with Mapbox: falls back to Mapbox and says why", async () => {
    const useScene = await mount("pk.test");
    expect(await screen.findByTestId("mapbox")).toBeInTheDocument();
    expect(useScene.getState().rendererFailed).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The 3D map could not be shown on this device. Showing the 2D map instead.",
    );
    expect(screen.queryByTestId("list-view")).toBeNull();
    // Review Focus 2: a Three.js crash never falls back to Cesium Stylised.
    expect(screen.queryByTestId("cesium-scene")).toBeNull();
  });

  it("without Mapbox: falls back to the list and says why", async () => {
    const useScene = await mount("");
    expect(await screen.findByTestId("list-view")).toBeInTheDocument();
    expect(useScene.getState().rendererFailed).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The map could not be shown on this device. Showing the list instead.",
    );
    expect(screen.queryByTestId("cesium-scene")).toBeNull();
    expect(screen.queryByTestId("mapbox")).toBeNull();
  });
});

describe("MapStage Stylised renderer", () => {
  it("ignores a stale tl.engine=cesium and ?engine=cesium: renders Three.js and drops the key", async () => {
    globalThis.__threeOk = true;
    localStorage.setItem("tl.engine", "cesium");
    history.replaceState(null, "", "/?engine=cesium");
    await mount("");
    expect(await screen.findByTestId("three-scene")).toBeInTheDocument();
    expect(screen.queryByTestId("cesium-scene")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Experimental 3D engine/)).toBeNull();
    expect(localStorage.getItem("tl.engine")).toBeNull();
  });
});

/** A Google key and a buildings request that settles only when the test says so. */
async function mountKeyedUnsettled(opts: { chooseRealistic?: boolean } = {}) {
  let settle: (r: Response) => void = () => {};
  const pending = new Promise<Response>((res) => {
    settle = res;
  });
  stubFetch((url) => (url.includes("/layers/buildings") ? pending : json({ detail: "x" }, 404)));
  const { ENV } = await import("../../lib/env");
  ENV.googleKey = "test";
  ENV.cesiumToken = "";
  ENV.mapboxToken = "";
  const { MapStage } = await import("./MapStage");
  const { useScene } = await import("../scene/sceneStore");
  useScene.getState().reset();
  if (opts.chooseRealistic) useScene.getState().setMapStyle("realistic");
  const qc = newQueryClient();
  qc.setQueryData(["scenarios"], []);
  renderWithClient(<MapStage />, qc);
  await act(async () => {});
  return { settle, useScene };
}

describe("MapStage first load with a map key (review I1)", () => {
  it("waits for the buildings layer, then mounts Three.js only (Cesium never mounts)", async () => {
    globalThis.__threeOk = true;
    const { settle } = await mountKeyedUnsettled();
    expect(screen.getByText("Loading the township")).toBeInTheDocument();
    expect(screen.queryByTestId("cesium-scene")).toBeNull();
    expect(screen.queryByTestId("three-scene")).toBeNull();
    await act(async () => settle(json(BUILDINGS)));
    expect(await screen.findByTestId("three-scene")).toBeInTheDocument();
    expect(screen.queryByTestId("cesium-scene")).toBeNull();
  });

  it("waits, then mounts Cesium when the world has no buildings (Realistic default)", async () => {
    globalThis.__threeOk = true;
    const { settle } = await mountKeyedUnsettled();
    expect(screen.queryByTestId("cesium-scene")).toBeNull();
    expect(screen.queryByTestId("three-scene")).toBeNull();
    await act(async () => settle(json({ detail: "none" }, 404)));
    expect(await screen.findByTestId("cesium-scene")).toBeInTheDocument();
    expect(screen.queryByTestId("three-scene")).toBeNull();
  });

  it("a chosen Realistic style goes straight to Cesium without waiting", async () => {
    globalThis.__threeOk = true;
    await mountKeyedUnsettled({ chooseRealistic: true });
    expect(await screen.findByTestId("cesium-scene")).toBeInTheDocument();
    expect(screen.queryByTestId("three-scene")).toBeNull();
  });
});
