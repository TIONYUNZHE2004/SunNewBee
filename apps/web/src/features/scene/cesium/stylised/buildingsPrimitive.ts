import type * as Cesium from "cesium";
import { buildMesh, enuToEcef, TONE_STRIDE, type Triangulate } from "./buildingsMesh";
import type { Building } from "./model";
import { type Palette, paletteFor, type Theme } from "./palette";

/** The slice of the Cesium namespace the builder uses (a fake in unit tests). */
export type CesiumLike = Pick<
  typeof Cesium,
  | "Primitive"
  | "GeometryInstance"
  | "Geometry"
  | "GeometryAttribute"
  | "ComponentDatatype"
  | "PrimitiveType"
  | "BoundingSphere"
  | "MaterialAppearance"
  | "Material"
  | "Color"
  | "Cartesian2"
  | "Cartesian3"
  | "PolygonPipeline"
>;

export interface PrimitiveCollectionLike {
  add(p: Cesium.Primitive): unknown;
  remove(p: Cesium.Primitive): unknown;
}

export interface BuildingPrimitives {
  primitives: Cesium.Primitive[];
  /** Swap the look in place (material uniforms only, no geometry rebuild). */
  setTheme(theme: Theme): void;
  /** Remove and destroy every primitive and material. Idempotent. */
  destroy(): void;
}

/** Share of windows lit (seeded per cell in the shader). */

/**
 * Window material. st from buildingsMesh: s = window columns (+ per-building seed, + tone *
 * TONE_STRIDE), t = floors; t < 0 marks roofs. One window per cell (~52% x 50%); a hash of the
 * cell decides lit vs dark. Far away (cells under ~3 px) the pattern fades to its average colour,
 * so the city does not shimmer. Lit windows go to `emission` at night (glow = 1). Shading is our
 * own Lambert against a fixed sun, so the look does not depend on the clock.
 */
export const WINDOW_SHADER = /* glsl */ `
float tl_hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  vec2 st = materialInput.st;
  float tone = floor(st.s / ${TONE_STRIDE.toFixed(1)});
  vec3 l = normalize(czm_viewRotation * sunWC);
  float lambert = max(dot(normalize(materialInput.normalEC), l), 0.0);
  float shade = ambient + (1.0 - ambient) * lambert * sunIntensity;
  if (st.t < 0.0) {
    vec3 roof = tone < 0.5 ? roofWarm.rgb : (tone < 1.5 ? roofCool.rgb : roofRose.rgb);
    // Roofs are what the oblique home view mostly sees: keep them readable at night.
    m.diffuse = roof * mix(shade, 1.0, 0.5);
    return m;
  }
  vec3 wall = (tone < 0.5 ? wallWarm.rgb : (tone < 1.5 ? wallCool.rgb : wallRose.rgb)) * shade;
  vec2 g = vec2(st.s - tone * ${TONE_STRIDE.toFixed(1)}, st.t);
  vec2 cell = floor(g);
  vec2 f = fract(g);
  vec2 w = step(vec2(0.24, 0.26), f) * step(f, vec2(0.76, 0.76));
  float win = w.x * w.y;
  float isLit = step(tl_hash(cell), litFrac);
  vec3 litC = mix(litA.rgb, litB.rgb, step(0.62, tl_hash(cell + 17.0)));
  vec3 avgLit = mix(litA.rgb, litB.rgb, 0.38);
  vec3 darkC = darkWin.rgb * mix(shade, 1.0, glow);
#if (__VERSION__ == 300 || defined(GL_OES_standard_derivatives))
  vec2 dF = fwidth(g);
  float fade = clamp((max(dF.x, dF.y) - 0.2) / 0.3, 0.0, 1.0);
#else
  float fade = 0.0;
#endif
  float cover = 0.26;
  float litNear = win * isLit;
  float litFar = cover * litFrac;
  vec3 near = wall * (1.0 - win) + darkC * win * (1.0 - isLit) + litC * shade * (1.0 - glow) * litNear;
  vec3 far = wall * (1.0 - cover) + darkC * cover * (1.0 - litFrac) + avgLit * shade * (1.0 - glow) * litFar;
  m.diffuse = mix(near, far, fade);
  // Far away the lit cells are sub-pixel: boost their average so the city still glows at night
  // (x4: at the 6 km home view a building is a few pixels, so it must read as a warm point).
  m.emission = glow * mix(litC * litNear, avgLit * min(litFar * 4.0, 0.85), fade);
  return m;
}
`;

