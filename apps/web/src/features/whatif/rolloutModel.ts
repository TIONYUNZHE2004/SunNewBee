/** Rising-river rollout playback (GET /river-rollout). Pure helpers: which route each synthetic
 * resident walks at a stage, where along it they are, and their colour. Every route comes from
 * the engine; this file only interpolates along it for display. */

export const ROLLOUT_LEGEND =
  "Synthetic residents · simulation, not a forecast · no crowding, departure times or warnings · animation speed is illustrative";

export const RESIDENT_STYLE = {
  reach: { color: "#F6E05E", label: "Still reaches a centre" },
  cutOff: { color: "#F56565", label: "Cut off at this level" },
  noData: { color: "#A0AEC0", label: "No mapped connection" },
} as const;

export type ResidentKind = keyof typeof RESIDENT_STYLE;

export interface ResidentLike {
  id: string;
  statuses: string[];
  route_ids: (string | null)[];
}

export function kindAt(r: ResidentLike, stage: number): ResidentKind {
  const s = r.statuses[stage] ?? "no_data";
  if (s === "confirmed" || s === "partly_unverified") return "reach";
  return s === "blocked" || s === "start_flooded" ? "cutOff" : "noData";
}

/** The route walked at `stage`; a cut-off resident stays where their last route started. */
export function routeAt(
  r: ResidentLike,
  stage: number,
): { routeId: string | null; moving: boolean } {
  const now = r.route_ids[stage] ?? null;
  if (now && kindAt(r, stage) === "reach") return { routeId: now, moving: true };
  for (let i = stage; i >= 0; i--) {
    const prev = r.route_ids[i];
    if (prev) return { routeId: prev, moving: false };
  }
  return { routeId: null, moving: false };
}

type Coords = number[][];

/** Cumulative planar lengths (degrees are fine for interpolation over a few km). */
function cumulative(coords: Coords): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1] as number[];
    const b = coords[i] as number[];
    out.push(
      (out[i - 1] as number) + Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0)),
    );
  }
  return out;
}

/** Point at `f` in [0, 1] along the line (by length). */
export function pointAlong(coords: Coords, f: number): [number, number] {
  if (coords.length === 0) return [0, 0];
  const first = coords[0] as number[];
  if (coords.length === 1) return [first[0] ?? 0, first[1] ?? 0];
  const cum = cumulative(coords);
  const total = cum[cum.length - 1] as number;
  if (total === 0) return [first[0] ?? 0, first[1] ?? 0];
  const d = Math.min(Math.max(f, 0), 1) * total;
  let i = 1;
  while (i < cum.length - 1 && (cum[i] as number) < d) i++;
  const a = coords[i - 1] as number[];
  const b = coords[i] as number[];
  const span = (cum[i] as number) - (cum[i - 1] as number) || 1;
  const t = (d - (cum[i - 1] as number)) / span;
  return [
    (a[0] ?? 0) + t * ((b[0] ?? 0) - (a[0] ?? 0)),
    (a[1] ?? 0) + t * ((b[1] ?? 0) - (a[1] ?? 0)),
  ];
}

/** Deterministic phase per resident, so they do not all move in step. */
export function phase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

export interface StageCount {
  total: number;
  reach: number;
  confirmed: number;
  confirmed_on_demo?: number;
  cut_off: number;
  no_data: number;
}

/** Per-profile rows for one stage, numbers copied from the engine's counts. */
export function stageRows(
  counts: Record<string, Record<string, Partial<StageCount> & Record<string, number>>>,
  stageId: string,
): { profile: string; reach: number; total: number; cutOff: number }[] {
  return Object.entries(counts).map(([profile, per]) => {
    const c = per[stageId];
    return { profile, reach: c?.reach ?? 0, total: c?.total ?? 0, cutOff: c?.cut_off ?? 0 };
  });
}
