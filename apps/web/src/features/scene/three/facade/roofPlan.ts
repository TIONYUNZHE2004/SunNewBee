import { hash01 } from "../assets/fit";
import type { FallbackColours } from "../fallbackStyle";

/**
 * Roof dressing (pure): rooftop units, skylight strips and a roof-edge band for large roofs, plus a
 * roof colour from the precinct palette. Decorative only: nothing here is a fact about the real
 * building, and it never changes a footprint or a height.
 */

/** Roofs smaller than this (m2) get no dressing. */
export const MIN_ROOF_AREA_M2 = 600;
/** One rooftop unit per this many m2 of roof. */
export const UNIT_PER_M2 = 250;
/** Rooftop unit size: length, height, width (m). */
export const UNIT_SIZE_M = { l: 2, h: 1, w: 1.2 } as const;
/** Nothing (unit or skylight, including its footprint) within this distance of the roof edge. */
export const EDGE_CLEAR_M = 1.0;
/** Skylight strips repeat this often along the long axis; each is this wide. */
export const SKYLIGHT_PITCH_M = 12;
export const SKYLIGHT_W_M = 1.5;
const SKYLIGHT_H_M = 0.15;
/** The roof-edge band: width and height (m). */
export const BAND_W_M = 0.4;
const BAND_H_M = 0.3;
/** Units keep this centre-to-centre distance. */
const UNIT_SPACING_M = 3.5;
const TRIES_PER_UNIT = 24;
const MAX_UNITS = 40;
const SKYLIGHT_KINDS = new Set(["industrial", "retail"]);
const SKYLIGHT_ARCHETYPES = new Set(["factory", "mall"]);

export interface RoofBuilding {
  id: string;
  /** Footprint in the local (x, z) frame, either winding. */
  ring: Array<[number, number]>;
  heightM: number;
  kind?: string;
  archetype?: string;
  /** A modelled landmark (e.g. the Lakeside Mall) gets no dressing. */
  isLandmark?: boolean;
}

export interface RoofDressing {
  /** mat4 per rooftop unit (unit box with its base at y = 0 of its own frame). */
  units: Float32Array;
  /** mat4 per skylight strip. */
  skylights: Float32Array;
  /** mat4 per roof-edge band segment (0.4 m wide, just inside the edge). */
  band: Float32Array;
  /** Roof colour: the palette's roof colour instead of flat grey. */
  tint: string;
  /** Band colour: the palette trim. */
  edge: string;
}

type Pt = [number, number];

function cleanRing(ring: ReadonlyArray<readonly [number, number]>): Pt[] | null {
  const out: Pt[] = [];
  for (const p of ring) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push([p[0], p[1]]);
  }
  const first = out[0];
  const end = out[out.length - 1];
  if (first && end && out.length > 1 && first[0] === end[0] && first[1] === end[1]) out.pop();
  return out.length >= 3 ? out : null;
}

function area(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    a += pts[j]![0] * pts[i]![1] - pts[i]![0] * pts[j]![1];
  return a / 2;
}

