// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newQueryClient, renderWithClient } from "../../../../test/helpers";
import { fakeCesium } from "./fakeCesium.test-util";
import { paletteFor } from "./palette";
import { buildProps, type PropsCesium } from "./props";
import { StylisedCity } from "./StylisedCity";

// The real renderer needs WebGL; the integration under test is which view and style get chosen.
vi.mock("../CesiumScene", () => ({ default: () => <div data-testid="cesium-scene" /> }));
vi.mock("resium", () => ({ useCesium: () => ({ viewer: undefined }) }));

const BUILDINGS = {
  attribution: [],
  buildings: { type: "FeatureCollection", features: [{ type: "Feature" }] },
  trees: { type: "FeatureCollection", features: [] },
};

// Just enough viewer for applyStylisedLook (the fake primitives collections are mocked per test).
const FAKE_VIEWER = {
  isDestroyed: () => false,
  scene: {
    imageryLayers: { length: 0, get: () => undefined },
    globe: { baseColor: { clone: () => ({}) } },
    backgroundColor: { clone: () => ({}) },
    fog: { density: 0 },
    primitives: {},
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

let webgl = true;
const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  webgl = true;
  // MapStage keeps a once-per-page auto-select flag at module level: fresh modules per test.
  vi.resetModules();
  HTMLCanvasElement.prototype.getContext = vi.fn((kind: string) =>
    kind === "webgl2" && webgl ? ({} as never) : null,
  ) as never;
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

/** MapStage + the settings popover in a keyless env (as e2e), with the buildings cache seeded. */
async function mount(buildings: unknown) {
  const { ENV } = await import("../../../../lib/env");
  ENV.googleKey = "";
  ENV.cesiumToken = "";
  ENV.mapboxToken = "";
  const { MapStage } = await import("../../../map-ui/MapStage");
  const { SettingsPopover } = await import("../../../map-ui/SettingsPopover");
  const { useScene } = await import("../../sceneStore");
  useScene.getState().reset();
  const qc = newQueryClient();
  qc.setQueryData(["buildings"], buildings);
  qc.setQueryData(["scenarios"], []);
  renderWithClient(
    <MapStage>
      <SettingsPopover />
    </MapStage>,
    qc,
  );
  return useScene;
}

async function mapStyleGroup() {
  await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
  return screen.getByRole("radiogroup", { name: "Map style" });
}

describe("stylised city integration", () => {
  it("no buildings (API 404 -> null): view unchanged (list), no Stylised option enabled", async () => {
    const useScene = await mount(null);
    await waitFor(() => expect(screen.getByText(/3D map couldn't load/i)).toBeInTheDocument());
    expect(useScene.getState().view).toBe("list");
    expect(useScene.getState().mapStyle).toBe("realistic");
    expect(screen.queryByTestId("cesium-scene")).toBeNull();
    const g = await mapStyleGroup();
    for (const r of within(g).getAllByRole("radio")) {
      expect(r).toBeDisabled();
      expect(r).toHaveAttribute("aria-checked", "false"); // nothing claims to be shown
    }
    expect(screen.getByText("Needs building data")).toBeVisible();
  });

  it("buildings + WebGL, keyless: the 3D view with Stylised selected by default", async () => {
    const useScene = await mount(BUILDINGS);
    expect(await screen.findByTestId("cesium-scene")).toBeInTheDocument();
    expect(useScene.getState().view).toBe("cesium");
    expect(useScene.getState().mapStyle).toBe("stylised");
    expect(useScene.getState().mapStyleChosen).toBe(false);
    const g = await mapStyleGroup();
    expect(within(g).getByRole("radio", { name: "Stylised" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("Decorative details are illustrative.")).toBeVisible();
  });

  it("buildings but no WebGL: Map style radios disabled, none checked, no illustrative note", async () => {
    webgl = false;
    await mount(BUILDINGS);
    await waitFor(() => expect(screen.getByText(/3D map couldn't load/i)).toBeInTheDocument());
    const g = await mapStyleGroup();
    for (const r of within(g).getAllByRole("radio")) {
      expect(r).toBeDisabled();
      expect(r).toHaveAttribute("aria-checked", "false");
    }
    expect(screen.getAllByText("Needs a 3D-capable device").length).toBeGreaterThan(0);
    expect(screen.queryByText("Decorative details are illustrative.")).toBeNull();
  });

  it("a crashed 3D renderer (list fallback) also disables the style radios", async () => {
    const useScene = await mount(BUILDINGS);
    expect(await screen.findByTestId("cesium-scene")).toBeInTheDocument();
    await act(async () => useScene.getState().setRendererFailed(true));
    const g = await mapStyleGroup();
    for (const r of within(g).getAllByRole("radio")) expect(r).toBeDisabled();
    expect(screen.queryByText("Decorative details are illustrative.")).toBeNull();
  });

  it("buildings never beat a missing WebGL", async () => {
    webgl = false;
    const useScene = await mount(BUILDINGS);
    await waitFor(() => expect(screen.getByText(/3D map couldn't load/i)).toBeInTheDocument());
    expect(useScene.getState().view).toBe("list");
  });

  it("a user's choice is never overridden by the default rule", async () => {
    const { useScene } = await import("../../sceneStore");
    useScene.getState().reset();
    useScene.getState().setMapStyle("realistic");
    await act(async () => useScene.getState().applyDefaultMapStyle(true, false));
    expect(useScene.getState().mapStyle).toBe("realistic");
  });
});

describe("decorative props honesty", () => {
  it("props are never pickable and carry no pick id", () => {
    const f = fakeCesium();
    buildProps(f.C as unknown as PropsCesium, {
      trees: [{ lon: 101.5, lat: 3.18, h: 8 }],
      cars: [{ lon: 101.5, lat: 3.181, headingRad: 0, tone: 0 }],
      palette: paletteFor("night"),
    });
    expect(f.primitives.length).toBeGreaterThan(0);
    for (const p of f.primitives) {
      expect(p.options.allowPicking).toBe(false);
      for (const i of p.options.geometryInstances as { options?: { id?: unknown } }[])
        expect(i.options?.id).toBeUndefined();
    }
  });

  it("the stylised city adds nothing to the DOM / accessibility tree", () => {
    const qc = newQueryClient();
    qc.setQueryData(["buildings"], BUILDINGS);
    const { container } = renderWithClient(<StylisedCity />, qc);
    expect(container.innerHTML).toBe("");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("water given to buildGround comes from the buildings layer, never from scenario data", async () => {
    const ring = (x: number) => [
      [x, 3.18],
      [x + 0.001, 3.18],
      [x + 0.001, 3.181],
      [x, 3.18],
    ];
    const poly = (x: number) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring(x)] },
      properties: {},
    });
    const baseWater = { type: "FeatureCollection", features: [poly(101.5)] };
    const scenarioWater = { type: "FeatureCollection", features: [poly(101.9)] };
    const buildGround = vi.fn(() => ({ setTheme: vi.fn(), destroy: vi.fn() }));
    vi.resetModules();
    vi.doMock("resium", () => ({ useCesium: () => ({ viewer: FAKE_VIEWER }) }));
    vi.doMock("./ground", async (orig) => ({
      ...(await orig<typeof import("./ground")>()),
      buildGround,
    }));
    vi.doMock("./buildingsPrimitive", () => ({
      buildBuildingPrimitives: () => ({ primitives: [], setTheme: vi.fn(), destroy: vi.fn() }),
    }));
    vi.doMock("./props", () => ({
      buildProps: () => ({ setTheme: vi.fn(), destroy: vi.fn() }),
      kerbCars: () => [],
      streetTrees: () => [],
    }));
    vi.doMock("./reskin", () => ({ reskin: vi.fn() }));
    const { StylisedCity: City } = await import("./StylisedCity");
    const qc = newQueryClient();
    qc.setQueryData(["buildings"], { ...BUILDINGS, water: baseWater });
    qc.setQueryData(["scenario", "stage_p3m"], scenarioWater);
    qc.setQueryData(["layer", "access", "default", null], {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: ring(101.5).slice(0, 2) },
          properties: { id: "r", type: "street" },
        },
      ],
    });
    // Flood scenario selected: its water must not leak into the stylised ground.
    (await import("../../sceneStore")).useScene.getState().setScenario("stage_p3m");
    renderWithClient(<City />, qc);
    await waitFor(() => expect(buildGround).toHaveBeenCalled());
    const calls = buildGround.mock.calls as unknown as [
      unknown,
      unknown,
      { water: unknown[][][] },
    ][];
    for (const c of calls) {
      expect(c[2].water).toHaveLength(1);
      expect(c[2].water[0]![0]![0]).toEqual([101.5, 3.18]); // the buildings-layer polygon, not 101.9
    }
    vi.doUnmock("resium");
    vi.doUnmock("./ground");
    vi.doUnmock("./buildingsPrimitive");
    vi.doUnmock("./props");
    vi.doUnmock("./reskin");
  });
});
