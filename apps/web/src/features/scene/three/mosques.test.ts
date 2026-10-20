import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFrame, type LocalFrame } from "./frame";

const readJson = (rel: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../../../../data/seed/elmina/${rel}`, import.meta.url), "utf8"),
  );

type Pt = [number, number];
interface Fc {
  features: {
    properties: Record<string, string>;
    geometry: { type: string; coordinates: number[][][] | number[] };
  }[];
}

const site = readJson("site.json") as { center: [number, number] };
const frame: LocalFrame = createFrame(site.center);
const buildings = readJson("base/buildings.geojson") as Fc;
const places = readJson("base/places.geojson") as Fc;

const local = ([lon, lat]: number[]): Pt => frame.toLocal(lon!, lat!);
const ringOf = (g: Fc["features"][number]["geometry"]): Pt[] | null =>
  g.type === "Polygon" ? (g.coordinates as number[][][])[0]!.map(local) : null;

function inside([x, y]: Pt, ring: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i]!;
    const [bx, by] = ring[j]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) c = !c;
  }
  return c;
}

function distToSegment([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Metres from a point to a footprint: 0 when it is inside or on the outline. */
function distToRing(p: Pt, ring: Pt[]): number {
  if (inside(p, ring)) return 0;
  let d = Number.POSITIVE_INFINITY;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    d = Math.min(d, distToSegment(p, ring[i]!, ring[j]!));
  return d;
}

const NEAR_M = 30;
const footprints = buildings.features.flatMap((f) => {
  const ring = ringOf(f.geometry);
  return ring ? [{ id: f.properties.id!, archetype: f.properties.archetype!, ring }] : [];
});

/** The closest building footprint within NEAR_M of a place (one containing the point wins, at 0 m). */
function nearestBuilding(coords: number[]) {
  const p = local(coords);
  let best: { id: string; archetype: string; d: number } | null = null;
  for (const b of footprints) {
    const d = distToRing(p, b.ring);
    if (d <= NEAR_M && (!best || d < best.d)) best = { id: b.id, archetype: b.archetype, d };
  }
  return best;
}

const masjids = places.features.filter((f) => (f.properties.name ?? "").startsWith("Masjid"));

// Mapped as a point only: there is no OSM building within 30 m. They get a marker and no model.
// Empty since T-022 kept only places inside City of Elmina (+200 m): the four point-only masjids
// (Al-Falah, An-Nur, Nurul Amin x2) and Jamiul Ehsan, Saujana Utama and Al-Hidayah lie outside.
const MARKERS_ONLY: string[] = [];

describe("mosque archetype guard (Elmina seed)", () => {
  it("finds the masjid places", () => {
    expect(masjids.length).toBe(1);
  });

  it("every masjid with a footprint within 30 m is drawn on a mosque building", () => {
    let checked = 0;
    for (const f of masjids) {
      const b = nearestBuilding(f.geometry.coordinates as number[]);
      if (!b) continue;
      checked++;
      expect(b.archetype, `${f.properties.name} (${f.properties.id}) near ${b.id}`).toBe("mosque");
    }
    expect(checked).toBe(masjids.length - MARKERS_ONLY.length);
  });

  it.each([["Denai Alam", "osm-way-1030434016", "w1508434447"]])(
    "Masjid %s sits on its mosque building %s",
    (_n, placeId, buildingId) => {
      const f = masjids.find((m) => m.properties.id === placeId);
      expect(f).toBeTruthy();
      const b = nearestBuilding(f!.geometry.coordinates as number[]);
      expect(b).toEqual({ id: buildingId, archetype: "mosque", d: 0 });
    },
  );

  it("the known markers-only masjids have no footprint, so no model is invented for them", () => {
    for (const id of MARKERS_ONLY) {
      const f = masjids.find((m) => m.properties.id === id);
      expect(f, id).toBeTruthy();
      expect(nearestBuilding(f!.geometry.coordinates as number[]), id).toBeNull();
    }
  });
});
