import type * as Cesium from "cesium";
import { type Road, VOLUME_HALF_M } from "./ground";
import { LIT_COLOR_SOURCE, lightUniforms, litColorMaterial, setLightUniforms } from "./lighting";
import { hashUnit } from "./model";
import { ANIMATED_VS } from "./motion/sky";
import type { Palette } from "./palette";
import type { RoofItem } from "./roofs";

/**
 * Decorative props: trees and static parked cars. Illustrative only: never pickable, never
 * counted, never a fact. Placement is seeded (deterministic), never random per frame.
 */

export interface Tree {
  lon: number;
  lat: number;
  h: number;
  /** A second, smaller canopy above the first. */
  tier2: boolean;
}
export interface Lamp {
  lon: number;
  lat: number;
}
export interface Car {
  lon: number;
  lat: number;
  /** Direction of the street, radians counter-clockwise from east (local ENU). */
  headingRad: number;
  tone: 0 | 1 | 2 | 3 | 4;
}

const M_PER_DEG = 111_320;
/** Streets that get kerbside cars and street trees (residential / service width). */
const isResidential = (r: Road) => r.kind === "residential";

interface Slot {
  key: string;
  lon: number;
  lat: number;
  /** Street direction in local metres (unit vector, east/north). */
  ux: number;
  uy: number;
}

/** Points every `spacingM` along each road (offset half a spacing from the start). */
function slotsAlong(r: Road, seed: string, spacingM: number): Slot[] {
  const out: Slot[] = [];
  let carried = spacingM / 2;
  let n = 0;
  for (let i = 0; i + 1 < r.coords.length; i++) {
    const [x1, y1] = r.coords[i]!;
    const [x2, y2] = r.coords[i + 1]!;
    const k = Math.cos((((y1 + y2) / 2) * Math.PI) / 180) * M_PER_DEG;
    const dx = (x2 - x1) * k;
    const dy = (y2 - y1) * M_PER_DEG;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    let d = carried;
    for (; d < len; d += spacingM) {
      const f = d / len;
      out.push({
        key: `${seed}:${r.id}:${n++}`,
        lon: x1 + (x2 - x1) * f,
        lat: y1 + (y2 - y1) * f,
        ux: dx / len,
        uy: dy / len,
      });
    }
    carried = d - len;
  }
  return out;
}

/** Move a slot sideways (positive = left of the street direction) by `m` metres. */
function offset(s: Slot, m: number): { lon: number; lat: number } {
  const k = Math.cos((s.lat * Math.PI) / 180) * M_PER_DEG;
  return { lon: s.lon + (-s.uy * m) / k, lat: s.lat + (s.ux * m) / M_PER_DEG };
}

/** Deterministic uniform subsample when over the cap (no bias towards the first roads). */
function cap<T>(items: { v: T; key: string }[], max: number): T[] {
  if (items.length <= max) return items.map((i) => i.v);
  return items
    .map((i) => ({ ...i, r: hashUnit(i.key, "cap") }))
    .sort((a, b) => a.r - b.r)
    .slice(0, max)
    .map((i) => i.v);
}

/** Static cars parked at the kerb of residential streets, at seeded slots. */
export function kerbCars(
  roads: Road[],
  seed: string,
  { spacingM = 14, density = 0.22, max = 1500 } = {},
): Car[] {
  const out: { v: Car; key: string }[] = [];
  for (const r of roads) {
    if (!isResidential(r)) continue;
    for (const s of slotsAlong(r, seed, spacingM)) {
      if (hashUnit(s.key, "car") >= density) continue;
      const side = hashUnit(s.key, "side") < 0.5 ? 1 : -1;
      const p = offset(s, side * (r.widthM / 2 - 1));
      const tone = Math.min(4, Math.floor(hashUnit(s.key, "tone") * 5)) as Car["tone"];
      out.push({ key: s.key, v: { ...p, headingRad: Math.atan2(s.uy, s.ux), tone } });
    }
  }
  return cap(out, max);
}

