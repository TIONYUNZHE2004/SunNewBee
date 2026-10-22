import type { MarathonResult, Pressure } from "./closureSimModel";
import { metres } from "./courseDressing";

/**
 * T-031 detour traffic (Yunzhe, 22 Oct): illustrative cars on each detour road, as many and as slow
 * as the engine's pressure band says (high: many, slow; medium: some; low: few). The band is the
 * engine's; the counts and speeds are decoration, never vehicle counts or delays.
 */

/** Cars drawn per detour road by pressure band. */
export const BAND_CARS: Record<Pressure, number> = { high: 6, medium: 3, low: 1 };
/** Display speed (m/s) by band: crawling under high pressure. */
export const BAND_SPEED_MPS: Record<Pressure, number> = { high: 2.5, medium: 5, low: 8 };
/** At most this many detour cars in all. */
export const MAX_DETOUR_CARS = 80;

export const DETOUR_CARS_NOTE = "Cars are illustrative, not vehicle counts or delays.";

type Coords = number[][];

export interface DetourLine {
  coords: Coords;
  length: number;
  band: Pressure;
  /** Index of its road in `impact.detour_roads`. */
  road: number;
}

/** Each detour road's stretches on the map (the access layer's edges), with its pressure band. */
export function detourLines(
  m: MarathonResult,
  edges: readonly { id: string; coords: Coords }[],
): DetourLine[] {
  const byId = new Map(edges.map((e) => [e.id, e.coords]));
  const out: DetourLine[] = [];
  for (const [r, road] of m.impact.detour_roads.entries()) {
    for (const id of road.segment_ids) {
      const coords = byId.get(id);
      if (!coords || coords.length < 2) continue;
      let length = 0;
      for (let i = 1; i < coords.length; i++)
        length += metres(coords[i - 1] as number[], coords[i] as number[]);
      if (length > 1) out.push({ coords, length, band: road.pressure, road: r });
    }
  }
  return out;
}

/** The cars to draw: BAND_CARS per road, spread over its stretches, at most MAX_DETOUR_CARS. */
export function detourCars(
  m: MarathonResult,
  lines: readonly DetourLine[],
): { line: number; offset: number; speed: number }[] {
  const out: { line: number; offset: number; speed: number }[] = [];
  for (const [r, road] of m.impact.detour_roads.entries()) {
    const mine = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.road === r);
    if (!mine.length) continue;
    const n = BAND_CARS[road.pressure];
    for (let k = 0; k < n && out.length < MAX_DETOUR_CARS; k++) {
      const pick = mine[k % mine.length] as { l: DetourLine; i: number };
      out.push({ line: pick.i, offset: (k * 0.61803) % 1, speed: BAND_SPEED_MPS[road.pressure] });
    }
  }
  return out;
}

const lerp = (a: number[], b: number[], u: number): [number, number] => [
  (a[0] ?? 0) + u * ((b[0] ?? 0) - (a[0] ?? 0)),
  (a[1] ?? 0) + u * ((b[1] ?? 0) - (a[1] ?? 0)),
];

/** The point `d` metres along a line, looping. */
export function alongLoop(l: DetourLine, d: number): [number, number] {
  let rest = ((d % l.length) + l.length) % l.length;
  for (let i = 1; i < l.coords.length; i++) {
    const a = l.coords[i - 1] as number[];
    const b = l.coords[i] as number[];
    const seg = metres(a, b);
    if (rest <= seg && seg > 0) return lerp(a, b, rest / seg);
    rest -= seg;
  }
  const last = l.coords[l.coords.length - 1] as number[];
  return [last[0] ?? 0, last[1] ?? 0];
}
