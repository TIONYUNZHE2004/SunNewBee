import type { MultiPolygon, Polygon } from "polygon-clipping";
import * as pcModule from "polygon-clipping";
import type { LonLat } from "../scene/geo";
import { localRing } from "../scene/three/cityMesh";
import type { LocalFrame } from "../scene/three/frame";
import type { Boundary, P } from "../scene/three/ground/boundary";

const pc = (pcModule as unknown as { default?: typeof pcModule }).default ?? pcModule;
export type FloodClass = "likely_flooded" | "possible";
export interface FloodShape {
  kind: FloodClass;
  rings: P[][];
}

const close = (r: P[]): P[] => [...r, r[0]!];

/** Corner cutting is display only. Exact intersection below keeps holes and never adds area. */
function rounded(ring: P[]): P[] {
  let out = ring;
  for (let pass = 0; pass < 2; pass++) {
    const next: P[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i]!;
      const b = out[(i + 1) % out.length]!;
      // Limit the rounding to the raster-cell scale; long river edges retain their shape.
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const k = Math.min(0.25, 7.5 / Math.max(length, 1));
      next.push(
        [a[0] * (1 - k) + b[0] * k, a[1] * (1 - k) + b[1] * k],
        [a[0] * k + b[0] * (1 - k), a[1] * k + b[1] * (1 - k)],
      );
    }
    out = next;
  }
  return out;
}

/** Strict classes: decorative/base/unknown polygons can never become scenario water.
 * Only presentation geometry is rounded/clipped. API classes, routes and counters stay intact. */
export function floodShapes(
  data: unknown,
  frame: LocalFrame,
  boundary?: Boundary | null,
): FloodShape[] {
  const out: FloodShape[] = [];
  const features = (data as { features?: GeoJSON.Feature[] } | null)?.features ?? [];
  for (const f of features) {
    // The legacy river API omits class on its water-only GeoJSON. Its explicit river
    // scenario id + surface height identify that contract, never an arbitrary base layer.
    const props = f.properties;
    const legacyRiver =
      props?.class == null &&
      /^(baseline|stage_p[1-5]m)(?:_lowlying)?$/.test(String(props?.scenario_id ?? "")) &&
      typeof props?.surface_height_m === "number" &&
      Number.isFinite(props.surface_height_m);
    const kind = props?.class ?? (legacyRiver ? "likely_flooded" : undefined);
    if (kind !== "likely_flooded" && kind !== "possible") continue;
    const g = f.geometry;
    const polys =
      g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) {
      const rings = poly.map((r) => localRing(r as LonLat[], frame));
      if (!rings.length || rings.some((r) => !r || r.length < 3)) continue;
      const original = (rings as P[][]).map(close) as Polygon;
      try {
        let cut: MultiPolygon =
          kind === "possible"
            ? pc.intersection((rings as P[][]).map((r) => close(rounded(r))) as Polygon, original)
            : [original];
        if (boundary)
          cut = pc.intersection(
            cut,
            boundary.polys.map((p) => p.map(close)),
          );
        for (const p of cut) out.push({ kind, rings: p.map((r) => r.slice(0, -1) as P[]) });
      } catch {
        // Invalid geometry is a gap. Do not draw a fallback outside the checked footprint.
      }
    }
  }
  return out;
}

export const WATER_LOOK_NOTE = "Water look is illustrative; depth not modelled.";
