import * as Cesium from "cesium";
import { describe, expect, it } from "vitest";
import { buildMesh, enuBasis, type Triangulate } from "./buildingsMesh";
import type { Building } from "./model";

// The same triangulation path the shipped code uses (buildingsPrimitive.ts).
const triangulate: Triangulate = (xy) => {
  const pts: Cesium.Cartesian2[] = [];
  for (let i = 0; i + 1 < xy.length; i += 2) pts.push(new Cesium.Cartesian2(xy[i], xy[i + 1]));
  return Cesium.PolygonPipeline.triangulate(pts);
};

const LON = 101.51;
const LAT = 3.18;
const M = 1 / 111_320; // degrees per metre (north)
const KX = Math.cos((LAT * Math.PI) / 180);
/** Footprint from local metres [x, y] (east, north). */
const fromMetres = (pts: [number, number][]): [number, number][] => {
  const r = pts.map(([x, y]) => [LON + (x * M) / KX, LAT + y * M] as [number, number]);
  return [...r, r[0]!];
};

const L_SHAPE: [number, number][] = [
  [0, 0],
  [30, 0],
  [30, 10],
  [10, 10],
  [10, 30],
  [0, 30],
]; // area 500
const U_SHAPE: [number, number][] = [
  [0, 0],
  [30, 0],
  [30, 30],
  [20, 30],
  [20, 10],
  [10, 10],
  [10, 30],
  [0, 30],
]; // area 900 - 10*20 = 700

function building(pts: [number, number][]): Building {
  return {
    id: "c",
    ring: fromMetres(pts),
    height: 10,
    minHeight: 0,
    kind: "building",
    tone: "warm",
    floors: 3,
    perimeterM: 100,
    cols: 20,
    litSeed: 0.3,
  };
}

function polyArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j]![0] * pts[i]![1] - pts[i]![0] * pts[j]![1];
  }
  return Math.abs(a) / 2;
}

/** Roof triangles (t === -1) projected to local metres. */
function roofTriangles(pts: [number, number][]) {
  const b = building(pts);
  const mesh = buildMesh([b], triangulate);
  const { east, north } = enuBasis(b.ring[0]![0], b.ring[0]![1]);
  const local = (vi: number): [number, number] => {
    const p = [0, 1, 2].map((c) => mesh.positions[vi * 3 + c]!);
    const o = (() => {
      // vertex 0 of the roof fan shares ring[0]; find it via lowest-index roof vertex
      const first = [...Array(mesh.st.length / 2).keys()].find((i) => mesh.st[i * 2 + 1] === -1)!;
      return [0, 1, 2].map((c) => mesh.positions[first * 3 + c]!);
    })();
    const d = [p[0]! - o[0]!, p[1]! - o[1]!, p[2]! - o[2]!];
    const dot = (v: readonly number[]) => d[0]! * v[0]! + d[1]! * v[1]! + d[2]! * v[2]!;
    return [dot(east), dot(north)];
  };
  const tris: [number, number][][] = [];
  for (let q = 0; q < mesh.indices.length; q += 3) {
    const idx = [0, 1, 2].map((o) => mesh.indices[q + o]!);
    if (idx.every((i) => mesh.st[i * 2 + 1] === -1)) tris.push(idx.map(local));
  }
  return { tris, mesh };
}

const triArea = (t: [number, number][]) =>
  Math.abs(
    (t[1]![0] - t[0]![0]) * (t[2]![1] - t[0]![1]) - (t[1]![1] - t[0]![1]) * (t[2]![0] - t[0]![0]),
  ) / 2;

function inside(x: number, y: number, ring: [number, number][]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

describe.each([
  ["L-shape", L_SHAPE],
  ["U-shape", U_SHAPE],
])("concave footprint %s through the real PolygonPipeline", (_n, pts) => {
  it("roof triangles tile the polygon exactly (areas sum, none outside)", () => {
    const { tris } = roofTriangles(pts);
    expect(tris.length).toBe(pts.length - 2);
    const sum = tris.reduce((s, t) => s + triArea(t), 0);
    // The ECEF projection used here differs from the mesh's flat 111,320 m/deg by < 1%.
    expect(Math.abs(sum - polyArea(pts)) / polyArea(pts)).toBeLessThan(0.015);
    for (const t of tris) {
      const cx = (t[0]![0] + t[1]![0] + t[2]![0]) / 3;
      const cy = (t[0]![1] + t[1]![1] + t[2]![1]) / 3;
      expect(inside(cx, cy, pts)).toBe(true);
    }
  });

  it("every roof triangle faces up", () => {
    const { tris } = roofTriangles(pts);
    for (const t of tris) {
      const cross =
        (t[1]![0] - t[0]![0]) * (t[2]![1] - t[0]![1]) -
        (t[1]![1] - t[0]![1]) * (t[2]![0] - t[0]![0]);
      expect(cross).toBeGreaterThan(0);
    }
  });
});
