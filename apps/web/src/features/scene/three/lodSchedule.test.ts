import { describe, expect, it } from "vitest";
import { createLodSchedule } from "./lodSchedule";

describe("createLodSchedule", () => {
  it("is idle until the camera moves", () => {
    const s = createLodSchedule(250);
    expect(s.due(0)).toBe(false);
    expect(s.trailingMs(0)).toBeNull();
  });

  it("updates at most every 250 ms while moving, then once after it stops", () => {
    const s = createLodSchedule(250);
    s.moved();
    expect(s.due(1000)).toBe(true);
    s.moved();
    expect(s.due(1100)).toBe(false);
    s.moved();
    expect(s.due(1200)).toBe(false);
    // The camera stopped at 1200: one trailing update is owed 50 ms later.
    expect(s.trailingMs(1200)).toBe(50);
    expect(s.due(1250)).toBe(true);
    expect(s.trailingMs(1250)).toBeNull();
    expect(s.due(2000)).toBe(false);
  });

  it("force() makes the next tick update regardless of the interval", () => {
    const s = createLodSchedule(250);
    s.moved();
    expect(s.due(1000)).toBe(true);
    s.force();
    expect(s.due(1001)).toBe(true);
  });
});
