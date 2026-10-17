// @vitest-environment jsdom
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMode } from "../../app/modeStore";
import { ENV } from "../../lib/env";
import { newQueryClient, renderWithClient } from "../../test/helpers";
import { useTheme } from "../../ui/theme";
import { usePanel } from "../main/panelStore";
import { useSceneSettings } from "../scene/sceneSettingsStore";
import { useScene } from "../scene/sceneStore";
import { SettingsPopover } from "./SettingsPopover";

const scenarios = [
  { id: "baseline", label: "Baseline", stage_m: 0, disclaimer: "d", links: [] },
  { id: "stage_p1m", label: "River +1 m", stage_m: 1, disclaimer: "d", links: [] },
  { id: "stage_p3m", label: "River +3 m", stage_m: 3, disclaimer: "d", links: [] },
];

// The API client builds a Request with a relative URL, which jsdom rejects; seed the cache instead.
function seeded(buildings: unknown = null) {
  const qc = newQueryClient();
  qc.setQueryData(["scenarios"], scenarios);
  qc.setQueryData(["buildings"], buildings); // null = the world has no buildings (API 404)
  return qc;
}

const BUILDINGS = {
  attribution: [],
  buildings: { type: "FeatureCollection", features: [{ type: "Feature" }] },
  trees: { type: "FeatureCollection", features: [] },
};
const savedGoogle = ENV.googleKey;
const savedGetContext = HTMLCanvasElement.prototype.getContext;
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = savedGetContext;
  ENV.googleKey = savedGoogle;
});

beforeEach(() => {
  useScene.getState().reset();
  useMode.setState({ mode: "resident" });
});

