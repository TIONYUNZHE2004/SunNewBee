import type { LocalFrame } from "../frame";

/** Small polygon helpers in local metres, shared by the parking and construction planners. */
export type P = [number, number];
export type Ring = P[];
/** Outer ring first, then holes. */
export type Poly = Ring[];
export type BBox = [number, number, number, number];

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function localRing(ring: unknown, frame: LocalFrame): Ring | null {
  if (!Array.isArray(ring)) return null;
  const out: Ring = [];
  for (const c of ring) {
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
    out.push(frame.toLocal(c[0] as number, c[1] as number));
  }
  const a = out[0];
  const b = out[out.length - 1];
  if (out.length > 1 && a && b && a[0] === b[0] && a[1] === b[1]) out.pop();
  return out.length >= 3 ? out : null;
}

/** The Polygon / MultiPolygon rings of a geometry in local metres (bad rings drop the polygon). */
export function polygonsOf(geom: unknown, frame: LocalFrame): Poly[] {
  if (!isRec(geom) || !Array.isArray(geom.coordinates)) return [];
  const sets: unknown[] =
    geom.type === "Polygon"
      ? [geom.coordinates]
      : geom.type === "MultiPolygon"
        ? geom.coordinates
        : [];
  const out: Poly[] = [];
  for (const s of sets) {
    if (!Array.isArray(s)) continue;
    const rings = s.map((r) => localRing(r, frame));
    if (rings[0] && rings.every(Boolean)) out.push(rings as Poly);
  }
  return out;
}

export function inRing(x: number, z: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export const inPoly = (x: number, z: number, p: Poly): boolean =>
  inRing(x, z, p[0]!) && !p.slice(1).some((h) => inRing(x, z, h));

export function distSeg(px: number, pz: number, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2));
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
}

export function distToRing(x: number, z: number, ring: Ring): number {
  let d = Number.POSITIVE_INFINITY;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    d = Math.min(d, distSeg(x, z, ring[j]!, ring[i]!));
  return d;
}

export function areaOf(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return Math.abs(a / 2);
}

export function bboxOf(ring: Ring): BBox {
  let x0 = Number.POSITIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  for (const [x, z] of ring) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return [x0, z0, x1, z1];
}

/** Area of a polygon net of its holes. */
export const netArea = (p: Poly): number =>
  areaOf(p[0]!) - p.slice(1).reduce((s, h) => s + areaOf(h), 0);

/** Distance to the nearest ring edge (outer or hole). */
export const distToPoly = (x: number, z: number, p: Poly): number =>
  Math.min(...p.map((r) => distToRing(x, z, r)));
