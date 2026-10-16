import type * as Cesium from "cesium";
import { buildMesh, TONE_STRIDE, type Triangulate } from "./buildingsMesh";
import { LIGHTING_GLSL, lightUniforms, POSITION_WC_GLSL } from "./lighting";
import { type Building, TONE_LIST } from "./model";
import type { Palette } from "./palette";

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
  | "ShadowMode"
>;

export interface PrimitiveCollectionLike {
  add(p: Cesium.Primitive): unknown;
  remove(p: Cesium.Primitive): unknown;
}

export interface BuildingPrimitives {
  primitives: Cesium.Primitive[];
  /** Swap the look in place (material uniforms only, no geometry rebuild). */
  setPalette(p: Palette, final: boolean): void;
  /** Motion clock seconds (drifts the cloud shadows). */
  setTime(t: number): void;
  /** Remove and destroy every primitive and material. Idempotent. */
  destroy(): void;
}

/**
 * Window material. st from buildingsMesh: s = window columns (+ per-building seed, + class *
 * TONE_STRIDE where class = tone * 3 + style), t = 0..1 across the ground floor then one unit per
 * floor; t = -1 marks roofs and ledges, t = -2 the parapet (a darker roof colour).
 *   Ground floor: homes (grid) get plain wall with the odd door; everything else gets shopfront
 *   glazing, lit at dusk and night. Upper floors: grid = punched windows, strip = horizontal
 *   bands, curtain = glass with thin mullions reflecting a sky gradient by day.
 * A hash of the cell decides lit vs dark. Far away (cells under ~3 px) each pattern fades to its
 * average colour, so the city does not shimmer. Lit windows go to `emission` at night (glow = 1).
 * Shading is `tl_light` (key + fill + bounce), `tl_cloud` (drifting cloud shadows, decorative) and
 * `tl_fog`, so the look does not depend on the clock.
 */
export const WINDOW_SHADER = /* glsl */ `
float tl_hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 pick6(float i, vec3 a, vec3 b, vec3 c, vec3 d, vec3 e, vec3 f) {
  if (i < 0.5) return a;
  if (i < 1.5) return b;
  if (i < 2.5) return c;
  if (i < 3.5) return d;
  if (i < 4.5) return e;
  return f;
}
${LIGHTING_GLSL}

czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  vec2 st = materialInput.st;
  // +0.5 guards the floor against division rounding at exact multiples.
  float cls = floor((st.s + 0.5) / ${TONE_STRIDE.toFixed(1)});
  float tone = floor((cls + 0.5) / 3.0);
  float style = cls - tone * 3.0;
  vec3 lit = tl_light(materialInput.normalEC);
  ${POSITION_WC_GLSL}
  float cloud = tl_cloud(positionWC);
  if (st.t < 0.0) {
    vec3 roof = pick6(tone, roof0.rgb, roof1.rgb, roof2.rgb, roof3.rgb, roof4.rgb, roof5.rgb);
    if (st.t < -1.5) roof *= 0.85; // parapet cap and inner face
    // Roofs are what the oblique home view mostly sees: keep them readable at night.
    m.diffuse = tl_fog(roof * mix(lit, vec3(1.0), 0.35) * cloud, materialInput.positionToEyeEC);
    return m;
  }
  vec3 wall = pick6(tone, wall0.rgb, wall1.rgb, wall2.rgb, wall3.rgb, wall4.rgb, wall5.rgb) * lit;
  vec2 g = vec2(st.s - cls * ${TONE_STRIDE.toFixed(1)}, st.t);
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float isLit = step(tl_hash(cell), litFrac);
  vec3 litC = mix(litA.rgb, litB.rgb, step(0.62, tl_hash(cell + 17.0)));
  vec3 avgLit = mix(litA.rgb, litB.rgb, 0.38);
  vec3 darkC = darkWin.rgb * mix(lit, vec3(1.0), glow);
#if (__VERSION__ == 300 || defined(GL_OES_standard_derivatives))
  vec2 dF = fwidth(g);
  float fade = clamp((max(dF.x, dF.y) - 0.2) / 0.3, 0.0, 1.0);
#else
  float fade = 0.0;
#endif
  vec3 near;
  vec3 far;
  vec3 glowNear;
  vec3 glowFar;
  if (st.t < 1.0) {
    vec3 shop = shopfront.rgb * lit;
    if (style < 0.5) {
      // Homes: plain wall, a door on about one column in four.
      float door = step(0.4, f.x) * step(f.x, 0.6) * step(g.y, 0.75)
        * step(tl_hash(vec2(cell.x, 0.0)), 0.25);
      near = mix(wall, shop, door);
      far = mix(wall, shop, 0.2 * 0.75 * 0.25);
      glowNear = vec3(0.0);
      glowFar = vec3(0.0);
    } else {
      // Shops: wide glazing, lit from inside at dusk and night.
      float glaze = step(0.05, f.x) * step(f.x, 0.95) * step(0.15, f.y) * step(f.y, 0.85);
      float glazeCover = 0.9 * 0.7;
      near = mix(wall, shop, glaze);
      far = mix(wall, shop, glazeCover);
      glowNear = litA.rgb * glow * 0.8 * glaze;
      glowFar = litA.rgb * glow * 0.8 * glazeCover;
    }
  } else {
    float win;
    float cover;
    vec3 glass = darkC;
    if (style < 0.5) {
      vec2 w = step(vec2(0.24, 0.26), f) * step(f, vec2(0.76, 0.76));
      win = w.x * w.y;
      cover = 0.26;
    } else if (style < 1.5) {
      win = step(0.3, f.y) * step(f.y, 0.75);
      cover = 0.45;
    } else {
      win = step(0.06, f.x) * step(f.y, 0.94);
      cover = 0.88;
      vec3 sky = mix(glassSky0.rgb, glassSky1.rgb, clamp(st.t / 20.0, 0.0, 1.0));
      glass = mix(sky * lit, darkC, glow);
    }
    float litNear = win * isLit;
    float litFar = cover * litFrac;
    near = wall * (1.0 - win) + glass * win * (1.0 - isLit) + litC * lit * (1.0 - glow) * litNear;
    far = wall * (1.0 - cover) + glass * cover * (1.0 - litFrac) + avgLit * lit * (1.0 - glow) * litFar;
    glowNear = glow * litC * litNear;
    // Far away the lit cells are sub-pixel: boost their average so the city still glows at night
    // (x4: at the 6 km home view a building is a few pixels, so it must read as a warm point).
    glowFar = glow * avgLit * min(litFar * 4.0, 0.85);
  }
  m.diffuse = tl_fog(mix(near, far, fade) * cloud, materialInput.positionToEyeEC);
  m.emission = mix(glowNear, glowFar, fade);
  return m;
}
`;

