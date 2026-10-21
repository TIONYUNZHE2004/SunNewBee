import { describe, expect, it } from "vitest";
import { createPathBuilder, offsetLeft, type P } from "./walkPath";

/**
 * A4w review fix round 1: direct tests of the lane-offset geometry that the bicycle kerb lane
 * (AC-L6) needed. `offsetLeft` mitres interior vertices (up to 2x, a 120 deg turn), and the path
 * builder joins legs too short for a fillet at the offset lines' crossing (a mitre corner) instead
 * of a chord that the cusp drop would pull toward the centre line.
 */
const deg = (d: number) => (d * Math.PI) / 180;
const dir = (a: number): P => [Math.sin(a), Math.cos(a)];
const segYaw = (a: P, b: P) => Math.atan2(b[0] - a[0], b[1] - a[1]);
const wrapPi = (v: number) => v - 2 * Math.PI * Math.floor((v + Math.PI) / (2 * Math.PI));
/** The path builder's cusp threshold (walkPath CUSP_RAD). */
const CUSP = deg(100);

/** Unsigned distance from a point to the infinite line through a-b. */
function lineDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  return Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / Math.hypot(dx, dz);
}
/** Distance from a point to a polyline (segments). */
function polyDist(p: P, pts: P[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] as P;
    const b = pts[i + 1] as P;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    const t =
      l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t));
  }
  return best;
}
/** A centre line: `len` metres heading `h0`, then turning by `turn` (positive = right) for `len2`. */
function bend(h0: number, turn: number, len: number, len2: number): [P[], P[]] {
  const n: P = [0, 0];
  const d0 = dir(h0);
  const d1 = dir(h0 + turn);
  return [
    [[-d0[0] * len, -d0[1] * len], n],
    [n, [d1[0] * len2, d1[1] * len2]],
  ];
}

describe("offsetLeft: mitred interior vertices", () => {
  for (const t of [60, 90, 120, -60, -90, -120])
    it(`a ${t} deg bend keeps both offset segments exactly d from their centre segments`, () => {
      const [a, b] = bend(deg(30), deg(t), 20, 20);
      const centre: P[] = [a[0] as P, a[1] as P, b[1] as P];
      for (const d of [1.5, 2.3, -2.3]) {
        const o = offsetLeft(centre, d);
        for (let i = 0; i < 2; i++)
          for (const p of [o[i] as P, o[i + 1] as P])
            expect(lineDist(p, centre[i] as P, centre[i + 1] as P)).toBeCloseTo(Math.abs(d), 6);
      }
    });
  it("a sharper bend is clipped at a 2x mitre; the ends are never stretched; a zero segment adds no mitre", () => {
    const [a, b] = bend(0, deg(160), 20, 20);
    const centre: P[] = [a[0] as P, a[1] as P, b[1] as P];
    const o = offsetLeft(centre, 2);
    expect(Math.hypot((o[1] as P)[0], (o[1] as P)[1])).toBeCloseTo(4, 6);
    expect(lineDist(o[0] as P, centre[0] as P, centre[1] as P)).toBeCloseTo(2, 6);
    expect(lineDist(o[2] as P, centre[1] as P, centre[2] as P)).toBeCloseTo(2, 6);
    const dup = offsetLeft(
      [
        [0, 0],
        [0, 10],
        [0, 10],
        [0, 20],
      ],
      2,
    );
    for (const p of dup) expect(Math.abs(p[0])).toBeCloseTo(2, 6);
  });
});

describe("path builder: short legs meet at a mitre corner; no join cuts toward the centre line", () => {
  let mitred = 0;
  for (const t of [60, 75, 90, 105, 120])
    for (const side of [1, -1])
      for (const [lenA, lenB] of [
        [3, 3],
        [3, 4],
        [5, 2.5],
        // long legs take the fillet branch: it keeps the lane too (inside and outside corners)
        [20, 20],
      ] as const)
        it(`${side * t} deg turn, legs ${lenA} m + ${lenB} m: no heading flip, lane >= 0.9 d from the centre line`, () => {
          const d = 1.5;
          const [a, b] = bend(deg(10), side * deg(t), lenA, lenB);
          const builder = createPathBuilder({ fillet: 4 });
          expect(builder.add({ pts: a, off: d })).not.toBe(0);
          builder.add({ pts: b, off: d, node: [0, 0] });
          const { pts } = builder.result();
          const centre: P[] = [a[0] as P, [0, 0], b[1] as P];
          for (let i = 1; i < pts.length - 1; i++) {
            const turn = wrapPi(
              segYaw(pts[i] as P, pts[i + 1] as P) - segYaw(pts[i - 1] as P, pts[i] as P),
            );
            expect(Math.abs(turn), `vertex ${i}`).toBeLessThanOrEqual(CUSP);
          }
          for (const p of pts)
            expect(
              polyDist(p, centre),
              `(${p[0].toFixed(2)}, ${p[1].toFixed(2)})`,
            ).toBeGreaterThanOrEqual(0.9 * d);
          // the mitre corner: the crossing of the two offset lines is a path vertex
          const oa = offsetLeft(a, d);
          const ob = offsetLeft(b, d);
          const ua: P = [(oa[1] as P)[0] - (oa[0] as P)[0], (oa[1] as P)[1] - (oa[0] as P)[1]];
          const ub: P = [(ob[1] as P)[0] - (ob[0] as P)[0], (ob[1] as P)[1] - (ob[0] as P)[1]];
          const den = ua[0] * ub[1] - ua[1] * ub[0];
          const w: P = [(ob[0] as P)[0] - (oa[0] as P)[0], (ob[0] as P)[1] - (oa[0] as P)[1]];
          const s = (w[0] * ub[1] - w[1] * ub[0]) / den;
          const x: P = [(oa[0] as P)[0] + ua[0] * s, (oa[0] as P)[1] + ua[1] * s];
          if (pts.some((p) => Math.hypot(p[0] - x[0], p[1] - x[1]) < 1e-6)) mitred++;
        });
  it("the mitre-corner branch is exercised by these short legs", () => {
    expect(mitred).toBeGreaterThan(5);
  });
});
