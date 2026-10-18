import * as THREE from "three";
import type { Tier } from "../../cesium/stylised/quality";
import { hash01 } from "../assets/fit";
import { createRoleMaterial, type RoleUniforms } from "../assets/roleMaterial";
import { DECK_POOL_COLOUR, type PodiumDeck } from "./podiumDeck";
import type { RoofDressing } from "./roofPlan";

const NOOP = () => {};
/** Role 3 (glass) in COLOR_0.g, decoded by the role material as floor(g * 7 + 0.5). */
const GLASS_G = 3 / 7;
/** Skylight night glow relative to a lit window (`uWindowGlow` x 0.6): the owner saw them too bright. */
const SKYLIGHT_GLOW = 0.6;
const UNIT_GREY = "#8d9297";

export interface RoofItem {
  /** Building id: seeds the colour jitter of its units and the lit seed of its skylights. */
  id: string;
  dressing: RoofDressing;
}

/** One tile's planned roofs: the dressed roofs and the podium decks in it. */
export interface TileRoofs {
  items: RoofItem[];
  decks: PodiumDeck[];
}

/** A box with its base at y = 0 (so a matrix y of the roof height sits it on the roof). */
function baseBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

/**
 * Roof layer: at most 3 InstancedMesh draws (rooftop units, skylight strips, roof-edge band), plus
 * a `roof_deck` group of 2 draws (deck boxes, pool plane) when `decks` are given (the Kanopi
 * podium deck, ruling P4-M; the pool is base water #7fb6c9, never the flood blue).
 * Decorative only (never picked, never cited, no shadows). Skylights use the shared role material
 * on the glass role so they glow at night with the windows. At Low, or with nothing to draw, the
 * layer is empty and the buildings keep the P3 palette roofs.
 */
export function createRoofLayer(
  items: RoofItem[],
  uniforms: RoleUniforms,
  tier: Tier,
  decks: readonly PodiumDeck[] = [],
): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = "roofs";
  group.userData.decorative = true;
  group.raycast = NOOP;
  if (tier === "low" || (items.length === 0 && decks.length === 0)) return { group, dispose: NOOP };

  const disposables: Array<{ dispose(): void }> = [];
  const meshes: THREE.InstancedMesh[] = [];

  const build = (
    name: string,
    colourOf: (item: RoofItem, i: number) => [number, number, number],
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    per: (item: RoofItem) => Float32Array,
  ) => {
    let count = 0;
    for (const it of items) count += per(it).length / 16;
    if (count === 0) {
      geo.dispose();
      material.dispose();
      return;
    }
    const mesh = new THREE.InstancedMesh(geo, material, count);
    const col = new Float32Array(count * 3);
    let n = 0;
    for (const it of items) {
      const m = per(it);
      const k = m.length / 16;
      mesh.instanceMatrix.array.set(m, n * 16);
      for (let i = 0; i < k; i++) col.set(colourOf(it, i), (n + i) * 3);
      n += k;
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.raycast = NOOP;
    mesh.userData.decorative = true;
    disposables.push(geo, material);
    meshes.push(mesh);
    group.add(mesh);
  };

  const grey = new THREE.Color(UNIT_GREY);
  build(
    "roof_units",
    (it, i) => {
      const j = 0.9 + 0.2 * hash01(it.id, `roof:tone${i}`);
      return [grey.r * j, grey.g * j, grey.b * j];
    },
    baseBox(),
    new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }),
    (it) => it.dressing.units,
  );

  // Skylights: glass role, lit seed in the instance colour's blue channel.
  const skyGeo = baseBox();
  const nv = skyGeo.getAttribute("position").count;
  const vc = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) vc.set([1, GLASS_G, 1], i * 3);
  skyGeo.setAttribute("color", new THREE.Float32BufferAttribute(vc, 3));
  let skyCount = 0;
  for (const it of items) skyCount += it.dressing.skylights.length / 16;
  for (let i = 0; i < 3; i++)
    skyGeo.setAttribute(
      `iPal${i}`,
      new THREE.InstancedBufferAttribute(new Float32Array(3), 3, false, Math.max(1, skyCount)),
    );
  build(
    "roof_skylights",
    (it, i) => [1, 1, hash01(it.id, `roof:lit${i}`)],
    skyGeo,
    createRoleMaterial({ instanced: true, uniforms, glassGlow: SKYLIGHT_GLOW }),
    (it) => it.dressing.skylights,
  );

  // Band: coloured per building from its palette trim.
  const bandColour = new Map<string, THREE.Color>();
  build(
    "roof_edge_band",
    (it) => {
      let c = bandColour.get(it.dressing.edge);
      if (!c) {
        c = new THREE.Color(it.dressing.edge);
        bandColour.set(it.dressing.edge, c);
      }
      return [c.r, c.g, c.b];
    },
    baseBox(),
    new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }),
    (it) => it.dressing.band,
  );

  if (decks.length > 0) {
    const deck = new THREE.Group();
    deck.name = "roof_deck";
    deck.userData.decorative = true;
    deck.raycast = NOOP;
    const add = (mesh: THREE.InstancedMesh, geo: THREE.BufferGeometry, mat: THREE.Material) => {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.raycast = NOOP;
      mesh.userData.decorative = true;
      disposables.push(geo, mat);
      meshes.push(mesh);
      deck.add(mesh);
    };
    const nBoxes = decks.reduce((n, d) => n + d.boxes.length / 16, 0);
    if (nBoxes > 0) {
      const geo = baseBox();
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
      const mesh = new THREE.InstancedMesh(geo, mat, nBoxes);
      const col = new Float32Array(nBoxes * 3);
      let n = 0;
      for (const d of decks) {
        mesh.instanceMatrix.array.set(d.boxes, n * 16);
        col.set(d.colours, n * 3);
        n += d.boxes.length / 16;
      }
      mesh.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
      mesh.name = "roof_deck_boxes";
      add(mesh, geo, mat);
    }
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    const water = new THREE.MeshStandardMaterial({
      color: DECK_POOL_COLOUR,
      roughness: 0.25,
      metalness: 0,
    });
    const pool = new THREE.InstancedMesh(plane, water, decks.length);
    decks.forEach((d, i) => {
      pool.instanceMatrix.array.set(d.pool, i * 16);
    });
    pool.name = "roof_deck_pool";
    add(pool, plane, water);
    group.add(deck);
  }

  return {
    dispose() {
      for (const m of meshes) m.dispose();
      for (const d of disposables) d.dispose();
      group.clear();
      meshes.length = 0;
      disposables.length = 0;
    },
    group,
  };
}
