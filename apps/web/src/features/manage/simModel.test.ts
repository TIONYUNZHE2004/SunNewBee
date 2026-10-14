import { describe, expect, it } from "vitest";
import { outcomeLabel, summariseCounts, violationLabel } from "./simModel";

const counts = {
  stroller: { success: 3, success_with_unknowns: 1, blocked: 1, no_data: 1 },
  wheelchair: { success: 1, blocked: 2 },
};

describe("summariseCounts", () => {
  it("percentages per profile and overall sum to 100", () => {
    const s = summariseCounts({ counts });
    for (const p of [...Object.values(s.byProfile), s.overall]) {
      expect(p.confirmedPct + p.possiblePct + p.blockedPct + p.noDataPct).toBe(100);
    }
    expect(s.byProfile.wheelchair).toMatchObject({ confirmedPct: 33, blockedPct: 67 });
    expect(s.overall.total).toBe(9);
  });
  it("sums to 100 when rounding would otherwise drift", () => {
    const s = summariseCounts({ counts: { x: { success: 1, blocked: 1, no_data: 1 } } });
    const p = s.byProfile.x;
    expect(p && p.confirmedPct + p.blockedPct + p.noDataPct).toBe(100);
  });
  it("empty report gives zeros", () => {
    const s = summariseCounts({ counts: {} });
    expect(s.byProfile).toEqual({});
    expect(s.overall).toEqual({
      total: 0,
      confirmedPct: 0,
      possiblePct: 0,
      blockedPct: 0,
      noDataPct: 0,
    });
  });
  it("a profile with zero tasks gives zeros", () => {
    expect(summariseCounts({ counts: { a: {} } }).byProfile.a?.total).toBe(0);
  });
});

describe("labels", () => {
  it("outcomeLabel", () => {
    expect(outcomeLabel("success")).toBe("Confirmed");
    expect(outcomeLabel("success_with_unknowns")).toBe("Possible (unverified)");
    expect(outcomeLabel("blocked")).toBe("Not passable");
    expect(outcomeLabel("no_data")).toBe("No mapped connection (data gap)");
    expect(outcomeLabel("weird")).toBe("weird");
  });
  it("violationLabel", () => {
    expect(violationLabel("I1")).toBe("Route used a non-passable segment");
    expect(violationLabel("I2")).toBe("Unverified segment not disclosed");
    expect(violationLabel("I7")).toBe("Rest stops too far apart for older residents");
    expect(violationLabel("I9")).toBe("Invariant check failed (I9)");
  });
});
