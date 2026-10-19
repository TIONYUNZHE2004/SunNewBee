import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { EFFECT_COLOURS } from "../shared/clayTokens";
import { HERO_DISPLAY_SCALE } from "./hero";

const noRaycast = () => {};

function painted(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

/**
 * The hero's ground highlight (prototype): a yellow ring around a pale disc, flat on the ground
 * under her root. Shared by the placeholder and the rigged GLB hero. One opaque, unlit mesh (one
 * draw, never in the transparent pass: H11 frame cost). Model units (0.85 ring radius), scaled by
 * HERO_DISPLAY_SCALE. Never pickable, casts no shadow; tagged `userData.heroPart` "ring".
 */
export function createHeroRing(): { group: THREE.Group; ring: THREE.Mesh; dispose(): void } {
  const group = new THREE.Group();
  group.name = "journey-hero-ring";
  group.scale.setScalar(HERO_DISPLAY_SCALE);
  const torus = new THREE.TorusGeometry(0.85, 0.06, 12, 48)
    .rotateX(Math.PI / 2)
    .translate(0, 0.03, 0);
  const disc = new THREE.CircleGeometry(0.82, 40).rotateX(-Math.PI / 2).translate(0, 0.02, 0);
  disc.deleteAttribute("uv");
  torus.deleteAttribute("uv");
  const geo = mergeGeometries([
    painted(torus.toNonIndexed(), EFFECT_COLOURS.heroRing),
    painted(disc.toNonIndexed(), EFFECT_COLOURS.heroDisc),
  ]) as THREE.BufferGeometry;
  torus.dispose();
  disc.dispose();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const ring = new THREE.Mesh(geo, mat);
  ring.name = "ring";
  ring.userData.heroPart = "ring";
  ring.raycast = noRaycast;
  ring.castShadow = false;
  group.add(ring);
  return {
    group,
    ring,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
