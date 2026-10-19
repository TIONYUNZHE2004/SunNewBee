import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import { boundaryOf, outsideBy, type P } from "./boundary";
import { clipPolygon } from "./clipPolygon";

const frame = createFrame([101.5, 3.18]);
const toLL = (pts: P[]): P[] => pts.map(([x, z]) => frame.toLonLat(x, z) as P);
const closed = (pts: P[]) => [...toLL(pts), toLL(pts)[0]!];
/** A local L shape (x, z): [-100, 100]^2 less the quadrant x > 0, z > 0. */
const L_LOCAL: P[] = [
  [-100, -100],
  [100, -100],
  [100, 0],
  [0, 0],
  [0, 100],
  [-100, 100],
];
const L = boundaryOf({ type: "Polygon", coordinates: [closed(L_LOCAL)] }, frame)!;

describe("clipPolygon", () => {
  const area = (r: P[]) => {
    let s = 0;
    for (let i = 0; i < r.length - 1; i++) s += r[i]![0] * r[i + 1]![1] - r[i + 1]![0] * r[i]![1];
    return Math.abs(s / 2);
  };
  const localArea = (polys: P[][][]) =>
    polys.reduce((s, p) => s + area(p[0]!.map(([lon, lat]) => frame.toLocal(lon, lat))), 0);

  it("keeps an inside polygon as it is and drops an outside one", () => {
    const inside = [
      toLL([
        [-90, -90],
        [-10, -90],
        [-10, -10],
        [-90, -10],
      ]),
    ];
    expect(clipPolygon(L, inside, frame)).toEqual([inside]);
    const outside = [
      toLL([
        [200, 200],
        [300, 200],
        [300, 300],
      ]),
    ];
    expect(clipPolygon(L, outside, frame)).toEqual([]);
  });
  it("cuts a crossing polygon to the outline (area and vertices)", () => {
    // A square over the whole L and beyond: the cut is the L itself (30000 m2).
    const big = [
      toLL([
        [-200, -200],
        [200, -200],
        [200, 200],
        [-200, 200],
      ]),
    ];
    const cut = clipPolygon(L, big, frame);
    expect(localArea(cut)).toBeCloseTo(30000, -1);
    for (const p of cut)
      for (const [lon, lat] of p[0]!) {
        const [x, z] = frame.toLocal(lon, lat);
        expect(outsideBy(L, x, z)).toBeLessThan(0.01);
      }
    // A band across the notch: two pieces.
    const band = [
      toLL([
        [-150, 40],
        [150, 40],
        [150, 60],
        [-150, 60],
      ]),
    ];
    const pieces = clipPolygon(L, band, frame);
    expect(localArea(pieces)).toBeCloseTo(2000, -1);
  });
});

describe("clipPolygon with an outline hole", () => {
  // A 400 m square outline with a 40 m hole in its middle, rotated 30 degrees (not axis-aligned).
  const rot = (pts: P[]): P[] => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    return pts.map(([x, z]) => [x * c - z * s, x * s + z * c]);
  };
  const sq = (h: number): P[] => [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
  const H = boundaryOf(
    { type: "Polygon", coordinates: [closed(rot(sq(200))), closed(rot(sq(20)))] },
    frame,
  )!;
  const area = (r: P[]) => {
    let s = 0;
    for (let i = 0; i < r.length - 1; i++) s += r[i]![0] * r[i + 1]![1] - r[i + 1]![0] * r[i]![1];
    return Math.abs(s / 2);
  };
  const localArea = (polys: P[][][]) =>
    polys.reduce(
      (s, p) =>
        s +
        area(p[0]!.map(([lon, lat]) => frame.toLocal(lon, lat))) -
        p.slice(1).reduce((h, r) => h + area(r.map(([lon, lat]) => frame.toLocal(lon, lat))), 0),
      0,
    );

  it("a polygon around the hole (no edge crossing) is cut, not kept whole", () => {
    const around = [closed(sq(60))];
    const cut = clipPolygon(H, around, frame);
    expect(localArea(cut)).toBeCloseTo(120 * 120 - 40 * 40, -1);
  });
  it("a polygon away from the hole is kept as it is", () => {
    const away = [
      closed([
        [100, 0],
        [140, 0],
        [140, 40],
        [100, 40],
      ]),
    ];
    expect(clipPolygon(H, away, frame)).toEqual([away]);
  });
});

describe("the Elmina seed outline", () => {
  it("has no holes and one polygon (the hole path above stays latent on the seed)", () => {
    const raw = JSON.parse(
      readFileSync(
        new URL("../../../../../../../data/seed/elmina/base/boundary.geojson", import.meta.url),
        "utf8",
      ),
    );
    const g = raw.features[0].geometry;
    expect(g.type).toBe("Polygon");
    expect(g.coordinates).toHaveLength(1);
  });
});
