import type * as Cesium from "cesium";
import { mixHex } from "../colour";
import { lightUniforms, litColorMaterial, setLightUniforms } from "../lighting";
import { hashUnit } from "../model";
import type { Palette } from "../palette";
import { cloudOffset, type Loop, loopPoint, wrapCentred } from "./flocks";

/**
 * Decorative birds and drifting clouds. Illustrative only: never pickable, cast no shadows, never a
 * fact (clouds are not weather, birds are not wildlife data). Hidden at Night.
 */

/**
 * Cesium 1.146's TexturedMaterialAppearanceVS (same attribute and varying names, so Primitive's
 * shader rewrites still match) plus one displacement per variant. The clock is the built-in
 * czm_frameNumber: frames only advance while rendering, so motion freezes when the loop pauses.
 * Known limitation: a material uniform is not visible to a custom appearance vertex shader in
 * Cesium 1.146 (material uniforms are renamed and only bound in the fragment stage), so the phase
 * follows the render rate, not wall time. The motion clock renders at 30 fps, so flap and sway run
 * at their designed speed while idle and faster while the camera moves (frames up to 60 fps).
 * With Motion off or reduced motion, canopies use the plain appearance and birds are hidden.
 * Prefix "#define TL_BIRD\n" (flapping wings) or "#define TL_SWAY\n" (swaying canopies).
 */
export const ANIMATED_VS = /* glsl */ `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec2 st;
in float batchId;
out vec3 v_positionEC;
out vec3 v_normalEC;
out vec2 v_st;
void main() {
  vec4 p = czm_computePosition();
  float t = czm_frameNumber / 30.0;
#ifdef TL_BIRD
  // st.s: -1 left wing tip, 0 body, +1 right wing tip; st.t: bird index. Local frame: z is up.
  p.z += abs(st.s) * sin(t * 12.0 + st.t * 1.7) * 0.6;
#endif
#ifdef TL_SWAY
  // st.t runs 0 (bottom) to 1 (top) on the canopy ellipsoid: sway grows towards the top.
  vec3 up = normalize(position3DHigh + position3DLow);
  vec3 side = normalize(cross(up, vec3(0.0, 0.0, 1.0)));
  float phase = fract(position3DHigh.x * 0.013) * 6.2831;
  p.xyz += side * sin(t * 1.3 + phase) * 0.25 * st.t * st.t;
#endif
  v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
  v_normalEC = czm_normal * normal;
  v_st = st;
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`;

const BIRD_VS = `#define TL_BIRD\n${ANIMATED_VS}`;

export type SkyCesium = Pick<
  typeof Cesium,
  | "Primitive"
  | "GeometryInstance"
  | "Geometry"
  | "GeometryAttribute"
  | "ComponentDatatype"
  | "PrimitiveType"
  | "BoundingSphere"
  | "EllipsoidGeometry"
  | "MaterialAppearance"
  | "Material"
  | "Color"
  | "Cartesian3"
  | "Matrix3"
  | "Matrix4"
  | "Transforms"
  | "ShadowMode"
>;

export interface SkyViewer {
  scene: {
    primitives: { add(p: Cesium.Primitive): unknown; remove(p: Cesium.Primitive): unknown };
    requestRender(): void;
  };
}

export interface CloudSpot {
  x: number;
  y: number;
  z: number;
  scale: number;
}

export interface Sky {
  setPalette(p: Palette): void;
  /** Move flocks and clouds to clock time `t` (seconds). The caller requests the render. */
  tick(t: number): void;
  /** Birds follow the Motion setting; clouds the tier and the overlays (hidden while a route or a
   * flood scenario is shown). Night hides both regardless. */
  setVisible(birds: boolean, clouds: boolean): void;
  destroy(): void;
}

const birdColour = (p: Palette) => mixHex(p.light.fill, "#2a2148", 0.5);
/** White with a touch of the key light: warm at Dusk, near white by Day. */
const cloudColour = (p: Palette) => mixHex("#ffffff", p.light.key, 0.35);
/** See-through enough that a cloud never hides a route, path or flood line below it. Clouds are
 * also hidden while a route is highlighted or a flood scenario is active (StylisedCity). */
export const CLOUD_ALPHA = 0.5;
const isNight = (p: Palette) => p.glow >= 1;

