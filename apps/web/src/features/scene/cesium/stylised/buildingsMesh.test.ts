import { describe, expect, it } from "vitest";
import {
  buildMesh,
  cleanRing,
  ecef,
  enuBasis,
  GROUND_FLOOR_M,
  isConvex,
  type Mesh,
  meshBudget,
  PARAPET_M,
  SETBACK_AT,
  SETBACK_SCALE,
  shrinkRing,
  TONE_STRIDE,
  tAt,
} from "./buildingsMesh";
import { type Building, STYLE_LIST, TONE_LIST, toBuildings } from "./model";

// Fan triangulation is exact for the convex test footprints.
const fan = (xy: number[]) => {
  const out: number[] = [];
  for (let i = 1; i + 1 < xy.length / 2; i++) out.push(0, i, i + 1);
  return out;
};
const triangulate = fan;
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

const buildingFixture = (): Building => ({
  id: "fx",
  ring: [],
  height: 12,
  minHeight: 0,
  kind: "building",
  tone: "t0",
  style: "grid",
  floors: 3,
  perimeterM: 80,
  cols: 23,
  litSeed: 0.5,
});

const KX = 111_320 * Math.cos((3.18 * Math.PI) / 180);
/** Footprint from local metres (east, north) around 101.5, 3.18; closed like GeoJSON. */
const fromMetres = (pts: [number, number][]): [number, number][] => {
  const r = pts.map(([x, y]) => [101.5 + x / KX, 3.18 + y / 111_320] as [number, number]);
  return [...r, r[0]!];
};
const square = (m: number): [number, number][] => {
  const d = m / 111_320;
  return [
    [101.5, 3.18],
    [101.5 + d, 3.18],
    [101.5 + d, 3.18 + d],
    [101.5, 3.18 + d],
    [101.5, 3.18],
  ];
};

