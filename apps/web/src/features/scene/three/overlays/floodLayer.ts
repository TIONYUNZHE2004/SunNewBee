import * as THREE from "three";
import { groupEdgesByStatus, lineFeatures, waterPolygons } from "../../geo";
import { type EdgeStatus, WATER_COLOR } from "../../styles";
import { localRing, triangulate } from "../cityMesh";
import type { LocalFrame } from "../frame";
import { lineToLocal } from "../routeLine";
import { createLineBatch, statusLineStyle } from "./lines";

/** Metres the scenario water floats above the ground: the flood overlay's one and only height. */
export const FLOOD_LIFT_M = 0.3;
/**
 * Overlay pass orders. The fill sits above the ground bands (1-7) and under every line (>= 10), so
 * a flooded path stays readable on top of the tint. Flood edges share the what-if order (12).
 */
export const FLOOD_ORDER = { fill: 9, edges: 12 } as const;
export const FLOOD_ALPHA = 0.55;
/** Hatch: 45 degree lines, 4 px wide on a 12 px pitch. One texture repeat covers HATCH_REPEAT_M. */
const HATCH_PX = 12;
const HATCH_LINE_PX = 4;
const HATCH_REPEAT_M = 6;
const FLOODED: EdgeStatus[] = ["flooded_likely", "flooded_possible"];

/**
 * The hatch as a tiny RGBA texture multiplied into the water colour: white (no change) with
 * darker diagonal lines. Pixels on the same x + y share a value, so the lines run at 45 degrees.
 * Data texture (not a canvas): identical in every environment.
 */
export function hatchTexture(): THREE.DataTexture {
  const data = new Uint8Array(HATCH_PX * HATCH_PX * 4);
  for (let y = 0; y < HATCH_PX; y++)
    for (let x = 0; x < HATCH_PX; x++) {
      const v = (x + y) % HATCH_PX < HATCH_LINE_PX ? 150 : 255;
      data.set([v, v, v, 255], (y * HATCH_PX + x) * 4);
    }
  const t = new THREE.DataTexture(data, HATCH_PX, HATCH_PX, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Triangulated, flat, upward-facing fill of every scenario-water polygon (holes honoured). */
function fillGeometry(water: unknown, frame: LocalFrame): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const uv: number[] = [];
  for (const poly of waterPolygons(water)) {
    const rings = poly.rings.map((r) => localRing(r, frame));
    if (rings.length === 0 || rings.some((r) => r === null)) continue;
    const [contour, ...holes] = rings as [number, number][][];
    const tris = triangulate(contour as [number, number][], holes);
    if (!tris) continue;
    const all = [contour as [number, number][], ...holes].flat();
    for (const t of tris)
      for (const i of t) {
        const [x, z] = all[i] as [number, number];
        pos.push(x, FLOOD_LIFT_M, z);
        uv.push(x / HATCH_REPEAT_M, z / HATCH_REPEAT_M);
      }
  }
  if (pos.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/**
 * Draped scenario water: flat triangulated polygons at y = 0.30 m, #1e6fb8 at alpha 0.55 with a
 * hatch. No vertical faces, no height, no depth, no animation: it is an indicative class, not a
 * water surface. Flood edges (flooded_likely, flooded_possible) use the flood status styles, 2 px
 * wider as in Cesium. Base and land-cover water (#7fb6c9) never comes through here.
 */
export function createFloodLayer(
  water: unknown,
  floodEdges: unknown,
  frame: LocalFrame,
): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = "flood";
  let texture: THREE.DataTexture | null = null;

  const geo = water ? fillGeometry(water, frame) : null;
  if (geo) {
    texture = hatchTexture();
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(WATER_COLOR),
      map: texture,
      transparent: true,
      opacity: FLOOD_ALPHA,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "flood-fill";
    mesh.renderOrder = FLOOD_ORDER.fill;
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  if (floodEdges)
    for (const [status, edges] of groupEdgesByStatus(lineFeatures(floodEdges)))
      if (FLOODED.includes(status))
        group.add(
          createLineBatch(
            edges.map((e) => lineToLocal(e.coords, frame, 0)),
            statusLineStyle(status, 2),
            FLOOD_LIFT_M,
            FLOOD_ORDER.edges,
          ),
        );

  return {
    group,
    dispose() {
      for (const o of [...group.children]) {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
        group.remove(o);
      }
      texture?.dispose();
      texture = null;
    },
  };
}
