import { describe, expect, it } from "vitest";
import { copyFor, STARTERS } from "./starters";

describe("starters", () => {
  it("has four per mode and none contain banned words", () => {
    for (const m of ["resident", "management"] as const) {
      expect(STARTERS[m]).toHaveLength(4);
      for (const s of STARTERS[m]) expect(s.text).not.toMatch(/\bsafe\b|selamat|安全/i);
    }
  });
  it("copy changes with the mode", () => {
    expect(copyFor("resident").placeholder).toBe("Describe where you want to go");
    expect(copyFor("management").placeholder).toBe("Describe your plan or ask about an area");
    expect(copyFor("resident").sub).toMatch(/checked data/i);
    expect(copyFor("management").sub).toMatch(/tickets/i);
  });
});
