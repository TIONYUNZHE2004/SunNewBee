// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
  it("shows the map region and the assistant; map chrome is the brand pill and the settings button", () => {
    renderMain();
    const map = screen.getByRole("region", { name: "3D map of City of Elmina" });
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeVisible();
    expect(within(map).getByRole("button", { name: "Map settings" })).toBeVisible();
    expect(
      within(map)
        .getAllByRole("radiogroup")
        .map((g) => g.getAttribute("aria-label")),
    ).toEqual(["Perspective"]);
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
  it("the docked panel's collapse animation is off under reduced motion", () => {
    renderMain();
    const panel = screen.getByRole("complementary", { name: "Assistant" }).parentElement
      ?.parentElement;
    expect(panel).toHaveClass("transition-[width,opacity]", "motion-reduce:transition-none");
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

  it("fills the map area with a definite box (absolute inset-0, not h-full)", () => {
    const { container } = renderMain();
    expect(container.firstElementChild).toHaveClass("absolute", "inset-0");
    expect(container.firstElementChild).not.toHaveClass("h-full");
  });
  it("an ask from elsewhere opens a closed panel on wide screens", () => {
    usePanel.setState({ open: false });
    renderMain();
    act(() => useChatDraft.getState().ask("Can I push a stroller to the kiosk?"));
    expect(usePanel.getState().open).toBe(true);
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeVisible();
  });
  it("a stream starting while the panel is closed opens it on wide screens", () => {
    usePanel.setState({ open: false });
    renderMain();
    act(() => useChatDraft.setState({ streaming: true }));
    expect(usePanel.getState().open).toBe(true);
  });
  it("Ask about this place opens a closed panel and focuses the composer", async () => {
    usePanel.setState({ open: false });
    const qc = newQueryClient();
    qc.setQueryData(["scenarios"], scenarios);
    qc.setQueryData(["site"], { id: "t", name: "Test", attribution: [] });
    qc.setQueryData(["place", "p1", null, null], {
      ok: true,
      data: { id: "p1", name: "Kiosk", kind: "amenity", source: "osm", claims: {} },
    });
    useScene.getState().selectPlace("p1");
    renderWithClient(<MainPage />, qc);
    await userEvent.click(screen.getByRole("button", { name: "Ask about this place" }));
    expect(usePanel.getState().open).toBe(true);
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Your question" })).toHaveFocus(),
    );
    expect(screen.getByRole("textbox", { name: "Your question" })).toHaveValue(
      "Tell me about Kiosk",
    );
  });
  it("publishes the measured TopStack bottom as --top-h", () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private cb: () => void) {}
        observe(el: Element) {
          observed.push(el);
          this.cb();
        }
        disconnect() {}
      },
    );
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const bottom = this.dataset.testid === "top-stack" ? 180 : 0;
        return { top: 60, bottom, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 } as DOMRect;
      });
    const { container } = renderMain();
    const root = container.firstElementChild as HTMLElement;
    expect(observed).toContain(screen.getByTestId("top-stack"));
    expect(root.style.getPropertyValue("--top-h")).toBe("120px");
    rect.mockRestore();
  });

  it("moves focus to Show after Hide and back to Hide after Show", () => {
    renderMain();
    fireEvent.click(screen.getByRole("button", { name: "Hide assistant" }));
    expect(screen.getByRole("button", { name: "Show assistant" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Show assistant" }));
    expect(screen.getByRole("button", { name: "Hide assistant" })).toHaveFocus();
  });
  it("going wide -> narrow resets the sheet to peek, so an open, focused popover keeps focus", async () => {
    let matches = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    }));
    // A sheet left at full on a phone, then rotated to a wide layout.
    usePanel.setState({ sheet: "full" });
    renderMain();
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    const dialog = screen.getByRole("dialog", { name: "Map settings" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    matches = false;
    act(() => {
      for (const l of listeners) l();
    });
    expect(usePanel.getState().sheet).toBe("peek");
    expect(screen.getByRole("dialog", { name: "Map settings" })).not.toHaveClass("invisible");
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("dialog", { name: "Map settings" })).toContainElement(
      document.activeElement as HTMLElement,
    );
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
    it("the place/path card stack sits above the sheet and the attribution strip", () => {
      renderMain();
      expect(screen.getByTestId("bottom-stack").className).toContain(
        "bottom-[calc(var(--sheet-h,0px)+var(--attr-h,0px)+1rem)]",
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
