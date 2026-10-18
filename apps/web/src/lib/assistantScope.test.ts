import { describe, expect, it } from "vitest";
import { showsResidentTrip } from "./api";

describe("showsResidentTrip", () => {
  it("shows Rehearse my trip to residents only when the assistant covers everything", () => {
    expect(showsResidentTrip("all")).toBe(true);
    expect(showsResidentTrip("access_flood")).toBe(false);
    // still loading or the API is down: keep to the default scope B
    expect(showsResidentTrip(undefined)).toBe(false);
  });
});
