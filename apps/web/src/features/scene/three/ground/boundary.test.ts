import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import {
  allWithin,
  boundaryOf,
  CLIP_TOLERANCE_M,
  clearance,
  clipLine,
  clipPolygon,
  clipToBoundary,
  edgeDistance,
  insideBoundary,
  outsideBy,
  type P,
} from "./boundary";

const frame = createFrame([101.5, 3.18]);
/** A local square [-100, 100]^2 (x, z) with a notch: an L shape, given in lon/lat. */
const L_LOCAL: P[] = [
  [-100, -100],
  [100, -100],
  [100, 0],
  [0, 0],
  [0, 100],
  [-100, 100],
];
const toLL = (pts: P[]): P[] => pts.map(([x, z]) => frame.toLonLat(x, z) as P);
const L = boundaryOf(
  { type: "Polygon", coordinates: [[...toLL(L_LOCAL), toLL(L_LOCAL)[0]!]] },
  frame,
)!;

describe("boundaryOf", () => {
  it("reads a Polygon and a MultiPolygon, rejects other geometry", () => {
    expect(L.polys).toHaveLength(1);
    expect(L.polys[0]![0]).toHaveLength(6);
    const multi = boundaryOf(
      { type: "MultiPolygon", coordinates: [[toLL(L_LOCAL)], [toLL(L_LOCAL)]] },
      frame,
    );
    expect(multi?.polys).toHaveLength(2);
    expect(boundaryOf({ type: "Point", coordinates: [0, 0] }, frame)).toBeNull();
    expect(boundaryOf(null, frame)).toBeNull();
    expect(L.box.map((v) => Math.round(v))).toEqual([-100, -100, 100, 100]);
  });
});

describe("point tests (local frame)", () => {
  it("inside / outside the L, including the notch", () => {
    expect(insideBoundary(L, -50, -50)).toBe(true);
    expect(insideBoundary(L, 50, -50)).toBe(true);
    expect(insideBoundary(L, -50, 50)).toBe(true);
    expect(insideBoundary(L, 50, 50)).toBe(false); // the notch
    expect(insideBoundary(L, 150, 0)).toBe(false);
  });
  it("distances", () => {
    expect(edgeDistance(L, -50, -50)).toBeCloseTo(50, 3);
    expect(outsideBy(L, -50, -50)).toBe(0);
    expect(outsideBy(L, 103, -50)).toBeCloseTo(3, 3);
    expect(clearance(L, 103, -50)).toBeCloseTo(-3, 3);
    expect(clearance(L, 90, -50)).toBeCloseTo(10, 3);
    expect(outsideBy(L, 50, 50)).toBeCloseTo(50, 3);
  });
  it("allWithin honours the tolerance", () => {
    expect(
      allWithin(
        L,
        [
          [-50, -50],
          [104, -50],
        ],
        CLIP_TOLERANCE_M,
      ),
    ).toBe(true);
    expect(
      allWithin(
        L,
        [
          [-50, -50],
          [106, -50],
        ],
        CLIP_TOLERANCE_M,
      ),
    ).toBe(false);
    expect(allWithin(L, [[104, -50]])).toBe(false);
  });
});

describe("clipToBoundary", () => {
  it("keeps items with every point within the tolerance and counts the rest", () => {
    const items = [
      { id: "in", pts: [[-10, -10] as P] },
      { id: "edge", pts: [[-10, -10] as P, [103, -10] as P] },
      { id: "notch", pts: [[50, 50] as P] },
    ];
    const r = clipToBoundary(items, (i) => i.pts, L, CLIP_TOLERANCE_M);
    expect(r.kept.map((i) => i.id)).toEqual(["in", "edge"]);
    expect(r.dropped).toBe(1);
    expect(clipToBoundary(items, (i) => i.pts, null).kept).toHaveLength(3);
  });
});

describe("clipLine", () => {
  it("cuts a line at the crossings and keeps the inside runs", () => {
    // From the left lobe, across the notch, into the bottom lobe... as one line along z = 50 then x = 50.
    const runs = clipLine(L, [
      [-150, 50],
      [150, 50],
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]![0]![0]).toBeCloseTo(-100, 6);
    expect(runs[0]![1]![0]).toBeCloseTo(0, 6);
    const two = clipLine(L, [
      [-50, 150],
      [-50, -50],
      [50, -50],
      [50, 150],
    ]);
    expect(two).toHaveLength(1);
    expect(two[0]![0]![1]).toBeCloseTo(100, 6);
    expect(two[0]![two[0]!.length - 1]![1]).toBeCloseTo(0, 6);
    expect(
      clipLine(L, [
        [200, 200],
        [300, 300],
      ]),
    ).toEqual([]);
  });
});

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

describe("the Elmina seed outline", () => {
  const raw = JSON.parse(
    readFileSync(
      new URL("../../../../../../../data/seed/elmina/base/boundary.geojson", import.meta.url),
      "utf8",
    ),
  );
  const site = JSON.parse(
    readFileSync(
      new URL("../../../../../../../data/seed/elmina/site.json", import.meta.url),
      "utf8",
    ),
  );
  const f = createFrame(site.center);
  const b = boundaryOf(raw.features[0].geometry, f)!;
  it("contains Harmoni 1 / Urban Park and excludes a far point", () => {
    const [hx, hz] = f.toLocal(101.5095, 3.1805);
    expect(insideBoundary(b, hx, hz)).toBe(true);
    expect(insideBoundary(b, 20000, 0)).toBe(false);
  });
});
