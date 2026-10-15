import { centreSourceLabel } from "../../../lib/evidence";
import { mapStatus } from "../status";
import type { EdgeStatus } from "../styles";

export interface PlaceItem {
  id: string;
  name: string;
  type: string;
  /** Staff-reported closure in force ("Closed: works until 2026-10-20"), else undefined. */
  closure?: string;
}
export interface EdgeItem {
  id: string;
  name: string;
  status: EdgeStatus;
  coords: [number, number][];
  closure?: string;
}

const closureOf = (p: Record<string, unknown>): { closure?: string } =>
  p.closed === true && typeof p.closure_label === "string" ? { closure: p.closure_label } : {};

type Feature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown> | null;
};

/** Tolerant parser: the layer payload is a loosely typed FeatureCollection. */
export function parseLayer(data: unknown): { places: PlaceItem[]; edges: EdgeItem[] } {
  const feats = ((data as { features?: Feature[] } | null)?.features ?? []).filter(Boolean);
  const places: PlaceItem[] = [];
  const edges: EdgeItem[] = [];
  for (const f of feats) {
    const p = f.properties ?? {};
    const id = String(p.id ?? "");
    if (!id) continue;
    if (f.geometry?.type === "Point") {
      places.push({
        id,
        name: String(p.name ?? id),
        type: String(p.type ?? "other"),
        ...closureOf(p),
      });
    } else if (f.geometry?.type === "LineString") {
      edges.push({
        id,
        name: p.name ? String(p.name) : `Unnamed ${String(p.type ?? "path").replace(/_/g, " ")}`,
        status: mapStatus(p),
        coords: (f.geometry.coordinates as [number, number][]) ?? [],
        ...closureOf(p),
      });
    }
  }
  return { places, edges };
}

export function groupByType(places: PlaceItem[]): [string, PlaceItem[]][] {
  const m = new Map<string, PlaceItem[]>();
  for (const p of places) m.set(p.type, [...(m.get(p.type) ?? []), p]);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}

const key = (c: number[]) => `${c[0]},${c[1]}`;

/** Edges whose endpoints both lie on the route, ordered along it. */
export function routeSteps(route: GeoJSON.LineString | null, edges: EdgeItem[]): EdgeItem[] {
  if (!route) return [];
  const idx = new Map<string, number>();
  route.coordinates.forEach((c, i) => {
    idx.set(key(c), i);
  });
  return edges
    .filter(
      (e) =>
        e.coords.length >= 2 &&
        idx.has(key(e.coords[0] as number[])) &&
        idx.has(key(e.coords.at(-1) as number[])),
    )
    .sort(
      (a, b) =>
        (idx.get(key(a.coords[0] as number[])) ?? 0) - (idx.get(key(b.coords[0] as number[])) ?? 0),
    );
}

/** Scenario labels already say "(indicative)" in the seed; never repeat it. */
export const withIndicative = (label: string) =>
  /indicative/i.test(label) ? label : `${label} (indicative)`;

export const humanType = (t: string) => t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export interface CentreItem {
  id: string;
  name: string;
  sourceLabel: string;
}
export interface WasteItem {
  id: string;
  name: string;
  typeLabel: string;
  statusLabel: string;
}

const pointProps = (data: unknown, kind: string) =>
  ((data as { features?: Feature[] } | null)?.features ?? [])
    .filter((f) => f?.geometry?.type === "Point" && f.properties?.kind === kind && f.properties.id)
    .map((f) => f.properties as Record<string, unknown>);

/** Evacuation centres from the flood layer, each with its source label. The layer puts the
 * centre's source (official_pps | osm_candidate) in the feature's `type`. */
export function parseCentres(data: unknown): CentreItem[] {
  return pointProps(data, "evac_centre").map((p) => ({
    id: String(p.id),
    name: String(p.name ?? p.id),
    sourceLabel: centreSourceLabel(p.type),
  }));
}

/** Waste points from the waste layer, with status (unknown when absent). */
export function parseWaste(data: unknown): WasteItem[] {
  return pointProps(data, "waste_point").map((p) => ({
    id: String(p.id),
    name: String(p.name ?? p.id),
    typeLabel: humanType(String(p.type ?? "other")),
    statusLabel: `Status: ${String(p.status ?? "unknown")}`,
  }));
}
