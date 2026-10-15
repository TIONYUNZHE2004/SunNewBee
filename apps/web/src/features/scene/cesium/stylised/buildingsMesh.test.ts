import { describe, expect, it } from "vitest";
import { buildMesh, cleanRing, ecef, enuBasis, TONE_STRIDE, TONES } from "./buildingsMesh";
import { toBuildings } from "./model";

// Fan triangulation is exact for the convex test footprints.
const fan = (xy: number[]) => {
  const out: number[] = [];
  for (let i = 1; i + 1 < xy.length / 2; i++) out.push(0, i, i + 1);
  return out;
};
const ring = (cw = false) => {
  const r: [number, number][] = [
    [101.5, 3.18],
    [101.5003, 3.18],
    [101.5003, 3.1802],
    [101.5, 3.1802],
    [101.5, 3.18],
  ];
  return cw ? r.reverse() : r;
};
const building = (cw = false, h = 16) =>
  toBuildings({
    features: [
      {
        geometry: { type: "Polygon", coordinates: [ring(cw)] },
        properties: { id: "x", height_m: h },
      },
    ],
  }).buildings[0]!;

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]!);
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);
const cross = (a: number[], b: number[]) => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];

describe("ecef", () => {
  it("puts the equator/prime meridian on the x axis and adds height radially", () => {
    expect(ecef(0, 0, 0)[0]).toBeCloseTo(6_378_137, 3);
    const [x0] = ecef(0, 0, 0);
    const [x1] = ecef(0, 0, 10);
    expect(x1 - x0).toBeCloseTo(10, 6);
  });
});

describe("cleanRing", () => {
  it("drops the closing point and orients counter-clockwise", () => {
    const ccw = cleanRing(ring(false));
    expect(ccw).toHaveLength(4);
    expect(new Set(cleanRing(ring(true)).map(String))).toEqual(new Set(ccw.map(String)));
    // Shoelace of the cleaned clockwise input is positive (counter-clockwise).
    const r = cleanRing(ring(true));
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++)
      a += r[j]![0] * r[i]![1] - r[i]![0] * r[j]![1];
    expect(a).toBeGreaterThan(0);
  });
});

describe("buildMesh", () => {
  it("emits 4 wall vertices per edge plus a roof, with metric st", () => {
    const b = building();
    const m = buildMesh([b], fan);
    expect(m.positions.length / 3).toBe(4 * 4 + 4);
    expect(m.indices.length).toBe(4 * 6 + 2 * 3);
    const ts = [...m.st].filter((_, i) => i % 2 === 1);
    expect(Math.max(...ts)).toBe(b.floors); // top of the walls
    expect(ts.filter((t) => t === -1)).toHaveLength(4); // roof flag
    // s carries the tone stride and spans whole window columns along the perimeter.
    const ss = [...m.st].filter((_, i) => i % 2 === 0).slice(0, 16);
    expect(Math.floor(Math.min(...ss) / TONE_STRIDE)).toBe(TONES[b.tone]);
    const span = Math.max(...ss) - Math.min(...ss);
    expect(Number.isInteger(span)).toBe(true);
    expect(span).toBeCloseTo(b.perimeterM / 3.5, -1);
  });

  it("winds every triangle outward (walls) or upward (roof), whatever the ring orientation", () => {
    for (const cw of [false, true]) {
      const m = buildMesh([building(cw)], fan);
      const up = enuBasis(101.5, 3.18).up;
      const centre = ecef(101.50015, 3.1801, 8);
      for (let i = 0; i < m.indices.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => [
          ...m.positions.subarray(m.indices[i + k]! * 3, m.indices[i + k]! * 3 + 3),
        ]);
        const n = cross(sub(b!, a!), sub(c!, a!));
        const na = [...m.normals.subarray(m.indices[i]! * 3, m.indices[i]! * 3 + 3)];
        expect(dot(n, na)).toBeGreaterThan(0); // geometric face normal agrees with the vertex normal
        const isRoof = Math.abs(dot(na, up)) > 0.99;
        if (!isRoof) expect(dot(na, sub(a!, centre))).toBeGreaterThan(0); // wall faces away from the centre
      }
    }
  });

  it("is deterministic and skips degenerate rings", () => {
    const b = building();
    expect(buildMesh([b], fan)).toEqual(buildMesh([b], fan));
    const flat = {
      ...b,
      ring: [
        [1, 1],
        [1, 1],
        [1, 1],
      ] as [number, number][],
    };
    const m = buildMesh([flat], fan);
    expect(m.positions.length).toBe(0);
    expect(m.indices.length).toBe(0);
  });
});