/**
 * `n` birds as one custom Geometry in the flock's local ENU frame (x forward, z up), at seeded
 * offsets within +-6 m. Each bird is 5 vertices and 4 triangles: two wings that meet along a
 * slightly raised body ridge (nose, back, tail), 0.9 m wingspan. st.s = -1 / 0 / +1 at the left
 * tip / body / right tip, st.t = bird index (read by the TL_BIRD vertex shader).
 */
function birdGeometry(C: SkyCesium, n: number, key: string): Cesium.Geometry {
  const shape: [number, number, number, number][] = [
    // x, y, z, st.s
    [0.3, 0, 0, 0], // nose
    [-0.02, 0, 0.06, 0], // back (ridge)
    [-0.3, 0, 0, 0], // tail
    [-0.08, 0.45, 0, -1], // left tip (+y is left of +x)
    [-0.08, -0.45, 0, 1], // right tip
  ];
  const positions = new Float64Array(n * 15);
  const normals = new Float32Array(n * 15);
  const st = new Float32Array(n * 10);
  const indices = new Uint16Array(n * 12);
  for (let b = 0; b < n; b++) {
    const k = `${key}:${b}`;
    const ox = (hashUnit(k, "x") - 0.5) * 12;
    const oy = (hashUnit(k, "y") - 0.5) * 12;
    // +0.1 keeps every vertex off the exact local origin (Cesium cannot project it to 2D).
    const oz = (hashUnit(k, "z") - 0.5) * 3 + 0.1;
    shape.forEach(([x, y, z, s], v) => {
      const i = b * 5 + v;
      positions.set([ox + x, oy + y, oz + z], i * 3);
      normals.set([0, 0, 1], i * 3);
      st.set([s, b], i * 2);
    });
    const [N, H, T, L, R] = [0, 1, 2, 3, 4].map((v) => b * 5 + v) as [
      number,
      number,
      number,
      number,
      number,
    ];
    indices.set([N, L, H, H, L, T, N, H, R, H, T, R], b * 12);
  }
  const sphere = C.BoundingSphere.fromVertices(positions as unknown as number[]);
  sphere.radius += 1; // room for the flapping wing tips
  return new C.Geometry({
    attributes: {
      position: new C.GeometryAttribute({
        componentDatatype: C.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: positions,
      }),
      normal: new C.GeometryAttribute({
        componentDatatype: C.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: normals,
      }),
      st: new C.GeometryAttribute({
        componentDatatype: C.ComponentDatatype.FLOAT,
        componentsPerAttribute: 2,
        values: st,
      }),
    } as unknown as Cesium.GeometryAttributes,
    indices,
    primitiveType: C.PrimitiveType.TRIANGLES,
    boundingSphere: sphere,
  });
}

/**
 * One Primitive per flock (birds flap in the vertex shader; the flock moves along its loop by
 * modelMatrix) and one per cloud (3-5 flattened ellipsoid puffs, translucent, drifting with
 * wrap-around inside `extentM`). Positions are metres east / north / up of `at`.
 */
