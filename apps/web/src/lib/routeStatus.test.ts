import { describe, expect, it } from "vitest";
import { centreMapMarker, centreReachLabel, NO_DATA_LABEL, routeStatusLabel } from "./routeStatus";

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
  it("always labels map estimates, including centre markers", () => {
    expect(routeStatusLabel("likely_ok")).toBe("Likely OK (estimated)");
    const c = { reachable: true, route_status: "likely_ok" };
    expect(centreReachLabel(c)).toBe("Reachable, estimated from map data");
    expect(centreMapMarker(c)).toEqual({
      text: "Reachable, estimated from map data",
      color: "#319795",
    });
  });
  it("a closed centre reads 'Closed (staff report)', never reachable", () => {
    expect(routeStatusLabel("closed")).toBe("Closed (staff report)");
    expect(centreReachLabel({ reachable: false, route_status: "closed" })).toBe(
      "Closed (staff report)",
    );
    expect(centreMapMarker({ reachable: false, route_status: "closed" }).text).toBe(
      "Closed (staff report)",
    );
  });
  it("centre reachability", () => {
    expect(centreReachLabel({ reachable: true, route_status: "confirmed" })).toBe("Reachable");
    expect(centreReachLabel({ reachable: false, route_status: "no_data" })).toBe(NO_DATA_LABEL);
    expect(centreReachLabel({ reachable: false, route_status: "blocked" })).toBe("Not passable");
  });
  it("centre reachability distinguishes every route status", () => {
    const r = (reachable: boolean, route_status: string) =>
      centreReachLabel({ reachable, route_status });
    expect(r(true, "confirmed")).toBe("Reachable");
    expect(r(true, "partly_unverified")).toBe("Reachable, some paths not yet checked");
    expect(r(false, "blocked")).toBe("Not passable");
    expect(r(false, "no_data")).toBe("No mapped connection (data gap)");
  });
  it("map marker flags partly unverified centres", () => {
    expect(centreMapMarker({ reachable: true, route_status: "partly_unverified" })).toEqual({
      text: "Reachable, some paths not yet checked",
      color: "#B7791F",
    });
  });
  it("map marker: no_data is neutral, blocked stays red", () => {
    const nd = centreMapMarker({ reachable: false, route_status: "no_data" });
    expect(nd).toEqual({ text: "No mapped connection", color: "#6B7280" });
    const bl = centreMapMarker({ reachable: false, route_status: "blocked" });
    expect(bl).toEqual({ text: "Not reachable", color: "#C53030" });
    expect(centreMapMarker({ reachable: true, route_status: "confirmed" }).text).toBe("Reachable");
  });
});
