// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newQueryClient, renderWithClient } from "../../../../test/helpers";
import { fakeCesium } from "./fakeCesium.test-util";
import { paletteFor } from "./palette";
import { buildProps, type PropsCesium } from "./props";
import { StylisedCity } from "./StylisedCity";
import stylisedCitySource from "./StylisedCity.tsx?raw";

// The real renderer needs WebGL; the integration under test is which view and style get chosen.
vi.mock("../CesiumScene", () => ({ default: () => <div data-testid="cesium-scene" /> }));
vi.mock("resium", () => ({ useCesium: () => ({ viewer: undefined }) }));

const BUILDINGS = {
  attribution: [],
  buildings: { type: "FeatureCollection", features: [{ type: "Feature" }] },
  trees: { type: "FeatureCollection", features: [] },
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

  it("base water is documented as decorative, never a flood scenario", () => {
    expect(stylisedCitySource).toMatch(/Decorative base water/);
    expect(stylisedCitySource).toMatch(/NOT\s+\*?\s*a flood scenario/);
  });
});
