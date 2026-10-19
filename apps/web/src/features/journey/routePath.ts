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

export function createRoutePath(
  plan: Pick<JourneyPlan, "polyline" | "spans">,
  toLocal: (lon: number, lat: number) => [number, number],
): RoutePath {
  const pts: [number, number][] = [];
  for (const c of plan.polyline) {
    const lon = c[0] as number;
    const lat = c[1] as number;
    if (Number.isFinite(lon) && Number.isFinite(lat)) pts.push(toLocal(lon, lat));
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as [number, number];
    const b = pts[i] as [number, number];
    cum.push((cum[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum.at(-1) ?? 0;
  const lastSpan = plan.spans.at(-1);
  const planLength = lastSpan && lastSpan[1] > 0 ? lastSpan[1] : length;
  const k = planLength > 0 ? length / planLength : 1;

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
