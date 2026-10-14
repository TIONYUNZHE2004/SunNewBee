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
  I7: { label: "Rest stops too far apart for older residents", critical: false },
};
export const violationLabel = (i: string): string =>
  VIOLATIONS[i]?.label ?? `Invariant check failed (${i})`;
export const isCriticalViolation = (i: string): boolean => VIOLATIONS[i]?.critical ?? false;

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
