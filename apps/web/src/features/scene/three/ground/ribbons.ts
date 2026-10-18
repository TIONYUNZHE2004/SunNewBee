import {
  KIND_BY_TYPE,
  ROAD_WIDTH_UNKNOWN,
  type RoadKind,
  WIDTH_BY_TYPE,
} from "../../cesium/stylised/ground";
import type { LocalFrame } from "../frame";
import { type Box, inBox, type PlanArea, perLayer, touchesBox } from "../stream/area";
import { MARKING_Y, ROAD_Y } from "./bands";

/** Road surface lift above the ground plane (metres): above land cover (<= 0.06), below markings. */
const MARK_WIDTH_M = 0.25;
const MARK_DASH_M = 3;
const MARK_GAP_M = 6;
/** A mitre never pushes a vertex further than this many half-widths from the centre line. */
const MITRE_LIMIT = 2;

/**
 * Flat triangles for one road kind (or, with `marking`, the dashed centre marks of major roads).
 * Display only: no access fact is read or implied.
 */
export interface Ribbon {
  positions: Float32Array;
  indices: Uint32Array;
  kind: RoadKind;
  marking?: boolean;
}

type P = [number, number];

class Builder {
  pos: number[] = [];
  idx: number[] = [];
  constructor(private readonly y: number) {}

  /** A strip around `pts` (>= 2 distinct), `half` metres each side, mitred, wound to face +y. */
  strip(pts: P[], half: number) {
    const n = pts.length;
    const base = this.pos.length / 3;
    const seg = (i: number): P => {
      const dx = pts[i + 1]![0] - pts[i]![0];
      const dz = pts[i + 1]![1] - pts[i]![1];
      const l = Math.hypot(dx, dz) || 1;
      return [dx / l, dz / l];
    };
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? seg(i - 1) : null;
      const b = i < n - 1 ? seg(i) : null;
      // Left of travel (viewed from above, x east, z south) is (dz, -dx).
      const la: P | null = a ? [a[1], -a[0]] : null;
      const lb: P | null = b ? [b[1], -b[0]] : null;
      let nx: number;
      let nz: number;
      if (la && lb) {
        const sx = la[0] + lb[0];
        const sz = la[1] + lb[1];
        const sl = Math.hypot(sx, sz);
        if (sl < 1e-6) {
          [nx, nz] = la;
        } else {
          const scale = Math.min(MITRE_LIMIT, 2 / sl); // 1 / cos(half the turn)
          nx = (sx / sl) * scale;
          nz = (sz / sl) * scale;
        }
      } else {
        [nx, nz] = (la ?? lb)!;
      }
      const [x, z] = pts[i]!;
      this.pos.push(x + nx * half, this.y, z + nz * half, x - nx * half, this.y, z - nz * half);
    }
    for (let i = 0; i < n - 1; i++) {
      const l0 = base + i * 2;
      const r0 = l0 + 1;
      const l1 = l0 + 2;
      const r1 = l0 + 3;
      this.idx.push(l0, r0, l1, r0, r1, l1);
    }
  }

  done(kind: RoadKind, marking?: boolean): Ribbon {
    const r: Ribbon = {
      kind,
      positions: Float32Array.from(this.pos),
      indices: Uint32Array.from(this.idx),
    };
    if (marking) r.marking = true;
    return r;
  }
  get empty() {
    return this.idx.length === 0;
  }
}

