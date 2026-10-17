// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChipRow } from "./ChipRow";

/** jsdom has no layout: give the row a scroll geometry and a working scrollLeft. */
function geometry(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  let left = 0;
  Object.defineProperty(el, "scrollWidth", { configurable: true, get: () => scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => clientWidth });
  Object.defineProperty(el, "scrollLeft", {
    configurable: true,
    get: () => left,
    set: (v: number) => {
      left = v;
    },
  });
}

const wheel = (el: HTMLElement, deltaY: number, deltaX = 0) => {
  const ev = new WheelEvent("wheel", { deltaY, deltaX, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
};

// jsdom normalises colours (#000 -> rgb(0, 0, 0)), so read only where "transparent" sits.
const fadesStart = (row: HTMLElement) =>
  row.style.maskImage.startsWith("linear-gradient(to right, transparent");
const fadesEnd = (row: HTMLElement) => row.style.maskImage.endsWith("transparent)");

function setup(scrollWidth = 600, clientWidth = 300) {
  render(
    <ChipRow>
      <button type="button">a</button>
      <button type="button">b</button>
    </ChipRow>,
  );
  const row = screen.getByRole("button", { name: "a" }).parentElement as HTMLElement;
  geometry(row, scrollWidth, clientWidth);
  act(() => {
    row.dispatchEvent(new Event("scroll"));
  });
  return row;
}

describe("ChipRow", () => {
  it("hides its scrollbar, keeps room for focus rings, and scrolls sideways", () => {
    const row = setup();
    expect(row.className.split(" ")).toEqual(
      expect.arrayContaining(["no-scrollbar", "overflow-x-auto", "pt-1", "pb-1"]),
    );
  });
  it("a vertical mouse wheel scrolls the row sideways and is consumed", () => {
    const row = setup();
    const ev = wheel(row, 120);
    expect(row.scrollLeft).toBe(120);
    expect(ev.defaultPrevented).toBe(true);
  });
  it("at the end of the range the wheel passes through to the panel", () => {
    const row = setup();
    row.scrollLeft = 300;
    const down = wheel(row, 120);
    expect(down.defaultPrevented).toBe(false);
    expect(row.scrollLeft).toBe(300);
    const up = wheel(row, -120);
    expect(up.defaultPrevented).toBe(true);
    expect(row.scrollLeft).toBe(180);
    row.scrollLeft = 0;
    expect(wheel(row, -120).defaultPrevented).toBe(false);
  });
  it("a row that fits never takes the wheel and has no fade", () => {
    const row = setup(300, 300);
    expect(wheel(row, 120).defaultPrevented).toBe(false);
    expect(row.style.maskImage).toBe("");
  });
  it("fades only the sides with hidden chips, following the scroll position", () => {
    const row = setup();
    expect(fadesStart(row)).toBe(false);
    expect(fadesEnd(row)).toBe(true);
    row.scrollLeft = 300;
    act(() => {
      row.dispatchEvent(new Event("scroll"));
    });
    expect(fadesStart(row)).toBe(true);
    expect(fadesEnd(row)).toBe(false);
  });
});
