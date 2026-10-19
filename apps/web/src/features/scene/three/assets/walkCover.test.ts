import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import { buildWalkIndex, WALK_COVER_MARGIN_M, walkCoverPoint, walkIndexOf } from "./walkCover";

type Pt = [number, number];
const frame = createFrame([101.5, 3.18]);
const line = (...pts: Pt[]) => ({
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates: pts.map(([x, z]) => frame.toLonLat(x, z)) },
});
const fc = (...features: unknown[]) => ({ type: "FeatureCollection", features });
const rect = (x0: number, z0: number, x1: number, z1: number): Pt[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];

describe("walkCoverPoint (9.1 F1)", () => {
  const box = rect(0, 0, 20, 10);

  it("finds a walk edge under the drawn box that the outline does not cover", () => {
    const walk = buildWalkIndex(fc(line([15, -5], [15, 15])), frame);
    // the outline is the left half only: the path at x = 15 is outside it
    const p = walkCoverPoint([box], [rect(0, 0, 10, 10)], walk);
    expect(p).not.toBeNull();
    expect(p![0]).toBeCloseTo(15, 3);
    expect(p![1]).toBeGreaterThan(WALK_COVER_MARGIN_M - 1e-6);
  });

  it("ignores a walk edge inside the outline (a passage through the building)", () => {
    const walk = buildWalkIndex(fc(line([5, -5], [5, 15])), frame);
    expect(walkCoverPoint([box], [rect(0, 0, 10, 10)], walk)).toBeNull();
  });

  it("ignores walk edges outside the drawn box, or within the margin of its edge", () => {
    const walk = buildWalkIndex(
      fc(line([-5, 12], [30, 12]), line([-5, 10.3], [30, 10.3]), line([25, -5], [25, 15])),
      frame,
    );
    expect(walkCoverPoint([box], [rect(0, 0, 10, 10)], walk)).toBeNull();
  });

  it("ignores a footway hugging the outline within the margin", () => {
    const walk = buildWalkIndex(fc(line([10.3, -5], [10.3, 15])), frame);
    expect(walkCoverPoint([box], [rect(0, 0, 10, 10)], walk)).toBeNull();
  });

  it("works for a rotated box with either winding", () => {
    const c = Math.SQRT1_2;
    const rot = (r: Pt[]): Pt[] => r.map(([x, z]) => [x * c - z * c, x * c + z * c]);
    const walk = buildWalkIndex(
      fc(
        line(
          ...rot([
            [15, -5],
            [15, 15],
          ]),
        ),
      ),
      frame,
    );
    const drawn = rot(box);
    expect(walkCoverPoint([drawn], [rot(rect(0, 0, 10, 10))], walk)).not.toBeNull();
    expect(walkCoverPoint([[...drawn].reverse()], [rot(rect(0, 0, 10, 10))], walk)).not.toBeNull();
    expect(walkCoverPoint([drawn], [drawn], walk)).toBeNull();
  });

  it("indexes MultiLineStrings and skips points and polygons; memoised per layer and frame", () => {
    const layer = fc(
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "MultiLineString",
          coordinates: [
            [frame.toLonLat(0, 0), frame.toLonLat(10, 0)],
            [frame.toLonLat(0, 5), frame.toLonLat(0, 9)],
          ],
        },
      },
      { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [101.5, 3.18] } },
    );
    const idx = walkIndexOf(layer, frame)!;
    expect(idx.segs).toHaveLength(2);
    expect(walkIndexOf(layer, frame)).toBe(idx);
    expect(walkIndexOf(null, frame)).toBeNull();
  });
});
