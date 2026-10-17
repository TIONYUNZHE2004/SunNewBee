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
const fade = vi.fn();
const buildPoolLayer = vi.fn();
const setVisible = vi.fn();
const reskinPalette = vi.fn();

beforeEach(async () => {
  viewer = fakeViewer();
  for (const m of [buildProps, fade, buildPoolLayer, setVisible, reskinPalette]) m.mockReset();
  buildPoolLayer.mockImplementation(() => ({ setPalette: vi.fn(), destroy: vi.fn() }));
  buildProps.mockImplementation(() => ({
    setPalette: vi.fn(),
    setTime: vi.fn(),
    destroy: vi.fn(),
  }));
  vi.resetModules();
  vi.doMock("resium", () => ({ useCesium: () => ({ viewer }) }));
  vi.doMock("./ground", async (orig) => ({
    ...(await orig<typeof import("./ground")>()),
    buildGround: () => ({ setPalette: vi.fn(), setTime: vi.fn(), fade, destroy: vi.fn() }),
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
    streetLamps: () => [{ lon: 101.5, lat: 3.18 }],
  }));
  vi.doMock("./groundImagery", () => ({ buildPoolLayer }));
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
    "./groundImagery",
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

  it("light pools are an imagery layer on the scene, not a prop; none on the Low tier", async () => {
    await mount();
    await waitFor(() => expect(buildPoolLayer).toHaveBeenCalled());
    const call = buildPoolLayer.mock.calls.at(-1) as unknown[];
    expect(call[1]).toBe(viewer.scene);
    expect(call[2]).toEqual([{ lon: 101.5, lat: 3.18 }]);
    expect(buildProps.mock.calls.at(-1)).toHaveLength(3); // (Cesium, options, primitives)
    const { useSceneSettings } = await import("../../sceneSettingsStore");
    const last = buildPoolLayer.mock.results.at(-1);
    const destroy = (last!.value as { destroy: () => void }).destroy;
    await act(async () => useSceneSettings.setState({ quality: "low" }));
    expect(destroy).toHaveBeenCalled();
  });

  it("a pool layer built mid-fade starts from the palette on screen, not the target", async () => {
    await mount();
    await waitFor(() => expect(buildPoolLayer).toHaveBeenCalled());
    const { useTheme } = await import("../../../../ui/theme");
    const { paletteFor } = await import("./palette");
    const from = useTheme.getState().theme;
    const target = from === "day" ? "night" : "day";
    const { useSceneSettings } = await import("../../sceneSettingsStore");
    // Fade frames driven by hand: a queued requestAnimationFrame and a stubbed clock.
    const frames: FrameRequestCallback[] = [];
    let clock = 1000;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      await act(async () => useTheme.getState().setChoice(target));
      clock += 300; // 300 ms into a 2-3 s fade
      act(() => {
        for (const cb of frames.splice(0)) cb(clock);
      });
      await act(async () => useSceneSettings.setState({ quality: "low" }));
      await act(async () => useSceneSettings.setState({ quality: "medium" }));
    } finally {
      now.mockRestore();
      vi.unstubAllGlobals();
    }
    const built = (buildPoolLayer.mock.calls.at(-1) as unknown[])[3] as { glow: number };
    expect(built).not.toEqual(paletteFor(target));
    expect(built).not.toEqual(paletteFor(from));
  });

  it("a theme change fades the ground decals towards the new palette, ending at t = 1", async () => {
    // Reduced motion: the crossfade applies the target once (no 2 s frame loop in the test).
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    try {
      await mount();
      await waitFor(() => expect(buildProps).toHaveBeenCalled()); // ground and props are built
      const { useTheme } = await import("../../../../ui/theme");
      const target = useTheme.getState().theme === "day" ? "night" : "day";
      fade.mockClear();
      await act(async () => useTheme.getState().setChoice(target));
      const { paletteFor } = await import("./palette");
      expect(fade.mock.calls).toEqual([[paletteFor(target), 1]]);
    } finally {
      vi.unstubAllGlobals();
    }
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
