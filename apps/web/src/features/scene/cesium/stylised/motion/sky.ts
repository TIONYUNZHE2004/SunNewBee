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
  // All flocks share one primitive whose model matrix is the ENU frame at the anchor: position is
  // the bird's offset in its flock (x forward, z up); the per-instance "flock" attribute holds the
  // flock's place (east, north, up metres) and heading, written by tick().
  // st.s: -1 left wing tip, 0 body, +1 right wing tip; st.t: bird index.
  vec4 fl = czm_batchTable_flock(batchId);
  vec3 local = position3DHigh + position3DLow;
  float ch = cos(fl.w);
  float sh = sin(fl.w);
  local.xy = vec2(ch * local.x - sh * local.y, sh * local.x + ch * local.y);
  local.z += abs(st.s) * sin(t * 12.0 + st.t * 1.7) * 0.6;
  local += fl.xyz;
  p = vec4(local - czm_encodedCameraPositionMCHigh - czm_encodedCameraPositionMCLow, 1.0);
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
  | "GeometryInstanceAttribute"
  | "GeometryOffsetAttribute"
>;

export interface SkyViewer {
  scene: {
    primitives: { add(p: Cesium.Primitive): unknown; remove(p: Cesium.Primitive): unknown };
    requestRender(): void;
    /** Used once: places the clouds on the first frame their primitive is ready. */
    postRender?: { addEventListener(cb: () => void): () => void };
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
 * Two primitives in all (measured at the 2026-10-17 perf gate: one per flock and one per cloud cost
 * ~50 draw commands at Day/High). Every flock is an instance of ONE bird primitive: the vertex
 * shader flaps the wings and places each flock from its per-instance "flock" attribute (east,
 * north, up, heading). Every cloud puff is an instance of ONE translucent cloud primitive and
 * drifts by Cesium's per-instance `offset` (with wrap-around inside `extentM`). Positions are metres
 * east / north / up of `at`.
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
  const flockValue = (loop: Loop, t: number) => {
    const [e, n, u] = loopPoint(loop, t);
    const [e2, n2] = loopPoint(loop, t + 0.1);
    return [e, n, u, Math.atan2(n2 - n, e2 - e)];
  };

  let birdMat: Cesium.Material | null = null;
  let birds: Cesium.Primitive | null = null;
  if (loops.length > 0) {
    birdMat = C.Material.fromType("Color", {
      color: C.Color.fromCssColorString(birdColour(palette)),
    });
    birds = new C.Primitive({
      geometryInstances: loops.map(
        (loop, i) =>
          new C.GeometryInstance({
            geometry: birdGeometry(C, birdsPerFlock, `bird:${i}`),
            id: `flock:${i}`,
            attributes: {
              flock: new C.GeometryInstanceAttribute({
                componentDatatype: C.ComponentDatatype.FLOAT,
                componentsPerAttribute: 4,
                value: flockValue(loop, 0),
              }),
            } as never,
          }),
      ),
      modelMatrix: base,
      appearance: new C.MaterialAppearance({
        material: birdMat,
        materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED,
        vertexShaderSource: BIRD_VS,
        flat: true,
        translucent: false,
      }),
      // Custom geometry is synchronous-only; st holds -1..1 and bird indices (no compression).
      asynchronous: false,
      compressVertices: false,
      allowPicking: false,
      // The shader moves the flocks away from the geometry's bounds: never cull (a few hundred
      // triangles).
      cull: false,
      shadows: C.ShadowMode.DISABLED,
    });
  }

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
    // Supported by EllipsoidGeometry in 1.146 (adds applyOffset) but missing from its typings.
    ...({ offsetAttribute: C.GeometryOffsetAttribute.ALL } as object),
  });
  // Cesium's per-instance `offset` (what OffsetGeometryInstanceAttribute builds; that class is
  // missing from the 1.146 typings): an ECEF vector added to every vertex with applyOffset = 1.
  const zero = () =>
    new C.GeometryInstanceAttribute({
      componentDatatype: C.ComponentDatatype.FLOAT,
      componentsPerAttribute: 3,
      value: [0, 0, 0],
    });
  const cloudSets = clouds.map((c, i) => {
    const key = `cloud:${i}`;
    const n = 3 + Math.min(2, Math.floor(hashUnit(key, "n") * 3));
    const at0 = C.Matrix4.multiplyByTranslation(
      base,
      new C.Cartesian3(c.x, c.y, c.z),
      new C.Matrix4(),
    );
    const ids = Array.from({ length: n }, (_, j) => `${key}:${j}`);
    const instances = ids.map((k) => {
      const rx = (35 + hashUnit(k, "r") * 25) * c.scale;
      const offset = C.Matrix4.multiplyByTranslation(
        at0,
        new C.Cartesian3(
          (hashUnit(k, "x") - 0.5) * 70 * c.scale,
          (hashUnit(k, "y") - 0.5) * 40 * c.scale,
          (hashUnit(k, "z") - 0.5) * 10 * c.scale,
        ),
        new C.Matrix4(),
      );
      return new C.GeometryInstance({
        geometry: puff as unknown as Cesium.Geometry,
        id: k,
        modelMatrix: C.Matrix4.multiplyByScale(
          offset,
          new C.Cartesian3(rx, rx * (0.6 + hashUnit(k, "w") * 0.3), rx * 0.35),
          new C.Matrix4(),
        ),
        attributes: { offset: zero() } as never,
      });
    });
    return { spot: c, ids, instances };
  });
  const cloudPrim =
    cloudSets.length > 0
      ? new C.Primitive({
          geometryInstances: cloudSets.flatMap((s) => s.instances),
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
        })
      : null;
  const prims = [birds, cloudPrim].filter((p): p is Cesium.Primitive => p !== null);
  for (const p of prims) collection.add(p);

  let night = isNight(palette);
  let birdsOn = true;
  let cloudsOn = true;
  const apply = () => {
    if (birds) birds.show = birdsOn && !night;
    if (cloudPrim) cloudPrim.show = cloudsOn && !night;
    viewer.scene.requestRender();
  };

  /** Per-instance attributes once the primitive is ready (before that, nothing to write). */
  const attrs = (p: Cesium.Primitive, id: string) =>
    p.ready
      ? (p.getGeometryInstanceAttributes(id) as Record<string, unknown> | undefined)
      : undefined;
  /** Last clock time: re-applied once the (asynchronous) clouds become ready. */
  let lastT = 0;
  let cloudsPlaced = false;
  const tick = (t: number) => {
    lastT = t;
    if (birds)
      loops.forEach((loop, i) => {
        const a = attrs(birds as Cesium.Primitive, `flock:${i}`);
        if (a) a.flock = flockValue(loop, t);
      });
    if (cloudPrim?.ready) {
      cloudsPlaced = true;
      const [dx, dy] = cloudOffset(t, 3, extentM);
      for (const { spot, ids } of cloudSets) {
        const enu = new C.Cartesian3(
          wrapCentred(spot.x + dx, extentM) - spot.x,
          wrapCentred(spot.y + dy, extentM) - spot.y,
          0,
        );
        const ecef = C.Matrix4.multiplyByPointAsVector(base, enu, new C.Cartesian3());
        const value = new Float32Array([ecef.x, ecef.y, ecef.z]);
        for (const id of ids) {
          const a = attrs(cloudPrim, id);
          if (a) a.offset = value;
        }
      }
    }
  };
  /** Place the clouds at the latest time on the first frame they are ready (Motion off: no tick). */
  const placeWhenReady = () => {
    if (cloudsPlaced || !cloudPrim) return true;
    if (!cloudPrim.ready) return false;
    tick(lastT);
    viewer.scene.requestRender();
    return true;
  };
  tick(0);
  let stopWatching: (() => void) | undefined = viewer.scene.postRender?.addEventListener(() => {
    if (!placeWhenReady()) return;
    stopWatching?.();
    stopWatching = undefined;
  });
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
      stopWatching?.();
      stopWatching = undefined;
      for (const prim of prims) {
        collection.remove(prim); // a scene collection also destroys it
        if (!prim.isDestroyed()) prim.destroy();
      }
      for (const m of [birdMat, cloudMat]) if (m && !m.isDestroyed()) m.destroy();
    },
  };
}
