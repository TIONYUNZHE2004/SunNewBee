import { describe, expect, it } from "vitest";
import type { ToolChip } from "../chat/chatReducer";
import { toolStep } from "./toolSteps";

const names = new Map([
  ["park-b", "Lakeside Mall Car Park B"],
  ["playground", "Urban Park playground"],
]);
const tool = (name: string, args: Record<string, unknown>, done = false): ToolChip => ({
  id: "t",
  name,
  args,
  done,
});

describe("toolStep", () => {
  it("names the lookup text, present tense while running and past once done", () => {
    expect(toolStep(tool("find_place", { query: "Car Park B" }), names)).toBe(
      "Looking up “Car Park B”",
    );
    expect(toolStep(tool("find_place", { query: "Car Park B" }, true), names)).toBe(
      "Looked up “Car Park B”",
    );
  });
  it("plan_route uses mapped place names, the profile and the river stage", () => {
    expect(
      toolStep(
        tool("plan_route", {
          from_id: "park-b",
          to_id: "playground",
          profile: "stroller",
          scenario_id: "stage_p3m",
        }),
        names,
      ),
    ).toBe(
      "Checking each path on a stroller route from Lakeside Mall Car Park B to Urban Park playground at river +3 m (indicative)",
    );
  });
  it("never shows a raw id when the name is unknown", () => {
    const s = toolStep(tool("plan_route", { from_id: "seg-123", to_id: "x-9" }, true), names);
    expect(s).toBe("Checked each path on a route from the start to the destination");
    expect(s).not.toMatch(/seg-123|x-9/);
  });
  it("falls back to the spaced tool name for an unknown tool", () => {
    expect(toolStep(tool("new_tool_name", {}), names)).toBe("new tool name");
  });
  it("never claims safety or a result", () => {
    for (const n of ["plan_route", "affected_places", "river_tipping_point", "get_closures"])
      expect(toolStep(tool(n, {}, true), names)).not.toMatch(/\bsafe\b|confirmed|verified/i);
  });
});
