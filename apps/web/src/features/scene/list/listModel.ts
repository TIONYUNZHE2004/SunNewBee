import type { EdgeStatus } from "../styles";

export interface PlaceItem {
  id: string;
  name: string;
  type: string;
}
export interface EdgeItem {
  id: string;
  name: string;
  status: EdgeStatus;
  coords: [number, number][];
}

type Feature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown> | null;
};

const STATUSES: EdgeStatus[] = ["ok", "unknown", "blocked", "flooded_likely", "flooded_possible"];

function edgeStatus(p: Record<string, unknown>): EdgeStatus {
  // Backend contract: properties.status_for_profile. Fallbacks below are tolerant extras.
  for (const s of [p.status_for_profile, p.status]) {
    if (STATUSES.includes(s as EdgeStatus)) return s as EdgeStatus;
  }
  if (p.flood_class === "likely_flooded") return "flooded_likely";
  if (p.flood_class === "possible") return "flooded_possible";
  const claims = p.claims as Record<string, { status?: string }> | undefined;
  if (claims && Object.values(claims).some((c) => c?.status && c.status !== "verified"))
    return "unknown";
  // Never present unverified data as "Checked".
  return "unknown";
}

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
      places.push({ id, name: String(p.name ?? id), type: String(p.type ?? "other") });
    } else if (f.geometry?.type === "LineString") {
      edges.push({
        id,
        name: String(p.name ?? id),
        status: edgeStatus(p),
        coords: (f.geometry.coordinates as [number, number][]) ?? [],
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

export const humanType = (t: string) => t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
