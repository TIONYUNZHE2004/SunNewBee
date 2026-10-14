import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssumptionsView } from "./Assumptions";
import { assumptionRows, comparisonRows } from "./comparison";
import { ComparisonTable } from "./FloodBriefing";

const aff = (l: number, p: number, lp: number, pp: number) => ({
  scenario_id: "x",
  likely: [],
  possible: [],
  isolated_components: [],
  disclaimer: "",
  likely_edge_ids: Array(l).fill("e"),
  possible_edge_ids: Array(p).fill("e"),
  likely_place_ids: Array(lp).fill("p"),
  possible_place_ids: Array(pp).fill("p"),
});
const centre = (id: string, reachable: boolean, route_status: string) => ({
  centre: { id, name: id, source: "official_pps" as const },
  reachable,
  route_status,
});
const base = {
  scenario: { id: "baseline", label: "Normal" },
  affected: aff(0, 0, 0, 0),
  centres: [centre("a", true, "confirmed"), centre("b", true, "confirmed")],
  disclaimer: "",
};
const scen = {
  scenario: { id: "stage_p3m", label: "River +3 m (indicative)" },
  affected: aff(5, 7, 1, 2),
  centres: [
    centre("a", true, "partly_unverified"),
    centre("b", false, "no_data"),
    centre("c", false, "blocked"),
  ],
  disclaimer: "",
};

describe("comparisonRows", () => {
  it("counts paths, places and centre states for both columns", () => {
    const rows = comparisonRows(base, scen);
    const get = (k: string) => rows.find((r) => r.key === k);
    expect(get("likelyPaths")).toMatchObject({ baseline: 0, scenario: 5 });
    expect(get("possiblePaths")).toMatchObject({ baseline: 0, scenario: 7 });
    expect(get("places")).toMatchObject({ baseline: 0, scenario: 3 });
    expect(get("reachable")).toMatchObject({ baseline: 2, scenario: 0 });
    expect(get("partly")).toMatchObject({ baseline: 0, scenario: 1 });
    expect(get("noData")?.label).toBe("No mapped connection (data gap)");
    expect(get("noData")).toMatchObject({ baseline: 0, scenario: 1 });
    expect(get("blocked")?.label).toBe("Not passable");
    expect(get("blocked")).toMatchObject({ baseline: 0, scenario: 1 });
  });
});

describe("ComparisonTable", () => {
  it("renders two labelled columns and the origin", () => {
    const h = renderToStaticMarkup(
      <ComparisonTable baseline={base} scenario={scen} scenarioLabel="River +3 m (indicative)" />,
    );
    expect(h).toContain("Normal river level");
    expect(h).toContain("River +3 m (indicative)");
    expect(h).toContain("from Elmina Lakeside Mall, demo start point");
    expect(h).toContain("Likely flooded paths");
    expect(h).toContain("Possibly flooded paths");
    expect(h).toContain("Places affected");
    expect(h).toContain('scope="col"');
  });
  it("labels the origin from the API's near_place, not a hard-coded mall", () => {
    const h = renderToStaticMarkup(
      <ComparisonTable
        baseline={base}
        scenario={scen}
        scenarioLabel="x"
        origin={{ id: "clinic-1", name: "Klinik Elmina" }}
      />,
    );
    expect(h).toContain("from Klinik Elmina, demo start point");
    expect(h).not.toContain("Lakeside Mall");
    const byId = renderToStaticMarkup(
      <ComparisonTable
        baseline={base}
        scenario={scen}
        scenarioLabel="x"
        origin={{ id: "clinic-1" }}
      />,
    );
    expect(byId).toContain("from clinic-1, demo start point");
  });
  it("says so when the baseline is unavailable", () => {
    const h = renderToStaticMarkup(
      <ComparisonTable baseline={undefined} scenario={scen} scenarioLabel="x" />,
    );
    expect(h).toContain("Normal river level unavailable");
  });
});

describe("assumptions", () => {
  const w = {
    id: "wheelchair",
    label: "Wheelchair user",
    hard: { max_step_count: 0, max_incline_pct: 8.3, min_width_m: 0.9 },
    soft: {},
    threshold_basis: "our engineering default (no published source)",
  };
  it("lists thresholds with plain labels", () => {
    const r = assumptionRows(w);
    expect(r).toContainEqual({ label: "Maximum incline", value: "8.3%" });
    expect(r).toContainEqual({ label: "Maximum steps", value: "0" });
    expect(r).toContainEqual({ label: "Minimum width", value: "0.9 m" });
  });
  it("labels every threshold as an engineering default", () => {
    const h = renderToStaticMarkup(<AssumptionsView profiles={[w]} selected="wheelchair" />);
    expect(h).toContain("our engineering default (no published source)");
    expect(h).toContain("Assumptions");
    expect(h).toContain("Maximum incline");
    expect(h).toContain("indicative");
  });
});