function inside(pts: Pt[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i]!;
    const [xj, zj] = pts[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function distToEdges(pts: Pt[], x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[(i + 1) % pts.length]!;
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

/** A point is usable when it is inside and at least `r` from every edge. */
const clear = (pts: Pt[], x: number, z: number, r: number) =>
  inside(pts, x, z) && distToEdges(pts, x, z) >= r;

/** Column-major mat4: unit box scaled (sl, sh, sw) along (u, up, perp), centred at (cx, y, cz). */
function writeBox(
  out: number[],
  cx: number,
  y: number,
  cz: number,
  ux: number,
  uz: number,
  sl: number,
  sh: number,
  sw: number,
) {
  out.push(ux * sl, 0, uz * sl, 0, 0, sh, 0, 0, -uz * sw, 0, ux * sw, 0, cx, y, cz, 1);
}

/**
 * Dressing for one large roof: 1 rooftop unit per 250 m2 (2 x 1.2 x 1 m), skylight strips every
 * 12 m along the long axis for factories and malls (1.5 m wide), a 0.4 m band just inside the roof
 * edge, and the palette roof colour as the tint. Units and skylights sit at y = heightM, with their
 * whole footprint at least 1.0 m inside the roof. Seeded per building id. Below 600 m2 and for
 * landmarks there is no dressing. Pure.
 */
export function roofDressing(b: RoofBuilding, palette: FallbackColours): RoofDressing {
  const none: RoofDressing = {
    units: new Float32Array(0),
    skylights: new Float32Array(0),
    band: new Float32Array(0),
    tint: palette.roof,
    edge: palette.trim,
  };
  const pts = cleanRing(b.ring);
  if (b.isLandmark || !pts || !Number.isFinite(b.heightM)) return none;
  const a = Math.abs(area(pts));
  if (!(a >= MIN_ROOF_AREA_M2)) return none;
  const y = b.heightM;

  // Long axis: the longest edge's direction.
  let ux = 1;
  let uz = 0;
  let longest = -1;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[(i + 1) % pts.length]!;
    const l = Math.hypot(bx - ax, bz - az);
    if (l > longest) {
      longest = l;
      ux = (bx - ax) / l;
      uz = (bz - az) / l;
    }
  }
  const vx = -uz;
  const vz = ux;
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (const [px, pz] of pts) {
    const pu = px * ux + pz * uz;
    const pv = px * vx + pz * vz;
    minU = Math.min(minU, pu);
    maxU = Math.max(maxU, pu);
    minV = Math.min(minV, pv);
    maxV = Math.max(maxV, pv);
  }
  const at = (pu: number, pv: number): Pt => [pu * ux + pv * vx, pu * uz + pv * vz];

  // Rooftop units: seeded rejection sampling; the whole unit footprint stays clear of the edge.
  const unitR = Math.hypot(UNIT_SIZE_M.l, UNIT_SIZE_M.w) / 2 + EDGE_CLEAR_M;
  const want = Math.min(MAX_UNITS, Math.floor(a / UNIT_PER_M2));
  const placed: Pt[] = [];
  const units: number[] = [];
  for (let k = 0; k < want; k++) {
    for (let t = 0; t < TRIES_PER_UNIT; t++) {
      const [px, pz] = at(
        minU + hash01(b.id, `roof:u${k}:${t}:a`) * (maxU - minU),
        minV + hash01(b.id, `roof:u${k}:${t}:b`) * (maxV - minV),
      );
      if (!clear(pts, px, pz, unitR)) continue;
      if (placed.some((q) => Math.hypot(q[0] - px, q[1] - pz) < UNIT_SPACING_M)) continue;
      placed.push([px, pz]);
      writeBox(units, px, y, pz, ux, uz, UNIT_SIZE_M.l, UNIT_SIZE_M.h, UNIT_SIZE_M.w);
      break;
    }
  }

  // Skylight strips: every 12 m along the long axis, spanning the short axis.
  const skylights: number[] = [];
  if (SKYLIGHT_KINDS.has(b.kind ?? "") || SKYLIGHT_ARCHETYPES.has(b.archetype ?? "")) {
    const midV = (minV + maxV) / 2;
    const span = Math.min(20, (maxV - minV) * 0.6);
    const n = Math.floor((maxU - minU) / SKYLIGHT_PITCH_M);
    for (let i = 0; i < n; i++) {
      const pu = minU + (i + 0.5) * SKYLIGHT_PITCH_M;
      // Shrink across the short axis until every corner clears the edge by 1.0 m.
      for (let len = span; len >= 3; len -= 2) {
        const hw = SKYLIGHT_W_M / 2;
        const hl = len / 2;
        const probe: Pt[] = [
          at(pu - hw, midV - hl),
          at(pu + hw, midV - hl),
          at(pu - hw, midV + hl),
          at(pu + hw, midV + hl),
          at(pu, midV),
        ];
        if (!probe.every(([qx, qz]) => clear(pts, qx, qz, EDGE_CLEAR_M))) continue;
        const [cx, cz] = at(pu, midV);
        // The strip's long side runs across the roof (along v).
        writeBox(skylights, cx, y, cz, vx, vz, len, SKYLIGHT_H_M, SKYLIGHT_W_M);
        break;
      }
    }
  }

  // Roof-edge band: a 0.4 m strip just inside each edge (a decorative coping line).
  const band: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1) continue;
    const ex = (bx - ax) / len;
    const ez = (bz - az) / len;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    // Pick the normal that points into the roof, whatever the winding.
    let nx = -ez;
    let nz = ex;
    if (!inside(pts, mx + nx * 0.3, mz + nz * 0.3)) {
      nx = -nx;
      nz = -nz;
    }
    const off = BAND_W_M / 2;
    writeBox(band, mx + nx * off, y, mz + nz * off, ex, ez, len, BAND_H_M, BAND_W_M);
  }

  return {
    units: new Float32Array(units),
    skylights: new Float32Array(skylights),
    band: new Float32Array(band),
    tint: palette.roof,
    edge: palette.trim,
  };
}
