/** Elmina Day playback (pure, tested). Every position comes from the engine's tracks: a resident
 * moves at constant speed along each segment's real path nodes between the segment's start and
 * end minute, and stands still on a waiting segment. Nothing here invents a number. */

export const DAY_START = 5 * 60;
export const DAY_END = 23 * 60;
export const DAY_LEGEND = "Rehearsal · synthetic residents · not a forecast";

export const DAY_STYLE = {
  walk: { color: "#F6E05E", label: "Walking" },
  drive: { color: "#63B3ED", label: "Driving" },
  wait: { color: "#F56565", label: "Waiting for the water" },
} as const;
export type DayState = keyof typeof DAY_STYLE;

export const hhmm = (m: number) => {
  const x = Math.max(0, Math.round(m));
  return `${String(Math.floor(x / 60) % 24).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};

type Seg = [number, number, number[], number]; // t0, t1, node indices, wait (0/1)
export interface TrackTrip {
  r: string;
  m: "walk" | "drive";
  s: string;
  k: number;
  seg: Seg[];
}
export interface Tracks {
  nodes: number[][];
  trips: TrackTrip[];
  shown: number;
  of: number;
}

interface PreSeg {
  t0: number;
  t1: number;
  pts: P[];
  cum: number[]; // cumulative metres along pts
  wait: boolean;
  mode: "walk" | "drive";
}
export interface Prepared {
  byResident: Map<string, PreSeg[]>;
}

type P = [number, number];
const pt = (p: number[] | undefined): P => [p?.[0] ?? 0, p?.[1] ?? 0];

const metres = (a: P, b: P) => {
  const dx = (b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180);
  const dy = (b[1] - a[1]) * 110_540;
  return Math.hypot(dx, dy);
};

export function prepare(tr: Tracks | null | undefined): Prepared {
  const byResident = new Map<string, PreSeg[]>();
  for (const trip of tr?.trips ?? []) {
    const list = byResident.get(trip.r) ?? [];
    for (const [t0, t1, idx, w] of trip.seg) {
      const pts = idx
        .map((i) => tr?.nodes[i])
        .filter((p): p is number[] => Array.isArray(p))
        .map(pt);
      if (!pts.length) continue;
      const cum = [0];
      for (let i = 1; i < pts.length; i++)
        cum.push((cum[i - 1] ?? 0) + metres(pt(pts[i - 1]), pt(pts[i])));
      list.push({ t0, t1, pts, cum, wait: w === 1, mode: trip.m });
    }
    list.sort((a, b) => a.t0 - b.t0);
    byResident.set(trip.r, list);
  }
  return { byResident };
}

/** Point at fraction f (0..1) of a polyline by length. */
export function along(pts: number[][], cum: number[], f: number): P {
  const first = pt(pts[0]);
  const total = cum[cum.length - 1] ?? 0;
  if (pts.length === 1 || total <= 0) return first;
  const target = Math.min(Math.max(f, 0), 1) * total;
  let i = 1;
  while (i < cum.length - 1 && (cum[i] ?? 0) < target) i++;
  const c0 = cum[i - 1] ?? 0;
  const seg = (cum[i] ?? c0) - c0 || 1;
  const u = (target - c0) / seg;
  const a = pt(pts[i - 1]);
  const b = pt(pts[i]);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

export interface Dot {
  r: string;
  lon: number;
  lat: number;
  state: DayState;
}

/** Residents out and about at minute t (at home or at a place: not drawn). */
export function dotsAt(p: Prepared, t: number): Dot[] {
  const out: Dot[] = [];
  for (const [r, segs] of p.byResident) {
    const s = segs.find((x) => x.t0 <= t && t < x.t1);
    if (!s) continue;
    const f = s.t1 > s.t0 ? (t - s.t0) / (s.t1 - s.t0) : 0;
    const [lon, lat] = s.wait ? pt(s.pts[s.pts.length - 1]) : along(s.pts, s.cum, f);
    out.push({ r, lon, lat, state: s.wait ? "wait" : s.mode === "drive" ? "drive" : "walk" });
  }
  return out;
}

/** The river stage in force at minute t (null = normal level). */
export function stageAt(stages: [number, string | null][] | null | undefined, t: number) {
  let cur: string | null = null;
  for (const [m, sid] of stages ?? []) if (m <= t) cur = sid;
  return cur;
}

export interface FeedPost {
  id: string;
  t: number;
  replies: { t?: number }[];
}
/** Posts and replies that exist at minute t: the feed fills up as the day plays. */
export function feedUntil<T extends FeedPost>(feed: T[] | null | undefined, t: number): T[] {
  return (feed ?? [])
    .filter((p) => p.t <= t)
    .map((p) => ({ ...p, replies: p.replies.filter((x) => (x.t ?? p.t) <= t) }))
    .sort((a, b) => b.t - a.t);
}

/** Timeline row for minute t (15-minute bins). */
export function binAt<T extends { t: number }>(rows: T[] | null | undefined, t: number): T | null {
  let hit: T | null = null;
  for (const r of rows ?? []) if (r.t <= t) hit = r;
  return hit;
}
