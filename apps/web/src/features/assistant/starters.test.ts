import { describe, expect, it } from "vitest";
import { copyFor, DEVSIM_BRIEF, STARTERS } from "./starters";

describe("starters", () => {
  it("four resident and five management starters; none contain banned words", () => {
    expect(STARTERS.resident).toHaveLength(4);
    expect(STARTERS.management).toHaveLength(5);
    for (const m of ["resident", "management"] as const) {
      for (const s of STARTERS[m]) expect(s.text).not.toMatch(/\bsafe\b|selamat|安全/i);
    }
  });
  it("the development brief is a Management starter only, and equals the spec text", () => {
    expect(DEVSIM_BRIEF).toBe(
      "Simulate a 30-storey, 500-home tower near Lakeside Mall, from construction to daily life",
    );
    expect(STARTERS.management.map((s) => s.text)).toContain(DEVSIM_BRIEF);
    expect(STARTERS.resident.map((s) => s.text)).not.toContain(DEVSIM_BRIEF);
    expect(DEVSIM_BRIEF).not.toMatch(/flood|safe|depth/i);
  });
  it("copy changes with the mode", () => {
    expect(copyFor("resident").placeholder).toBe("Describe where you want to go");
    expect(copyFor("management").placeholder).toBe("Describe your plan or ask about an area");
    expect(copyFor("resident").sub).toMatch(/checked data/i);
    expect(copyFor("management").sub).toMatch(/tickets/i);
  });
});
