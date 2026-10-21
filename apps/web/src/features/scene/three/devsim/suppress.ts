import { useMemo } from "react";
import { useDevsim } from "../../../devsim/devsimStore";
import type { DevelopmentPlan } from "../../../devsim/types";
import type { Placement } from "../assets/fit";
import type { LocalFrame } from "../frame";
import { TRACK_STRIDE } from "../props/construction";
import { inRing, type Poly, polygonsOf } from "../props/polyGeom";

/** A local-ground test: true where the city's own decorative dressing must not draw. */
export type Suppress = (x: number, z: number) => boolean;

/** The parcel's polygons (local) from the landcover feature whose `osm` is the plan's parcel id. */
export function parcelPolys(plan: DevelopmentPlan, landcover: unknown, frame: LocalFrame): Poly[] {
  const fc = landcover as { features?: GeoJSON.Feature[] } | null | undefined;
  const out: Poly[] = [];
  for (const f of fc?.features ?? []) {
    const osm = (f.properties as { osm?: unknown } | null)?.osm;
    if (osm === plan.site.parcel_id) out.push(...polygonsOf(f.geometry, frame));
  }
  return out;
}

/** True inside any outer ring and outside its holes. */
export function inPolys(polys: readonly Poly[], x: number, z: number): boolean {
  for (const p of polys) {
    const [outer, ...holes] = p;
    if (outer && inRing(x, z, outer) && !holes.some((h) => inRing(x, z, h))) return true;
  }
  return false;
}

/**
 * How far outside the parcel outline still counts as on the parcel (m): the city places its
 * construction hoardings exactly on the boundary (`props/construction.ts`), so a plain inside test
 * kept about half of them (the grey panels by the tower at the 30 s move-in, C-align).
 */
export const PARCEL_EDGE_M = 1.5;

/** True within `m` metres of any ring edge of the polygons. */
export function nearPolyEdge(polys: readonly Poly[], x: number, z: number, m: number): boolean {
  for (const p of polys)
    for (const ring of p)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i] as readonly [number, number];
        const c = ring[(i + 1) % ring.length] as readonly [number, number];
        const dx = c[0] - a[0];
        const dz = c[1] - a[1];
        const l2 = dx * dx + dz * dz || 1;
        const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
        if (Math.hypot(a[0] + dx * u - x, a[1] + dz * u - z) <= m) return true;
      }
  return false;
}

/** On the parcel: inside it, or on its outline (within `PARCEL_EDGE_M`). */
export function parcelSuppress(polys: readonly Poly[]): Suppress {
  return (x, z) => inPolys(polys, x, z) || nearPolyEdge(polys, x, z, PARCEL_EDGE_M);
}

/**
 * While a Development Simulation is shown, the city's own decorative construction dressing on the
 * plan's parcel (the stylised city dresses construction land: kit props and earth tracks) is
 * suppressed, so only the devsim site kit shows there; that includes the hoardings on its outline. Null when nothing is suppressed.
 */
export function useDevsimSuppress(frame: LocalFrame | null, landcover: unknown): Suppress | null {
  const plan = useDevsim((s) => s.plan);
  return useMemo(() => {
    if (!plan || !frame) return null;
    const polys = parcelPolys(plan, landcover, frame);
    if (polys.length === 0) return null;
    return parcelSuppress(polys);
  }, [plan, frame, landcover]);
}

/** Kits without the construction props inside the suppressed area (same map when none). */
export function suppressKits(
  kits: Map<string, Placement[]>,
  suppress: Suppress | null | undefined,
): Map<string, Placement[]> {
  if (!suppress) return kits;
  const out = new Map<string, Placement[]>();
  for (const [k, list] of kits) {
    const kept = list.filter((p) => p.asset !== "construction" || !suppress(p.x, p.z));
    if (kept.length > 0) out.set(k, kept);
  }
  return out;
}

const trackCache = new WeakMap<Float32Array, WeakMap<Suppress, Float32Array>>();
/** Earth-track segments whose midpoint is outside the suppressed area (memoised per list). */
export function suppressTracks(tracks: Float32Array, suppress: Suppress): Float32Array {
  let m = trackCache.get(tracks);
  const hit = m?.get(suppress);
  if (hit) return hit;
  const kept: number[] = [];
  for (let i = 0; i + TRACK_STRIDE <= tracks.length; i += TRACK_STRIDE) {
    const x0 = tracks[i] as number;
    const z0 = tracks[i + 1] as number;
    const x1 = tracks[i + 2] as number;
    const z1 = tracks[i + 3] as number;
    if (suppress((x0 + x1) / 2, (z0 + z1) / 2)) continue;
    for (let k = 0; k < TRACK_STRIDE; k++) kept.push(tracks[i + k] as number);
  }
  const out = kept.length === tracks.length ? tracks : new Float32Array(kept);
  if (!m) {
    m = new WeakMap();
    trackCache.set(tracks, m);
  }
  m.set(suppress, out);
  return out;
}
