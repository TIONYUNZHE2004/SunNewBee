import type { BuildingsLayer } from "../../../../lib/api";
import type { LocalFrame } from "../frame";
import {
  allWithin,
  type Boundary,
  CLIP_TOLERANCE_M,
  clipLine,
  clipPolygon,
  insideBoundary,
  type P,
} from "./boundary";

/**
 * The stylised city's inputs cut to the Elmina outline (display only, A-T4). Applied once where the
 * data enters the Three.js scene, so every planner downstream (city plan and extrusions, facades,
 * roofs, land cover, parks, water, props, lots, verges, signs, agents, road ribbons) only ever sees
 * what lies inside. Per layer:
 * - buildings and landmark outlines: kept only when every footprint vertex lies within
 *   CLIP_TOLERANCE_M (5 m) of the inside; a building is never cut (a half building reads as a
 *   bug), so the ones crossing the edge are dropped and counted;
 * - land cover, parks and base water: polygons cut geometrically to the outline (a polygon that
 *   crosses it keeps its inside part, split into several features when the cut makes pieces);
 * - trees, signs and point landmarks: kept only inside;
 * - walk lines (the decorative copy the planners read; the data overlays keep the full layer): cut
 *   at the edge crossings, inside runs only; place points inside only.
 */

export interface LayerClipStats {
  kept: number;
  dropped: number;
  /** Polygon layers: features that crossed the outline and were cut (counted in `kept`). */
  cut?: number;
}

export interface ClipStats {
  buildings: LayerClipStats;
  landmarks: LayerClipStats;
  trees: LayerClipStats;
  signage: LayerClipStats;
  landcover: LayerClipStats;
  parks: LayerClipStats;
  water: LayerClipStats;
}

type FC = { type: "FeatureCollection"; features: unknown[] };
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const featuresOf = (fc: unknown): unknown[] =>
  isRec(fc) && Array.isArray(fc.features) ? fc.features : [];
const fcOf = (features: unknown[]): FC => ({ type: "FeatureCollection", features });

/** Outer-ring vertices (lon/lat) of a Polygon / MultiPolygon geometry; null for anything else. */
function outerRings(geom: unknown): P[][] | null {
  if (!isRec(geom) || !Array.isArray(geom.coordinates)) return null;
  const polys =
    geom.type === "Polygon"
      ? [geom.coordinates]
      : geom.type === "MultiPolygon"
        ? geom.coordinates
        : null;
  if (!polys) return null;
  const out: P[][] = [];
  for (const poly of polys) {
    const ring = Array.isArray(poly) ? poly[0] : null;
    if (Array.isArray(ring)) out.push(ring as P[]);
  }
  return out;
}

function pointOf(geom: unknown): P | null {
  if (!isRec(geom) || geom.type !== "Point" || !Array.isArray(geom.coordinates)) return null;
  const [lon, lat] = geom.coordinates as unknown[];
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon as number, lat as number] : null;
}

/** Footprint features (buildings, landmark outlines) within the tolerance; points inside. */
function clipFootprints(
  fc: unknown,
  b: Boundary,
  frame: LocalFrame,
): { fc: FC; stats: LayerClipStats } {
  const kept: unknown[] = [];
  let dropped = 0;
  for (const f of featuresOf(fc)) {
    const g = isRec(f) ? f.geometry : null;
    const rings = outerRings(g);
    const pt = rings ? null : pointOf(g);
    const local: P[] = rings
      ? rings.flat().map(([lon, lat]) => frame.toLocal(lon, lat))
      : pt
        ? [frame.toLocal(pt[0], pt[1])]
        : [];
    const tol = rings ? CLIP_TOLERANCE_M : 0;
    if (local.length > 0 && allWithin(b, local, tol)) kept.push(f);
    else dropped++;
  }
  return { fc: fcOf(kept), stats: { kept: kept.length, dropped } };
}

/** Point features inside (anything else is dropped). */
function clipPoints(fc: unknown, b: Boundary, frame: LocalFrame) {
  const kept: unknown[] = [];
  let dropped = 0;
  for (const f of featuresOf(fc)) {
    const pt = pointOf(isRec(f) ? f.geometry : null);
    const [x, z] = pt ? frame.toLocal(pt[0], pt[1]) : [Number.NaN, Number.NaN];
    if (pt && insideBoundary(b, x, z)) kept.push(f);
    else dropped++;
  }
  return { fc: fcOf(kept), stats: { kept: kept.length, dropped } };
}

