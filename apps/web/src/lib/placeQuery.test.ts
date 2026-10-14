import { describe, expect, it } from "vitest";
import { DEMO_ORIGIN_ID, originName, placeQueryParams, placeReach } from "./placeQuery";

describe("place query gating", () => {
  it("asks for reachability only for centres with a scenario", () => {
    expect(placeReach("evc-a", "stage_p3m", "stroller")).toEqual({
      scenarioId: "stage_p3m",
      profile: "stroller",
    });
    expect(placeReach("evc-a", null, "stroller")).toBeUndefined();
    expect(placeReach("toilet-1", "stage_p3m", "stroller")).toBeUndefined();
    expect(placeReach("wp-1", "stage_p3m", "default")).toBeUndefined();
  });
  it("builds scenario, profile and the demo origin", () => {
    expect(placeQueryParams(placeReach("evc-a", "stage_p3m", "drive"))).toEqual({
      scenario_id: "stage_p3m",
      profile: "drive",
      near: DEMO_ORIGIN_ID,
    });
    expect(placeQueryParams(undefined)).toEqual({});
    expect(placeQueryParams({ scenarioId: "s", profile: "default", near: "x" }).near).toBe("x");
  });
  it("names the demo origin", () => {
    expect(originName("lakeside-mall")).toBe("Elmina Lakeside Mall");
    expect(originName("other")).toBe("other");
  });
});
