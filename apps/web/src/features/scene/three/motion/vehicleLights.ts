import * as THREE from "three";
import type { RoleUniforms } from "../assets/roleMaterial";
import { LAMP_POOL_RENDER_ORDER, LAMP_POOL_Y } from "../props/lampPools";
import { EFFECT_COLOURS } from "../shared/clayTokens";

/**
 * Light that moving traffic throws on the road at night (owner, 21 Oct: the glow has to come from
 * the lamps in front and behind the car, not from the whole car). Two instanced additive ground
 * quads per drawn vehicle: a warm headlight beam ahead of the front bumper and a small red tail
 * glow behind the rear one. Brightness follows the shared light-role glow (0 by day); the layer's
 * fade is the materials' opacity. Display only: never picked, no shadow, no depth write.
 */
export const BEAM = { lengthM: 11, widthM: 4.2, nearWidthM: 1.6 } as const;
export const TAIL = { lengthM: 2.4, widthM: 2.4 } as const;

const TEX_W = 32;
const TEX_H = 64;
const noRaycast = () => {};

/** Texture of a beam: v = 0 at the bumper, 1 at the far end; a cone that widens and fades. */
export function beamAlpha(u: number, v: number): number {
  const half = (BEAM.nearWidthM + (BEAM.widthM - BEAM.nearWidthM) * v) / BEAM.widthM / 2;
  const off = Math.abs(u - 0.5);
  if (off >= half) return 0;
  const across = 1 - (off / half) ** 2;
  const along = (1 - v) ** 1.6 * Math.min(1, v * 8);
  return across * along;
}

/** Texture of a tail glow: a soft ellipse centred near the bumper end (v = 0). */
export function tailAlpha(u: number, v: number): number {
  const d = Math.hypot((u - 0.5) * 2, v * 1.1);
  return Math.max(0, 1 - d) ** 2;
}

function texture(colour: string, alpha: (u: number, v: number) => number): THREE.DataTexture {
  const c = new THREE.Color(colour);
  const data = new Uint8Array(TEX_W * TEX_H * 4);
  for (let j = 0; j < TEX_H; j++)
    for (let i = 0; i < TEX_W; i++) {
      const a = alpha((i + 0.5) / TEX_W, (j + 0.5) / TEX_H);
      const k = (j * TEX_W + i) * 4;
      data[k] = Math.round(c.r * 255 * a);
      data[k + 1] = Math.round(c.g * 255 * a);
      data[k + 2] = Math.round(c.b * 255 * a);
      data[k + 3] = Math.round(255 * a);
    }
  const t = new THREE.DataTexture(data, TEX_W, TEX_H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * A ground quad `width` x `length` whose v = 0 edge is at local z = 0 and runs to z = +length
 * (`sign` 1, ahead) or z = -length (`sign` -1, behind).
 */
function quad(width: number, length: number, sign: 1 | -1): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(width, length);
  g.rotateX(-Math.PI / 2); // plane in XZ; v = 0 at +z/2 after the rotation
  if (sign === 1) g.rotateY(Math.PI); // v = 0 at -z/2
  g.translate(0, 0, (sign * length) / 2);
  return g;
}

function material(
  map: THREE.Texture,
  uniforms: RoleUniforms,
  strength: number,
  key: string,
): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
    fog: false,
  });
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLightGlow = uniforms.uLightGlow;
    // Additive (SrcAlpha, One): the alpha scales the light added; opacity (the layer fade) too.
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float uLightGlow;\nvoid main() {")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>\ndiffuseColor.a *= clamp(uLightGlow, 0.0, 1.0) * ${strength.toFixed(2)};`,
      );
  };
  return mat;
}

export interface VehicleLights {
  group: THREE.Group;
  /** Starts a tick: no instances drawn yet. */
  begin(): void;
  /** One vehicle at (x, z) facing `yaw` (atan2(dx, dz)), `halfLengthM` from its centre to a bumper. */
  add(x: number, z: number, yaw: number, halfLengthM: number, scale: number): void;
  /** Ends a tick: uploads the instances; hidden by day (no glow) or with nothing drawn. */
  end(): void;
  setOpacity(o: number): void;
  dispose(): void;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);

export function createVehicleLights(capacity: number, uniforms: RoleUniforms): VehicleLights {
  const beamMap = texture(EFFECT_COLOURS.headlight, beamAlpha);
  const tailMap = texture(EFFECT_COLOURS.taillight, tailAlpha);
  const beamGeo = quad(BEAM.widthM, BEAM.lengthM, 1);
  const tailGeo = quad(TAIL.widthM, TAIL.lengthM, -1);
  const beamMat = material(beamMap, uniforms, 0.8, "tl_vehicle_beam");
  const tailMat = material(tailMap, uniforms, 0.7, "tl_vehicle_tail");
  const make = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, capacity));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = name;
    mesh.count = 0;
    mesh.visible = false;
    mesh.renderOrder = LAMP_POOL_RENDER_ORDER;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.raycast = noRaycast;
    mesh.userData.decorative = true;
    return mesh;
  };
  const beams = make(beamGeo, beamMat, "vehicle-beams");
  const tails = make(tailGeo, tailMat, "vehicle-tails");
  const group = new THREE.Group();
  group.name = "vehicle-lights";
  group.userData.decorative = true;
  group.add(beams, tails);
  let n = 0;
  const lit = () => uniforms.uLightGlow.value > 0.01 && beamMat.opacity > 0;
  return {
    group,
    begin() {
      n = 0;
    },
    add(x, z, yaw, halfLengthM, scale) {
      if (n >= capacity || !lit()) return;
      _q.setFromAxisAngle(_y, yaw);
      _s.set(scale, 1, scale);
      const fx = Math.sin(yaw) * halfLengthM * scale;
      const fz = Math.cos(yaw) * halfLengthM * scale;
      beams.setMatrixAt(n, _m.compose(_p.set(x + fx, LAMP_POOL_Y, z + fz), _q, _s));
      tails.setMatrixAt(n, _m.compose(_p.set(x - fx, LAMP_POOL_Y, z - fz), _q, _s));
      n++;
    },
    end() {
      const show = n > 0 && lit();
      for (const mesh of [beams, tails]) {
        mesh.count = show ? n : 0;
        mesh.visible = show;
        if (show) mesh.instanceMatrix.needsUpdate = true;
      }
    },
    setOpacity(o) {
      beamMat.opacity = o;
      tailMat.opacity = o;
    },
    dispose() {
      for (const mesh of [beams, tails]) mesh.dispose();
      beamGeo.dispose();
      tailGeo.dispose();
      beamMat.dispose();
      tailMat.dispose();
      beamMap.dispose();
      tailMap.dispose();
      group.clear();
    },
  };
}
