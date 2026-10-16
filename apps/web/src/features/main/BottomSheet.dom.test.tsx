// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { BottomSheet, SHEET_HEIGHTS, SHEET_TOP_RESERVE } from "./BottomSheet";
import { usePanel } from "./panelStore";

describe("BottomSheet", () => {
  beforeEach(() => usePanel.setState({ sheet: "peek" }));
  it("expands and collapses with buttons", () => {
    render(
      <BottomSheet>
        <p>chat</p>
      </BottomSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand assistant" }));
    expect(usePanel.getState().sheet).toBe("half");
    fireEvent.click(screen.getByRole("button", { name: "Expand assistant" }));
    expect(usePanel.getState().sheet).toBe("full");
    fireEvent.click(screen.getByRole("button", { name: "Collapse assistant" }));
    expect(usePanel.getState().sheet).toBe("half");
  });
  it("arrow keys on the handle change the height", () => {
    render(
      <BottomSheet>
        <p>chat</p>
      </BottomSheet>,
    );
    const handle = screen.getByRole("slider", { name: "Assistant height" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(usePanel.getState().sheet).toBe("half");
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(usePanel.getState().sheet).toBe("peek");
  });
  it("children stay mounted at every height and the height follows the store", () => {
    const { container } = render(
      <BottomSheet>
        <p>chat</p>
      </BottomSheet>,
    );
    for (const s of ["peek", "half", "full"] as const) {
      act(() => usePanel.setState({ sheet: s }));
      expect(screen.getByText("chat")).toBeInTheDocument();
    }
    expect((container.firstChild as HTMLElement).style.height).toContain("100%");
  });
  it("a drag up or down past the threshold changes the height", () => {
    render(
      <BottomSheet>
        <p>chat</p>
      </BottomSheet>,
    );
    const handle = screen.getByRole("slider", { name: "Assistant height" });
    fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 400, pointerId: 1 });
    expect(usePanel.getState().sheet).toBe("half");
    fireEvent.pointerDown(handle, { clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 500, pointerId: 1 });
    expect(usePanel.getState().sheet).toBe("peek");
  });
  it("Home, End and Escape jump to peek, full and peek", () => {
    render(
      <BottomSheet>
        <p>chat</p>
      </BottomSheet>,
    );
    const handle = screen.getByRole("slider", { name: "Assistant height" });
    fireEvent.keyDown(handle, { key: "End" });
    expect(usePanel.getState().sheet).toBe("full");
    fireEvent.keyDown(handle, { key: "Escape" });
    expect(usePanel.getState().sheet).toBe("peek");
    fireEvent.keyDown(handle, { key: "End" });
    fireEvent.keyDown(handle, { key: "Home" });
    expect(usePanel.getState().sheet).toBe("peek");
  });
  it("step buttons use aria-disabled at the ends, stay focusable and do nothing", () => {
    render(
      <BottomSheet>
        <p>chat</p>
      </BottomSheet>,
    );
    const collapse = screen.getByRole("button", { name: "Collapse assistant" });
    expect(collapse).toHaveAttribute("aria-disabled", "true");
    expect(collapse).not.toBeDisabled();
    fireEvent.click(collapse);
    expect(usePanel.getState().sheet).toBe("peek");
    act(() => usePanel.setState({ sheet: "full" }));
    const expand = screen.getByRole("button", { name: "Expand assistant" });
    expect(expand).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(expand);
    expect(usePanel.getState().sheet).toBe("full");
  });
  it("full leaves the TopStack reserve clear", () => {
    expect(SHEET_HEIGHTS.full).toBe(`calc(100% - ${SHEET_TOP_RESERVE})`);
    expect(SHEET_TOP_RESERVE).toBe("6rem");
  });
  it("carries the attribution on its bottom edge at full only", () => {
    render(
      <BottomSheet attribution="© OpenStreetMap contributors (ODbL)">
        <p>chat</p>
      </BottomSheet>,
    );
    expect(screen.queryByText(/OpenStreetMap/)).toBeNull();
    act(() => usePanel.setState({ sheet: "full" }));
    expect(screen.getByText(/OpenStreetMap/)).toBeVisible();
  });
});