/** Ellipsoidal height of each vertex, approximated as |p| - |ecef(lon0, lat0, 0)| (cm-accurate). */
const heightsOf = (mesh: Mesh, lon0 = 101.5, lat0 = 3.18) => {
  const r0 = Math.hypot(...ecef(lon0, lat0, 0));
  const out: number[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3)
    out.push(Math.hypot(mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!) - r0);
  return out;
};

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
  it("emits the budgeted vertices with metric st: floors above the ground floor, roof flag", () => {
    const b = building();
    const m = buildMesh([b], fan);
    const want = meshBudget(cleanRing(b.ring), b);
    expect(m.positions.length / 3).toBe(want.vertices);
    expect(m.indices.length).toBe(want.indices);
    const ts = [...m.st].filter((_, i) => i % 2 === 1);
    expect(Math.max(...ts)).toBeCloseTo(tAt(b.height), 5); // top of the walls
    expect(tAt(b.height)).toBeCloseTo(1 + (16 - GROUND_FLOOR_M) / 3.2, 6);
    expect(ts.filter((t) => t === -1)).toHaveLength(4); // roof flag
    // s carries the tone/style class and spans whole window columns along the perimeter.
    const cls = TONE_LIST.indexOf(b.tone) * 3 + STYLE_LIST.indexOf(b.style);
    const ss = [...m.st].filter((_, i) => i % 2 === 0).slice(0, 16);
    expect(Math.floor(Math.min(...ss) / TONE_STRIDE)).toBe(cls);
    const span = Math.max(...ss) - Math.min(...ss);
    expect(Number.isInteger(span)).toBe(true);
    expect(span).toBeCloseTo(b.perimeterM / 3.5, -1);
  });

  it("winds every triangle outward (walls) or upward (roof), whatever the ring orientation", () => {
    for (const cw of [false, true]) {
      const m = buildMesh([building(cw)], fan);
      const up = enuBasis(101.5, 3.18).up;
      const centre = ecef(101.50015, 3.1801, 8);
      let inward = 0;
      for (let i = 0; i < m.indices.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => [
          ...m.positions.subarray(m.indices[i + k]! * 3, m.indices[i + k]! * 3 + 3),
        ]);
        const n = cross(sub(b!, a!), sub(c!, a!));
        const na = [...m.normals.subarray(m.indices[i]! * 3, m.indices[i]! * 3 + 3)];
        expect(dot(n, na)).toBeGreaterThan(0); // geometric face normal agrees with the vertex normal
        const isRoof = Math.abs(dot(na, up)) > 0.99;
        if (isRoof) continue;
        if (dot(na, sub(a!, centre)) < 0) {
          // Only the parapet's inner face looks back towards the centre.
          inward++;
          expect(m.st[m.indices[i]! * 2 + 1]).toBe(-2);
        }
      }
      expect(inward).toBe(4 * 2);
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

describe("building shapes", () => {
  it("isConvex / shrinkRing", () => {
    expect(isConvex(square(20).slice(0, 4))).toBe(true);
    const s = shrinkRing(square(20).slice(0, 4), 0.3);
    const w = (s[1]![0] - s[0]![0]) * 111_320 * Math.cos((3.18 * Math.PI) / 180);
    expect(w).toBeCloseTo(19.4, 0);
  });

  it("shrinkRing moves every edge inward by m, also at a concave corner", () => {
    const L: [number, number][] = [
      [0, 0],
      [30, 0],
      [30, 10],
      [10, 10],
      [10, 30],
      [0, 30],
    ];
    const ringL = fromMetres(L).slice(0, -1);
    expect(isConvex(ringL)).toBe(false);
    const s = shrinkRing(ringL, 0.3).map(([x, y]) => [(x - 101.5) * KX, (y - 3.18) * 111_320]);
    const want = [
      [0.3, 0.3],
      [29.7, 0.3],
      [29.7, 9.7],
      [9.7, 9.7],
      [9.7, 29.7],
      [0.3, 29.7],
    ];
    s.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(want[i]![0]!, 2);
      expect(p[1]).toBeCloseTo(want[i]![1]!, 2);
    });
  });

  it("walls are split at the ground floor and the parapet rises above the roof", () => {
    const b = { ...buildingFixture(), height: 12, minHeight: 0, floors: 3, ring: square(20) };
    const mesh = buildMesh([b], triangulate);
    const ts = new Set(
      Array.from(mesh.st.filter((_, i) => i % 2 === 1)).map((t) => Math.round(t * 100) / 100),
    );
    expect(ts.has(1)).toBe(true); // ground-floor line
    expect(ts.has(-1)).toBe(true); // roof
    expect(ts.has(-2)).toBe(true); // parapet
    const heights = heightsOf(mesh);
    expect(Math.max(...heights)).toBeCloseTo(12 + PARAPET_M, 1);
    expect(heights.some((h) => Math.abs(h - GROUND_FLOOR_M) < 0.05)).toBe(true);
  });

  it("tall convex buildings get one setback; concave ones do not", () => {
    const tall = { ...buildingFixture(), height: 40, floors: 12, ring: square(30) };
    const m = buildMesh([tall], triangulate);
    expect(meshBudget(square(30).slice(0, 4), tall).vertices).toBe(m.positions.length / 3);
    const hs = heightsOf(m);
    expect(hs.some((h) => Math.abs(h - 40 * SETBACK_AT) < 0.1)).toBe(true);
    // Above the setback the tower is narrower (scaled about the centroid).
    const { east } = enuBasis(101.5, 3.18);
    const o = ecef(101.5, 3.18, 0);
    const xs: number[] = [];
    hs.forEach((h, i) => {
      if (h > 40 * SETBACK_AT + 0.5) {
        const p = [0, 1, 2].map((c) => m.positions[i * 3 + c]! - o[c]!);
        xs.push(dot(p, east));
      }
    });
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(30 * SETBACK_SCALE, 0);
    // A concave footprint (one reflex corner) keeps straight walls.
    const notched = fromMetres([
      [0, 0],
      [30, 0],
      [30, 30],
      [15, 15],
      [0, 30],
    ]);
    const mc = buildMesh([{ ...tall, ring: notched }], triangulate);
    expect(heightsOf(mc).some((h) => Math.abs(h - 40 * SETBACK_AT) < 0.1)).toBe(false);
    expect(mc.positions.length / 3).toBe(meshBudget(cleanRing(notched), tall).vertices);
  });

  it("vertex and index counts stay within the budget", () => {
    const b = { ...buildingFixture(), height: 12, floors: 3, ring: square(20) };
    const mesh = buildMesh([b], triangulate);
    const want = meshBudget(square(20).slice(0, 4), b);
    expect(mesh.positions.length / 3).toBe(want.vertices);
    expect(mesh.indices.length).toBeLessThanOrEqual(want.indices);
  });

  it("round towers get smooth normals; boxes keep flat walls", () => {
    const round: [number, number][] = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * 2 * Math.PI;
      return [10 * Math.cos(a), 10 * Math.sin(a)] as [number, number];
    });
    const m = buildMesh([{ ...buildingFixture(), ring: fromMetres(round) }], triangulate);
    const { east, north, up } = enuBasis(101.5, 3.18);
    // The first wall vertex sits due east of the centre: its normal is radial, not an edge normal.
    const n0 = [...m.normals.subarray(0, 3)];
    expect(dot(n0, east)).toBeCloseTo(1, 3);
    expect(Math.abs(dot(n0, north))).toBeLessThan(2e-3);
    expect(Math.abs(dot(n0, up))).toBeLessThan(1e-3);
    const box = buildMesh([{ ...buildingFixture(), ring: square(20) }], triangulate);
    // Vertex 0 of the first wall quad of a box uses the south edge's normal.
    expect(dot([...box.normals.subarray(0, 3)], north)).toBeCloseTo(-1, 3);
  });
});
