// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useMode } from "../../app/modeStore";
import { newQueryClient, renderWithClient } from "../../test/helpers";
import { useTheme } from "../../ui/theme";
import { useScene } from "../scene/sceneStore";
import { SettingsPopover } from "./SettingsPopover";

const scenarios = [
  { id: "baseline", label: "Baseline", stage_m: 0, disclaimer: "d", links: [] },
  { id: "stage_p1m", label: "River +1 m", stage_m: 1, disclaimer: "d", links: [] },
  { id: "stage_p3m", label: "River +3 m", stage_m: 3, disclaimer: "d", links: [] },
];

// The API client builds a Request with a relative URL, which jsdom rejects; seed the cache instead.
function seeded() {
  const qc = newQueryClient();
  qc.setQueryData(["scenarios"], scenarios);
  return qc;
}

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
  it("Day/Night radiogroup drives the theme", async () => {
    renderWithClient(<SettingsPopover />, seeded());
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    await userEvent.click(screen.getByRole("radio", { name: "Day" }));
    expect(useTheme.getState().theme).toBe("day");
  });
  it("Escape closes and returns focus to the button", async () => {
    renderWithClient(<SettingsPopover />, seeded());
    const btn = screen.getByRole("button", { name: "Map settings" });
    await userEvent.click(btn);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(btn).toHaveFocus();
  });
});
