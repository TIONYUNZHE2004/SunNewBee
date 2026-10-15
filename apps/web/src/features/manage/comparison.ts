import type { Schemas } from "@tl/api-client";
import { NO_DATA_LABEL, PARTLY_LABEL } from "../../lib/routeStatus";
import type { Briefing } from "./manageApi";

export type ProfileInfo = Schemas["ProfileInfo"];

export interface ComparisonRow {
  key: string;
  label: string;
  baseline: number;
  scenario: number;
}

type CentreLike = { reachable: boolean; route_status: string };
type Counts = {
  likelyPaths: number;
  possiblePaths: number;
  places: number;
  reachable: number;
  partly: number;
  noData: number;
  blocked: number;
};

function counts(b: Briefing): Counts {
  const a = b.affected;
  const c = { reachable: 0, partly: 0, noData: 0, blocked: 0 };
  for (const x of b.centres as CentreLike[]) {
    if (x.route_status === "closed") continue; // closed (staff report): neither reachable nor blocked
    if (x.route_status === "no_data") c.noData++;
    else if (x.reachable && x.route_status === "partly_unverified") c.partly++;
    else if (x.reachable) c.reachable++;
    else c.blocked++;
  }
  return {
    likelyPaths: a.likely_edge_ids?.length ?? 0,
    possiblePaths: a.possible_edge_ids?.length ?? 0,
    places: (a.likely_place_ids?.length ?? 0) + (a.possible_place_ids?.length ?? 0),
    ...c,
  };
}

const ROWS: [keyof Counts, string][] = [
  ["likelyPaths", "Likely flooded paths"],
  ["possiblePaths", "Possibly flooded paths"],
  ["places", "Places affected"],
  ["reachable", "Centres reachable"],
  ["partly", `Centres: ${PARTLY_LABEL.toLowerCase()}`],
  ["noData", NO_DATA_LABEL],
  ["blocked", "Not passable"],
];

export function comparisonRows(baseline: Briefing, scenario: Briefing): ComparisonRow[] {
  const b = counts(baseline);
  const s = counts(scenario);
  return ROWS.map(([key, label]) => ({ key, label, baseline: b[key], scenario: s[key] }));
}

const THRESHOLDS: Record<string, [string, (v: number) => string]> = {
  max_incline_pct: ["Maximum incline", (v) => `${v}%`],
  max_step_count: ["Maximum steps", (v) => `${v}`],
  min_width_m: ["Minimum width", (v) => `${v} m`],
};

export function assumptionRows(p: Pick<ProfileInfo, "hard" | "max_rest_free_run_m">) {
  const rows = Object.entries(p.hard).map(([k, v]) => {
    const t = THRESHOLDS[k];
    return { label: t ? t[0] : k.replaceAll("_", " "), value: t ? t[1](v) : `${v}` };
  });
  if (p.max_rest_free_run_m != null)
    rows.push({ label: "Longest run without a rest stop", value: `${p.max_rest_free_run_m} m` });
  return rows;
}
