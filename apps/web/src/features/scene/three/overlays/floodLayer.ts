import * as THREE from "three";
import { type FloodShape, floodShapes } from "../../../flood/floodPresentation";
import { createRiverSurface } from "../../../flood/riverSurface";
import { groupEdgesByStatus, lineFeatures } from "../../geo";
import { type EdgeStatus, statusStyle } from "../../styles";
import { triangulate } from "../cityMesh";
import type { LocalFrame } from "../frame";
import type { Boundary } from "../ground/boundary";
import { lineToLocal } from "../routeLine";
import { createLineBatch, statusLineStyle } from "./lines";

/** River height is illustrative; source surface_height_m is deliberately never read. */
export const FLOOD_LIFT_M = 0.3;
export const FLOOD_ORDER = { fill: 8, edges: 12 } as const;
export const FLOOD_POLYGON_OFFSET = -8;
export const FLOOD_ALPHA = 0.16;
const FLOODED: EdgeStatus[] = ["flooded_likely", "flooded_possible"];

/** Build one batch per class. Reflector uses XY; terrain uses the city's XZ plane. */
function fillGeometry(shapes: FloodShape[], possible: boolean): THREE.BufferGeometry | null {
  const pos: number[] = [];
  for (const poly of shapes) {
    if ((poly.kind === "possible") !== possible) continue;
    const [contour, ...holes] = poly.rings;
    if (!contour) continue;
    const tris = triangulate(contour, holes);
    if (!tris) continue;
    const all = poly.rings.flat();
    for (const t of tris)
      for (const i of t) {
        const [x, z] = all[i]!;
        pos.push(...(possible ? [x, 0.025, z] : [x, -z, 0]));
      }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** River water and terrain possibility are intentionally different materials and draw orders. */
export function createFloodLayer(
  water: unknown,
  floodEdges: unknown,
  frame: LocalFrame,
  boundary?: Boundary | null,
): {
  group: THREE.Group;
  ground: THREE.Group;
  update(seconds: number, rise?: number, fade?: number): void;
  dispose(): void;
} {
  const group = new THREE.Group();
  group.name = "flood";
  const ground = new THREE.Group();
  ground.name = "flood-ground";
  const shapes = floodShapes(water, frame, boundary);
  const riverGeo = fillGeometry(shapes, false);
  const river = riverGeo ? createRiverSurface(riverGeo) : null;
  if (river) {
    river.mesh.renderOrder = FLOOD_ORDER.fill;
    river.update(0);
    ground.add(river.mesh);
  }
  const terrainGeo = fillGeometry(shapes, true);
  if (terrainGeo) {
    const mat = new THREE.MeshBasicMaterial({
      color: statusStyle("flooded_possible").color,
      transparent: true,
      opacity: FLOOD_ALPHA,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -0.5,
      polygonOffsetUnits: -0.5,
      side: THREE.DoubleSide,
    });
    const terrain = new THREE.Mesh(terrainGeo, mat);
    terrain.name = "flood-fill-possible";
    terrain.renderOrder = 0; // roads (1–5) and buildings draw over the soft terrain fill
    ground.add(terrain);
    const points: number[] = [];
    for (const shape of shapes.filter((s) => s.kind === "possible"))
      for (const ring of shape.rings)
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]!;
          const b = ring[(i + 1) % ring.length]!;
          points.push(a[0], 0.035, a[1], b[0], 0.035, b[1]);
        }
    const outline = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(points, 3),
      ),
      new THREE.LineBasicMaterial({
        color: statusStyle("flooded_possible").color,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }),
    );
    outline.name = "flood-possible-outline";
    ground.add(outline);
  }

  if (floodEdges)
    for (const [status, edges] of groupEdgesByStatus(lineFeatures(floodEdges)))
      if (FLOODED.includes(status)) {
        const batch = createLineBatch(
          edges.map((e) => lineToLocal(e.coords, frame, 0)),
          statusLineStyle(status, 2),
          FLOOD_LIFT_M,
          FLOOD_ORDER.edges,
          edges.map((e) => e.id),
        );
        // Data: the shared picker names the edge by segment (within 8 px of the line).
        batch.userData.pick = { kind: "floodEdge" };
        group.add(batch);
      }

  return {
    group,
    ground,
    update(seconds, rise, fade) {
      river?.update(seconds, rise, fade);
    },
    dispose() {
      river?.dispose();
      for (const o of [...group.children, ...ground.children]) {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
        o.removeFromParent();
      }
    },
  };
}
