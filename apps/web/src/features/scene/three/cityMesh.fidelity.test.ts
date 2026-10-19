import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../lib/api";
import { toBuildings } from "../shared/model";
import { BUILDING_BEVEL, bevelBody, buildCityGeometry, displayHeight, localRing } from "./cityMesh";
import { createFrame } from "./frame";
import { boundaryOf } from "./ground/boundary";
import { clipLayer } from "./ground/clipLayer";

/**
 * AC-B2 (fact fidelity under rounding), over every seed building in the Elmina boundary (the
 * clipLayer predicate, A-T4 ruling: every footprint vertex within 5 m of the inside). The bevelled
 * extrusion is measured from the drawn geometry itself, never from the generator's inputs:
 * - footprint area: the xz-projected area of the upward-facing triangles (roof cap plus the bevel
 *   bands, which together cover the drawn footprint exactly once) within ±2 % of the OSM ring;
 * - vertices: every drawn vertex lies inside the OSM outline or within 0.15 m of it, and every OSM
 *   vertex has a drawn vertex within 0.15 m;
 * - top: the highest drawn vertex within ±0.1 m of `display_height_m` (else `height_m`).
 */
const SEED = (p: string) => new URL(`../../../../../../data/seed/elmina/${p}`, import.meta.url);
const HAVE =
  existsSync(SEED("base/buildings.geojson")) && existsSync(SEED("base/boundary.geojson"));

type Pt = [number, number];

function inside(ring: Pt[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function distToRing(ring: Pt[], x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j]!;
    const [bx, bz] = ring[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

const ringArea = (r: Pt[]) =>
  Math.abs(
    r.reduce(
      (s, [x, z], i) => s + x * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * z,
      0,
    ),
  ) / 2;

describe.skipIf(!HAVE)("AC-B2: bevelled extrusions keep every seed building's facts", () => {
  const read = (p: string) => JSON.parse(readFileSync(SEED(p), "utf8"));
  const frame = createFrame(read("site.json").center);
  const boundary = boundaryOf(read("base/boundary.geojson").features[0].geometry, frame)!;
  const raw = { buildings: read("base/buildings.geojson") } as unknown as BuildingsLayer;
  const { layer } = clipLayer(raw, boundary, frame);
  // The OSM facts, straight from the seed (never from the generator).
  const osm = new Map(
    toBuildings(layer.buildings, displayHeight).buildings.map((b) => [b.id, b] as const),
  );

  it("every building in the boundary: area ±2 %, vertices ≤ 0.15 m, top ±0.1 m", () => {
    const g = buildCityGeometry(layer, frame);
    const pos = g.buildings.getAttribute("position");
    const { ids, starts } = g.faces;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    let worstArea = 0;
    let worstOut = 0;
    let worstCover = 0;
    let worstTop = 0;
    let bevelled = 0;
    const fails: string[] = [];
    ids.forEach((id, i) => {
      const fact = osm.get(id)!;
      let ring = localRing(fact.ring, frame)!;
      if (ringArea(ring) <= 0) ring = ring.reverse();
      const t0 = starts[i]!;
      const t1 = starts[i + 1] ?? pos.count / 3;
      let up = 0;
      let top = Number.NEGATIVE_INFINITY;
      let out = 0;
      let bands = 0;
      const xs: Pt[] = [];
      for (let t = t0; t < t1; t++) {
        a.fromBufferAttribute(pos, 3 * t);
        b.fromBufferAttribute(pos, 3 * t + 1);
        c.fromBufferAttribute(pos, 3 * t + 2);
        n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
        const proj = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
        if (n.y > 1e-6) up += proj;
        if (n.y > 0.05 && n.y < 0.99) bands++;
        for (const v of [a, b, c]) {
          top = Math.max(top, v.y);
          xs.push([v.x, v.z]);
          if (!inside(ring, v.x, v.z)) out = Math.max(out, distToRing(ring, v.x, v.z));
        }
      }
      let cover = 0;
      for (const [ox, oz] of ring) {
        let best = Number.POSITIVE_INFINITY;
        for (const [x, z] of xs) best = Math.min(best, Math.hypot(x - ox, z - oz));
        cover = Math.max(cover, best);
      }
      const area = ringArea(ring);
      const dA = Math.abs(up - area) / area;
      const dTop = Math.abs(top - fact.height);
      if (bands > 0) bevelled++;
      worstArea = Math.max(worstArea, dA);
      worstOut = Math.max(worstOut, out);
      worstCover = Math.max(worstCover, cover);
      worstTop = Math.max(worstTop, dTop);
      if (dA > 0.02 || out > 0.15 || cover > 0.15 || dTop > 0.1)
        fails.push(
          `${id} dA=${dA.toFixed(4)} out=${out.toFixed(3)} cover=${cover.toFixed(3)} dTop=${dTop.toFixed(3)}`,
        );
    });
    // Every building in the boundary is drawn (none skipped for the bevel) and checked.
    expect(ids.length).toBe(osm.size - g.skipped);
    expect(g.skipped).toBe(0);
    expect(ids.length).toBeGreaterThan(1000);
    // Rounded: almost every building carries bevel bands (tiny or very thin ones may stay square).
    expect(bevelled / ids.length).toBeGreaterThan(0.95);
    expect(fails.slice(0, 10)).toEqual([]);
    // Measured worst values (round 0): area 0.445 %, outside 0.000 m, OSM vertex 0.140 m, top 0 m.
    expect(worstArea).toBeLessThan(0.02);
    expect(worstOut).toBeLessThanOrEqual(0.15);
    expect(worstCover).toBeLessThanOrEqual(BUILDING_BEVEL.chamferM + 1e-3);
    expect(worstTop).toBeLessThanOrEqual(0.1);
    expect(pos.count / 3).toBeLessThan(160_000);
  });

  it("most buildings get the full 0.5 m radius (the rounding reads at the street bookmark)", () => {
    const radii = [...osm.values()].map((b) => {
      let ring = localRing(b.ring, frame)!;
      if (ringArea(ring) <= 0) ring = ring.reverse();
      return bevelBody(ring, b.height - b.minHeight, BUILDING_BEVEL)?.radius ?? 0;
    });
    const full = radii.filter((r) => r >= 0.499).length / radii.length;
    const some = radii.filter((r) => r >= 0.2).length / radii.length;
    expect(full).toBeGreaterThan(0.8);
    expect(some).toBeGreaterThan(0.95);
  });

  // Measured on the seed (2,421 buildings in the boundary, all extruded: the keyless upper bound;
  // with assets most become instanced archetypes): flat 26,973, bevelled 139,883 (2 segments; 1
  // segment would be 98,533). A merged static mesh of 140 k triangles is far below one archetype
  // LOD0 tile, so the bevel segments are not LODed by distance.
  it("triangle budget: the whole bevelled seed stays under 160 k triangles (Medium: one segment, fewer)", () => {
    const flat =
      buildCityGeometry(layer, frame, { bevel: false }).buildings.getAttribute("position").count /
      3;
    const round = buildCityGeometry(layer, frame).buildings.getAttribute("position").count / 3;
    expect(round).toBeLessThan(160_000);
    expect(round / flat).toBeLessThan(5.5);
    const medium =
      buildCityGeometry(layer, frame, { bevel: { segments: 1 } }).buildings.getAttribute("position")
        .count / 3;
    expect(medium).toBeLessThan(round);
    expect(medium).toBeLessThan(110_000);
  });
});
