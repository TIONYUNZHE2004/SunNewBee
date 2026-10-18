import * as THREE from "three";
import type { Placement } from "../assets/fit";
import type { RoleUniforms } from "../assets/roleMaterial";

export const LAMP_POOL_SIZE_M = 14;
/** Above the markings band (0.10), below nothing else on the ground. */
export const LAMP_POOL_Y = 0.12;
/** After the ground bands (1 to 5), before overlays (10 and up). */
export const LAMP_POOL_RENDER_ORDER = 6;
const WARM = "#ffcf8a";
const TEX = 64;

/** A warm radial falloff, white-to-black alpha-free (additive blending, so black adds nothing). */
function gradientTexture(): THREE.DataTexture {
  const warm = new THREE.Color(WARM);
  const data = new Uint8Array(TEX * TEX * 4);
  for (let j = 0; j < TEX; j++)
    for (let i = 0; i < TEX; i++) {
      const d = Math.hypot((i + 0.5) / TEX - 0.5, (j + 0.5) / TEX - 0.5) * 2;
      const f = Math.max(0, 1 - d);
      const a = f * f;
      const k = (j * TEX + i) * 4;
      data[k] = Math.round(warm.r * 255 * a);
      data[k + 1] = Math.round(warm.g * 255 * a);
      data[k + 2] = Math.round(warm.b * 255 * a);
      data[k + 3] = Math.round(255 * a);
    }
  const t = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const noRaycast = () => {};

/**
 * One instanced additive ground quad per lamp: a warm pool of light. Opacity is `clamp(uLightGlow, 0, 1)`
 * read from the shared role uniforms, so it is 0 by day and rises with the night glow. Display only.
 */
export function createLampPools(
  lamps: Placement[],
  uniforms: RoleUniforms,
): { mesh: THREE.InstancedMesh; opacity(): number; dispose(): void } {
  const geo = new THREE.PlaneGeometry(LAMP_POOL_SIZE_M, LAMP_POOL_SIZE_M);
  geo.rotateX(-Math.PI / 2);
  const map = gradientTexture();
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
  mat.customProgramCacheKey = () => "tl_lamp_pool";
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLightGlow = uniforms.uLightGlow;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float uLightGlow;\nvoid main() {")
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\ndiffuseColor.a *= clamp(uLightGlow, 0.0, 1.0);",
      );
  };
  const mesh = new THREE.InstancedMesh(geo, mat, lamps.length);
  mesh.name = "lamp-pools";
  const m = new THREE.Matrix4();
  for (const [i, l] of lamps.entries())
    mesh.setMatrixAt(i, m.makeTranslation(l.x, LAMP_POOL_Y, l.z));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.renderOrder = LAMP_POOL_RENDER_ORDER;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.decorative = true;
  mesh.raycast = noRaycast;
  return {
    mesh,
    opacity: () => Math.min(1, Math.max(0, uniforms.uLightGlow.value)),
    dispose() {
      geo.dispose();
      mat.dispose();
      map.dispose();
      mesh.dispose();
    },
  };
}