function uniformsFor(
  C: CesiumLike,
  palette: Palette,
  at: { lon: number; lat: number },
  time: number,
) {
  const col = (c: string) => C.Color.fromCssColorString(c);
  const tones: Record<string, Cesium.Color> = {};
  TONE_LIST.forEach((t, i) => {
    tones[`wall${i}`] = col(palette.wall[t]);
    tones[`roof${i}`] = col(palette.roof[t]);
  });
  return {
    ...tones,
    shopfront: col(palette.shopfront),
    glassSky0: col(palette.glassSky[0]),
    glassSky1: col(palette.glassSky[1]),
    litA: col(palette.windowLit[0]),
    litB: col(palette.windowLit[1]),
    darkWin: col(palette.windowDark),
    litFrac: palette.litFrac,
    glow: palette.glow,
    ...lightUniforms(C, palette, at, time),
  };
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
  collection?: PrimitiveCollectionLike,
): BuildingPrimitives {
  const triangulate: Triangulate = (xy) => {
    const pts: Cesium.Cartesian2[] = [];
    for (let i = 0; i + 1 < xy.length; i += 2) pts.push(new C.Cartesian2(xy[i], xy[i + 1]));
    return C.PolygonPipeline.triangulate(pts);
  };
  const first = [...classes.values()].find((g) => g.length > 0)?.[0]?.ring[0];
  const at = { lon: first ? first[0] : 0, lat: first ? first[1] : 0 };
  let primitives: Cesium.Primitive[] = [];
  let materials: Cesium.Material[] = [];
  let time = 0;

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
        uniforms: uniformsFor(C, palette, at, time),
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
      shadows: C.ShadowMode.CAST_ONLY,
    });
    collection?.add(primitive);
    primitives.push(primitive);
    materials.push(material);
  }

  const out: BuildingPrimitives = {
    primitives,
    setPalette(p) {
      const u = uniformsFor(C, p, at, time);
      for (const m of materials) Object.assign(m.uniforms, u);
    },
    setTime(t) {
      time = t;
      for (const m of materials) m.uniforms.time = t;
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
