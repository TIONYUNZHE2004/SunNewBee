import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import { type Box, boxAround } from "../stream/area";
import { RIBBON_MARGIN_M, ribbonsFromWalk } from "./ribbons";

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

  it("an area drops segments outside its box (the P3 circle as a 2,400 m box)", () => {
    const near = line("street", [
      [0, 0],
      [100, 0],
    ]);
    const far = line("street", [
      [5000, 0],
      [5100, 0],
    ]);
    const [cx, cz] = frame.toLocal(...frame.toLonLat(50, 0));
    const area = { box: boxAround(cx, cz, 1200), seed: "t" };
    const kept = road(ribbonsFromWalk(fc(near, far), frame, { area }));
    expect(kept).toHaveLength(1);
    expect(extent(kept[0]!.positions, 0)).toBeCloseTo(100, 1);
    expect(road(ribbonsFromWalk(fc(far), frame, { area }))).toHaveLength(0);
  });

  describe("per tile box", () => {
    /** Centre of every strip quad (l0, r0, l1, r1), rounded to 1 cm, and its centreline length. */
    const quads = (rs: R) => {
      const out: { key: string; len: number }[] = [];
      for (const r of rs) {
        const p = r.positions;
        const v = (i: number) => [p[i * 3]!, p[i * 3 + 2]!] as const;
        for (let t = 0; t < r.indices.length; t += 6) {
          const [l0, r0, l1] = [r.indices[t]!, r.indices[t + 1]!, r.indices[t + 2]!];
          const r1 = r.indices[t + 4]!;
          const pts = [v(l0), v(r0), v(l1), v(r1)];
          const cx = pts.reduce((a, q) => a + q[0], 0) / 4;
          const cz = pts.reduce((a, q) => a + q[1], 0) / 4;
          const a = [(pts[0]![0] + pts[1]![0]) / 2, (pts[0]![1] + pts[1]![1]) / 2];
          const b = [(pts[2]![0] + pts[3]![0]) / 2, (pts[2]![1] + pts[3]![1]) / 2];
          out.push({
            key: `${r.kind}:${!!r.marking}:${cx.toFixed(2)},${cz.toFixed(2)}`,
            len: Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!),
          });
        }
      }
      return out;
    };
    // A long major road crossing the shared edge x = 0 in one 400 m segment, a bent street
    // crossing both edges, and a footway lying exactly on the edge z = 0.
    const walk = fc(
      line("major_road", [
        [-200, 37],
        [200, 41],
      ]),
      line("street", [
        [-180, -150],
        [-3, -2],
        [4, 3],
        [150, 190],
      ]),
      line("footway", [
        [-100, 0],
        [100, 0],
      ]),
    );
    const Q: Box[] = [
      { x0: -250, z0: -250, x1: 0, z1: 0 },
      { x0: 0, z0: -250, x1: 250, z1: 0 },
      { x0: -250, z0: 0, x1: 0, z1: 250 },
      { x0: 0, z0: 0, x1: 250, z1: 250 },
    ];
    const tiles = Q.map((box) => ribbonsFromWalk(walk, frame, { area: { box, seed: "t" } }));

    it("adjacent tiles never draw the same segment", () => {
      const keys = tiles.flatMap((t) => quads(t).map((q) => q.key));
      expect(keys.length).toBeGreaterThan(10);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("and leave no gap: the tiles' road length is the whole road length", () => {
      const roadLen = (rs: R[]) => rs.flatMap((t) => quads(road(t))).reduce((a, q) => a + q.len, 0);
      const whole = roadLen([ribbonsFromWalk(walk, frame)]);
      expect(roadLen(tiles)).toBeCloseTo(whole, 0);
      const markLen = (rs: R[]) =>
        rs.flatMap((t) => quads(t.filter((x) => x.marking))).reduce((a, q) => a + q.len, 0);
      expect(markLen(tiles)).toBeCloseTo(markLen([ribbonsFromWalk(walk, frame)]), 0);
    });

    it(`a tile's ribbons reach at most ${RIBBON_MARGIN_M} m past its box (plus the half width)`, () => {
      tiles.forEach((t, i) => {
        const b = Q[i]!;
        const m = RIBBON_MARGIN_M + 5 * 2; // margin plus a capped mitre of the 10 m major road
        for (const r of t)
          for (let k = 0; k < r.positions.length; k += 3) {
            const x = r.positions[k]!;
            const z = r.positions[k + 2]!;
            expect(x >= b.x0 - m && x <= b.x1 + m && z >= b.z0 - m && z <= b.z1 + m).toBe(true);
          }
      });
      // Not vacuous: the 400 m major road segment (local z about -40) is split, so the west and
      // the east tile both draw a part of it.
      const [w, e] = [tiles[0]!, tiles[1]!].map((t) => t.some((r) => r.kind === "major"));
      expect(w && e).toBe(true);
    });
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
