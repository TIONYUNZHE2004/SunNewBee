/** What-if diffs from the township world model (POST /what-if, or the assistant's whatif.diff).
 * Pure helpers: every line drawn from a what-if is labelled imagined, never a real route. */

export const WHATIF_STYLE = {
  before: { color: "#8A8F98", width: 5, label: "Before" },
  after: { color: "#9F7AEA", width: 7, label: "What-if (imagined)" },
  touched: { color: "#D53F8C", width: 11, label: "Imagined change" },
} as const;

export const WHATIF_LEGEND = "What-if · not real";

type Coords = number[][];

export interface WhatIfLines {
  before: Coords[];
  after: Coords[];
  touched: Coords[];
}

interface Feature {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
}

const isLine = (c: unknown): c is Coords =>
  Array.isArray(c) &&
  c.length >= 2 &&
  c.every((p) => Array.isArray(p) && p.length >= 2 && p.every((n) => typeof n === "number"));

/** Split a whatif.diff FeatureCollection into the three line sets; anything not tagged
 * `whatif: true` is ignored, so a stray real route can never be drawn as imagined (or vice versa). */
export function diffLines(fc: { features?: Feature[] } | null | undefined): WhatIfLines {
  const out: WhatIfLines = { before: [], after: [], touched: [] };
  for (const f of fc?.features ?? []) {
    const p = f.properties ?? {};
    const c = f.geometry?.type === "LineString" ? f.geometry.coordinates : null;
    if (p.whatif !== true || !isLine(c)) continue;
    if (p.side === "before" || p.side === "after" || p.side === "touched") out[p.side].push(c);
  }
  return out;
}

export interface WhatIfSummary {
  total?: number;
  reach_before?: number;
  reach_after?: number;
  reach_stage_only?: number;
  confirmed_before?: number;
  confirmed_after?: number;
  changed?: number;
}

export interface Bar {
  label: string;
  today: number;
  whatIf: number;
  total: number;
}

/** Before/after bars for the Lab card. Numbers are copied from the engine's summary, never computed here. */
export function summaryBars(s: WhatIfSummary, scope: string): Bar[] {
  const total = s.total ?? 0;
  const reach = scope === "evacuation" ? "Reach a centre" : "Have a mapped route";
  const bars: Bar[] = [
    { label: reach, today: s.reach_before ?? 0, whatIf: s.reach_after ?? 0, total },
    {
      label: "Confirmed route",
      today: s.confirmed_before ?? 0,
      whatIf: s.confirmed_after ?? 0,
      total,
    },
  ];
  if (typeof s.reach_stage_only === "number")
    bars.splice(1, 0, {
      label: `${reach} (river rise only)`,
      today: s.reach_before ?? 0,
      whatIf: s.reach_stage_only,
      total,
    });
  return bars;
}

export const pct = (n: number, total: number) => (total > 0 ? Math.round((100 * n) / total) : 0);

/** A stable key per suggested action (checkbox ids). */
export const actionKey = (a: { kind: string; element_id?: string; attribute?: string }) =>
  [a.kind, a.element_id ?? "", a.attribute ?? ""].join(":");

export interface PlanFactLike {
  element_id: string;
  path_label: string;
  check: string;
  journeys_relying: number;
  ticket_id?: string | null;
}

export interface SiteGroup {
  elementId: string;
  where: string;
  checks: string[];
  journeys: number;
  ticketIds: string[];
}

/** One line per place to visit: the checks to make there, in plan order. */
export function groupBySite(facts: PlanFactLike[]): SiteGroup[] {
  const out: SiteGroup[] = [];
  const by = new Map<string, SiteGroup>();
  for (const f of facts) {
    let g = by.get(f.element_id);
    if (!g) {
      const where = f.path_label.charAt(0).toUpperCase() + f.path_label.slice(1);
      g = { elementId: f.element_id, where, checks: [], journeys: 0, ticketIds: [] };
      by.set(f.element_id, g);
      out.push(g);
    }
    g.checks.push(f.check);
    g.journeys = Math.max(g.journeys, f.journeys_relying);
    if (f.ticket_id) g.ticketIds.push(f.ticket_id);
  }
  return out;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface DiffMeta {
  summary: WhatIfSummary;
  actions: string[];
  profile: string;
  scope: string;
  imagined: boolean;
  changedShown: number;
}

/** The engine's summary carried on the diff (`meta`, a GeoJSON foreign member), so the lite map
 * and the list can show a what-if without the Lab. Copied, never recomputed; null when absent. */
export function diffMeta(fc: { meta?: unknown } | null | undefined): DiffMeta | null {
  const m = fc?.meta as Record<string, unknown> | undefined;
  if (!m || typeof m !== "object" || typeof m.summary !== "object" || !m.summary) return null;
  return {
    summary: m.summary as WhatIfSummary,
    actions: Array.isArray(m.actions) ? m.actions.filter((a) => typeof a === "string") : [],
    profile: typeof m.profile === "string" ? m.profile : "",
    scope: typeof m.scope === "string" ? m.scope : "suite",
    imagined: m.imagined === true,
    changedShown: typeof m.changed_shown === "number" ? m.changed_shown : 0,
  };
}

export interface DiffJourney {
  from: string;
  to: string;
  before: string;
  after: string;
}

/** One row per changed journey (before/after status), in engine order: from `meta.changed`,
 * which lists both statuses even when a cut route has no "after" line; else from the lines. */
export function diffJourneys(
  fc: { features?: Feature[]; meta?: unknown } | null | undefined,
): DiffJourney[] {
  const rows = (fc?.meta as { changed?: unknown } | undefined)?.changed;
  if (Array.isArray(rows))
    return rows
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({
        from: String(r.from_name ?? "A mapped place"),
        to: String(r.to_name ?? "a mapped place"),
        before: String(r.before ?? ""),
        after: String(r.after ?? ""),
      }));
  const by = new Map<number, DiffJourney>();
  for (const f of fc?.features ?? []) {
    const p = f.properties ?? {};
    if (p.whatif !== true || (p.side !== "before" && p.side !== "after")) continue;
    if (typeof p.journey !== "number") continue;
    const j = by.get(p.journey) ?? {
      from: String(p.from_name ?? "A mapped place"),
      to: String(p.to_name ?? "a mapped place"),
      before: "",
      after: "",
    };
    j[p.side] = String(p.status ?? "");
    by.set(p.journey, j);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, j]) => j);
}

/** Readable names of the imagined paths (touched edges). */
export function touchedLabels(fc: { features?: Feature[] } | null | undefined): string[] {
  const out: string[] = [];
  for (const f of fc?.features ?? []) {
    const p = f.properties ?? {};
    if (p.whatif === true && p.side === "touched" && typeof p.label === "string") {
      const l = p.label.charAt(0).toUpperCase() + p.label.slice(1);
      if (!out.includes(l)) out.push(l);
    }
  }
  return out;
}

const ROUTE_STATUS_WORDS: Record<string, string> = {
  confirmed: "confirmed",
  partly_unverified: "partly unverified",
  blocked: "blocked",
  no_data: "no mapped connection",
};
/** A route status in words ("no_data" is a data gap, never "not reachable"). */
export const routeStatusWord = (s: string) => ROUTE_STATUS_WORDS[s] ?? s.replace(/_/g, " ");