/** Trees along residential streets, just outside the carriageway, alternating sides. */
export function streetTrees(
  roads: Road[],
  seed: string,
  { spacingM = 34, keep = 0.7, max = 6000 } = {},
): Tree[] {
  const out: { v: Tree; key: string }[] = [];
  for (const r of roads) {
    if (!isResidential(r)) continue;
    slotsAlong(r, `${seed}:tree`, spacingM).forEach((s, n) => {
      if (hashUnit(s.key, "keep") >= keep) return;
      const p = offset(s, (n % 2 === 0 ? 1 : -1) * (r.widthM / 2 + 2.5));
      out.push({
        key: s.key,
        v: { ...p, h: 4 + hashUnit(s.key, "h") * 4, tier2: hashUnit(s.key, "t2") < 0.5 },
      });
    });
  }
  return cap(out, max);
}

/** Street lamps along residential and major roads, alternating sides (display only). */
export function streetLamps(
  roads: Road[],
  seed: string,
  { spacingM = 30, max = 3000 } = {},
): Lamp[] {
  const out: { v: Lamp; key: string }[] = [];
  for (const r of roads) {
    if (r.kind !== "residential" && r.kind !== "major") continue;
    slotsAlong(r, `${seed}:lamp`, spacingM).forEach((s, n) => {
      out.push({ key: s.key, v: offset(s, (n % 2 ? 1 : -1) * (r.widthM / 2 + 1.5)) });
    });
  }
  return cap(out, max);
}

/** The slice of Cesium the props builder uses (a fake in unit tests). */
export type PropsCesium = Pick<
  typeof Cesium,
  | "Primitive"
  | "GeometryInstance"
  | "EllipsoidGeometry"
  | "CylinderGeometry"
  | "BoxGeometry"
  | "EllipseGeometry"
  | "DistanceDisplayCondition"
  | "DistanceDisplayConditionGeometryInstanceAttribute"
  | "MaterialAppearance"
  | "Material"
  | "Color"
  | "Cartesian3"
  | "Matrix3"
  | "Matrix4"
  | "Transforms"
  | "ShadowMode"
  | "ClassificationPrimitive"
  | "PerInstanceColorAppearance"
  | "ColorGeometryInstanceAttribute"
  | "VertexFormat"
  | "ClassificationType"
>;

interface PrimitiveCollectionLike {
  add(p: Cesium.Primitive): unknown;
  remove(p: Cesium.Primitive): unknown;
}

/** Where the light pools go: `scene.groundPrimitives` (flat decals under the overlay lines). */
export interface PropsGroundScene {
  groundPrimitives: {
    add(p: Cesium.ClassificationPrimitive): unknown;
    remove(p: Cesium.ClassificationPrimitive): unknown;
    lowerToBottom(p: Cesium.ClassificationPrimitive): void;
  };
  postRender: { addEventListener(cb: () => void): () => void };
  requestRender(): void;
}

/** Light pool colour alpha at full glow (Night). */
export const POOL_ALPHA = 0.35;

export interface Props {
  setPalette(p: Palette, final: boolean): void;
  /** Motion clock seconds (drifts the cloud shadows on lit props). */
  setTime(t: number): void;
  destroy(): void;
}

type ColourOf = (p: Palette) => string;

/** Lit like every prop, plus a warm emission scaled by the `glow` uniform (lamp heads). */
const LAMP_HEAD_SOURCE = LIT_COLOR_SOURCE.replace(
  "return m;",
  "m.emission = color.rgb * glow;\n  return m;",
);

/** Canopy vertex shader: the shared animated shader with the sway variant (Motion on only). */
const SWAY_VS = `#define TL_SWAY
${ANIMATED_VS}`;

