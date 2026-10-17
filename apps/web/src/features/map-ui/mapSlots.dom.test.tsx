// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePanel } from "../main/panelStore";
import { BottomStack, InSlot, TopStack } from "./mapSlots";

describe("map overlay stacks", () => {
  it("top stack holds route, flood, hint in DOM order regardless of mount order", () => {
    render(
      <>
        <TopStack />
        <InSlot name="hint">
          <p>hint</p>
        </InSlot>
        <InSlot name="flood">
          <p>flood</p>
        </InSlot>
        <InSlot name="route">
          <p>route</p>
        </InSlot>
      </>,
    );
    const stack = screen.getByTestId("top-stack");
    expect(Array.from(stack.querySelectorAll("p")).map((p) => p.textContent)).toEqual([
      "route",
      "flood",
      "hint",
    ]);
    expect(stack.className).toContain("top-4");
    expect(stack.className).toContain("right-[calc(var(--panel-w,0px)+1rem)]");
  });
  it("bottom stack puts the card above the notes", () => {
    render(
      <>
        <BottomStack />
        <InSlot name="notes">
          <p>note</p>
        </InSlot>
        <InSlot name="card">
          <p>card</p>
        </InSlot>
      </>,
    );
    const ps = Array.from(screen.getByTestId("bottom-stack").querySelectorAll("p"));
    expect(ps.map((p) => p.textContent)).toEqual(["card", "note"]);
  });
  it("renders inline when no stack is mounted", () => {
    render(
      <InSlot name="flood">
        <p>solo</p>
      </InSlot>,
    );
    expect(screen.getByText("solo")).toBeInTheDocument();
  });

  describe("bottom stack behind the full phone sheet", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      act(() => usePanel.setState({ sheet: "peek" }));
    });
    const media = (wide: boolean) =>
      vi.stubGlobal("matchMedia", () => ({
        matches: wide,
        addEventListener() {},
        removeEventListener() {},
      }));
    // At narrow + full, --sheet-h is calc(100% - var(--top-h) - 0.5rem), so the stack's max-height
    // max(0px, 100% - sheet - attr - 5rem) = max(0px, top-h - 4.5rem) is ~0 and its bottom edge sits
    // up under the top stack: the card would be a 0 px box whose buttons are still tabbable.
    it("hides (and leaves the tab order) on a narrow screen at full; shown at half and on wide", () => {
      media(false);
      usePanel.setState({ sheet: "full" });
      render(
        <>
          <BottomStack />
          <InSlot name="card">
            <button type="button">Ask about this place</button>
          </InSlot>
        </>,
      );
      const classes = () => screen.getByTestId("bottom-stack").className.split(" ");
      expect(classes()).toContain("invisible");
      act(() => usePanel.setState({ sheet: "half" }));
      expect(classes()).not.toContain("invisible");
    });
    it("stays visible on a wide screen even if the sheet state says full", () => {
      media(true);
      usePanel.setState({ sheet: "full" });
      render(<BottomStack />);
      expect(screen.getByTestId("bottom-stack").className.split(" ")).not.toContain("invisible");
    });
  });
});
