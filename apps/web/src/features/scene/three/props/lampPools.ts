import * as THREE from "three";
import type { Placement } from "../assets/fit";
import type { RoleUniforms } from "../assets/roleMaterial";
import { EFFECT_COLOURS } from "../shared/clayTokens";

export const LAMP_POOL_SIZE_M = 14;
/** Above the markings band (0.10), below nothing else on the ground. */
export const LAMP_POOL_Y = 0.12;
/** After the ground bands (1 to 5), before overlays (10 and up). */
export const LAMP_POOL_RENDER_ORDER = 6;
const WARM = EFFECT_COLOURS.lampPool;
const TEX = 64;

/**
 * Where each lamp model's lit head is, in model metres: [x along the arm, height]. Measured from the
 * kit (`furniture` glb, light role 7 at x 1.05..1.6, y 8.78..8.85). A double lamp has a head at each
 * end of its arm. The pool lies under the head, not at the pole's foot (owner, 21 Oct: a pool round
 * the pole base read as fake).
 */
export const LAMP_HEADS: Record<string, readonly (readonly [number, number])[]> = {
  lamp_single: [[1.33, 8.8]],
  lamp_double: [
    [-1.33, 8.8],
    [1.33, 8.8],
  ],
};
/** Halo sprite at a lit head (world metres): small, soft, warm. */
export const LAMP_HALO_M = 2.2;

/** World (x, y, z) of each lit head of a placed lamp (yaw about +y, scale sx / sy). */
export function lampHeads(l: Placement): [number, number, number][] {
  const heads = LAMP_HEADS[l.variant] ?? [[0, 8.8]];
  const c = Math.cos(l.yaw);
  const s = Math.sin(l.yaw);
  // three's rotation about +y maps local (x, 0, 0) to (x cos, 0, -x sin)
  return heads.map(([hx, hy]) => [l.x + hx * l.sx * c, hy * l.sy, l.z - hx * l.sx * s]);
}

/** Radial falloff `f(d)` (d = 0 centre, 1 edge) in a warm, alpha-matched texture (additive). */
function gradientTexture(falloff: (d: number) => number): THREE.DataTexture {
  const warm = new THREE.Color(WARM);
  const data = new Uint8Array(TEX * TEX * 4);
  for (let j = 0; j < TEX; j++)
    for (let i = 0; i < TEX; i++) {
      const d = Math.hypot((i + 0.5) / TEX - 0.5, (j + 0.5) / TEX - 0.5) * 2;
      const a = falloff(Math.min(1, d));
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

/** Ground pool: a bright core under the head and a long soft tail, like a real cone of light. */
const poolFalloff = (d: number) => 0.55 * Math.max(0, 1 - d / 0.35) ** 2 + 0.45 * (1 - d) ** 2.2;
/** Head halo: a tight hot centre fading fast. */
const haloFalloff = (d: number) => Math.max(0, 1 - d) ** 3;

const noRaycast = () => {};

const glowShader =
  (uniforms: RoleUniforms) => (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uLightGlow = uniforms.uLightGlow;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float uLightGlow;\nvoid main() {")
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\ndiffuseColor.a *= clamp(uLightGlow, 0.0, 1.0);",
      )
      // PointsMaterial (the halos) samples its map in its own chunk
      .replace(
        "#include <map_particle_fragment>",
        "#include <map_particle_fragment>\ndiffuseColor.a *= clamp(uLightGlow, 0.0, 1.0);",
      );
  };

/**
 * Night street light, display only: one instanced additive ground pool under each lit lamp head,
 * and a small halo sprite at the head itself. Opacity is `clamp(uLightGlow, 0, 1)` from the shared
 * role uniforms, so both are 0 by day and rise with the night glow.
 */
export function createLampPools(
  lamps: Placement[],
  uniforms: RoleUniforms,
): {
  mesh: THREE.InstancedMesh;
  halos: THREE.Points;
  opacity(): number;
  dispose(): void;
} {
  const heads = lamps.flatMap(lampHeads);
  const geo = new THREE.PlaneGeometry(LAMP_POOL_SIZE_M, LAMP_POOL_SIZE_M);
  geo.rotateX(-Math.PI / 2);
  const map = gradientTexture(poolFalloff);
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
  mat.onBeforeCompile = glowShader(uniforms);
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, heads.length));
  mesh.count = heads.length;
  mesh.name = "lamp-pools";
  const m = new THREE.Matrix4();
  for (const [i, [x, , z]] of heads.entries())
    mesh.setMatrixAt(i, m.makeTranslation(x, LAMP_POOL_Y, z));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.renderOrder = LAMP_POOL_RENDER_ORDER;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.decorative = true;
  mesh.raycast = noRaycast;

  // Halos just under each head (the lit face looks down), sized in world metres.
  const hgeo = new THREE.BufferGeometry();
  hgeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      heads.flatMap(([x, y, z]) => [x, y - 0.15, z]),
      3,
    ),
  );
  const hmap = gradientTexture(haloFalloff);
  const hmat = new THREE.PointsMaterial({
    map: hmap,
    size: LAMP_HALO_M,
    sizeAttenuation: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  hmat.customProgramCacheKey = () => "tl_lamp_halo";
  hmat.onBeforeCompile = glowShader(uniforms);
  const halos = new THREE.Points(hgeo, hmat);
  halos.name = "lamp-halos";
  halos.userData.decorative = true;
  halos.raycast = noRaycast;
  halos.frustumCulled = heads.length > 0;
  return {
    mesh,
    halos,
    opacity: () => Math.min(1, Math.max(0, uniforms.uLightGlow.value)),
    dispose() {
      geo.dispose();
      mat.dispose();
      map.dispose();
      mesh.dispose();
      hgeo.dispose();
      hmat.dispose();
      hmap.dispose();
    },
  };
}
