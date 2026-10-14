import { describe, expect, it } from "vitest";
import { statusStyle } from "./styles";

describe("statusStyle", () => {
  it("never relies on colour alone", () => {
    for (const s of ["ok", "unknown", "blocked", "flooded_likely", "flooded_possible"] as const) {
      expect(statusStyle(s).label.length).toBeGreaterThan(0);
    }
    expect(statusStyle("blocked").dotted).toBe(true);
    expect(statusStyle("ok").dotted).toBeFalsy();
    expect(statusStyle("unknown").dashed).toBe(true);
    expect(statusStyle("flooded_possible").dashed).toBe(true);
  });
});
