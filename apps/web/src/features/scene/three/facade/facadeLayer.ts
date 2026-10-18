import * as THREE from "three";
import type { Tier } from "../../shared/quality";
import { hash01 } from "../assets/fit";
import { createRoleMaterial, type MotionUniforms, type RoleUniforms } from "../assets/roleMaterial";
import { type FacadeSpec, facadeInstances, type WindowStyle } from "./facadePlan";

const NOOP = () => {};
/** Golden-ratio step: consecutive windows of one building get well-spread lit seeds. */
const SEED_STEP = 0.6180339887;
/** Shopfront seeds are scaled down, so a larger share of them reads as lit at night. Decorative. */
const SHOP_SEED_SCALE = 0.8;
/** Role 3 (glass) in COLOR_0.g, decoded by the role material as floor(g * 7 + 0.5). */
const GLASS_G = 3 / 7;

export interface FacadeBuilding {
  ring: Array<[number, number]>;
  heightM: number;
  minHeightM: number;
  spec: FacadeSpec;
}

/** A unit quad (+-0.5 in x and y, facing +z) with COLOR_0 = (AO 1, glass role, seed 1). */
function unitQuad(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1);
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([1, GLASS_G, 1], i * 3);
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

interface Batch {
  mats: Float32Array[];
  seeds: number[];
  count: number;
}

/**
 * Procedural facade layer: one InstancedMesh per window style in use (at most 4) plus one for
 * shopfronts, so the whole pass costs at most 5 draws. Every mesh is decorative (never picked,
 * never cited) and casts no shadow. Windows use the shared role material on the glass role: the
 * instance colour's blue channel is the lit seed (the archetypes' COLOR_0.b), so they glow by
 * uWindowGlow when the seed is below uLitShare, and flicker when uFlicker is on (pass the shared
 * `motion` uniforms so the flicker follows the motion clock; without them the clock stays at 0). At Low the layer is empty: buildings fall back to the P3 palette extrusion.
 */
export function createFacadeLayer(
  buildings: FacadeBuilding[],
  uniforms: RoleUniforms,
  tier: Tier,
  motion?: MotionUniforms,
): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = "facades";
  group.userData.decorative = true;
  group.raycast = NOOP;
  if (tier === "low" || buildings.length === 0) return { group, dispose: NOOP };

  const styles: Record<WindowStyle, Batch> = {
    0: { mats: [], seeds: [], count: 0 },
    1: { mats: [], seeds: [], count: 0 },
    2: { mats: [], seeds: [], count: 0 },
    3: { mats: [], seeds: [], count: 0 },
  };
  const shops: Batch = { mats: [], seeds: [], count: 0 };
  for (const b of buildings) {
    const out = facadeInstances(b.ring, b.heightM, b.minHeightM, b.spec);
    const base = hash01(b.spec.buildingId, "facade:lit");
    const batch = styles[b.spec.windowStyle] ?? styles[0];
    if (out.count > 0) {
      batch.mats.push(out.windows);
      for (let i = 0; i < out.count; i++) batch.seeds.push((base + i * SEED_STEP) % 1);
      batch.count += out.count;
    }
    const nShop = out.shopfronts.length / 16;
    if (nShop > 0) {
      shops.mats.push(out.shopfronts);
      for (let i = 0; i < nShop; i++)
        shops.seeds.push(((base + (i + 0.5) * SEED_STEP) % 1) * SHOP_SEED_SCALE);
      shops.count += nShop;
    }
  }

  const quad = unitQuad();
  const material = createRoleMaterial({
    instanced: true,
    uniforms,
    motion,
    flicker: true,
  });
  // Pull the quads toward the camera so the 0.05 m offset never z-fights at range.
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  const geos: THREE.BufferGeometry[] = [];
  const meshes: THREE.InstancedMesh[] = [];

  const build = (name: string, batch: Batch) => {
    if (batch.count === 0) return;
    const geo = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(quad.attributes)) geo.setAttribute(k, a);
    geo.setIndex(quad.index);
    // The role material declares iPal0..2; the glass role ignores them, so one shared value
    // (divisor = instance count) stands in for a per-instance buffer.
    for (let i = 0; i < 3; i++)
      geo.setAttribute(
        `iPal${i}`,
        new THREE.InstancedBufferAttribute(new Float32Array(3), 3, false, batch.count),
      );
    geos.push(geo);
    const mesh = new THREE.InstancedMesh(geo, material, batch.count);
    let o = 0;
    for (const m of batch.mats) {
      mesh.instanceMatrix.array.set(m, o);
      o += m.length;
    }
    const col = new Float32Array(batch.count * 3);
    for (let i = 0; i < batch.count; i++) col.set([1, 1, batch.seeds[i]!], i * 3);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.raycast = NOOP;
    mesh.userData.decorative = true;
    meshes.push(mesh);
    group.add(mesh);
  };
  for (const s of [0, 1, 2, 3] as const) build(`facade_windows_${s}`, styles[s]);
  build("facade_shopfronts", shops);

  return {
    group,
    dispose() {
      for (const m of meshes) m.dispose();
      for (const g of geos) g.dispose();
      quad.dispose();
      material.dispose();
      group.clear();
      meshes.length = 0;
      geos.length = 0;
    },
  };
}
