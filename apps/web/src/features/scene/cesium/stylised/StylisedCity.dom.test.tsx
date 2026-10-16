// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newQueryClient } from "../../../../test/helpers";

/** StylisedCity wiring with every Cesium-facing builder mocked: which options reach them, when. */

const BUILDINGS = {
  attribution: [],
  buildings: { type: "FeatureCollection", features: [{ type: "Feature" }] },
  trees: { type: "FeatureCollection", features: [] },
};

function fakeViewer() {
  const stage = () => ({ enabled: false, uniforms: {} });
  return {
    isDestroyed: () => false,
    shadows: false,
    resolutionScale: 1,
    useBrowserRecommendedResolution: true,
    container: document.createElement("div"),
    camera: { changed: { addEventListener: () => () => {} } },
    scene: {
      postProcessStages: { fxaa: stage(), ambientOcclusion: stage(), bloom: stage() },
      shadowMap: { softShadows: false, size: 1024, maximumDistance: 5000, darkness: 0.3 },
      imageryLayers: { length: 0, get: () => undefined },
      globe: { baseColor: { clone: () => ({}) }, shadows: 0 },
      backgroundColor: { clone: () => ({}) },
      fog: { density: 0 },
      primitives: {},
      groundPrimitives: {},
      // Fires once on the next tick (the first frame), as the real event does.
      postRender: {
        addEventListener: (cb: () => void) => {
          setTimeout(cb, 0);
          return () => {};
        },
      },
      requestRender: () => {},
    },
  };
}

let viewer = fakeViewer();
const buildProps = vi.fn();
const restack = vi.fn();
const setVisible = vi.fn();
const reskinPalette = vi.fn();

beforeEach(async () => {
  viewer = fakeViewer();
  for (const m of [buildProps, restack, setVisible, reskinPalette]) m.mockReset();
  buildProps.mockImplementation(() => ({
    setPalette: vi.fn(),
    setTime: vi.fn(),
    destroy: vi.fn(),
  }));
  vi.resetModules();
  vi.doMock("resium", () => ({ useCesium: () => ({ viewer }) }));
  vi.doMock("./ground", async (orig) => ({
    ...(await orig<typeof import("./ground")>()),
    buildGround: () => ({ setPalette: vi.fn(), setTime: vi.fn(), restack, destroy: vi.fn() }),
    roadsFromWalk: () => [{ id: "r", coords: [], widthM: 6, kind: "residential" }],
  }));
  vi.doMock("./buildingsPrimitive", () => ({
    buildBuildingPrimitives: () => ({
      primitives: [],
      setPalette: vi.fn(),
      setTime: vi.fn(),
      destroy: vi.fn(),
    }),
  }));
  vi.doMock("./props", () => ({
    buildProps,
    kerbCars: () => [],
    streetTrees: () => [{ lon: 101.5, lat: 3.18, h: 6, tier2: false }],
    streetLamps: () => [],
  }));
  vi.doMock("./reskin", () => ({ reskinPalette }));
  vi.doMock("./motion/sky", () => ({
    buildSky: () => ({ setPalette: vi.fn(), tick: vi.fn(), setVisible, destroy: vi.fn() }),
  }));
  const { useScene } = await import("../../sceneStore");
  useScene.getState().reset();
  const { useSceneSettings } = await import("../../sceneSettingsStore");
  useSceneSettings.setState({ quality: "medium", motion: false });
});
afterEach(() => {
  for (const m of [
    "resium",
    "./ground",
    "./buildingsPrimitive",
    "./props",
    "./reskin",
    "./motion/sky",
  ])
    vi.doUnmock(m);
});

async function mount() {
  const { StylisedCity } = await import("./StylisedCity");
  const qc = newQueryClient();
  qc.setQueryData(["buildings"], BUILDINGS);
  qc.setQueryData(["layer", "access", "default", null], {
    type: "FeatureCollection",
    features: [],
  });
  return render(
    <QueryClientProvider client={qc}>
      <StylisedCity />
    </QueryClientProvider>,
  );
}

describe("StylisedCity wiring", () => {
  it("Motion off builds still canopies; Motion on rebuilds them swaying", async () => {
    await mount();
    await waitFor(() => expect(buildProps).toHaveBeenCalled());
    const last = () => buildProps.mock.calls.at(-1) as unknown as [unknown, { sway: boolean }];
    expect(last()[1].sway).toBe(false);
    const { useSceneSettings } = await import("../../sceneSettingsStore");
    await act(async () => useSceneSettings.setState({ motion: true }));
    await waitFor(() => expect(last()[1].sway).toBe(true));
  });

  it("light pools go to the scene's ground collection and the ground is restacked under them", async () => {
    await mount();
    await waitFor(() => expect(buildProps).toHaveBeenCalled());
    const call = buildProps.mock.calls.at(-1) as unknown[];
    expect(call[3]).toBe(viewer.scene);
    expect(restack).toHaveBeenCalled();
  });

  it("clouds hide while a flood scenario or a route is shown", async () => {
    await mount();
    await waitFor(() => expect(setVisible).toHaveBeenCalled());
    expect(setVisible.mock.calls.at(-1)?.[1]).toBe(true);
    const { useScene } = await import("../../sceneStore");
    await act(async () => useScene.getState().setScenario("stage_p3m"));
    expect(setVisible.mock.calls.at(-1)?.[1]).toBe(false);
    await act(async () => useScene.getState().setScenario(null));
    expect(setVisible.mock.calls.at(-1)?.[1]).toBe(true);
    await act(async () =>
      useScene.setState({ route: { id: "r1", geojson: { type: "LineString", coordinates: [] } } }),
    );
    expect(setVisible.mock.calls.at(-1)?.[1]).toBe(false);
  });

  it("mount applies the shown palette once, with no fade loop", async () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    await mount();
    expect(reskinPalette).toHaveBeenCalledTimes(1);
    expect(reskinPalette.mock.calls[0]?.[5]).toBe(true);
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });

  it("unmount restores the viewer's own render settings (switching to Realistic)", async () => {
    const r = await mount();
    expect(viewer.useBrowserRecommendedResolution).toBe(false);
    expect(viewer.scene.postProcessStages.fxaa.enabled).toBe(true);
    r.unmount();
    expect(viewer.useBrowserRecommendedResolution).toBe(true);
    expect(viewer.resolutionScale).toBe(1);
    expect(viewer.scene.postProcessStages.fxaa.enabled).toBe(false);
    expect(viewer.scene.shadowMap).toEqual({
      softShadows: false,
      size: 1024,
      maximumDistance: 5000,
      darkness: 0.3,
    });
  });
});
