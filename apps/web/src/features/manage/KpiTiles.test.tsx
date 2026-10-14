import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KpiTilesView } from "./KpiTiles";
import { kpiTexts } from "./kpiModel";

describe("kpiTexts", () => {
  it("formats values", () => {
    const t = kpiTexts(
      { open_vrs: 4, median_hours_to_resolve: 5.25, journeys_confirmed_pct: 62.5 },
      18,
    );
    expect(t.open).toBe("4");
    expect(t.median).toBe("5.3 h");
    expect(t.journeys).toBe("63%");
    expect(t.dataGap).toBe("18% of journeys have no mapped connection (data gap)");
  });
  it("uses plain fallbacks when data is missing", () => {
    const t = kpiTexts(
      { open_vrs: 0, median_hours_to_resolve: null, journeys_confirmed_pct: null },
      null,
    );
    expect(t.open).toBe("0");
    expect(t.median).toBe("Not enough data");
    expect(t.journeys).toBe("No run yet");
    expect(t.dataGap).toBeNull();
  });
  it("hides data gap when it is zero", () => {
    expect(
      kpiTexts({ open_vrs: 1, median_hours_to_resolve: 1, journeys_confirmed_pct: 100 }, 0).dataGap,
    ).toBeNull();
  });
});

describe("KpiTilesView", () => {
  const k = { open_vrs: 7, median_hours_to_resolve: null, journeys_confirmed_pct: 40 };
  it("renders labelled tiles", () => {
    const h = renderToStaticMarkup(<KpiTilesView state="ready" kpis={k} noDataPct={12} />);
    expect(h).toContain("Open verification requests");
    expect(h).toContain("Median hours to resolve");
    expect(h).toContain("Not enough data");
    expect(h).toContain("Journeys confirmed (latest run)");
    expect(h).toContain("40%");
    expect(h).toContain("12% of journeys have no mapped connection (data gap)");
  });
  it("renders loading and error states", () => {
    expect(renderToStaticMarkup(<KpiTilesView state="loading" />)).toContain("Loading");
    expect(renderToStaticMarkup(<KpiTilesView state="error" />)).toContain("unavailable");
  });
});