function localLine(coords: unknown, frame: LocalFrame): P[] | null {
  if (!Array.isArray(coords)) return null;
  const out: P[] = [];
  for (const c of coords) {
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
    const q = frame.toLocal(c[0] as number, c[1] as number);
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  return out.length >= 2 ? out : null;
}

/**
 * How far a box's ribbons may reach past the box (m). A segment that is not wholly inside the box
 * is cut into equal pieces of at most twice this, the same cut whichever box looks at it, and each
 * piece belongs to the box holding its midpoint: adjacent boxes never draw the same piece and
 * leave no gap between them.
 */
export const RIBBON_MARGIN_M = 20;

/** Runs of consecutive pieces whose midpoint is in the box (the whole line, with no box). */
function clipRuns(pts: P[], box: Box | null): P[][] {
  if (!box) return [pts];
  const runs: P[][] = [];
  let cur: P[] = [];
  const piece = (a: P, b: P) => {
    if (inBox(box, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) {
      if (cur.length === 0) cur.push(a);
      cur.push(b);
    } else if (cur.length > 0) {
      runs.push(cur);
      cur = [];
    }
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const whole =
      inBox(box, Math.min(a[0], b[0]), Math.min(a[1], b[1])) &&
      inBox(box, Math.max(a[0], b[0]), Math.max(a[1], b[1]));
    const n = whole ? 1 : Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (2 * RIBBON_MARGIN_M));
    let prev = a;
    for (let k = 1; k <= n; k++) {
      const next: P =
        k === n ? b : [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      piece(prev, next);
      prev = next;
    }
  }
  if (cur.length > 0) runs.push(cur);
  return runs;
}

interface Line {
  pts: P[];
  type: string;
  bb: [number, number, number, number];
}
const linesCache = new WeakMap<object, WeakMap<object, Line[]>>();

/** The walk LineStrings in local metres with their bounds, built once per layer and frame. */
const linesOf = (fc: GeoJSON.FeatureCollection | null | undefined, frame: LocalFrame): Line[] =>
  perLayer(linesCache, fc, frame, () => {
    const out: Line[] = [];
    const features = Array.isArray(fc?.features) ? fc.features : [];
    for (const f of features) {
      if (f?.geometry?.type !== "LineString") continue;
      const pts = localLine(f.geometry.coordinates, frame);
      if (!pts) continue;
      const type = typeof f.properties?.type === "string" ? f.properties.type : "";
      out.push({ pts, type, bb: bounds(pts) });
    }
    return out;
  });

/** Bounds of a polyline. */
function bounds(pts: P[]): [number, number, number, number] {
  let x0 = Number.POSITIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  for (const [x, z] of pts) {
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  }
  return [x0, z0, x1, z1];
}

/** Dashes along a polyline, the on/off phase carried across vertices; each dash is straight. */
function dashes(pts: P[]): P[][] {
  const out: P[][] = [];
  let pos = 0; // distance along the line into the current on/off cycle
  const cycle = MARK_DASH_M + MARK_GAP_M;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const at = (d: number): P => [
      a[0] + ((b[0] - a[0]) * d) / len,
      a[1] + ((b[1] - a[1]) * d) / len,
    ];
    let d = 0;
    while (d < len) {
      const phase = pos % cycle;
      const on = phase < MARK_DASH_M;
      const step = Math.min(len - d, (on ? MARK_DASH_M : cycle) - phase);
      if (on && step > 0.05) out.push([at(d), at(d + step)]);
      d += step;
      pos += step;
    }
  }
  return out;
}

/**
 * Triangle-strip ribbons around the walk network's LineStrings (width by segment `type`, shared
 * with the Cesium stylised ground), mitred with the offset capped at 2 half-widths, merged per
 * kind, at the road lift. Major roads also get dashed centre marks (a separate ribbon, one lift
 * higher). With an `area`, only the pieces whose midpoint is in its box are kept (see
 * RIBBON_MARGIN_M), and only the dashes whose midpoint is: the dash phase runs along the whole
 * line, so adjacent boxes agree. Pure.
 */
export function ribbonsFromWalk(
  fc: GeoJSON.FeatureCollection | null | undefined,
  frame: LocalFrame,
  opts: { area?: PlanArea } = {},
): Ribbon[] {
  const box = opts.area?.box ?? null;
  const kinds = new Map<RoadKind, Builder>();
  const marks = new Builder(MARKING_Y);
  for (const { pts, type, bb } of linesOf(fc, frame)) {
    if (box && !touchesBox(box, bb[0], bb[1], bb[2], bb[3])) continue;
    const kind = KIND_BY_TYPE[type] ?? "other";
    const half = (WIDTH_BY_TYPE[type] ?? ROAD_WIDTH_UNKNOWN) / 2;
    let b = kinds.get(kind);
    if (!b) {
      b = new Builder(ROAD_Y);
      kinds.set(kind, b);
    }
    for (const run of clipRuns(pts, box)) b.strip(run, half);
    if (kind === "major")
      for (const d of dashes(pts)) {
        const [a, c] = [d[0]!, d[d.length - 1]!];
        if (!box || inBox(box, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2))
          marks.strip(d, MARK_WIDTH_M / 2);
      }
  }
  const out: Ribbon[] = [];
  for (const [kind, b] of kinds) if (!b.empty) out.push(b.done(kind));
  if (!marks.empty) out.push(marks.done("major", true));
  return out;
}
