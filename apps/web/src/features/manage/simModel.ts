export const OUTCOMES = ["success", "success_with_unknowns", "blocked", "no_data"] as const;
export type Outcome = (typeof OUTCOMES)[number];

const OUTCOME_LABELS: Record<Outcome, string> = {
  success: "Confirmed",
  success_with_unknowns: "Possible (unverified)",
  blocked: "Not passable",
  no_data: "No mapped connection (data gap)",
};
export const outcomeLabel = (o: string): string => OUTCOME_LABELS[o as Outcome] ?? o;

const VIOLATIONS: Record<string, { label: string; critical: boolean }> = {
  I1: { label: "Route used a non-passable segment", critical: true },
  I2: { label: "Unverified segment not disclosed", critical: true },
  // The router marks a route as within the rest limit only when it is (Task 41), so a breach
  // is a routing bug. Routes with no alternative are advisory notes, not I7.
  I7: {
    label: "Route claimed rest stops within the limit, but a stretch is longer",
    critical: true,
  },
};
export const violationLabel = (i: string): string =>
  VIOLATIONS[i]?.label ?? `Invariant check failed (${i})`;
export const isCriticalViolation = (i: string): boolean => VIOLATIONS[i]?.critical ?? false;

// Evacuation journeys (Task 47, G-07). E1/E2 are the G-08 (c) checks on the evacuation table.
VIOLATIONS.E1 = {
  label: "A higher river stage improved an evacuation journey",
  critical: true,
};
VIOLATIONS.E2 = {
  label: "Baseline evacuation result differs from the no-scenario result",
  critical: true,
};

export const EVAC_RESULTS = [
  "reachable_confirmed",
  "reachable_partly_unverified",
  "blocked_by_flood",
  "no_mapped_connection",
  "no_centre",
] as const;
const EVAC_LABELS: Record<string, string> = {
  reachable_confirmed: "Reachable (confirmed)",
  reachable_partly_unverified: "Reachable (some parts unverified)",
  blocked_by_flood: "Blocked (known barrier or flood)",
  no_mapped_connection: "No mapped connection (data gap)",
  no_centre: "No evacuation centre mapped",
};
export const evacResultLabel = (r: string): string => EVAC_LABELS[r] ?? r;

export function evacScenarioLabel(id: string): string {
  if (id === "baseline") return "Normal river level";
  const m = /^stage_p(\d+)m$/.exec(id);
  return m ? `River +${m[1]} m (indicative)` : id;
}

/** One plain sentence per run: how many sampled journeys reach a centre at all. */
export function evacSummaryText(ev: {
  origins_sampled: number;
  origins_available: number;
}): string {
  return `${ev.origins_sampled} of ${ev.origins_available} mapped starting places, the same places for every profile and river level.`;
}

const ADVISORIES: Record<string, string> = {
  rest_limit_no_alternative: "Routes over the rest limit (no alternative)",
  rest_search_stopped_early: "Rest-point search stopped early (a route within the limit may exist)",
};
export const advisoryLabel = (k: string): string => ADVISORIES[k] ?? `Advisory note (${k})`;

export type CheckSummary = { critical: number; other: number; advisories: number };

export function checkSummary(report: {
  invariant_violations: { invariant: string }[];
  rest_advisories?: unknown[];
}): CheckSummary {
  const critical = report.invariant_violations.filter((v) =>
    isCriticalViolation(v.invariant),
  ).length;
  return {
    critical,
    other: report.invariant_violations.length - critical,
    advisories: report.rest_advisories?.length ?? 0,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function checkSummaryText(s: CheckSummary): string {
  return [
    plural(s.critical, "critical invariant violation", "critical invariant violations"),
    ...(s.other > 0
      ? [plural(s.other, "other invariant violation", "other invariant violations")]
      : []),
    plural(s.advisories, "advisory note", "advisory notes"),
  ].join(", ");
}

export type Pcts = {
  total: number;
  confirmedPct: number;
  possiblePct: number;
  blockedPct: number;
  noDataPct: number;
};

/** Largest-remainder rounding so the four percentages always add to exactly 100. */
function pcts(c: Record<string, number>): Pcts {
  const raw = OUTCOMES.map((o) => c[o] ?? 0);
  const total = raw.reduce((a, b) => a + b, 0);
  if (total === 0)
    return { total: 0, confirmedPct: 0, possiblePct: 0, blockedPct: 0, noDataPct: 0 };
  const exact = raw.map((n) => (n * 100) / total);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left--;
  }
  const [a = 0, b = 0, c2 = 0, d = 0] = floors;
  return { total, confirmedPct: a, possiblePct: b, blockedPct: c2, noDataPct: d };
}

export function summariseCounts(report: { counts: Record<string, Record<string, number>> }): {
  byProfile: Record<string, Pcts>;
  overall: Pcts;
} {
  const byProfile: Record<string, Pcts> = {};
  const sum: Record<string, number> = {};
  for (const [p, c] of Object.entries(report.counts)) {
    byProfile[p] = pcts(c);
    for (const [o, n] of Object.entries(c)) sum[o] = (sum[o] ?? 0) + n;
  }
  return { byProfile, overall: pcts(sum) };
}

export const PROFILE_LABELS: Record<string, string> = {
  default: "Default",
  stroller: "Stroller",
  wheelchair: "Wheelchair",
  older_adult_rest: "Older adult (rest stops)",
  drive: "Drive",
};
export const profileLabel = (p: string): string => PROFILE_LABELS[p] ?? p;

/** Why no route keeps the rest limit, from the run's own counts (Task 41, R30 I-3). Rest points
 * sit at path junctions, so a segment longer than the limit cannot be split by one. */
export function restAdvisoryText(report: {
  rest_limit_m?: number | null;
  rest_long_segments?: number;
}): string {
  const limit = report.rest_limit_m;
  if (limit == null)
    return "No route keeps every stretch within the rest limit between mapped rest points.";
  const n = report.rest_long_segments ?? 0;
  if (n === 0) return `No route keeps every stretch under ${limit} m between mapped rest points.`;
  return n === 1
    ? `No route keeps every stretch under ${limit} m: 1 path segment is longer than ${limit} m with no mapped rest point along it.`
    : `No route keeps every stretch under ${limit} m: ${n} path segments are longer than ${limit} m with no mapped rest point along them.`;
}
