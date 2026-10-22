import { WIDTH_BY_TYPE } from "../scene/shared/roads";
import type { JourneyPlan } from "./timeline";

export type SpanEval = JourneyPlan["spans"][number][2];

/** A run of same-status plan spans as a local polyline (xyz triplets, y = 0; the caller lifts it). */
export interface SpanLine {
  eval: SpanEval;
  from_m: number;
  to_m: number;
  points: Float32Array;
}

/**
 * The plan's polyline in some planar frame, measured in plan metres. Plan metres (`spans`, `at_m`)
 * and the polyline's own length differ by the frame error (< 1 m on the township), so plan metres
 * are scaled onto the polyline: `pointAt(planLength)` is exactly the last vertex. One source for the
 * hero, the ribbon, the markers and the mini-map, so they always agree.
 */
export interface RoutePath {
  /** Polyline length in the frame units. */
  length: number;
  /** The route length in plan metres (end of the last span; the polyline length without spans). */
  planLength: number;
  /** [x, z] at `m` plan metres, clamped to the route. */
  pointAt(m: number): [number, number];
  /** Same-status runs, in travel order, covering [0, planLength]. */
  spanLines(): SpanLine[];
}

/** Carriageways cars drive on: a walker along one keeps to its verge (display only). */
const CARRIAGEWAY = new Set(["street", "major_road", "residential", "service"]);
/** A roadside walker keeps this far beyond the kerb (m): mid-verge on a 6 m street. */
export const ROADSIDE_KERB_M = 0.75;
/** A turn sharper than about 120 deg clips the mitred offset here (as walkPath's MITRE_MAX). */
const MITRE_MAX = 2;

/** [from_m, to_m, offset_m] for each span on a carriageway, from the plan's per-span edge types. */
export function roadsideRuns(
  spans: readonly (readonly [number, number, unknown])[],
  types: readonly string[] | null | undefined,
): [number, number, number][] {
  if (!types || types.length !== spans.length) return [];
  const out: [number, number, number][] = [];
  spans.forEach(([a, b], i) => {
    const t = types[i] as string;
    if (CARRIAGEWAY.has(t)) out.push([a, b, (WIDTH_BY_TYPE[t] ?? 6) / 2 + ROADSIDE_KERB_M]);
  });
  return out;
}

export interface RoutePathOptions {
  /**
   * DECORATIVE: runs (plan metres) drawn beside the centre line, so a walker on a road keeps to its
   * verge instead of walking among the cars: [from_m, to_m, offset_m], positive to the left of
   * travel. Plan metres are unchanged: a point keeps its metre and only moves sideways. Never a
   * fact about a pavement.
   */
  roadside?: readonly (readonly [number, number, number])[];
}

export function createRoutePath(
  plan: Pick<JourneyPlan, "polyline" | "spans">,
  toLocal: (lon: number, lat: number) => [number, number],
  opts: RoutePathOptions = {},
): RoutePath {
  const centre: [number, number][] = [];
  for (const c of plan.polyline) {
    const lon = c[0] as number;
    const lat = c[1] as number;
    if (Number.isFinite(lon) && Number.isFinite(lat)) centre.push(toLocal(lon, lat));
  }
  const cum = [0];
  for (let i = 1; i < centre.length; i++) {
    const a = centre[i - 1] as [number, number];
    const b = centre[i] as [number, number];
    cum.push((cum[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum.at(-1) ?? 0;
  const lastSpan = plan.spans.at(-1);
  const planLength = lastSpan && lastSpan[1] > 0 ? lastSpan[1] : length;
  const k = planLength > 0 ? length / planLength : 1;
  const pts = roadside(centre, cum, k, opts.roadside ?? []);

  /** Index i with cum[i] <= s < cum[i + 1] (the last segment for s = length). */
  const segAt = (s: number) => {
    let lo = 0;
    let hi = Math.max(0, pts.length - 2);
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((cum[mid] as number) <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const atS = (s: number): [number, number] => {
    if (pts.length === 0) return [0, 0];
    if (pts.length === 1) return [...(pts[0] as [number, number])];
    const sc = Math.max(0, Math.min(length, s));
    const i = segAt(sc);
    const a = pts[i] as [number, number];
    const b = pts[i + 1] as [number, number];
    const L = (cum[i + 1] as number) - (cum[i] as number);
    const u = L > 0 ? (sc - (cum[i] as number)) / L : 0;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  };
  const pointAt = (m: number): [number, number] =>
    atS(Math.max(0, Math.min(planLength, Number.isFinite(m) ? m : 0)) * k);

  const between = (from: number, to: number): Float32Array => {
    const out: number[] = [];
    const push = (p: [number, number]) => out.push(p[0], 0, p[1]);
    push(pointAt(from));
    const s0 = from * k;
    const s1 = to * k;
    for (let i = 0; i < pts.length; i++) {
      const c = cum[i] as number;
      if (c > s0 && c < s1) push(pts[i] as [number, number]);
    }
    push(pointAt(to));
    return new Float32Array(out);
  };

  return {
    length,
    planLength,
    pointAt,
    spanLines() {
      const runs: { eval: SpanEval; from_m: number; to_m: number }[] = [];
      for (const [a, b, ev] of plan.spans) {
        const last = runs.at(-1);
        if (last && last.eval === ev && Math.abs(last.to_m - a) < 1e-6) last.to_m = b;
        else runs.push({ eval: ev, from_m: a, to_m: b });
      }
      return runs.map((r) => ({ ...r, points: between(r.from_m, r.to_m) }));
    },
  };
}

/**
 * The centre line with each vertex moved left of travel by the larger offset of the two segments it
 * joins (0 off a carriageway, so a footway leaving a road ramps back to its own line over its first
 * segment). Vertex normals are averaged and mitred, as walkPath's offsetLeft.
 */
function roadside(
  pts: [number, number][],
  cum: number[],
  k: number,
  runs: readonly (readonly [number, number, number])[],
): [number, number][] {
  if (runs.length === 0 || pts.length < 2) return pts;
  const offAt = (m: number) => {
    for (const [a, b, d] of runs) if (m >= a && m <= b) return d;
    return 0;
  };
  // offset of segment j (vertex j to j + 1), from its midpoint in plan metres
  const seg = pts
    .slice(1)
    .map((_, j) => offAt(((cum[j] as number) + (cum[j + 1] as number)) / 2 / (k || 1)));
  const n = pts.length;
  return pts.map((p, i) => {
    const d = Math.max(i > 0 ? (seg[i - 1] as number) : 0, i < n - 1 ? (seg[i] as number) : 0);
    if (d === 0) return p;
    let lx = 0;
    let lz = 0;
    let real = 0;
    for (const [a, b] of [
      [i - 1, i],
      [i, i + 1],
    ] as const) {
      if (a < 0 || b >= n) continue;
      const dx = (pts[b] as [number, number])[0] - (pts[a] as [number, number])[0];
      const dz = (pts[b] as [number, number])[1] - (pts[a] as [number, number])[1];
      const sl = Math.hypot(dx, dz);
      if (sl === 0) continue;
      real++;
      // left of travel with y up: (dz, -dx)
      lx += dz / sl;
      lz += -dx / sl;
    }
    const l = Math.hypot(lx, lz);
    if (l === 0) return p;
    const mitre = real === 2 ? Math.min(MITRE_MAX, 2 / l) : 1;
    return [p[0] + (lx / l) * d * mitre, p[1] + (lz / l) * d * mitre];
  });
}