/** Polygon features cut to the outline; a cut that makes pieces gives one feature per piece. */
function clipPolygons(fc: unknown, b: Boundary, frame: LocalFrame) {
  const kept: unknown[] = [];
  let dropped = 0;
  let cut = 0;
  for (const f of featuresOf(fc)) {
    if (!isRec(f) || !isRec(f.geometry)) {
      dropped++;
      continue;
    }
    const g = f.geometry;
    const polys =
      g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : null;
    if (!Array.isArray(polys)) {
      dropped++;
      continue;
    }
    const pieces: P[][][] = [];
    let changed = false;
    for (const poly of polys) {
      if (!Array.isArray(poly)) continue;
      const out = clipPolygon(b, poly as P[][], frame);
      if (out.length !== 1 || out[0] !== poly) changed = true;
      pieces.push(...out);
    }
    if (pieces.length === 0) {
      dropped++;
      continue;
    }
    if (!changed) {
      kept.push(f);
      continue;
    }
    cut++;
    const props = isRec(f.properties) ? f.properties : {};
    pieces.forEach((coordinates, k) => {
      const id = props.id;
      const p =
        k > 0 && (typeof id === "string" || typeof id === "number")
          ? { ...props, id: `${id}~${k}` }
          : props;
      kept.push({ ...f, properties: p, geometry: { type: "Polygon", coordinates } });
    });
  }
  return { fc: fcOf(kept), stats: { kept: kept.length, dropped, cut } };
}

/** The buildings payload cut to the outline (see the module note). Pure. */
export function clipLayer(
  layer: BuildingsLayer,
  b: Boundary,
  frame: LocalFrame,
): { layer: BuildingsLayer; stats: ClipStats } {
  const buildings = clipFootprints(layer.buildings, b, frame);
  const landmarks = clipFootprints(layer.landmarks, b, frame);
  const trees = clipPoints(layer.trees, b, frame);
  const signage = clipPoints(layer.signage, b, frame);
  const landcover = clipPolygons(layer.landcover, b, frame);
  const parks = clipPolygons(layer.parks, b, frame);
  const water = clipPolygons(layer.water, b, frame);
  return {
    layer: {
      ...layer,
      buildings: buildings.fc,
      landmarks: landmarks.fc,
      trees: trees.fc,
      signage: signage.fc,
      landcover: landcover.fc,
      parks: parks.fc,
      water: water.fc,
    },
    stats: {
      buildings: buildings.stats,
      landmarks: landmarks.stats,
      trees: trees.stats,
      signage: signage.stats,
      landcover: landcover.stats,
      parks: parks.stats,
      water: water.stats,
    },
  };
}

/**
 * The walk layer as the decorative planners read it: LineStrings cut to their inside runs (one
 * feature per run, properties kept), Points inside only, anything else dropped. Never used for the
 * data overlays or routing. Pure.
 */
export function clipWalk<T>(walk: T, b: Boundary, frame: LocalFrame): T {
  if (!isRec(walk) || !Array.isArray(walk.features)) return walk;
  const out: unknown[] = [];
  for (const f of walk.features) {
    if (!isRec(f) || !isRec(f.geometry)) continue;
    const g = f.geometry;
    if (g.type === "Point") {
      const pt = pointOf(g);
      if (!pt) continue;
      const [x, z] = frame.toLocal(pt[0], pt[1]);
      if (insideBoundary(b, x, z)) out.push(f);
      continue;
    }
    if (g.type !== "LineString" || !Array.isArray(g.coordinates)) continue;
    const pts: P[] = [];
    let ok = true;
    for (const c of g.coordinates) {
      if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
        ok = false;
        break;
      }
      pts.push(frame.toLocal(c[0] as number, c[1] as number));
    }
    if (!ok || pts.length < 2) continue;
    if (allWithin(b, pts)) {
      // Wholly inside (no vertex outside): kept as is unless an edge leaves and comes back.
      const runs = clipLine(b, pts);
      if (runs.length === 1 && runs[0]!.length === pts.length) {
        out.push(f);
        continue;
      }
    }
    for (const run of clipLine(b, pts))
      out.push({
        ...f,
        geometry: { type: "LineString", coordinates: run.map(([x, z]) => frame.toLonLat(x, z)) },
      });
  }
  return { ...walk, features: out } as T;
}
