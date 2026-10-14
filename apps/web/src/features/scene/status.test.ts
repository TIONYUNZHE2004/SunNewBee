import { describe, expect, it } from "vitest";
import { mapStatus } from "./status";

describe("mapStatus", () => {
  it("passes canonical status_for_profile through", () => {
    for (const s of ["ok", "unknown", "blocked", "flooded_likely", "flooded_possible"]) {
      expect(mapStatus({ status_for_profile: s })).toBe(s);
    }
  });
  it("maps closed to blocked", () => {
    expect(mapStatus({ status_for_profile: "closed" })).toBe("blocked");
    expect(mapStatus({ status: "closed" })).toBe("blocked");
  });
  it("maps raw flood_class", () => {
    expect(mapStatus({ flood_class: "likely_flooded" })).toBe("flooded_likely");
    expect(mapStatus({ flood_class: "possible" })).toBe("flooded_possible");
    expect(mapStatus({ flood_class: "unlikely" })).toBe("unknown");
  });
  it("status_for_profile wins over flood_class", () => {
    expect(mapStatus({ status_for_profile: "ok", flood_class: "likely_flooded" })).toBe("ok");
  });
  it("defaults missing/garbage/null to unknown, never ok", () => {
    expect(mapStatus({})).toBe("unknown");
    expect(mapStatus(null)).toBe("unknown");
    expect(mapStatus({ status_for_profile: "wat" })).toBe("unknown");
  });
});
