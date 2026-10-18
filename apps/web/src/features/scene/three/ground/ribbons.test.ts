import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import { ribbonsFromWalk } from "./ribbons";

const frame = createFrame([101.5, 3.18]);
const lonAt = (eastM: number) => frame.toLonLat(eastM, 0)[0];
const latAt = (northM: number) => frame.toLonLat(0, -northM)[1];

const line = (type: string, pts: [number, number][]): GeoJSON.Feature => ({
  type: "Feature",
  properties: { type },
  geometry: { type: "LineString", coordinates: pts.map(([e, n]) => [lonAt(e), latAt(n)]) },
});
const fc = (...f: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: f,
});
const extent = (p: Float32Array, axis: 0 | 2) => {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = axis; i < p.length; i += 3) {
    lo = Math.min(lo, p[i]!);
    hi = Math.max(hi, p[i]!);
  }
  return hi - lo;
};
const ys = (p: Float32Array) =>
  new Set(Array.from({ length: p.length / 3 }, (_, i) => Math.round(p[i * 3 + 1]! * 1e5) / 1e5));
type R = ReturnType<typeof ribbonsFromWalk>;
const road = (r: R) => r.filter((x) => !x.marking);

describe("ribbonsFromWalk", () => {
  it("a straight 100 m street is a 6 m ribbon at y 0.08", () => {
    const r = road(
      ribbonsFromWalk(
        fc(
          line("street", [
            [0, 0],
            [100, 0],
          ]),
        ),
        frame,
      ),
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe("residential");
    expect(extent(r[0]!.positions, 2)).toBeCloseTo(6, 2);
    expect(extent(r[0]!.positions, 0)).toBeCloseTo(100, 1);
    expect([...ys(r[0]!.positions)]).toEqual([0.08]);
  });

  it("a major road is 10 m wide and has dashed markings at y 0.10", () => {
    const all = ribbonsFromWalk(
      fc(
        line("major_road", [
          [0, 0],
          [100, 0],
        ]),
      ),
      frame,
    );
    expect(extent(road(all)[0]!.positions, 2)).toBeCloseTo(10, 2);
    const marks = all.filter((x) => x.marking);
    expect(marks).toHaveLength(1);
    expect([...ys(marks[0]!.positions)]).toEqual([0.1]);
    expect(marks[0]!.positions.length / 12).toBeGreaterThan(5); // several dashes
  });

  it("a footway is 2.5 m, an unknown type 3 m, and neither gets markings", () => {
    const all = ribbonsFromWalk(
      fc(
        line("footway", [
          [0, 0],
          [50, 0],
        ]),
        line("mystery", [
          [0, 20],
          [50, 20],
        ]),
      ),
      frame,
    );
    expect(all.some((x) => x.marking)).toBe(false);
    expect(extent(all.find((x) => x.kind === "footway")!.positions, 2)).toBeCloseTo(2.5, 2);
    expect(extent(all.find((x) => x.kind === "other")!.positions, 2)).toBeCloseTo(3, 2);
  });

  it("every triangle faces up", () => {
    const r = road(
      ribbonsFromWalk(
        fc(
          line("street", [
            [0, 0],
            [30, 0],
            [30, 30],
          ]),
        ),
        frame,
      ),
    )[0]!;
    const p = r.positions;
    expect(r.indices.length).toBeGreaterThan(0);
    for (let t = 0; t < r.indices.length; t += 3) {
      const [a, b, c] = [r.indices[t]!, r.indices[t + 1]!, r.indices[t + 2]!];
      const ux = p[b * 3]! - p[a * 3]!;
      const uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
      const vx = p[c * 3]! - p[a * 3]!;
      const vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
      expect(uz * vx - ux * vz).toBeGreaterThan(0);
    }
  });

  it("a 90 degree bend's mitre stays within 2 x width of the corner", () => {
    const r = road(
      ribbonsFromWalk(
        fc(
          line("street", [
            [0, 0],
            [50, 0],
            [50, 50],
          ]),
        ),
        frame,
      ),
    )[0]!;
    const [cx, cz] = frame.toLocal(lonAt(50), latAt(0));
    const p = r.positions;
    let atCorner = 0;
    for (let i = 0; i < p.length; i += 3) {
      const d = Math.hypot(p[i]! - cx, p[i + 2]! - cz);
      if (d < 6) atCorner = Math.max(atCorner, d);
    }
    expect(atCorner).toBeGreaterThan(2.9); // the corner pair exists (half width 3)
    expect(atCorner).toBeLessThanOrEqual(12);
  });

  it("a hairpin does not spike beyond the cap", () => {
    const r = road(
      ribbonsFromWalk(
        fc(
          line("street", [
            [0, 0],
            [50, 0],
            [0, 1],
          ]),
        ),
        frame,
      ),
    )[0]!;
    const [cx, cz] = frame.toLocal(lonAt(50), latAt(0));
    for (let i = 0; i < r.positions.length; i += 3)
      expect(Math.hypot(r.positions[i]! - cx, r.positions[i + 2]! - cz)).toBeLessThan(60);
    const vx = Array.from({ length: r.positions.length / 3 }, (_, i) => r.positions[i * 3]!);
    expect(Math.max(...vx) - 50).toBeLessThanOrEqual(12);
  });

  it("clipRadiusM drops segments outside the radius", () => {
    const near = line("street", [
      [0, 0],
      [100, 0],
    ]);
    const far = line("street", [
      [5000, 0],
      [5100, 0],
    ]);
    const centre = frame.toLonLat(50, 0);
    const kept = road(
      ribbonsFromWalk(fc(near, far), frame, { clipCentre: centre, clipRadiusM: 1200 }),
    );
    expect(kept).toHaveLength(1);
    expect(extent(kept[0]!.positions, 0)).toBeCloseTo(100, 1);
    expect(
      road(ribbonsFromWalk(fc(far), frame, { clipCentre: centre, clipRadiusM: 1200 })),
    ).toHaveLength(0);
  });

  it("ignores non-lines and degenerate lines", () => {
    const bad: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [101.5, 3.18] },
    };
    const same = line("street", [
      [0, 0],
      [0, 0],
    ]);
    expect(ribbonsFromWalk(fc(bad, same), frame)).toEqual([]);
  });
});