function uniformsFor(C: CesiumLike, palette: Palette, sunWC: Cesium.Cartesian3) {
  const col = (c: string) => C.Color.fromCssColorString(c);
  return {
    wallWarm: col(palette.wall.warm),
    wallCool: col(palette.wall.cool),
    wallRose: col(palette.wall.rose),
    roofWarm: col(palette.roof.warm),
    roofCool: col(palette.roof.cool),
    roofRose: col(palette.roof.rose),
    litA: col(palette.windowLit[0]),
    litB: col(palette.windowLit[1]),
    darkWin: col(palette.windowDark),
    litFrac: palette.litFrac,
    glow: palette.glow,
    ambient: palette.ambient,
    sunIntensity: Math.min(1, palette.sun.intensity),
    sunWC,
  };
}

/** Light vector (towards the sun) in ECEF at the city, from the palette's ENU light direction. */
function sunVector(C: CesiumLike, palette: Palette, at: [number, number]) {
  const [x, y, z] = enuToEcef(
    palette.sun.dir.map((d) => -d) as [number, number, number],
    at[0],
    at[1],
  );
  const n = Math.hypot(x, y, z) || 1;
  return new C.Cartesian3(x / n, y / n, z / n);
}

/**
 * One Primitive per non-empty building class, each with its own window Material sharing the
 * shader source (Cesium caches the program). Custom geometry cannot use Cesium's geometry
 * workers, so primitives are synchronous; vertex compression is off because st holds window
 * units (> 1) that the compressor would clamp.
 */
export function buildBuildingPrimitives(
  C: CesiumLike,
  classes: Map<string, Building[]>,
  palette: Palette,
  theme: Theme,
  collection?: PrimitiveCollectionLike,
): BuildingPrimitives {
  const triangulate: Triangulate = (xy) => {
    const pts: Cesium.Cartesian2[] = [];
    for (let i = 0; i + 1 < xy.length; i += 2) pts.push(new C.Cartesian2(xy[i], xy[i + 1]));
    return C.PolygonPipeline.triangulate(pts);
  };
  const first = [...classes.values()].find((g) => g.length > 0)?.[0]?.ring[0];
  const at: [number, number] = first ? [first[0], first[1]] : [0, 0];
  let primitives: Cesium.Primitive[] = [];
  let materials: Cesium.Material[] = [];

  for (const group of classes.values()) {
    if (group.length === 0) continue;
    const mesh = buildMesh(group, triangulate);
    if (mesh.indices.length === 0) continue;
    const geometry = new C.Geometry({
      attributes: {
        position: new C.GeometryAttribute({
          componentDatatype: C.ComponentDatatype.DOUBLE,
          componentsPerAttribute: 3,
          values: mesh.positions,
        }),
        normal: new C.GeometryAttribute({
          componentDatatype: C.ComponentDatatype.FLOAT,
          componentsPerAttribute: 3,
          values: mesh.normals,
        }),
        st: new C.GeometryAttribute({
          componentDatatype: C.ComponentDatatype.FLOAT,
          componentsPerAttribute: 2,
          values: mesh.st,
        }),
      } as unknown as Cesium.GeometryAttributes,
      indices: mesh.indices,
      primitiveType: C.PrimitiveType.TRIANGLES,
      boundingSphere: C.BoundingSphere.fromVertices(mesh.positions as unknown as number[]),
    });
    const material = new C.Material({
      fabric: {
        uniforms: uniformsFor(C, palette, sunVector(C, palette, at)),
        source: WINDOW_SHADER,
      },
      translucent: false,
    });
    const primitive = new C.Primitive({
      geometryInstances: new C.GeometryInstance({ geometry }),
      appearance: new C.MaterialAppearance({
        material,
        materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED,
        translucent: false,
        closed: true,
        flat: true,
      }),
      asynchronous: false,
      compressVertices: false,
      releaseGeometryInstances: true,
      allowPicking: false,
    });
    collection?.add(primitive);
    primitives.push(primitive);
    materials.push(material);
  }

  const out: BuildingPrimitives = {
    primitives,
    setTheme(t) {
      const p = paletteFor(t);
      const u = uniformsFor(C, p, sunVector(C, p, at));
      for (const m of materials) Object.assign(m.uniforms, u);
    },
    destroy() {
      for (const p of primitives) {
        collection?.remove(p); // a scene collection also destroys it
        if (!p.isDestroyed()) p.destroy();
      }
      for (const m of materials) if (!m.isDestroyed()) m.destroy();
      primitives = [];
      materials = [];
      out.primitives = primitives;
    },
  };
  return out;
}
