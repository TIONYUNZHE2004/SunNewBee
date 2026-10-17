import { describe, expect, it } from "vitest";
import { movedInputs } from "./movedInputs";

const C = {
  ScreenSpaceEventType: {
    LEFT_DOWN: 1,
    RIGHT_DOWN: 2,
    MIDDLE_DOWN: 3,
    WHEEL: 4,
    PINCH_START: 5,
    LEFT_DOUBLE_CLICK: 6,
  },
  KeyboardEventModifier: { SHIFT: 10, CTRL: 11 },
};

describe("movedInputs", () => {
  const got = movedInputs(C as never).map(([t, m]) => `${t}:${m ?? ""}`);
  it("covers the plain inputs", () => {
    for (const k of ["1:", "2:", "3:", "4:", "5:"]) expect(got).toContain(k);
  });
  it("covers ctrl+drag orbit, shift+wheel tilt and double-click", () => {
    expect(got).toContain("1:11");
    expect(got).toContain("4:10");
    expect(got).toContain("6:");
  });
});
