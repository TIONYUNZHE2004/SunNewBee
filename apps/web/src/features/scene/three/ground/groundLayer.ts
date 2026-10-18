import * as THREE from "three";
import type { Tier } from "../../cesium/stylised/quality";
import { GROUND_BANDS, type GroundBand, groundMaterial } from "./bands";
import { shimmerMaterial } from "./landcover";
import type { Ribbon } from "./ribbons";

export interface GroundLayer {
  group: THREE.Group;
  dispose(): void;
}

/** Display-only tints per road kind (illustrative; a road's colour says nothing about access). */
const ROAD_COLOUR: Record<Ribbon["kind"], string> = {
  major: "#55595e",
  residential: "#6e7176",
  footway: "#b9b3a6",
  other: "#8b8a86",
};
const MARK_COLOUR = "#ece6d2";

const noRaycast = () => {};

function merge(ribbons: Ribbon[], colour: (r: Ribbon) => THREE.Color): THREE.BufferGeometry | null {
  let verts = 0;
  let idx = 0;
  for (const r of ribbons) {
    verts += r.positions.length / 3;
    idx += r.indices.length;
  }
  if (idx === 0) return null;
  const pos = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const index = new Uint32Array(idx);
  let v = 0;
  let i = 0;
  for (const r of ribbons) {
    const c = colour(r);
    const n = r.positions.length / 3;
    pos.set(r.positions, v * 3);
    for (let k = 0; k < n; k++) {
      col.set([c.r, c.g, c.b], (v + k) * 3);
      nor[(v + k) * 3 + 1] = 1;
    }
    for (let k = 0; k < r.indices.length; k++) index[i + k] = r.indices[k]! + v;
    v += n;
    i += r.indices.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

/**
 * The stylised ground above the base plane: land cover, road surfaces (all kinds merged,
 * vertex-coloured) and, above Low, dashed marks. At most three draws. Every mesh is decorative: it
 * receives shadows, casts none and ignores picking, so route and place picks go through it.
 * Ownership of `landcover` passes to the layer.
 */
export function createGroundLayer(
  roads: Ribbon[],
  landcover: THREE.BufferGeometry,
  tier: Tier,
  uTime?: { value: number },
): GroundLayer {
  const group = new THREE.Group();
  group.name = "ground-layer";
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const add = (geo: THREE.BufferGeometry, band: GroundBand) => {
    const mat = groundMaterial(band);
    if (uTime && band === "landcover") shimmerMaterial(mat, uTime, "water-only");
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = GROUND_BANDS[band].order;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.decorative = true;
    mesh.raycast = noRaycast;
    group.add(mesh);
    geometries.push(geo);
    materials.push(mat);
  };

  if (landcover.getAttribute("position")?.count) add(landcover, "landcover");
  else landcover.dispose();
  const surface = merge(
    roads.filter((r) => !r.marking),
    (r) => new THREE.Color(ROAD_COLOUR[r.kind]),
  );
  if (surface) add(surface, "roads");
  const marks =
    tier === "low"
      ? null
      : merge(
          roads.filter((r) => r.marking),
          () => new THREE.Color(MARK_COLOUR),
        );
  if (marks) add(marks, "markings");

  return {
    group,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      group.clear();
    },
  };
}
