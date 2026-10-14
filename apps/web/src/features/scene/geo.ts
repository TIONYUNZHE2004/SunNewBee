import { mapStatus } from "./status";
import type { EdgeStatus } from "./styles";

export type LonLat = [number, number];

type Feature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown> | null;
};

export interface LineFeature {
  id: string;
  status: EdgeStatus;
  coords: LonLat[];
}
export interface PointFeature {
  id: string;
  name: string;
  type: string;
  coord: LonLat;
}

const features = (d: unknown): Feature[] =>
  ((d as { features?: Feature[] } | null)?.features ?? []).filter(Boolean);

export function lineFeatures(d: unknown): LineFeature[] {
  const out: LineFeature[] = [];
  for (const f of features(d)) {
    if (f.geometry?.type !== "LineString") continue;
    const p = f.properties ?? {};
    out.push({
      id: String(p.id ?? out.length),
      status: mapStatus(p),
      coords: (f.geometry.coordinates as LonLat[]) ?? [],
    });
  }
  return out;
}

export function pointFeatures(d: unknown): PointFeature[] {
  const out: PointFeature[] = [];
  for (const f of features(d)) {
    if (f.geometry?.type !== "Point") continue;
    const p = f.properties ?? {};
    const c = f.geometry.coordinates as number[];
    if (!p.id || !c || c.length < 2) continue;
    out.push({
      id: String(p.id),
      name: String(p.name ?? p.id),
      type: String(p.type ?? "other"),
      coord: [c[0] as number, c[1] as number],
    });
  }
  return out;
}

/** Outer ring + holes of each Polygon/MultiPolygon, with the feature's surface height. */
export function waterPolygons(d: unknown): { key: string; rings: LonLat[][]; height: number }[] {
  const out: { key: string; rings: LonLat[][]; height: number }[] = [];
  for (const f of features(d)) {
    const h = Number(f.properties?.surface_height_m);
    const height = Number.isFinite(h) ? h : 0;
    const t = f.geometry?.type;
    const c = f.geometry?.coordinates;
    if (t === "Polygon") out.push({ key: `p${out.length}`, rings: c as LonLat[][], height });
    else if (t === "MultiPolygon")
      for (const poly of c as LonLat[][][])
        out.push({ key: `p${out.length}`, rings: poly, height });
  }
  return out;
}

/** FeatureCollection whose line features carry a normalised `status_for_profile` (for Mapbox expressions). */
export function normalizeLayer(d: unknown): GeoJSON.FeatureCollection {
  const fs = features(d).map((f) =>
    f.geometry?.type === "LineString"
      ? {
          ...f,
          properties: { ...(f.properties ?? {}), status_for_profile: mapStatus(f.properties) },
        }
      : f,
  );
  return { type: "FeatureCollection", features: fs as GeoJSON.Feature[] };
}

/** Group line features by status so each group renders as one batched primitive. */
export function groupByStatus(lines: LineFeature[]): Map<EdgeStatus, LonLat[][]> {
  const m = new Map<EdgeStatus, LonLat[][]>();
  for (const l of lines) {
    if (l.coords.length < 2) continue;
    const arr = m.get(l.status);
    if (arr) arr.push(l.coords);
    else m.set(l.status, [l.coords]);
  }
  return m;
}
