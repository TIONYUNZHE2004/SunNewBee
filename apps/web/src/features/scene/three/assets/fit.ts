import { hashUnit } from "../../cesium/stylised/model";
import type { AssetSpec } from "./manifest";

/** Min-area rectangle of a footprint in local xz. w <= l; angle is the direction of the l axis
 * from +x toward -z (radians, in [0, pi)); fill = footprint area / rectangle area. */
export interface Obb {
  cx: number;
  cz: number;
  w: number;
  l: number;
  angle: number;
  fill: number;
}

type P = [number, number];

function hull(points: P[]): P[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: P[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function ringArea(ring: P[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

interface Rect {
  area: number;
  ex: number;
  ez: number;
  minA: number;
  maxA: number;
  minB: number;
  maxB: number;
}

/** Rotating-calipers style search: the min-area rectangle has a side on a hull edge. */
export function footprintObb(ring: [number, number][]): Obb | null {
  const finite = ring.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const h = hull(finite);
  if (h.length < 3) return null;
  let best: Rect | null = null;
  for (let i = 0; i < h.length; i++) {
    const p = h[i]!;
    const q = h[(i + 1) % h.length]!;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 1e-9) continue;
    const ex = (q[0] - p[0]) / len;
    const ez = (q[1] - p[1]) / len;
    let minA = Number.POSITIVE_INFINITY;
    let maxA = Number.NEGATIVE_INFINITY;
    let minB = Number.POSITIVE_INFINITY;
    let maxB = Number.NEGATIVE_INFINITY;
    for (const [x, z] of h) {
      const a = x * ex + z * ez;
      const b = -x * ez + z * ex;
      if (a < minA) minA = a;
      if (a > maxA) maxA = a;
      if (b < minB) minB = b;
      if (b > maxB) maxB = b;
    }
    const area = (maxA - minA) * (maxB - minB);
    if (!best || area < best.area) best = { area, ex, ez, minA, maxA, minB, maxB };
  }
  if (!best || best.area < 1e-9) return null;
  const da = best.maxA - best.minA;
  const db = best.maxB - best.minB;
  const ca = (best.maxA + best.minA) / 2;
  const cb = (best.maxB + best.minB) / 2;
  const cx = ca * best.ex - cb * best.ez;
  const cz = ca * best.ez + cb * best.ex;
  const [ux, uz] = da >= db ? [best.ex, best.ez] : [-best.ez, best.ex];
  let angle = Math.atan2(-uz, ux) % Math.PI;
  if (angle < 0) angle += Math.PI;
  return {
    cx,
    cz,
    w: Math.min(da, db),
    l: Math.max(da, db),
    angle,
    fill: Math.min(1, ringArea(finite) / best.area),
  };
}

/** Yaw about +y that turns model +z (frontage) toward a front azimuth (deg clockwise from north). */
export function yawForFront(frontDeg: number): number {
  return Math.PI - (frontDeg * Math.PI) / 180;
}

export interface Placement {
  id: string;
  asset: string;
  variant: string;
  x: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  palette: [string, string, string];
}

/** FNV-1a (murmur-finalised) of `${salt}:${id}` in [0, 1). */
export function hash01(id: string, salt = ""): number {
  return hashUnit(id, salt);
}

export function precinctGroupOf(precinct: string | undefined, groups: [string, string][]): string {
  if (!precinct) return "default";
  for (const [g, re] of groups) {
    try {
      if (new RegExp(re, "i").test(precinct)) return g;
    } catch {
      // a bad pattern in the manifest must not break planning
    }
  }
  return "default";
}

export function variantFor(spec: AssetSpec, group: string, heightM: number): string {
  const names = Object.keys(spec.variants);
  // Variants of different heights (highrise mid/tall): the nearest height wins, because the
  // manifest gives every asset a `default` mapping that would otherwise always pick the first.
  const heights = new Set(names.map((n) => spec.variants[n]!.size[1]));
  if (names.length > 1 && heights.size > 1) {
    let best = names[0]!;
    let bd = Number.POSITIVE_INFINITY;
    for (const n of names) {
      const d = Math.abs(spec.variants[n]!.size[1] - heightM);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }
  const mapped = spec.variantByGroup[group] ?? spec.variantByGroup.default;
  if (mapped && spec.variants[mapped]) return mapped;
  return names[0]!;
}

const FALLBACK_PALETTE: [string, string, string] = ["#c8c2b6", "#8a8478", "#5a5650"];

export function paletteFor(spec: AssetSpec, group: string, id: string): [string, string, string] {
  const own = spec.palettes[group];
  const list = own && own.length > 0 ? own : (spec.palettes.default ?? []);
  if (list.length === 0) return FALLBACK_PALETTE;
  return list[Math.min(list.length - 1, Math.floor(hash01(id, "palette") * list.length))]!;
}

export function jitterFor(spec: AssetSpec, id: string): { scale: number; hueShift: number } {
  const js = spec.jitter.scale ?? 0;
  const jh = spec.jitter.hue ?? 0;
  return {
    scale: 1 + (2 * hash01(id, "scale") - 1) * js,
    hueShift: (2 * hash01(id, "hue") - 1) * jh,
  };
}

export interface FitOptions {
  /** Minimum footprint fill; default 0.75 (the caller passes 0.85 for generic). */
  minFill?: number;
  /** Override the spec's fit bands (landmarks use 0.5..2). */
  fit?: { xz: [number, number]; y: [number, number] };
}

const within = (v: number, [lo, hi]: [number, number]) => v >= lo && v <= hi;

/**
 * One or more instances (row units) for a footprint, or null when it cannot fit inside spec.fit.
 * `asset` on the result is empty; the caller (planCity) fills it in.
 */
export function fitArchetype(
  obb: Obb,
  spec: AssetSpec,
  variant: string,
  heightM: number,
  frontDeg: number | null,
  id: string,
  group = "default",
  opts: FitOptions = {},
): Placement[] | null {
  if (obb.fill < (opts.minFill ?? 0.75)) return null;
  const v = spec.variants[variant];
  if (!v) return null;
  const [sw, sh, sd] = v.size;
  if (!(sw > 0 && sh > 0 && sd > 0)) return null;
  const fit = opts.fit ?? spec.fit;

  // u runs along the long side, v along the short side.
  const ux = Math.cos(obb.angle);
  const uz = -Math.sin(obb.angle);
  const vx = -uz;
  const vz = ux;

  let frontLong: boolean;
  if (frontDeg !== null) {
    const a = (frontDeg * Math.PI) / 180;
    const dx = Math.sin(a);
    const dz = -Math.cos(a);
    frontLong = Math.abs(dx * ux + dz * uz) <= Math.abs(dx * vx + dz * vz);
  } else if (spec.repeat === "frontage" && obb.l >= 1.8 * sw && obb.w >= 0.75 * sd) {
    frontLong = true;
  } else {
    frontLong = spec.frontage === "long";
  }
  // sz is the only band the front choice can break: a narrow link plot whose front_deg faces a LONG
  // wall gets F = obb.l, D = obb.w and fails sz. Frontage specs retry once with the front on the
  // SHORT wall (F = obb.w, D = obb.l); on a second failure the original null stands.
  const bands = (F: number, D: number) => {
    const n = spec.repeat === "frontage" ? Math.max(1, Math.round(F / sw)) : 1;
    const sx = F / (n * sw);
    const sz = D / sd;
    const sy = heightM / sh;
    return { n, sx, sz, sy, ok: within(sx, fit.xz) && within(sz, fit.xz) && within(sy, fit.y) };
  };
  let F = frontLong ? obb.l : obb.w;
  let D = frontLong ? obb.w : obb.l;
  let fx = frontLong ? ux : vx;
  let fz = frontLong ? uz : vz;
  let r = bands(F, D);
  if (
    !r.ok &&
    !within(r.sz, fit.xz) &&
    spec.repeat === "frontage" &&
    frontDeg !== null &&
    frontLong
  ) {
    const sF = obb.w;
    const sD = obb.l;
    const t = bands(sF, sD);
    if (t.ok) {
      r = t;
      F = sF;
      D = sD;
      fx = vx;
      fz = vz;
    }
  }
  if (!r.ok) return null;
  const { n, sx, sy, sz } = r;

  // Yaw is always the frontage-axis normal, so the model stays aligned with its OBB. With a known
  // front the sign follows it; otherwise a deterministic hash picks one (the front is unknown).
  let sign: number;
  if (frontDeg !== null) {
    const a = (frontDeg * Math.PI) / 180;
    sign = Math.sin(a) * -fz + -Math.cos(a) * fx >= 0 ? 1 : -1;
  } else sign = hash01(id, "front") < 0.5 ? 1 : -1;
  const yaw = Math.atan2(sign * -fz, sign * fx);

  const step = F / n;
  const out: Placement[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i - (n - 1) / 2) * step;
    out.push({
      id: n === 1 ? id : `${id}#${i}`,
      asset: "",
      variant,
      x: obb.cx + fx * t,
      z: obb.cz + fz * t,
      yaw,
      sx,
      sy,
      sz,
      palette: paletteFor(spec, group, `${id}#${i}`),
    });
  }
  return out;
}
