// @vitest-environment jsdom
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMode } from "../../app/modeStore";
import { json, newQueryClient, renderWithClient, stubFetch } from "../../test/helpers";
import { useChatDraft } from "../chat/chatDraftStore";
import { useScene } from "../scene/sceneStore";
import { MainPage } from "./MainPage";
import { usePanel } from "./panelStore";

const scenarios = [
  { id: "baseline", label: "Baseline", stage_m: 0, disclaimer: "d", links: [] },
  { id: "stage_p3m", label: "River +3 m", stage_m: 3, disclaimer: "d", links: [] },
];

const stubWide = (wide: boolean) =>
  vi.stubGlobal("matchMedia", () => ({
    matches: wide,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  localStorage.clear();
  stubWide(true);
  usePanel.setState({ open: true, sheet: "peek" });
  useChatDraft.setState({ streaming: false });
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

  it("moves focus to Show after Hide and back to Hide after Show", () => {
    renderMain();
    fireEvent.click(screen.getByRole("button", { name: "Hide assistant" }));
    expect(screen.getByRole("button", { name: "Show assistant" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Show assistant" }));
    expect(screen.getByRole("button", { name: "Hide assistant" })).toHaveFocus();
  });
  describe("narrow screens (bottom sheet)", () => {
    beforeEach(() => stubWide(false));
    it("shows the sheet with the composer at peek and no hide/show buttons", () => {
      renderMain();
      expect(screen.queryByRole("button", { name: "Hide assistant" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Show assistant" })).toBeNull();
      expect(screen.getByRole("textbox", { name: "Your question" })).toBeVisible();
      expect(screen.getByRole("slider", { name: "Assistant height" })).toBeVisible();
      // Header and log stay mounted but hidden at peek.
      expect(screen.getByRole("log", { name: "Conversation", hidden: true })).toHaveClass("hidden");
    });
    it("expanding reveals the conversation and moves the --sheet-h offset", () => {
      const { container } = renderMain();
      const root = container.firstElementChild as HTMLElement;
      expect(root.style.getPropertyValue("--sheet-h")).toBe("9.5rem");
      fireEvent.click(screen.getByRole("button", { name: "Expand assistant" }));
      expect(screen.getByRole("log", { name: "Conversation" })).not.toHaveClass("hidden");
      expect(root.style.getPropertyValue("--sheet-h")).toBe("55dvh");
    });
    it("the place/path card stack sits above the sheet", () => {
      renderMain();
      expect(screen.getByTestId("bottom-stack").className).toContain(
        "bottom-[calc(var(--sheet-h,0px)+2rem)]",
      );
    });
    it("a question asked at peek opens the sheet to half", () => {
      renderMain();
      act(() => useChatDraft.setState({ streaming: true }));
      expect(usePanel.getState().sheet).toBe("half");
    });
  });
  describe("store default", () => {
    afterEach(() => vi.unstubAllGlobals());
    const fresh = async (wide: boolean) => {
      vi.resetModules();
      vi.stubGlobal("matchMedia", () => ({ matches: wide }));
      localStorage.setItem("tl.panel.open", "true");
      return (await import("./panelStore")).usePanel.getState().open;
    };
    it("starts closed on narrow screens even if a stored value says open", async () => {
      expect(await fresh(false)).toBe(false);
    });
    it("starts open on wide screens", async () => {
      expect(await fresh(true)).toBe(true);
    });
  });
});
