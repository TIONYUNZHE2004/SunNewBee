// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
