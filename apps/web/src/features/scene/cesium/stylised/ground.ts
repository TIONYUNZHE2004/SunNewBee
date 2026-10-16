import type * as Cesium from "cesium";
import { type Palette, paletteFor, type Theme } from "./palette";

/** A road centre line from the walk network, drawn as a flat corridor `widthM` wide. */
export interface Road {
  id: string;
  coords: [number, number][];
  widthM: number;
}

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

const WIDTH_BY_TYPE: Record<string, number> = {
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
    });
  });
  return out;
}

/** The slice of Cesium the ground builder uses (a fake in unit tests). */
export type GroundCesium = Pick<
  typeof Cesium,
  | "ClassificationPrimitive"
  | "GeometryInstance"
  | "CorridorGeometry"
  | "PolygonGeometry"
  | "PolygonHierarchy"
  | "PerInstanceColorAppearance"
  | "ColorGeometryInstanceAttribute"
  | "VertexFormat"
  | "Color"
  | "Cartesian3"
  | "ClassificationType"
  | "CornerType"
>;

interface GroundCollection {
  add(p: Cesium.ClassificationPrimitive): unknown;
  remove(p: Cesium.ClassificationPrimitive): unknown;
  lowerToBottom(p: Cesium.ClassificationPrimitive): void;
}

interface PostRender {
  addEventListener(cb: () => void): () => void;
}

export interface Ground {
  /** Recolour in place (per-instance colour attributes). Before the primitives are ready the
   * latest theme is kept and applied as soon as they are. */
  setTheme(t: Theme): void;
  /** Remove and destroy everything. Idempotent. */
  destroy(): void;
}

/** Half-height of the classification volumes around the flat (ellipsoid) stylised ground. */
export const VOLUME_HALF_M = 1;

const flat = (ring: [number, number][]) => ring.flatMap((p) => [p[0], p[1]]);

/**
 * Roads (corridors) and water (polygons) painted onto the flat stylised ground as two
 * ClassificationPrimitives with thin volumes (+-1 m around the ellipsoid). Not GroundPrimitive:
 * its volumes span the approximate terrain height range of the area, and 16k of those cost ~5 fps
 * in overdraw (measured). Valid only because the stylised ground is the bare ellipsoid.
 * Decorative: not pickable. Each is lowered to the bottom of `scene.groundPrimitives` so route,
 * flood and gap lines added by the overlay layers draw on top.
 */
export function buildGround(
  C: GroundCesium,
  viewer: {
    scene: { groundPrimitives: GroundCollection; postRender: PostRender; requestRender(): void };
  },
  { roads, water, palette }: { roads: Road[]; water: WaterPolygon[]; palette: Palette },
): Ground {
  const { scene } = viewer;
  const collection = scene.groundPrimitives;
  type Part = {
    prim: Cesium.ClassificationPrimitive;
    key: "road" | "water";
    ids: string[];
    applied: string;
  };
  let parts: Part[] = [];
  let want = palette;
  let stopWatching: (() => void) | null = null;

  const add = (
    key: "road" | "water",
    geometries: (Cesium.CorridorGeometry | Cesium.PolygonGeometry)[],
  ) => {
    if (geometries.length === 0) return;
    const colour = C.ColorGeometryInstanceAttribute.fromColor(
      C.Color.fromCssColorString(palette[key]),
    );
    const ids = geometries.map((_, i) => `${key}:${i}`);
    const prim = new C.ClassificationPrimitive({
      geometryInstances: geometries.map(
        (geometry, i) =>
          new C.GeometryInstance({ geometry, id: ids[i], attributes: { color: colour } }),
      ),
      appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: false }),
      classificationType: C.ClassificationType.TERRAIN,
      allowPicking: false,
      asynchronous: true,
      releaseGeometryInstances: true,
    });
    collection.add(prim);
    collection.lowerToBottom(prim);
    parts.push({ prim, key, ids, applied: palette[key] });
  };

  /** Write the wanted colours into ready primitives; true when nothing is left to do. */
  const sync = () => {
    let done = true;
    for (const part of parts) {
      const css = want[part.key];
      if (part.applied === css) continue;
      if (!part.prim.ready) {
        done = false;
        continue;
      }
      const value = C.ColorGeometryInstanceAttribute.toValue(C.Color.fromCssColorString(css));
      for (const id of part.ids) {
        const a = part.prim.getGeometryInstanceAttributes(id) as { color?: Uint8Array } | undefined;
        if (a) a.color = value;
      }
      part.applied = css;
    }
    return done;
  };

  // Roads first, then water, each lowered to the bottom: draw order is water, roads (bridges
  // cross the river), then every overlay line.
  add(
    "road",
    roads.map(
      (r) =>
        new C.CorridorGeometry({
          positions: C.Cartesian3.fromDegreesArray(flat(r.coords)),
          width: r.widthM,
          cornerType: C.CornerType.ROUNDED,
          height: -VOLUME_HALF_M,
          extrudedHeight: VOLUME_HALF_M,
          vertexFormat: C.VertexFormat.POSITION_ONLY,
        }),
    ),
  );
  add(
    "water",
    water
      .filter((rings) => (rings[0]?.length ?? 0) >= 3)
      .map(
        (rings) =>
          new C.PolygonGeometry({
            polygonHierarchy: new C.PolygonHierarchy(
              C.Cartesian3.fromDegreesArray(flat(rings[0]!)),
              rings
                .slice(1)
                .map((r) => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(flat(r)))),
            ),
            height: -VOLUME_HALF_M,
            extrudedHeight: VOLUME_HALF_M,
            vertexFormat: C.VertexFormat.POSITION_ONLY,
          }),
      ),
  );

  return {
    setTheme(t) {
      want = paletteFor(t);
      if (sync() || stopWatching || parts.length === 0) return;
      // Not ready yet: re-check after each frame until the latest colours are in.
      stopWatching = scene.postRender.addEventListener(() => {
        if (!sync()) return;
        stopWatching?.();
        stopWatching = null;
        scene.requestRender(); // the recolour lands after this frame
      });
    },
    destroy() {
      stopWatching?.();
      stopWatching = null;
      for (const { prim } of parts) {
        collection.remove(prim); // a scene collection also destroys it
        if (!prim.isDestroyed()) prim.destroy();
      }
      parts = [];
    },
  };
}
