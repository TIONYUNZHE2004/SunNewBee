import type { Kpis } from "./manageApi";

export type KpiTexts = {
  open: string;
  median: string;
  journeys: string;
  dataGap: string | null;
};

export function kpiTexts(k: Kpis, noDataPct: number | null): KpiTexts {
  return {
    open: String(k.open_vrs),
    median:
      k.median_hours_to_resolve == null
        ? "Not enough data"
        : `${Math.round(k.median_hours_to_resolve * 10) / 10} h`,
    journeys:
      k.journeys_confirmed_pct == null ? "No run yet" : `${Math.round(k.journeys_confirmed_pct)}%`,
    dataGap:
      noDataPct && noDataPct > 0
        ? `${noDataPct}% of journeys have no mapped connection (data gap)`
        : null,
  };
}