describe("SettingsPopover", () => {
  it("is closed until opened, and the button has a name and expanded state", async () => {
    renderWithClient(<SettingsPopover />, seeded());
    const btn = screen.getByRole("button", { name: "Map settings" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(btn);
    expect(screen.getByRole("dialog", { name: "Map settings" })).toBeVisible();
  });
  it("the gear and the popover sit above the phone sheet and the attribution strip, within the space left", async () => {
    renderWithClient(<SettingsPopover />, seeded());
    const gear = screen.getByRole("button", { name: "Map settings" });
    expect(gear.className).toContain("bottom-[calc(var(--sheet-h,0px)+var(--attr-h,0px)+1rem)]");
    await userEvent.click(gear);
    const dialog = screen.getByRole("dialog", { name: "Map settings" });
    expect(dialog.className).toContain("bottom-[calc(var(--sheet-h,0px)+var(--attr-h,0px)+5rem)]");
    expect(dialog.className).toContain(
      "max-h-[min(70%,calc(100%-var(--sheet-h,0px)-var(--attr-h,0px)-6rem))]",
    );
  });
  it("lists the legend with all six statuses incl. Suggested route", async () => {
    renderWithClient(<SettingsPopover />, seeded());
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    const legend = screen.getByRole("list", { name: "Path status legend" });
    for (const t of [
      "No known barrier",
      "Not checked yet",
      "Not passable",
      "Likely flooded (indicative)",
      "Possibly flooded (indicative)",
      "Suggested route",
    ])
      expect(within(legend).getByText(t)).toBeInTheDocument();
  });
  it("treats the baseline scenario as Normal and sets aria-controls only while open", async () => {
    useScene.getState().setScenario("baseline");
    renderWithClient(<SettingsPopover />, seeded());
    const btn = screen.getByRole("button", { name: "Map settings" });
    expect(btn).not.toHaveAttribute("aria-controls");
    await userEvent.click(btn);
    expect(btn).toHaveAttribute("aria-controls", "map-settings");
    expect(screen.getByRole("radio", { name: "Normal" })).toHaveAttribute("aria-checked", "true");
  });
  it("river level picks the scenario; Normal clears it", async () => {
    renderWithClient(<SettingsPopover />, seeded());
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    await userEvent.click(await screen.findByRole("radio", { name: "+3 m" }));
    expect(useScene.getState().scenarioId).toBe("stage_p3m");
    await userEvent.click(screen.getByRole("radio", { name: "Normal" }));
    expect(useScene.getState().scenarioId).toBeNull();
  });
  it("Travelling as is resident-only and sets the profile", async () => {
    renderWithClient(<SettingsPopover />, seeded());
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    await userEvent.click(screen.getByRole("radio", { name: "Wheelchair" }));
    expect(useScene.getState().profile).toBe("wheelchair");
  });
  it("management hides Travelling as", async () => {
    useMode.setState({ mode: "management" });
    renderWithClient(<SettingsPopover />, seeded());
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    expect(screen.queryByRole("radiogroup", { name: "Travelling as" })).toBeNull();
  });
  it("Theme radiogroup offers Auto/Day/Dusk/Night and drives the choice", async () => {
    renderWithClient(<SettingsPopover />, seeded());
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    for (const name of ["Auto (clock)", "Day", "Dusk", "Night"]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole("radio", { name: "Dusk" }));
    expect(useTheme.getState().choice).toBe("dusk");
    await userEvent.click(screen.getByRole("radio", { name: "Day" }));
    expect(useTheme.getState().choice).toBe("day");
  });
  it("Escape closes and returns focus to the button", async () => {
    renderWithClient(<SettingsPopover />, seeded());
    const btn = screen.getByRole("button", { name: "Map settings" });
    await userEvent.click(btn);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(btn).toHaveFocus();
  });
  it("ignores an Escape another layer already handled", async () => {
    renderWithClient(<SettingsPopover />, seeded());
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    const ev = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    ev.preventDefault();
    document.dispatchEvent(ev);
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("orders the groups Theme, Map style, Motion, Quality, Camera controls, Travelling as, River level, Legend", async () => {
    HTMLCanvasElement.prototype.getContext = (() => ({})) as never;
    useScene.getState().setView("cesium");
    renderWithClient(<SettingsPopover />, seeded());
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    const heads = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(heads).toEqual([
      "Theme",
      "Map style",
      "Motion",
      "Quality",
      "Camera controls",
      "Travelling as",
      "River level",
      "Legend",
    ]);
  });

  describe("Map style", () => {
    const openIt = async (buildings: unknown, google: string) => {
      ENV.googleKey = google;
      // Map styles are for the 3D renderer: a WebGL-capable device showing Cesium.
      HTMLCanvasElement.prototype.getContext = (() => ({})) as never;
      useScene.getState().setView("cesium");
      renderWithClient(<SettingsPopover />, seeded(buildings));
      await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
      return screen.getByRole("radiogroup", { name: "Map style" });
    };
    it("names the views honestly; keyless with buildings: Stylised on, Realistic disabled with a reason", async () => {
      const g = await openIt(BUILDINGS, "");
      const st = within(g).getByRole("radio", { name: "Stylised" });
      const re = within(g).getByRole("radio", { name: "Realistic photos (Google)" });
      expect(st).toHaveAttribute("aria-checked", "true");
      expect(st).toBeEnabled();
      expect(re).toBeDisabled();
      expect(re).toHaveAccessibleDescription("Needs a Google Maps key");
      expect(screen.getByText("Needs a Google Maps key")).toBeVisible();
      expect(screen.getByText("Decorative details are illustrative.")).toBeVisible();
      expect(st.className).toContain("min-h-11");
    });
    it("no buildings (404): Stylised disabled with a reason, no illustrative note", async () => {
      const g = await openIt(null, "g");
      const st = within(g).getByRole("radio", { name: "Stylised" });
      expect(st).toBeDisabled();
      expect(st).toHaveAccessibleDescription("Needs building data");
      expect(within(g).getByRole("radio", { name: "Realistic photos (Google)" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(screen.queryByText("Decorative details are illustrative.")).toBeNull();
    });
    it("selecting writes the store and records the user's choice", async () => {
      const g = await openIt(BUILDINGS, "g");
      await userEvent.click(within(g).getByRole("radio", { name: "Realistic photos (Google)" }));
      expect(useScene.getState().mapStyle).toBe("realistic");
      expect(useScene.getState().mapStyleChosen).toBe(true);
      expect(screen.queryByText("Decorative details are illustrative.")).toBeNull();
      await userEvent.click(within(g).getByRole("radio", { name: "Stylised" }));
      expect(useScene.getState().mapStyle).toBe("stylised");
      expect(screen.getByText("Decorative details are illustrative.")).toBeVisible();
    });
    it("a disabled option cannot be selected", async () => {
      const g = await openIt(BUILDINGS, "");
      await userEvent.click(within(g).getByRole("radio", { name: "Realistic photos (Google)" }));
      expect(useScene.getState().mapStyleChosen).toBe(false);
    });
  });

  describe("Motion and Quality (Cesium view)", () => {
    beforeEach(() => {
      useSceneSettings.setState({ motion: true, quality: "auto" });
      HTMLCanvasElement.prototype.getContext = (() => ({})) as never;
      useScene.getState().setView("cesium");
    });
    it("offers Motion On/Off and Quality Auto/High/Medium/Low", async () => {
      renderWithClient(<SettingsPopover />, seeded());
      await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
      const motion = screen.getByRole("radiogroup", { name: "Motion" });
      expect(within(motion).getByRole("radio", { name: "On" })).toBeInTheDocument();
      expect(within(motion).getByRole("radio", { name: "Off" })).toBeInTheDocument();
      const quality = screen.getByRole("radiogroup", { name: "Quality" });
      for (const name of ["Auto", "High", "Medium", "Low"]) {
        expect(within(quality).getByRole("radio", { name })).toBeInTheDocument();
      }
    });
    it("Off sets motion to false", async () => {
      renderWithClient(<SettingsPopover />, seeded());
      await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
      await userEvent.click(
        within(screen.getByRole("radiogroup", { name: "Motion" })).getByRole("radio", {
          name: "Off",
        }),
      );
      expect(useSceneSettings.getState().motion).toBe(false);
    });
  });
});

describe("SettingsPopover behind the full phone sheet", () => {
  const media = (wide: boolean) =>
    vi.stubGlobal("matchMedia", () => ({
      matches: wide,
      addEventListener() {},
      removeEventListener() {},
    }));
  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => usePanel.setState({ sheet: "peek" }));
  });
  const gear = () => screen.getByRole("button", { name: "Map settings" });

  it("hides the gear (out of tab order) on a narrow screen with the sheet at full", () => {
    media(false);
    usePanel.setState({ sheet: "full" });
    renderWithClient(<SettingsPopover />, seeded());
    expect(gear().className.split(" ")).toContain("invisible");
  });
  it("keeps the gear visible on a narrow screen at half, and on a wide screen at full", () => {
    media(false);
    usePanel.setState({ sheet: "half" });
    const { unmount } = renderWithClient(<SettingsPopover />, seeded());
    expect(gear().className.split(" ")).not.toContain("invisible");
    unmount();
    media(true);
    usePanel.setState({ sheet: "full" });
    renderWithClient(<SettingsPopover />, seeded());
    expect(gear().className.split(" ")).not.toContain("invisible");
  });
  it("closes an open popover when the narrow sheet goes to full", async () => {
    media(false);
    usePanel.setState({ sheet: "half" });
    renderWithClient(<SettingsPopover />, seeded());
    await userEvent.click(gear());
    expect(screen.getByRole("dialog", { name: "Map settings" })).toBeInTheDocument();
    act(() => usePanel.setState({ sheet: "full" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(gear()).toHaveAttribute("aria-expanded", "false");
  });
});
