import * as THREE from "three";
import { localRing, triangulate } from "../cityMesh";
import type { LocalFrame } from "../frame";
import { LANDCOVER_MAX_Y } from "./bands";

/**
 * Decorative land-cover tints (ESA WorldCover / OSM). Fill only: no outline, no hatch, no meaning.
 * Water is the BASE water blue, never the flood scenario blue (#1e6fb8).
 */
export const LANDCOVER_COLOURS: Record<string, string> = {
  forest: "#6f9a5b",
  grass: "#9cc483",
  scrub: "#8fae6e",
  farmland: "#c9c98f",
  oil_palm: "#7d9a55",
  residential: "#e6e1d6",
  commercial: "#e0dbe4",
  industrial: "#d9d6cf",
  parking: "#c7c4bd",
  construction: "#c9b28d",
  bare: "#d8ccb3",
  water: "#7fb6c9",
};
const UNKNOWN_COLOUR = "#d8d3c8";

/** Draw order, lowest first. */
export const LANDCOVER_ORDER = [
  "farmland",
  "oil_palm",
  "forest",
  "grass",
  "scrub",
  "residential",
  "commercial",
  "industrial",
  "parking",
  "bare",
  "construction",
  "water",
] as const;

/** Lifts span 0.00 to 0.04 m: parks (0.05) and base water (0.06) sit above, roads at 0.08 m. */
const MAX_LIFT_M = LANDCOVER_MAX_Y;
const lift = (cls: string) => {
  const i = (LANDCOVER_ORDER as readonly string[]).indexOf(cls);
  return i < 0 ? 0 : (MAX_LIFT_M * i) / (LANDCOVER_ORDER.length - 1);
};

function polygonsOf(g: GeoJSON.Geometry | null | undefined): unknown[][] {
  if (g?.type === "Polygon") return [g.coordinates];
  if (g?.type === "MultiPolygon") return g.coordinates;
  return [];
}

/**
 * One non-indexed, vertex-coloured, upward-facing triangle mesh of every land-cover polygon, each
 * flat at its class lift. A polygon that cannot be triangulated faithfully is skipped. Display
 * only: nothing here is read by routing, flood or answers.
 */
export function landcoverMesh(
  fc: GeoJSON.FeatureCollection,
  frame: LocalFrame,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const features = Array.isArray(fc?.features) ? fc.features : [];
  const colours = new Map<string, number[]>();
  const rgb = (cls: string) => {
    let c = colours.get(cls);
    if (!c) {
      c = new THREE.Color(LANDCOVER_COLOURS[cls] ?? UNKNOWN_COLOUR).toArray();
      colours.set(cls, c);
    }
    return c;
  };
  for (const f of features) {
    const raw = f?.properties?.class;
    const cls = typeof raw === "string" ? raw : "";
    const y = lift(cls);
    const c = rgb(cls);
    for (const rings of polygonsOf(f?.geometry)) {
      const local = (rings as unknown[]).map((r) =>
        Array.isArray(r) ? localRing(r as [number, number][], frame) : null,
      );
      if (local.length === 0 || local.some((r) => r === null)) continue;
      const [contour, ...holes] = local as [number, number][][];
      const tris = triangulate(contour!, holes);
      if (!tris) continue;
      const all = [contour!, ...holes].flat();
      for (const t of tris)
        for (const i of t) {
          pos.push(all[i]![0], y, all[i]![1]);
          col.push(c[0]!, c[1]!, c[2]!);
        }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(
      pos.map((_, i) => (i % 3 === 1 ? 1 : 0)),
      3,
    ),
  );
  return g;
}