/**
 * Trees (two-tier low-poly canopy + trunk), parked cars, street lamps and rooftop clutter as a few
 * instanced Primitives, one per colour, so the Day/Night swap is a material uniform write. Unit
 * geometries are shared and sized by each instance's model matrix. Lit by the shared stylised
 * lighting model (`lighting.ts`). Canopies sway only when `sway` is true (Motion on, no reduced
 * motion); otherwise they get the plain appearance and the scene is a still frame.
 *
 * Light pools are a flat ClassificationPrimitive band in `ground.groundPrimitives` (like the
 * pavements), lowered to the bottom so overlay lines draw on top and are never tinted; the caller
 * then restacks the ground parts under them (`Ground.restack`). One colour for every pool, alpha
 * POOL_ALPHA x glow, hidden when glow is 0. Lamps, pools and roof items are fine detail: they carry
 * a distance-display condition (`detailRangeM`) and are not built at all when it is 0.
 */
export function buildProps(
  C: PropsCesium,
  {
    trees,
    cars,
    lamps,
    roofItems,
    palette,
    at,
    detailRangeM,
    sway = false,
  }: {
    trees: Tree[];
    cars: Car[];
    lamps: Lamp[];
    roofItems: RoofItem[];
    palette: Palette;
    at: { lon: number; lat: number };
    detailRangeM: number;
    /** Canopy sway in the vertex shader (Motion on and no reduced-motion preference). */
    sway?: boolean;
  },
  collection?: PrimitiveCollectionLike,
  ground?: PropsGroundScene,
): Props {
  const vertexFormat = C.MaterialAppearance.MaterialSupport.BASIC.vertexFormat;
  const unit = new C.Cartesian3(1, 1, 1);
  // Canopies sway in the vertex shader, which needs `st` (t runs bottom to top): TEXTURED format.
  const canopy = new C.EllipsoidGeometry({
    radii: unit,
    stackPartitions: 5,
    slicePartitions: 7,
    vertexFormat: sway ? C.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat : vertexFormat,
  });
  const trunk = new C.CylinderGeometry({
    length: 1,
    topRadius: 1,
    bottomRadius: 1,
    slices: 6,
    vertexFormat,
  });
  const box = C.BoxGeometry.fromDimensions({ dimensions: unit, vertexFormat });

  /** ENU frame at (lon, lat, z), rotated about up by `heading`, scaled by (sx, sy, sz). */
  const frame = (
    lon: number,
    lat: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    heading = 0,
  ) => {
    const m = C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(lon, lat, z));
    if (heading !== 0) C.Matrix4.multiplyByMatrix3(m, C.Matrix3.fromRotationZ(heading), m);
    return C.Matrix4.multiplyByScale(m, new C.Cartesian3(sx, sy, sz), m);
  };
  const poolColour = (p: Palette) =>
    C.Color.fromCssColorString(p.lightPool).withAlpha(POOL_ALPHA * p.glow);
  const poolKey = (p: Palette) => `${p.lightPool}|${p.glow}`;
  const poolValue = (p: Palette) => C.ColorGeometryInstanceAttribute.fromColor(poolColour(p));
  const nearOnly = () => ({
    distanceDisplayCondition:
      C.DistanceDisplayConditionGeometryInstanceAttribute.fromDistanceDisplayCondition(
        new C.DistanceDisplayCondition(0, detailRangeM),
      ),
  });
  const inst = (
    geometry: Cesium.Geometry | Cesium.GeometryFactory,
    modelMatrix: Cesium.Matrix4,
    near = false,
  ) =>
    new C.GeometryInstance({
      geometry: geometry as Cesium.Geometry,
      modelMatrix,
      ...(near ? { attributes: nearOnly() } : {}),
    });

  const groups: {
    colour: ColourOf;
    instances: Cesium.GeometryInstance[];
    /** Emissive lamp heads (carry a `glow` uniform). */
    emissive?: boolean;
    /** Canopies: textured vertex format and the swaying vertex shader. */
    sway?: boolean;
  }[] = [
    { colour: (p) => p.tree[0], instances: [], sway },
    { colour: (p) => p.tree[1], instances: [], sway },
    { colour: (p) => p.tree[2], instances: [], sway },
    { colour: (p) => p.trunk, instances: [] },
    { colour: (p) => p.car[0], instances: [] },
    { colour: (p) => p.car[1], instances: [] },
    { colour: (p) => p.car[2], instances: [] },
    { colour: (p) => p.car[3], instances: [] },
    { colour: (p) => p.car[4], instances: [] },
    { colour: (p) => p.lampPost, instances: [] },
    { colour: (p) => p.lampHead, instances: [], emissive: true },
    { colour: (p) => p.roofItem, instances: [] },
  ];
  const [TREE, TRUNK, CAR, POST, HEAD, ROOF] = [0, 3, 4, 9, 10, 11] as const;
  for (const t of trees) {
    const key = `${t.lon.toFixed(6)},${t.lat.toFixed(6)}`;
    const tone = Math.min(2, Math.floor(hashUnit(key, "tree") * 3));
    const r = t.h * 0.32;
    const g = groups[TREE + tone]!.instances;
    g.push(inst(canopy, frame(t.lon, t.lat, t.h * 0.6, r, r, t.h * 0.38)));
    if (t.tier2)
      g.push(inst(canopy, frame(t.lon, t.lat, t.h * 0.85, r * 0.7, r * 0.7, t.h * 0.26)));
    groups[TRUNK]!.instances.push(
      inst(trunk, frame(t.lon, t.lat, t.h * 0.18, 0.22, 0.22, t.h * 0.36)),
    );
  }
  for (const c of cars) {
    const g = groups[CAR + c.tone]!.instances;
    g.push(inst(box, frame(c.lon, c.lat, 0.6, 4.2, 1.8, 0.9, c.headingRad)));
    g.push(inst(box, frame(c.lon, c.lat, 1.35, 2.3, 1.6, 0.6, c.headingRad)));
  }
  // Fine detail: only near the camera, and not built at all on the Low tier.
  const poolInstances: Cesium.GeometryInstance[] = [];
  if (detailRangeM > 0) {
    for (const l of lamps) {
      groups[POST]!.instances.push(inst(trunk, frame(l.lon, l.lat, 2.25, 0.08, 0.08, 4.5), true));
      groups[HEAD]!.instances.push(inst(box, frame(l.lon, l.lat, 4.5, 0.5, 0.25, 0.15), true));
      poolInstances.push(
        new C.GeometryInstance({
          // A thin classification volume around the flat ellipsoid ground, like the pavements.
          geometry: new C.EllipseGeometry({
            center: C.Cartesian3.fromDegrees(l.lon, l.lat),
            semiMajorAxis: 5,
            semiMinorAxis: 5,
            height: -VOLUME_HALF_M,
            extrudedHeight: VOLUME_HALF_M,
            vertexFormat: C.VertexFormat.POSITION_ONLY,
          }),
          id: `pool:${poolInstances.length}`,
          attributes: { ...nearOnly(), color: poolValue(palette) },
        }),
      );
    }
    for (const it of roofItems) {
      const z = it.z + it.sizeM / 2;
      groups[ROOF]!.instances.push(
        it.kind === "tank"
          ? inst(trunk, frame(it.lon, it.lat, z, it.sizeM / 2, it.sizeM / 2, it.sizeM), true)
          : inst(box, frame(it.lon, it.lat, z, it.sizeM, it.sizeM, it.sizeM), true),
      );
    }
  }

  interface Part {
    prim: Cesium.Primitive;
    mat: Cesium.Material;
    /** Lit materials also take the shared light uniforms. */
    lit: boolean;
    update(p: Palette): void;
  }
  let parts: Part[] = [];
  let time = 0;
  for (const { colour, instances, emissive, sway } of groups) {
    if (instances.length === 0) continue;
    const mat = emissive
      ? new C.Material({
          fabric: {
            uniforms: {
              color: C.Color.fromCssColorString(colour(palette)),
              glow: palette.glow,
              ...lightUniforms(C, palette, at),
            },
            source: LAMP_HEAD_SOURCE,
          },
          translucent: false,
        })
      : litColorMaterial(C, colour(palette), palette, at);
    const prim = new C.Primitive({
      geometryInstances: instances,
      appearance: new C.MaterialAppearance({
        material: mat,
        materialSupport: sway
          ? C.MaterialAppearance.MaterialSupport.TEXTURED
          : C.MaterialAppearance.MaterialSupport.BASIC,
        ...(sway ? { vertexShaderSource: SWAY_VS } : {}),
        flat: true,
        translucent: false,
        closed: true,
      }),
      allowPicking: false,
      shadows: C.ShadowMode.CAST_ONLY,
      asynchronous: true,
      releaseGeometryInstances: true,
    });
    collection?.add(prim);
    parts.push({
      prim,
      mat,
      lit: true,
      update(p) {
        mat.uniforms.color = C.Color.fromCssColorString(colour(p));
        if (emissive) mat.uniforms.glow = p.glow;
      },
    });
  }
  /** The light pools: one ClassificationPrimitive in the ground collection (or none). */
  let pools: {
    prim: Cesium.ClassificationPrimitive;
    ids: string[];
    applied: string;
    want: Palette;
    stopWatching: (() => void) | null;
  } | null = null;
  if (poolInstances.length > 0 && ground) {
    const prim = new C.ClassificationPrimitive({
      geometryInstances: poolInstances,
      appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true }),
      classificationType: C.ClassificationType.TERRAIN,
      allowPicking: false,
      asynchronous: true,
      releaseGeometryInstances: true,
    });
    prim.show = palette.glow > 0;
    ground.groundPrimitives.add(prim);
    ground.groundPrimitives.lowerToBottom(prim);
    pools = {
      prim,
      ids: poolInstances.map((_, i) => `pool:${i}`),
      applied: poolKey(palette),
      want: palette,
      stopWatching: null,
    };
  }
  /** Write the wanted pool colour into the ready primitive; true when nothing is left to do. */
  const syncPools = () => {
    if (!pools) return true;
    const key = poolKey(pools.want);
    if (key === pools.applied) return true;
    if (!pools.prim.ready) return false;
    const value = C.ColorGeometryInstanceAttribute.toValue(poolColour(pools.want));
    for (const id of pools.ids) {
      const a = pools.prim.getGeometryInstanceAttributes(id) as { color?: Uint8Array } | undefined;
      if (a) a.color = value;
    }
    pools.applied = key;
    return true;
  };

  return {
    setPalette(p) {
      const light = lightUniforms(C, p, at, time);
      for (const { mat, lit, update } of parts) {
        update(p);
        if (lit) setLightUniforms(mat, light);
      }
      if (!pools || !ground) return;
      pools.want = p;
      pools.prim.show = p.glow > 0;
      if (syncPools() || pools.stopWatching) return;
      // Not ready yet: re-check after each frame until the latest colour is in.
      const pl = pools;
      const g = ground;
      pl.stopWatching = g.postRender.addEventListener(() => {
        if (!syncPools()) return;
        pl.stopWatching?.();
        pl.stopWatching = null;
        g.requestRender();
      });
    },
    setTime(t) {
      time = t;
      for (const { mat, lit } of parts) if (lit) mat.uniforms.time = t;
    },
    destroy() {
      for (const { prim, mat } of parts) {
        collection?.remove(prim); // a scene collection also destroys it
        if (!prim.isDestroyed()) prim.destroy();
        if (!mat.isDestroyed()) mat.destroy();
      }
      parts = [];
      if (pools) {
        pools.stopWatching?.();
        ground?.groundPrimitives.remove(pools.prim); // a scene collection also destroys it
        if (!pools.prim.isDestroyed()) pools.prim.destroy();
        pools = null;
      }
    },
  };
}
