import * as THREE from "three";
import type { LightPreset } from "./lighting";

/**
 * The sky: a gradient from `skyTop` at the zenith to the fog colour at and below the horizon, so
 * far ground fading into fog meets the sky without a seam. A unit sphere drawn at the far plane
 * (its position is projected with the camera's rotation only, depth w), so it needs no following,
 * no depth write and never takes part in picking, shadows or AO (depth 1 reads as background).
 * Display only.
 */
export interface Sky {
  mesh: THREE.Mesh;
  /** The two gradient ends as sRGB hex, as last set. */
  colours(): { top: string; horizon: string };
  setPreset(p: LightPreset): void;
  dispose(): void;
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}`;

const FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
varying vec3 vDir;
void main() {
  float t = pow(clamp(vDir.y, 0.0, 1.0), 0.55);
  gl_FragColor = vec4(mix(uHorizon, uTop, t), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSky(): Sky {
  const uTop = { value: new THREE.Color() };
  const uHorizon = { value: new THREE.Color() };
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTop, uHorizon },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const geo = new THREE.SphereGeometry(1, 24, 12);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "sky";
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.decorative = true;
  mesh.raycast = () => {};
  return {
    mesh,
    colours: () => ({
      top: `#${uTop.value.getHexString()}`,
      horizon: `#${uHorizon.value.getHexString()}`,
    }),
    setPreset(p) {
      uTop.value.set(p.skyTop);
      uHorizon.value.set(p.fog.color);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
