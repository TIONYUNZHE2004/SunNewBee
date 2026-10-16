import type * as Cesium from "cesium";
import { dashSegments, offsetLine } from "./lines";
import type { Palette } from "./palette";

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
const KIND_BY_TYPE: Record<string, RoadKind> = {
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

/** The slice of Cesium the ground builder uses (a fake in unit tests). */
export type GroundCesium = Pick<
  typeof Cesium,
  | "ClassificationPrimitive"
  | "GroundPrimitive"
  | "EllipsoidSurfaceAppearance"
  | "Material"
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

type GroundPrim = Cesium.ClassificationPrimitive | Cesium.GroundPrimitive;

interface GroundCollection {
  add(p: GroundPrim): unknown;
  remove(p: GroundPrim): unknown;
  lowerToBottom(p: GroundPrim): void;
}

interface PostRender {
  addEventListener(cb: () => void): () => void;
}

type PartKey = "road" | "pavement" | "kerb" | "roadMark" | "park" | "parkEdge" | "water" | "shore";

export interface Ground {
  /** Recolour in place (per-instance colour attributes). Before the primitives are ready the
   * latest palette is kept and applied as soon as they are. Only `final` calls recolour: the
   * caller passes the target palette once, at the fade's midpoint. */
  setPalette(p: Palette, final: boolean): void;
  /** Motion clock seconds: drives the base-water ripple (the only animated ground part). */
  setTime(t: number): void;
  /** Remove and destroy everything. Idempotent. */
  destroy(): void;
}

/**
 * Ripple for DECORATIVE base water only (never a flood layer: flood scenarios are drawn by the
 * overlay lines and carry no animation). Uniforms: color, shoreColor, time.
 */
export const WATER_SHIMMER_GLSL = /* glsl */ `
czm_material czm_getMaterial(czm_materialInput mi) {
  czm_material m = czm_getDefaultMaterial(mi);
  vec2 p = mi.st * 40.0;
  float w = sin(p.x * 1.7 + time * 0.8) * sin(p.y * 1.3 - time * 0.6);
  m.diffuse = mix(color.rgb, shoreColor.rgb, 0.12 + 0.08 * w);
  return m;
}
`;

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
  {
    roads,
    water,
    parks,
    palette,
  }: { roads: Road[]; water: WaterPolygon[]; parks: WaterPolygon[]; palette: Palette },
): Ground {
  const { scene } = viewer;
  const collection = scene.groundPrimitives;
  type Part = {
    prim: GroundPrim;
    key: PartKey;
    ids: string[];
    applied: string;
  };
  /** The base-water material (set when there are lakes). */
  let waterMat: Cesium.Material | null = null;
  let waterApplied = `${palette.water}|${palette.shore}`;
  let parts: Part[] = [];
  let want = palette;
  let stopWatching: (() => void) | null = null;

  const add = (key: PartKey, geometries: (Cesium.CorridorGeometry | Cesium.PolygonGeometry)[]) => {
    if (geometries.length === 0) return;
    const colour = C.ColorGeometryInstanceAttribute.fromColor(
      C.Color.fromCssColorString(palette[key]),
    );
    const ids = geometries.map((_, i) => `${key}:${i}`);
    const prim: GroundPrim = new C.ClassificationPrimitive({
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
    if (waterMat) {
      const key = `${want.water}|${want.shore}`;
      if (key !== waterApplied) {
        waterMat.uniforms.color = C.Color.fromCssColorString(want.water);
        waterMat.uniforms.shoreColor = C.Color.fromCssColorString(want.shore);
        waterApplied = key;
      }
    }
    for (const part of parts) {
      if (part.prim === waterPrim) continue; // coloured through its material above
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

  const corridor = (coords: [number, number][], width: number) =>
    new C.CorridorGeometry({
      positions: C.Cartesian3.fromDegreesArray(flat(coords)),
      width,
      cornerType: C.CornerType.ROUNDED,
      height: -VOLUME_HALF_M,
      extrudedHeight: VOLUME_HALF_M,
      vertexFormat: C.VertexFormat.POSITION_ONLY,
    });
  const polygon = (rings: WaterPolygon) =>
    new C.PolygonGeometry({
      polygonHierarchy: new C.PolygonHierarchy(
        C.Cartesian3.fromDegreesArray(flat(rings[0]!)),
        rings.slice(1).map((r) => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(flat(r)))),
      ),
      height: -VOLUME_HALF_M,
      extrudedHeight: VOLUME_HALF_M,
      vertexFormat: C.VertexFormat.POSITION_ONLY,
    });
  /** Lake polygon for the material-based water primitive: a flat surface, not a thin volume. */
  const surface = (rings: WaterPolygon) =>
    new C.PolygonGeometry({
      polygonHierarchy: new C.PolygonHierarchy(
        C.Cartesian3.fromDegreesArray(flat(rings[0]!)),
        rings.slice(1).map((r) => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(flat(r)))),
      ),
      vertexFormat: C.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
    });
  const valid = (list: WaterPolygon[]) => list.filter((rings) => (rings[0]?.length ?? 0) >= 3);
  const kerbed = roads.filter((r) => r.kind === "residential" || r.kind === "major");

  // Pavements, kerbs, parks and shore are FLAT classification bands, never raised geometry, so
  // route, path-status and flood lines drawn on the ground stay visible. Each part is lowered to
  // the bottom as it is added, so add in reverse of the wanted bottom-to-top order:
  // park, parkEdge, water, shore, pavement, road, kerb, roadMark, then every overlay line.
  add(
    "roadMark",
    roads
      .filter((r) => r.kind === "major")
      .flatMap((r) => dashSegments(r.coords, 3, 6).map((d) => corridor(d, 0.25))),
  );
  add(
    "kerb",
    kerbed.flatMap((r) => [
      corridor(offsetLine(r.coords, r.widthM / 2), 0.35),
      corridor(offsetLine(r.coords, -r.widthM / 2), 0.35),
    ]),
  );
  add(
    "road",
    roads.map((r) => corridor(r.coords, r.widthM)),
  );
  add(
    "pavement",
    kerbed.flatMap((r) => [
      corridor(offsetLine(r.coords, r.widthM / 2 + 1), 2),
      corridor(offsetLine(r.coords, -(r.widthM / 2 + 1)), 2),
    ]),
  );
  add(
    "shore",
    valid(water).map((rings) => corridor(rings[0]!, 4)),
  );
  // Base water is the one part with a material (ripple): a GroundPrimitive over the few lake
  // polygons. Still lowered under the overlays and never pickable.
  let waterPrim: GroundPrim | null = null;
  const lakes = valid(water);
  if (lakes.length > 0) {
    waterMat = new C.Material({
      fabric: {
        uniforms: {
          color: C.Color.fromCssColorString(palette.water),
          shoreColor: C.Color.fromCssColorString(palette.shore),
          time: 0,
        },
        source: WATER_SHIMMER_GLSL,
      },
      translucent: false,
    });
    waterPrim = new C.GroundPrimitive({
      geometryInstances: lakes.map(
        (rings, i) => new C.GeometryInstance({ geometry: surface(rings), id: `water:${i}` }),
      ),
      appearance: new C.EllipsoidSurfaceAppearance({ material: waterMat, aboveGround: false }),
      classificationType: C.ClassificationType.TERRAIN,
      allowPicking: false,
      asynchronous: true,
      releaseGeometryInstances: true,
    });
    collection.add(waterPrim);
    collection.lowerToBottom(waterPrim);
    parts.push({ prim: waterPrim, key: "water", ids: [], applied: palette.water });
  }
  add(
    "parkEdge",
    valid(parks).map((rings) => corridor(rings[0]!, 3)),
  );
  add("park", valid(parks).map(polygon));

  return {
    setPalette(p, final) {
      want = p;
      if (!final) return;
      if (sync() || stopWatching || parts.length === 0) return;
      // Not ready yet: re-check after each frame until the latest colours are in.
      stopWatching = scene.postRender.addEventListener(() => {
        if (!sync()) return;
        stopWatching?.();
        stopWatching = null;
        scene.requestRender(); // the recolour lands after this frame
      });
    },
    setTime(t) {
      if (waterMat && !waterMat.isDestroyed()) waterMat.uniforms.time = t;
    },
    destroy() {
      stopWatching?.();
      stopWatching = null;
      for (const { prim } of parts) {
        collection.remove(prim); // a scene collection also destroys it
        if (!prim.isDestroyed()) prim.destroy();
      }
      parts = [];
      if (waterMat && !waterMat.isDestroyed()) waterMat.destroy();
      waterMat = null;
    },
  };
}
