import { describe, expect, it } from "vitest";
import { centreReachLabel, NO_DATA_LABEL, routeStatusLabel } from "./routeStatus";

describe("route status labels", () => {
  it("no_data is a data gap, never 'not reachable' or blocked", () => {
    expect(routeStatusLabel("no_data")).toBe("No mapped connection (data gap)");
    expect(NO_DATA_LABEL).toBe("No mapped connection (data gap)");
    expect(routeStatusLabel("no_data")).not.toMatch(/reachable|blocked/i);
  });
  it("blocked keeps 'Not passable'", () => {
    expect(routeStatusLabel("blocked")).toBe("Not passable");
  });
  it("other statuses stay readable", () => {
    expect(routeStatusLabel("partly_unverified")).toBe("partly unverified");
    expect(routeStatusLabel("confirmed")).toBe("confirmed");
  });
  it("centre reachability", () => {
    expect(centreReachLabel({ reachable: true, route_status: "confirmed" })).toBe("Reachable");
    expect(centreReachLabel({ reachable: false, route_status: "no_data" })).toBe(NO_DATA_LABEL);
    expect(centreReachLabel({ reachable: false, route_status: "blocked" })).toBe("Not passable");
  });
});
