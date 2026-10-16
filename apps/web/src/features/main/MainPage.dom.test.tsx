// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useMode } from "../../app/modeStore";
import { json, newQueryClient, renderWithClient, stubFetch } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { MainPage } from "./MainPage";
import { usePanel } from "./panelStore";

const scenarios = [
  { id: "baseline", label: "Baseline", stage_m: 0, disclaimer: "d", links: [] },
  { id: "stage_p3m", label: "River +3 m", stage_m: 3, disclaimer: "d", links: [] },
];

beforeEach(() => {
  localStorage.clear();
  usePanel.setState({ open: true });
  useScene.getState().reset();
  useMode.setState({ mode: "resident" });
  stubFetch(() => json([]));
});

function renderMain() {
  const qc = newQueryClient();
  qc.setQueryData(["scenarios"], scenarios);
  qc.setQueryData(["site"], { id: "t", name: "Test", attribution: [] });
  return renderWithClient(<MainPage />, qc);
}

describe("MainPage", () => {
  it("shows the map region and the assistant, with only the settings button as map chrome", () => {
    renderMain();
    const map = screen.getByRole("region", { name: "3D map of City of Elmina" });
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeVisible();
    expect(within(map).getByRole("button", { name: "Map settings" })).toBeVisible();
    expect(within(map).queryByRole("radiogroup")).toBeNull();
    expect(within(map).queryByRole("list", { name: "Path status legend" })).toBeNull();
    expect(within(map).getByText(/3D map couldn't load/)).toBeVisible();
    const list = within(map).queryByRole("list");
    const controls = within(map)
      .getAllByRole("button")
      .filter((b) => !list?.contains(b));
    expect(controls.map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "Map settings",
    ]);
  });
  it("collapsing hides the panel visually but keeps the conversation mounted", () => {
    renderMain();
    fireEvent.click(screen.getByRole("button", { name: "Hide assistant" }));
    expect(usePanel.getState().open).toBe(false);
    expect(localStorage.getItem("tl.panel.open")).toBe("false");
    expect(screen.getByRole("log", { name: "Conversation", hidden: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show assistant" }));
    expect(usePanel.getState().open).toBe(true);
  });
  it("settings reveal the legend; +3 m shows the not-a-forecast note", async () => {
    renderMain();
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    expect(screen.getByRole("list", { name: "Path status legend" })).toBeVisible();
    await userEvent.click(screen.getByRole("radio", { name: "+3 m" }));
    expect(await screen.findByRole("note")).toHaveTextContent(/not a forecast/);
  });
});
