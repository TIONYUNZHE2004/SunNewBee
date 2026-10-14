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

const STATUSES: EdgeStatus[] = ["ok", "unknown", "blocked", "flooded_likely", "flooded_possible"];
const features = (d: unknown): Feature[] =>
  ((d as { features?: Feature[] } | null)?.features ?? []).filter(Boolean);

export function lineFeatures(d: unknown): LineFeature[] {
  const out: LineFeature[] = [];
  for (const f of features(d)) {
    if (f.geometry?.type !== "LineString") continue;
    const p = f.properties ?? {};
    const s = [p.status_for_profile, p.status].find((v) => STATUSES.includes(v as EdgeStatus));
    out.push({
      id: String(p.id ?? out.length),
      // Never present unverified data as checked.
      status: (s as EdgeStatus | undefined) ?? "unknown",
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