export function buildSky(
  C: SkyCesium,
  viewer: SkyViewer,
  {
    at,
    loops,
    clouds,
    palette,
    birdsPerFlock,
    extentM = 5000,
  }: {
    at: { lon: number; lat: number };
    loops: Loop[];
    clouds: CloudSpot[];
    palette: Palette;
    birdsPerFlock: number;
    extentM?: number;
  },
): Sky {
  const collection = viewer.scene.primitives;
  const base = C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(at.lon, at.lat, 0));
  /** base x translate(e, n, u) x rotateZ(heading), written into `into` when given. */
  const place = (e: number, n: number, u: number, into?: Cesium.Matrix4, heading?: number) => {
    const m = C.Matrix4.multiplyByTranslation(
      base,
      new C.Cartesian3(e, n, u),
      into ?? new C.Matrix4(),
    );
    if (heading !== undefined) C.Matrix4.multiplyByMatrix3(m, C.Matrix3.fromRotationZ(heading), m);
    return m;
  };

  const birdMat =
    loops.length > 0
      ? C.Material.fromType("Color", { color: C.Color.fromCssColorString(birdColour(palette)) })
      : null;
  const flocks = loops.map((loop, i) => ({
    loop,
    prim: new C.Primitive({
      geometryInstances: new C.GeometryInstance({
        geometry: birdGeometry(C, birdsPerFlock, `bird:${i}`),
      }),
      appearance: new C.MaterialAppearance({
        material: birdMat!,
        materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED,
        vertexShaderSource: BIRD_VS,
        flat: true,
        translucent: false,
      }),
      // Custom geometry is synchronous-only; st holds -1..1 and bird indices (no compression).
      asynchronous: false,
      compressVertices: false,
      allowPicking: false,
      shadows: C.ShadowMode.DISABLED,
    }),
  }));

  let cloudMat: Cesium.Material | null = null;
  const cloudUniforms = (p: Palette) => ({ ...lightUniforms(C, p, at), cloudShadow: 0 });
  if (clouds.length > 0) {
    cloudMat = litColorMaterial(C, cloudColour(palette), palette, at, CLOUD_ALPHA);
    setLightUniforms(cloudMat, cloudUniforms(palette)); // a cloud never shades itself
  }
  const puff = new C.EllipsoidGeometry({
    radii: new C.Cartesian3(1, 1, 1),
    stackPartitions: 6,
    slicePartitions: 8,
    vertexFormat: C.MaterialAppearance.MaterialSupport.BASIC.vertexFormat,
  });
  const cloudPrims = clouds.map((c, i) => {
    const key = `cloud:${i}`;
    const n = 3 + Math.min(2, Math.floor(hashUnit(key, "n") * 3));
    const instances = Array.from({ length: n }, (_, j) => {
      const k = `${key}:${j}`;
      const rx = (35 + hashUnit(k, "r") * 25) * c.scale;
      const offset = C.Matrix4.fromTranslation(
        new C.Cartesian3(
          (hashUnit(k, "x") - 0.5) * 70 * c.scale,
          (hashUnit(k, "y") - 0.5) * 40 * c.scale,
          (hashUnit(k, "z") - 0.5) * 10 * c.scale,
        ),
        new C.Matrix4(),
      );
      return new C.GeometryInstance({
        geometry: puff as unknown as Cesium.Geometry,
        modelMatrix: C.Matrix4.multiplyByScale(
          offset,
          new C.Cartesian3(rx, rx * (0.6 + hashUnit(k, "w") * 0.3), rx * 0.35),
          new C.Matrix4(),
        ),
      });
    });
    return {
      spot: c,
      prim: new C.Primitive({
        geometryInstances: instances,
        appearance: new C.MaterialAppearance({
          material: cloudMat!,
          materialSupport: C.MaterialAppearance.MaterialSupport.BASIC,
          flat: true,
          translucent: true,
          closed: true,
        }),
        asynchronous: true,
        releaseGeometryInstances: true,
        allowPicking: false,
        shadows: C.ShadowMode.DISABLED,
      }),
    };
  });
  for (const { prim } of [...flocks, ...cloudPrims]) collection.add(prim);

  let night = isNight(palette);
  let birdsOn = true;
  let cloudsOn = true;
  const apply = () => {
    for (const { prim } of flocks) prim.show = birdsOn && !night;
    for (const { prim } of cloudPrims) prim.show = cloudsOn && !night;
    viewer.scene.requestRender();
  };

  const tick = (t: number) => {
    for (const { loop, prim } of flocks) {
      const [e, n, u] = loopPoint(loop, t);
      const [e2, n2] = loopPoint(loop, t + 0.1);
      prim.modelMatrix = place(e, n, u, prim.modelMatrix, Math.atan2(n2 - n, e2 - e));
    }
    const [dx, dy] = cloudOffset(t, 3, extentM);
    for (const { spot, prim } of cloudPrims) {
      prim.modelMatrix = place(
        wrapCentred(spot.x + dx, extentM),
        wrapCentred(spot.y + dy, extentM),
        spot.z,
        prim.modelMatrix,
      );
    }
  };
  tick(0);
  apply();

  let destroyed = false;
  return {
    setPalette(p) {
      if (destroyed) return;
      night = isNight(p);
      if (birdMat) birdMat.uniforms.color = C.Color.fromCssColorString(birdColour(p));
      if (cloudMat) {
        cloudMat.uniforms.color = C.Color.fromCssColorString(cloudColour(p)).withAlpha(CLOUD_ALPHA);
        setLightUniforms(cloudMat, cloudUniforms(p));
      }
      apply();
    },
    tick(t) {
      if (!destroyed) tick(t);
    },
    setVisible(birds, cloudsVisible) {
      if (destroyed) return;
      birdsOn = birds;
      cloudsOn = cloudsVisible;
      apply();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const { prim } of [...flocks, ...cloudPrims]) {
        collection.remove(prim); // a scene collection also destroys it
        if (!prim.isDestroyed()) prim.destroy();
      }
      for (const m of [birdMat, cloudMat]) if (m && !m.isDestroyed()) m.destroy();
    },
  };
}
