import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SimReport } from "../tickets/manageApi";
import { JourneyReport } from "./JourneyTests";
import { summariseCounts } from "./simModel";

const base: SimReport = {
  run_id: "sim-0123456789abcdef",
  created_at: "2026-10-15T00:00:00Z",
  scenario_id: null,
  counts: { older_adult_rest: { success_with_unknowns: 2 } },
  results: [],
  gaps: [],
  invariant_violations: [],
  rest_advisories: [],
  rest_limit_m: 100,
  rest_long_segments: 0,
  gaps_truncated: false,
  world_version: 0,
};
const html = (r: SimReport) =>
  renderToStaticMarkup(<JourneyReport report={r} summary={summariseCounts(r)} />);

describe("JourneyReport: critical violations vs advisory notes (Task 41)", () => {
  it("lists rest-limit advisories apart from invariant violations, in plain words", () => {
    const out = html({
      ...base,
      rest_advisories: [
        {
          kind: "rest_limit_no_alternative",
          task_id: "older_adult_rest:park-b>hall",
          detail: "longest stretch without a rest point 146.0 m > limit 100 m",
          long_segments: 2,
        },
      ],
      rest_long_segments: 2,
    });
    expect(out).toContain("No critical invariant violations.");
    expect(out).toContain("Advisory notes");
    expect(out).toContain("Routes over the rest limit (no alternative): 1");
    expect(out).toContain("older_adult_rest:park-b&gt;hall");
    expect(out).toContain(
      "No route keeps every stretch under 100 m: 2 path segments are longer than 100 m with no mapped rest point along them.",
    );
    expect(out).toContain("never confirmed");
    expect(out).not.toMatch(/more mapped rest points|would help/i);
    expect(out).not.toContain("critical)");
  });
  it("marks a rest-limit breach the router claimed as critical", () => {
    const out = html({
      ...base,
      invariant_violations: [{ invariant: "I7", task_id: "t", detail: "rest_gap_exceeds_limit" }],
    });
    expect(out).toContain("(I7, critical)");
    expect(out).toContain("No advisory notes.");
  });
  it("an older report without rest_advisories still renders", () => {
    const { rest_advisories: _drop, ...old } = base;
    expect(html(old as SimReport)).toContain("No advisory notes.");
  });
});
