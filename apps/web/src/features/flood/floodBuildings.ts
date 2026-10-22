import type { Polygon } from "polygon-clipping";
import * as pcModule from "polygon-clipping";
import * as THREE from "three";
import type { LonLat } from "../scene/geo";
import { displayHeight, localRing } from "../scene/three/cityMesh";
import type { LocalFrame } from "../scene/three/frame";
import type { P } from "../scene/three/ground/boundary";
import type { FloodShape } from "./floodPresentation";

const pc = (pcModule as unknown as { default?: typeof pcModule }).default ?? pcModule;
const close = (r: P[]) => [...r, r[0]!];
const bounds = (rings: P[][]) => {
  const p = rings.flat();
  return [
    Math.min(...p.map((p) => p[0])),
    Math.min(...p.map((p) => p[1])),
    Math.max(...p.map((p) => p[0])),
    Math.max(...p.map((p) => p[1])),
  ] as const;
};
const overlaps = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

export interface FloodBuilding {
  id: string;
  rings: P[][];
  centre: P;
  height: number;
  area: number;
}

/** Display intersection, never a tool classification of the building or a local water depth.
 * Full rings (including courtyards) are tested against river evidence; terrain cannot tag a building. */
export function floodBuildingHits(
  buildings: unknown,
  shapes: FloodShape[],
  frame: LocalFrame,
): FloodBuilding[] {
  const water = shapes
    .filter((s) => s.kind === "likely_flooded")
    .map((s) => ({ polygon: s.rings.map(close) as Polygon, box: bounds(s.rings) }));
  const features = (buildings as { features?: GeoJSON.Feature[] } | null)?.features ?? [];
  const hits: FloodBuilding[] = [];
  for (const feature of features) {
    const g = feature.geometry;
    const polygons =
      g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const coordinates of polygons) {
      const raw = coordinates.map((r) => localRing(r as LonLat[], frame));
      if (!raw.length || raw.some((r) => !r || r.length < 3)) continue;
      const rings = raw as P[][];
      const box = bounds(rings);
      const polygon = rings.map(close) as Polygon;
      let area = 0;
      for (const candidate of water) {
        if (!overlaps(box, candidate.box)) continue;
        try {
          for (const p of pc.intersection(polygon, candidate.polygon)) {
            const ringArea = (r: P[]) =>
              Math.abs(r.slice(1).reduce((a, b, i) => a + r[i]![0] * b[1] - b[0] * r[i]![1], 0)) /
              2;
            area += ringArea(p[0] as P[]) - p.slice(1).reduce((a, r) => a + ringArea(r as P[]), 0);
          }
        } catch {
          /* Invalid footprint: omit its claim. */
        }
      }
      if (area <= 0) continue;
      const props = feature.properties ?? {};
      const height = Number(displayHeight(props));
      hits.push({
        id: String(props.id ?? feature.id ?? hits.length),
        rings,
        centre: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2],
        height: Number.isFinite(height) && height > 0 ? height : 9,
        area,
      });
    }
  }
  // Keep the story in the deep spot near the site centre, favouring a substantial footprint.
  return hits.sort(
    (a, b) =>
      b.area / (1 + Math.hypot(...b.centre) / 250) ** 2 -
        a.area / (1 + Math.hypot(...a.centre) / 250) ** 2 || a.id.localeCompare(b.id),
  );
}

/** Thin blue annotation at each reached building's base; its height has no depth meaning. */
export function createBuildingBands(hits: FloodBuilding[]) {
  const positions: number[] = [];
  for (const hit of hits)
    for (const ring of hit.rings)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        positions.push(
          a[0],
          0.1,
          a[1],
          b[0],
          0.1,
          b[1],
          b[0],
          1.2,
          b[1],
          a[0],
          0.1,
          a[1],
          b[0],
          1.2,
          b[1],
          a[0],
          1.2,
          a[1],
        );
      }
  const geometry = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  const material = new THREE.MeshBasicMaterial({
    color: "#40b9ef",
    transparent: true,
    opacity: 0.7,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "indicative-flood-building-bands";
  mesh.renderOrder = 9;
  group.add(mesh);
  return {
    group,
    dispose() {
      geometry.dispose();
      material.dispose();
      group.removeFromParent();
    },
  };
}
