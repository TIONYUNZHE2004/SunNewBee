import { describe, expect, it } from "vitest";
import { edgeFades, fadeMask, wheelScrollLeft } from "./chipRowScroll";

const row = (scrollLeft: number, scrollWidth = 600, clientWidth = 300) => ({
  scrollLeft,
  scrollWidth,
  clientWidth,
});

describe("wheelScrollLeft", () => {
  it("maps a vertical wheel onto the row's horizontal scroll, clamped to the range", () => {
    expect(wheelScrollLeft(row(0), 0, 100)).toBe(100);
    expect(wheelScrollLeft(row(250), 0, 100)).toBe(300);
    expect(wheelScrollLeft(row(100), 0, -40)).toBe(60);
    expect(wheelScrollLeft(row(30), 0, -100)).toBe(0);
  });
  it("scales line and page deltas", () => {
    expect(wheelScrollLeft(row(0), 0, 3, 1)).toBe(48);
    expect(wheelScrollLeft(row(0), 0, 1, 2)).toBe(300);
  });
  it("passes the event through at the end of the range in the wheel's direction", () => {
    expect(wheelScrollLeft(row(0), 0, -100)).toBeNull();
    expect(wheelScrollLeft(row(300), 0, 100)).toBeNull();
    expect(wheelScrollLeft(row(299.5), 0, 100)).toBeNull();
  });
  it("passes through zoom (ctrl/meta, incl. trackpad pinch) and shift wheels", () => {
    expect(wheelScrollLeft(row(0), 0, 100, 0, { ctrlKey: true })).toBeNull();
    expect(wheelScrollLeft(row(0), 0, 100, 0, { metaKey: true })).toBeNull();
    expect(wheelScrollLeft(row(0), 0, 100, 0, { shiftKey: true })).toBeNull();
  });
  it("passes through horizontal gestures and rows that do not overflow", () => {
    expect(wheelScrollLeft(row(0), 50, 20)).toBeNull();
    expect(wheelScrollLeft(row(0, 300, 300), 0, 100)).toBeNull();
  });
});

describe("edge fades", () => {
  it("fade only the sides with hidden chips", () => {
    expect(edgeFades(row(0))).toEqual({ start: false, end: true });
    expect(edgeFades(row(150))).toEqual({ start: true, end: true });
    expect(edgeFades(row(300))).toEqual({ start: true, end: false });
    expect(edgeFades(row(0, 300, 300))).toEqual({ start: false, end: false });
  });
  it("build a mask only when something overflows", () => {
    expect(fadeMask({ start: false, end: false })).toBeUndefined();
    expect(fadeMask({ start: false, end: true })).toBe(
      "linear-gradient(to right, #000, #000, #000 calc(100% - 1.5rem), transparent)",
    );
    expect(fadeMask({ start: true, end: false })).toBe(
      "linear-gradient(to right, transparent, #000 1.5rem, #000, #000)",
    );
  });
});
