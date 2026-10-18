/** A road centre line from the walk network, drawn as a flat corridor `widthM` wide. */
export interface Road {
  id: string;
  coords: [number, number][];
  widthM: number;
  /** What the street is for (drives decoration): not inferred from the width. */
  kind: RoadKind;
}

export type RoadKind = "major" | "residential" | "footway" | "other";

/** A water polygon: outer ring then holes, lon/lat. */
export type WaterPolygon = [number, number][][];

function toPolygon(coords: unknown): WaterPolygon | null {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  const rings: WaterPolygon = [];
  for (const r of coords) {
    if (!Array.isArray(r) || r.length < 4) return null;
    const ring: [number, number][] = [];
    for (const p of r) {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
      ring.push([p[0] as number, p[1] as number]);
    }
    rings.push(ring);
  }
  return rings;
}

/**
 * Lake/riverbank polygons from the buildings payload's `water` collection. This is DECORATIVE base
 * water (OSM hydrology) for the stylised look, NOT a flood scenario: it never encodes a water level,
 * depth or extent. Lines and malformed geometry are dropped.
 */
export function waterFromLayer(fc: unknown): WaterPolygon[] {
  const features = isRec(fc) && Array.isArray(fc.features) ? fc.features : [];
  const out: WaterPolygon[] = [];
  for (const f of features) {
    const g = isRec(f) ? f.geometry : null;
    if (!isRec(g)) continue;
    if (g.type === "Polygon") {
      const p = toPolygon(g.coordinates);
      if (p) out.push(p);
    } else if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
      for (const c of g.coordinates) {
        const p = toPolygon(c);
        if (p) out.push(p);
      }
    }
  }
  return out;
}

/** Park polygons from the buildings payload's `parks`: DECORATIVE outlines, parsed like water. */
export const parksFromLayer = waterFromLayer;

export const WIDTH_BY_TYPE: Record<string, number> = {
  major_road: 10,
  residential: 6,
  service: 6,
  street: 6, // the seed's residential streets
  footway: 2.5,
  path: 2.5,
  pedestrian: 2.5,
  steps: 2.5,
  crossing: 2.5,
};
export const KIND_BY_TYPE: Record<string, RoadKind> = {
  major_road: "major",
  residential: "residential",
  service: "residential",
  street: "residential",
  footway: "footway",
  path: "footway",
  pedestrian: "footway",
  steps: "footway",
  crossing: "footway",
};
export const ROAD_WIDTH_UNKNOWN = 3;

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isPt = (p: unknown): p is [number, number] =>
  Array.isArray(p) &&
  typeof p[0] === "number" &&
  typeof p[1] === "number" &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]);

/**
 * Walk/major-road segments (the `/layers/access` FeatureCollection) to drawable roads, width by
 * segment `type`. Display only: no access fact is read or implied. Drops anything that is not a
 * LineString with at least two distinct finite points.
 */
export function roadsFromWalk(layer: unknown): Road[] {
  const out: Road[] = [];
  const features = isRec(layer) && Array.isArray(layer.features) ? layer.features : [];
  features.forEach((f: unknown, i: number) => {
    if (!isRec(f) || !isRec(f.geometry) || f.geometry.type !== "LineString") return;
    const c = f.geometry.coordinates;
    if (!Array.isArray(c) || !c.every(isPt)) return;
    const coords = c.map((p) => [p[0], p[1]] as [number, number]);
    if (new Set(coords.map((p) => `${p[0]},${p[1]}`)).size < 2) return;
    const props = isRec(f.properties) ? f.properties : {};
    const type = typeof props.type === "string" ? props.type : "";
    out.push({
      id: String(props.id ?? `r${i}`),
      coords,
      widthM: WIDTH_BY_TYPE[type] ?? ROAD_WIDTH_UNKNOWN,
      kind: KIND_BY_TYPE[type] ?? "other",
    });
  });
  return out;
}
