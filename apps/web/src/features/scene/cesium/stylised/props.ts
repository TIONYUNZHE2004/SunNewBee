import type * as Cesium from "cesium";
import type { Road } from "./ground";
import { lightUniforms, litColorMaterial, setLightUniforms } from "./lighting";
import { hashUnit } from "./model";
import { type Palette, paletteFor, type Theme } from "./palette";

/**
 * Decorative props: trees and static parked cars. Illustrative only: never pickable, never
 * counted, never a fact. Placement is seeded (deterministic), never random per frame.
 */

export interface Tree {
  lon: number;
  lat: number;
  h: number;
}
export interface Car {
  lon: number;
  lat: number;
  /** Direction of the street, radians counter-clockwise from east (local ENU). */
  headingRad: number;
  tone: 0 | 1 | 2;
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
      const tone = Math.min(2, Math.floor(hashUnit(s.key, "tone") * 3)) as 0 | 1 | 2;
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
      out.push({ key: s.key, v: { ...p, h: 4 + hashUnit(s.key, "h") * 4 } });
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
  | "MaterialAppearance"
  | "Material"
  | "Color"
  | "Cartesian3"
  | "Matrix3"
  | "Matrix4"
  | "Transforms"
>;

interface PrimitiveCollectionLike {
  add(p: Cesium.Primitive): unknown;
  remove(p: Cesium.Primitive): unknown;
}

export interface Props {
  setTheme(t: Theme): void;
  destroy(): void;
}

type ColourOf = (p: Palette) => string;

/**
 * Trees (low-poly canopy + trunk) and parked cars (body + cabin) as a few instanced Primitives,
 * one per colour, so the Day/Night swap is a material uniform write. Unit geometries are shared and
 * sized by each instance's model matrix. Lit by the shared stylised lighting model (`lighting.ts`).
 */
export function buildProps(
  C: PropsCesium,
  {
    trees,
    cars,
    palette,
    at,
  }: { trees: Tree[]; cars: Car[]; palette: Palette; at: { lon: number; lat: number } },
  collection?: PrimitiveCollectionLike,
): Props {
  const vertexFormat = C.MaterialAppearance.MaterialSupport.BASIC.vertexFormat;
  const unit = new C.Cartesian3(1, 1, 1);
  const canopy = new C.EllipsoidGeometry({
    radii: unit,
    stackPartitions: 5,
    slicePartitions: 7,
    vertexFormat,
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
  const inst = (geometry: Cesium.Geometry | Cesium.GeometryFactory, modelMatrix: Cesium.Matrix4) =>
    new C.GeometryInstance({ geometry: geometry as Cesium.Geometry, modelMatrix });

  const groups: { colour: ColourOf; instances: Cesium.GeometryInstance[] }[] = [
    { colour: (p) => p.tree[0], instances: [] },
    { colour: (p) => p.tree[1], instances: [] },
    { colour: (p) => p.trunk, instances: [] },
    { colour: (p) => p.car[0], instances: [] },
    { colour: (p) => p.car[1], instances: [] },
    { colour: (p) => p.car[2], instances: [] },
  ];
  for (const t of trees) {
    const tone = hashUnit(`${t.lon.toFixed(6)},${t.lat.toFixed(6)}`, "tree") < 0.55 ? 0 : 1;
    const r = t.h * 0.32;
    groups[tone]!.instances.push(inst(canopy, frame(t.lon, t.lat, t.h * 0.6, r, r, t.h * 0.38)));
    groups[2]!.instances.push(inst(trunk, frame(t.lon, t.lat, t.h * 0.18, 0.22, 0.22, t.h * 0.36)));
  }
  for (const c of cars) {
    const g = groups[3 + c.tone]!.instances;
    g.push(inst(box, frame(c.lon, c.lat, 0.6, 4.2, 1.8, 0.9, c.headingRad)));
    g.push(inst(box, frame(c.lon, c.lat, 1.35, 2.3, 1.6, 0.6, c.headingRad)));
  }

  let parts: { prim: Cesium.Primitive; mat: Cesium.Material; colour: ColourOf }[] = [];
  for (const { colour, instances } of groups) {
    if (instances.length === 0) continue;
    const mat = litColorMaterial(C, colour(palette), palette, at);
    const prim = new C.Primitive({
      geometryInstances: instances,
      appearance: new C.MaterialAppearance({
        material: mat,
        materialSupport: C.MaterialAppearance.MaterialSupport.BASIC,
        flat: true,
        translucent: false,
        closed: true,
      }),
      allowPicking: false,
      asynchronous: true,
      releaseGeometryInstances: true,
    });
    collection?.add(prim);
    parts.push({ prim, mat, colour });
  }

  return {
    setTheme(t) {
      const p = paletteFor(t);
      const light = lightUniforms(C, p, at);
      for (const { mat, colour } of parts) {
        mat.uniforms.color = C.Color.fromCssColorString(colour(p));
        setLightUniforms(mat, light);
      }
    },
    destroy() {
      for (const { prim, mat } of parts) {
        collection?.remove(prim); // a scene collection also destroys it
        if (!prim.isDestroyed()) prim.destroy();
        if (!mat.isDestroyed()) mat.destroy();
      }
      parts = [];
    },
  };
}
