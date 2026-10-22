import { describe, expect, it } from "vitest";
import { joinScenario, levelOptions, splitScenario } from "./SettingsPopover";

const rows = [
  { id: "baseline", label: "Normal", stage_m: 0, kind: "river_stage" },
  { id: "stage_p1m", label: "River +1 m", stage_m: 1, kind: "river_stage" },
  { id: "stage_p3m", label: "River +3 m", stage_m: 3, kind: "river_stage" },
  { id: "lowlying", label: "Low-lying areas", stage_m: 0, kind: "lowlying" },
  { id: "stage_p3m+lowlying", label: "River +3 m + low-lying", stage_m: 3, kind: "combined" },
];

describe("river level and low-lying switch (T-029)", () => {
  it("lists river stages only, never a combined scenario as another +3 m", () => {
    expect(levelOptions(rows).map((o) => o.label)).toEqual(["Normal", "+1 m", "+3 m"]);
  });

  it("splits and joins a scenario id with the low-lying switch", () => {
    expect(splitScenario("stage_p3m+lowlying")).toEqual({ stage: "stage_p3m", lowlying: true });
    expect(splitScenario("lowlying")).toEqual({ stage: null, lowlying: true });
    expect(splitScenario("baseline")).toEqual({ stage: null, lowlying: false });
    expect(joinScenario("stage_p3m", true, rows)).toBe("stage_p3m+lowlying");
    expect(joinScenario(null, true, rows)).toBe("lowlying");
    expect(joinScenario("stage_p3m", false, rows)).toBe("stage_p3m");
    // no combined scenario in this world: the river stage alone, never an id that does not exist
    expect(joinScenario("stage_p1m", true, rows)).toBe("stage_p1m");
  });
});
