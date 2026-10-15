import { describe, expect, it } from "vitest";
import {
  advisoryLabel,
  checkSummary,
  checkSummaryText,
  EVAC_RESULTS,
  evacResultLabel,
  evacScenarioLabel,
  isCriticalViolation,
  outcomeLabel,
  restAdvisoryText,
  summariseCounts,
  violationLabel,
} from "./simModel";

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
    expect(violationLabel("I7")).toBe(
      "Route claimed rest stops within the limit, but a stretch is longer",
    );
    expect(violationLabel("I9")).toBe("Invariant check failed (I9)");
  });
});

describe("critical violations vs advisory notes", () => {
  it("I7 is critical now: the router only claims the rest limit when it holds", () => {
    expect(isCriticalViolation("I7")).toBe(true);
    expect(isCriticalViolation("I1")).toBe(true);
    expect(isCriticalViolation("I9")).toBe(false);
  });
  it("advisoryLabel", () => {
    expect(advisoryLabel("rest_limit_no_alternative")).toBe(
      "Routes over the rest limit (no alternative)",
    );
    expect(advisoryLabel("rest_search_stopped_early")).toBe(
      "Rest-point search stopped early (a route within the limit may exist)",
    );
    expect(advisoryLabel("other")).toBe("Advisory note (other)");
  });
  it("checkSummary separates critical violations from advisory notes", () => {
    const adv = { kind: "rest_limit_no_alternative", task_id: "t", detail: "d" };
    const s = checkSummary({
      invariant_violations: [{ invariant: "I1" }],
      rest_advisories: [adv, adv],
    });
    expect(s).toEqual({ critical: 1, other: 0, advisories: 2 });
  });
  it("an empty or older report has nothing to flag", () => {
    expect(checkSummary({ invariant_violations: [] })).toEqual({
      critical: 0,
      other: 0,
      advisories: 0,
    });
  });
  it("checkSummaryText in plain words", () => {
    expect(checkSummaryText({ critical: 0, other: 0, advisories: 60 })).toBe(
      "0 critical invariant violations, 60 advisory notes",
    );
    expect(checkSummaryText({ critical: 1, other: 2, advisories: 1 })).toBe(
      "1 critical invariant violation, 2 other invariant violations, 1 advisory note",
    );
  });
});

describe("restAdvisoryText (Task 41 fix round 1, R30 I-3)", () => {
  it("names the long segments from the run's data", () => {
    expect(restAdvisoryText({ rest_limit_m: 100, rest_long_segments: 151 })).toBe(
      "No route keeps every stretch under 100 m: 151 path segments are longer than 100 m with no mapped rest point along them.",
    );
    expect(restAdvisoryText({ rest_limit_m: 100, rest_long_segments: 1 })).toBe(
      "No route keeps every stretch under 100 m: 1 path segment is longer than 100 m with no mapped rest point along it.",
    );
  });
  it("without long segments it says only what holds", () => {
    expect(restAdvisoryText({ rest_limit_m: 100, rest_long_segments: 0 })).toBe(
      "No route keeps every stretch under 100 m between mapped rest points.",
    );
  });
  it("never suggests mapping more rest points", () => {
    for (const n of [0, 1, 5]) {
      expect(restAdvisoryText({ rest_limit_m: 100, rest_long_segments: n })).not.toMatch(
        /map(ping)? more|would help/i,
      );
    }
  });
  it("older reports without the fields fall back to the profile limit wording", () => {
    expect(restAdvisoryText({})).toBe(
      "No route keeps every stretch within the rest limit between mapped rest points.",
    );
  });
});

describe("evacuation labels (Task 47)", () => {
  it("uses plain words and never says safe or not reachable", () => {
    const all = EVAC_RESULTS.map(evacResultLabel).join(" | ");
    expect(all).toContain("No mapped connection (data gap)");
    expect(all).not.toMatch(/\bsafe\b|not reachable/i);
    expect(evacResultLabel("other")).toBe("other");
  });
  it("names river levels as indicative", () => {
    expect(evacScenarioLabel("baseline")).toBe("Normal river level");
    expect(evacScenarioLabel("stage_p3m")).toBe("River +3 m (indicative)");
  });
  it("treats E1 and E2 as critical", () => {
    expect(isCriticalViolation("E1")).toBe(true);
    expect(violationLabel("E2")).toMatch(/Baseline/);
  });
});
