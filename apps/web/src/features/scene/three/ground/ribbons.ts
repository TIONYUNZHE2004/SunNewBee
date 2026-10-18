import {
  KIND_BY_TYPE,
  ROAD_WIDTH_UNKNOWN,
  type RoadKind,
  WIDTH_BY_TYPE,
} from "../../cesium/stylised/ground";
import type { LonLat } from "../../geo";
import type { LocalFrame } from "../frame";
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

/** Runs of consecutive segments whose midpoint is inside the clip circle (all, with no clip). */
function clipRuns(pts: P[], clip: { c: P; r: number } | null): P[][] {
  if (!clip) return [pts];
  const runs: P[][] = [];
  let cur: P[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const inside =
      Math.hypot((a[0] + b[0]) / 2 - clip.c[0], (a[1] + b[1]) / 2 - clip.c[1]) <= clip.r;
    if (inside) {
      if (cur.length === 0) cur.push(a);
      cur.push(b);
    } else if (cur.length > 0) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) runs.push(cur);
  return runs;
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
 * higher). With `clipCentre`/`clipRadiusM`, only segments whose midpoint is inside the circle are
 * kept. Pure.
 */
export function ribbonsFromWalk(
  fc: GeoJSON.FeatureCollection | null | undefined,
  frame: LocalFrame,
  opts: { clipCentre?: LonLat; clipRadiusM?: number } = {},
): Ribbon[] {
  const clip =
    opts.clipCentre && opts.clipRadiusM !== undefined
      ? { c: frame.toLocal(opts.clipCentre[0], opts.clipCentre[1]), r: opts.clipRadiusM }
      : null;
  const kinds = new Map<RoadKind, Builder>();
  const marks = new Builder(MARKING_Y);
  const features = Array.isArray(fc?.features) ? fc.features : [];
  for (const f of features) {
    if (f?.geometry?.type !== "LineString") continue;
    const pts = localLine(f.geometry.coordinates, frame);
    if (!pts) continue;
    const type = typeof f.properties?.type === "string" ? f.properties.type : "";
    const kind = KIND_BY_TYPE[type] ?? "other";
    const half = (WIDTH_BY_TYPE[type] ?? ROAD_WIDTH_UNKNOWN) / 2;
    let b = kinds.get(kind);
    if (!b) {
      b = new Builder(ROAD_Y);
      kinds.set(kind, b);
    }
    for (const run of clipRuns(pts, clip)) {
      b.strip(run, half);
      if (kind === "major") for (const d of dashes(run)) marks.strip(d, MARK_WIDTH_M / 2);
    }
  }
  const out: Ribbon[] = [];
  for (const [kind, b] of kinds) if (!b.empty) out.push(b.done(kind));
  if (!marks.empty) out.push(marks.done("major", true));
  return out;
}
