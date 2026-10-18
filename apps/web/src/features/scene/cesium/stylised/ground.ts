import type * as Cesium from "cesium";
import type { Road, WaterPolygon } from "../../shared/roads";
import {
  buildGroundLayers,
  type Decal,
  type ImageryCesium,
  type ImageryScene,
  indexDecals,
  type MakeCanvas,
  makeDecal,
} from "./groundImagery";
import { dashSegments, offsetLine } from "./lines";
import type { Palette } from "./palette";

export {
  KIND_BY_TYPE,
  parksFromLayer,
  ROAD_WIDTH_UNKNOWN,
  type Road,
  type RoadKind,
  roadsFromWalk,
  type WaterPolygon,
  WIDTH_BY_TYPE,
  waterFromLayer,
} from "../../shared/roads";

const valid = (list: WaterPolygon[]) => list.filter((rings) => (rings[0]?.length ?? 0) >= 3);

/**
 * The decorative ground decals for the stylised city: roads (corridors `widthM` wide), pavements and
 * kerbs beside residential and major roads, dashed marks on major roads, a shore band around base
 * water, and parks with an edge band. Flat paint only (never raised), so route, path-status and flood
 * lines stay visible above them.
 */
export function groundDecals({
  roads,
  water,
  parks,
}: {
  roads: Road[];
  water: WaterPolygon[];
  parks: WaterPolygon[];
}): Decal[] {
  const out: Decal[] = [];
  const kerbed = roads.filter((r) => r.kind === "residential" || r.kind === "major");
  for (const rings of valid(parks)) {
    out.push(makeDecal("park", "fill", rings, 0));
    out.push(makeDecal("parkEdge", "line", [rings[0]!], 3));
  }
  for (const rings of valid(water)) out.push(makeDecal("shore", "line", [rings[0]!], 4));
  for (const r of kerbed)
    for (const side of [1, -1])
      out.push(makeDecal("pavement", "line", [offsetLine(r.coords, side * (r.widthM / 2 + 1))], 2));
  for (const r of roads) out.push(makeDecal("road", "line", [r.coords], r.widthM));
  for (const r of kerbed)
    for (const side of [1, -1])
      out.push(makeDecal("kerb", "line", [offsetLine(r.coords, (side * r.widthM) / 2)], 0.35));
  for (const r of roads.filter((x) => x.kind === "major"))
    for (const d of dashSegments(r.coords, 3, 6))
      out.push(makeDecal("roadMark", "line", [d], 0.25));
  return out;
}

/** The slice of Cesium the ground builder uses (a fake in unit tests). */
export type GroundCesium = ImageryCesium &
  Pick<
    typeof Cesium,
    | "GroundPrimitive"
    | "EllipsoidSurfaceAppearance"
    | "Material"
    | "GeometryInstance"
    | "PolygonGeometry"
    | "PolygonHierarchy"
    | "Color"
    | "Cartesian3"
    | "ClassificationType"
  >;

interface GroundCollection {
  add(p: Cesium.GroundPrimitive): unknown;
  remove(p: Cesium.GroundPrimitive): unknown;
  lowerToBottom(p: Cesium.GroundPrimitive): void;
}

export interface Ground {
  /** Recolour the base water (material uniforms). Only `final` calls recolour: the caller passes
   * the target palette once, at the fade's midpoint. */
  setPalette(p: Palette, final: boolean): void;
  /** Crossfade the decal imagery towards `to` (every fade frame, t in [0, 1]). */
  fade(to: Palette, t: number): void;
  /** Motion clock seconds: drives the base-water ripple (the only animated ground part). */
  setTime(t: number): void;
  /** The decal imagery layers (bottom to top). */
  layers(): Cesium.ImageryLayer[];
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

const flat = (ring: [number, number][]) => ring.flatMap((p) => [p[0], p[1]]);

/**
 * The stylised ground: the decals as globe imagery (`buildGroundLayers`, crossfaded per palette)
 * and base water as one GroundPrimitive with a ripple material (few lake polygons, cheap). Valid
 * only on the bare ellipsoid ground the stylised style guarantees. Decorative: never pickable; the
 * water is lowered to the bottom of `scene.groundPrimitives` so overlay lines draw on top, and
 * imagery always sits under every overlay.
 */
export function buildGround(
  C: GroundCesium,
  viewer: { scene: ImageryScene & { groundPrimitives: GroundCollection } },
  {
    roads,
    water,
    parks,
    palette,
  }: { roads: Road[]; water: WaterPolygon[]; parks: WaterPolygon[]; palette: Palette },
  makeCanvas?: MakeCanvas,
): Ground {
  const { scene } = viewer;
  const decals = buildGroundLayers(
    C,
    scene,
    indexDecals(groundDecals({ roads, water, parks })),
    palette,
    makeCanvas ? { makeCanvas } : {},
  );

  let waterMat: Cesium.Material | null = null;
  let waterPrim: Cesium.GroundPrimitive | null = null;
  let waterApplied = `${palette.water}|${palette.shore}`;
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
    const surface = (rings: WaterPolygon) =>
      new C.PolygonGeometry({
        polygonHierarchy: new C.PolygonHierarchy(
          C.Cartesian3.fromDegreesArray(flat(rings[0]!)),
          rings.slice(1).map((r) => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(flat(r)))),
        ),
        vertexFormat: C.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
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
    scene.groundPrimitives.add(waterPrim);
    scene.groundPrimitives.lowerToBottom(waterPrim);
  }

  return {
    setPalette(p, final) {
      if (!final || !waterMat || waterMat.isDestroyed()) return;
      const key = `${p.water}|${p.shore}`;
      if (key === waterApplied) return;
      waterMat.uniforms.color = C.Color.fromCssColorString(p.water);
      waterMat.uniforms.shoreColor = C.Color.fromCssColorString(p.shore);
      waterApplied = key;
    },
    fade(to, t) {
      decals.fade(to, t);
    },
    setTime(t) {
      if (waterMat && !waterMat.isDestroyed()) waterMat.uniforms.time = t;
    },
    layers: () => decals.layers(),
    destroy() {
      decals.destroy();
      if (waterPrim) {
        scene.groundPrimitives.remove(waterPrim); // a scene collection also destroys it
        if (!waterPrim.isDestroyed()) waterPrim.destroy();
        waterPrim = null;
      }
      if (waterMat && !waterMat.isDestroyed()) waterMat.destroy();
      waterMat = null;
    },
  };
}
