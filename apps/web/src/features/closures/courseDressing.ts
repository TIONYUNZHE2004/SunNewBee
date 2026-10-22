import type { ClosureImpact, MarathonResult } from "./closureSimModel";

/**
 * T-031 static course dressing on the Stylised map (display only): where the km markers, the
 * start / finish arches, the cones at closure-boundary junctions and the closure-window tag go.
 * Every position comes from the engine's course line and the map's own edges; nothing is invented.
 */

/** Closed course and dressing colours (an overlay legend, outside the clay city tokens). */
export const DRESSING_STYLE = {
  stripeRed: "#D62828",
  stripeWhite: "#FFFFFF",
  glow: "#FF5A3C",
  cone: "#F77F00",
  coneBand: "#FFFFFF",
  arch: "#1D3557",
  archText: "#FFFFFF",
  kmBg: "#1D3557",
  kmText: "#FFFFFF",
  tagBg: "#D62828",
  tagText: "#FFFFFF",
} as const;

/** At most this many cones (a draw each is not needed: they are instanced, but crowds read badly). */
export const MAX_CONES = 40;
/** Junctions closer than this (metres) share one cone. */
export const CONE_MERGE_M = 25;

type LonLat = [number, number];
type Coords = number[][];

const R = 6371008.8;
const RAD = Math.PI / 180;
/** Ground distance in metres (equirectangular: under 0.1 % off across the township). */
export function metres(a: number[], b: number[]): number {
  const lat = (((a[1] ?? 0) + (b[1] ?? 0)) / 2) * RAD;
  const dx = ((b[0] ?? 0) - (a[0] ?? 0)) * RAD * Math.cos(lat);
  const dy = ((b[1] ?? 0) - (a[1] ?? 0)) * RAD;
  return Math.hypot(dx, dy) * R;
}

/** Length of a line in metres. */
export function lineLength(line: Coords): number {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += metres(line[i - 1] as number[], line[i] as number[]);
  return d;
}

/** The point `d` metres along a line (clamped to its ends). */
export function pointAtMetres(line: Coords, d: number): LonLat {
  const first = (line[0] ?? [0, 0]) as number[];
  if (line.length < 2 || d <= 0) return [first[0] ?? 0, first[1] ?? 0];
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as number[];
    const b = line[i] as number[];
    const seg = metres(a, b);
    if (walked + seg >= d && seg > 0) {
      const t = (d - walked) / seg;
      return [
        (a[0] ?? 0) + t * ((b[0] ?? 0) - (a[0] ?? 0)),
        (a[1] ?? 0) + t * ((b[1] ?? 0) - (a[1] ?? 0)),
      ];
    }
    walked += seg;
  }
  const last = line[line.length - 1] as number[];
  return [last[0] ?? 0, last[1] ?? 0];
}

/** A km marker every whole kilometre along the course line, before the finish. */
export function kmMarkers(course: Coords): { km: number; at: LonLat }[] {
  const total = lineLength(course);
  const out: { km: number; at: LonLat }[] = [];
  for (let km = 1; km * 1000 < total; km++) out.push({ km, at: pointAtMetres(course, km * 1000) });
  return out;
}

const ll = (c: number[] | undefined): LonLat => [c?.[0] ?? 0, c?.[1] ?? 0];

/**
 * Start and finish of the course line, each with the next point along the course (`toward`, so the
 * arch stands across the road); a loop (ends within 30 m) has one shared arch.
 */
export function arches(course: Coords): { label: string; at: LonLat; toward: LonLat }[] {
  if (course.length < 2) return [];
  const n = course.length;
  const s = course[0] as number[];
  const f = course[n - 1] as number[];
  const start = { at: ll(s), toward: ll(course[1]) };
  if (metres(s, f) < 30) return [{ label: "START · FINISH", ...start }];
  return [
    { label: "START", ...start },
    { label: "FINISH", at: ll(f), toward: ll(course[n - 2]) },
  ];
}

const key = (c: number[]) => `${(c[0] ?? 0).toFixed(6)},${(c[1] ?? 0).toFixed(6)}`;

/**
 * Junctions on the closure boundary: course edge ends that another mapped edge also touches
 * (side streets meeting the closed course), merged within CONE_MERGE_M, at most MAX_CONES, in
 * course order. Uses the access layer's own edge geometry.
 */
export function boundaryJunctions(
  courseIds: ReadonlySet<string>,
  edges: readonly { id: string; coords: Coords }[],
): LonLat[] {
  const ends = (e: { coords: Coords }) =>
    e.coords.length >= 2
      ? [e.coords[0] as number[], e.coords[e.coords.length - 1] as number[]]
      : [];
  const onCourse = new Map<string, number[]>();
  for (const e of edges) if (courseIds.has(e.id)) for (const c of ends(e)) onCourse.set(key(c), c);
  const hit = new Set<string>();
  for (const e of edges)
    if (!courseIds.has(e.id)) for (const c of ends(e)) if (onCourse.has(key(c))) hit.add(key(c));
  const out: LonLat[] = [];
  for (const [k, c] of onCourse) {
    if (!hit.has(k) || out.some((o) => metres(o, c) < CONE_MERGE_M)) continue;
    out.push([c[0] ?? 0, c[1] ?? 0]);
    if (out.length === MAX_CONES) break;
  }
  return out;
}

const hhmm = new Intl.DateTimeFormat("en-MY", {
  timeZone: "Asia/Kuala_Lumpur",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "Closed 06:00–10:00" from the engine's closure window (Elmina time); null without one. */
export function closedTag(impact: ClosureImpact): string | null {
  const c = impact.event.closures[0];
  if (!c) return null;
  const a = new Date(c.starts_at);
  const b = new Date(c.ends_at);
  if (!Number.isFinite(a.getTime()) || !(b > a)) return null;
  return `Closed ${hhmm.format(a)}–${hhmm.format(b)}`;
}

/** Everything the static dressing draws for one proposed course. */
export function courseDressing(
  m: MarathonResult,
  edges: readonly { id: string; coords: Coords }[],
) {
  const course = m.animation.course_coordinates;
  return {
    arches: arches(course),
    km: kmMarkers(course),
    cones: boundaryJunctions(new Set(m.course.segment_ids), edges),
    closed: closedTag(m.impact),
  };
}
