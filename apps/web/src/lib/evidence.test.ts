import { describe, expect, it } from "vitest";
import { claimBadge, DEMO_LABEL } from "./evidence";

const verified = { label: "Verified", icon: "✓" };

describe("claimBadge", () => {
  it("placeholder facts read as demo values: no tick, no checked date", () => {
    expect(claimBadge("team_survey_placeholder", verified, "2026-10-18")).toEqual({
      label: DEMO_LABEL,
      icon: "",
      verifiedAt: null,
      demo: true,
    });
  });
  it("real evidence keeps its status and date", () => {
    expect(claimBadge("field_survey", verified, "2026-10-18")).toEqual({
      ...verified,
      verifiedAt: "2026-10-18",
      demo: false,
    });
  });
});
