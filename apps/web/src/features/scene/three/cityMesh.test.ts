import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../lib/api";
import { WATER_COLOR } from "../styles";
import {
  BEVEL_BY_TIER,
  BUILDING_BEVEL,
  bevelBody,
  bevelForTier,
  buildCityGeometry as buildBevelled,
  faceBuildingId,
  KIND_COLOUR,
  PARK_Y,
  WATER_Y,
} from "./cityMesh";
import { largeRoofTint } from "./facade/roofPlan";
import { createFrame } from "./frame";

const frame = createFrame([101.5, 3.0]);

/** Axis-aligned square of `size` metres, lower-left corner at local (x, z), as a lon/lat ring. */
function square(x: number, z: number, size = 10, clockwise = false): [number, number][] {
  const pts: [number, number][] = [
    [x, z],
    [x + size, z],
    [x + size, z + size],
    [x, z + size],
  ];
  const ring = pts.map(([px, pz]) => frame.toLonLat(px, pz));
  const out = clockwise ? ring.reverse() : ring;
  return [...out, out[0]!];
}

const poly = (ring: unknown) => ({ type: "Polygon", coordinates: [ring] });
const fc = (features: unknown[]) => ({ type: "FeatureCollection", features });
const feat = (geometry: unknown, properties: Record<string, unknown> = {}) => ({
  type: "Feature",
  geometry,
  properties,
});

function layer(over: Partial<Record<"buildings" | "parks" | "water", unknown>> = {}) {
  return {
    attribution: [],
    buildings: fc([]),
    parks: fc([]),
    water: fc([]),
    trees: fc([]),
    ...over,
  } as unknown as BuildingsLayer;
}

const pos = (g: THREE.BufferGeometry) => g.getAttribute("position");

/** The plain-box contract (pre-B-T2 vertex counts, flat normals): every test below but the bevel ones. */
const buildCityGeometry = (...[l, f, o = {}]: Parameters<typeof buildBevelled>) =>
  buildBevelled(l, f, { bevel: false, ...o });

describe("buildCityGeometry", () => {
  it("records which building owns each triangle, for picking", () => {
    const g = buildCityGeometry(
      layer({
        buildings: fc([
          feat(poly(square(0, 0)), { id: "a", height_m: 9 }),
          feat(poly(square(50, 0)), { id: "skip", height_m: 9 }),
          feat(poly(square(100, 0)), { id: "b", height_m: 9 }),
        ]),
      }),
      frame,
      { only: new Set(["a", "b"]) },
    );
    // a square is 2 roof + 8 wall triangles
    expect(g.faces).toEqual({ ids: ["a", "b"], starts: [0, 10] });
    expect(pos(g.buildings).count).toBe(60);
    expect(faceBuildingId(g.faces, 0)).toBe("a");
    expect(faceBuildingId(g.faces, 9)).toBe("a");
    expect(faceBuildingId(g.faces, 10)).toBe("b");
    expect(faceBuildingId(g.faces, 19)).toBe("b");
    expect(faceBuildingId(g.faces, -1)).toBeNull();
    expect(faceBuildingId(undefined, 3)).toBeNull();
  });

  it("one square building, height 9, is 30 vertices from y 0 to 9", () => {
    const g = buildCityGeometry(
      layer({ buildings: fc([feat(poly(square(0, 0)), { height_m: 9 })]) }),
      frame,
    );
    g.buildings.computeBoundingBox();
    expect(g.buildings.boundingBox!.max.y).toBeCloseTo(9, 6);
    expect(g.buildings.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(pos(g.buildings).count).toBe(30);
    expect(g.bounds.max.y).toBeCloseTo(9, 6);
    expect(g.skipped).toBe(0);
  });

  it.each([false, true])("walls face outward (clockwise input = %s)", (clockwise) => {
    const g = buildCityGeometry(
      layer({ buildings: fc([feat(poly(square(0, 0, 10, clockwise)), { height_m: 9 })]) }),
      frame,
    );
    const p = pos(g.buildings);
    const n = g.buildings.getAttribute("normal");
    let walls = 0;
    for (let t = 0; t < p.count; t += 3) {
      if (Math.abs(n.getY(t)) > 0.5) continue; // roof
      walls++;
      const cx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3;
      const cz = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3;
      const dot = n.getX(t) * (cx - 5) + n.getZ(t) * (cz - 5);
      expect(dot).toBeGreaterThan(0);
      // The winding agrees with the stored normal (front face outward).
      const a = new THREE.Vector3().fromBufferAttribute(p, t);
      const b = new THREE.Vector3().fromBufferAttribute(p, t + 1);
      const c = new THREE.Vector3().fromBufferAttribute(p, t + 2);
      const face = b.sub(a).cross(c.sub(a)).normalize();
      expect(face.x * n.getX(t) + face.z * n.getZ(t)).toBeGreaterThan(0.99);
    }
    expect(walls).toBe(8);
  });

  it("with colours: wall, roof cap and a 0.6 m trim band, 24 more vertices for a square", () => {
    const colours = { wall: "#ff0000", roof: "#00ff00", trim: "#0000ff" };
    const g = buildCityGeometry(
      layer({ buildings: fc([feat(poly(square(0, 0)), { height_m: 9 })]) }),
      frame,
      { colours: () => colours },
    );
    const p = pos(g.buildings);
    // Vertices = roof 2 tris (6) + per ring edge: wall quad + trim quad = 2 * 6 = 12 -> 6 + 12 * 4 = 54,
    // i.e. the 30 of today plus 6 per ring edge (24 for a square).
    expect(p.count).toBe(54);
    const col = g.buildings.getAttribute("color");
    const lin = (h: string) => new THREE.Color(h).toArray();
    const seen = { wall: 0, roof: 0, trim: 0 };
    for (let i = 0; i < p.count; i += 3) {
      const rgb = [col.getX(i), col.getY(i), col.getZ(i)];
      const y = [p.getY(i), p.getY(i + 1), p.getY(i + 2)];
      const near = (c: string) => lin(c).every((v, k) => Math.abs(v - rgb[k]!) < 1e-5);
      if (
        y.every((v) => v === 9) &&
        p.getY(i) === 9 &&
        g.buildings.getAttribute("normal").getY(i) === 1
      ) {
        expect(near(colours.roof)).toBe(true);
        seen.roof++;
      } else if (Math.min(...y) >= 8.4 - 1e-6) {
        expect(near(colours.trim)).toBe(true);
        seen.trim++;
      } else {
        expect(near(colours.wall)).toBe(true);
        seen.wall++;
      }
    }
    expect(seen).toEqual({ roof: 2, trim: 8, wall: 8 });
  });

  it("roofTint recolours the roof cap of a large roof only (P4 Task 8: no flat grey big roofs)", () => {
    const colours = { wall: "#ff0000", roof: "#4a4e55", trim: "#0000ff" };
    const g = buildCityGeometry(
      layer({
        buildings: fc([
          feat(poly(square(0, 0, 40)), { id: "big", height_m: 9 }), // 1600 m2
          feat(poly(square(100, 0, 10)), { id: "small", height_m: 9 }), // 100 m2
        ]),
      }),
      frame,
      { colours: () => colours, roofTint: largeRoofTint },
    );
    const p = pos(g.buildings);
    const col = g.buildings.getAttribute("color");
    const nor = g.buildings.getAttribute("normal");
    const lin = (h: string) => new THREE.Color(h).toArray();
    const near = (i: number, c: string) =>
      lin(c).every((v, k) => Math.abs(v - [col.getX(i), col.getY(i), col.getZ(i)][k]!) < 1e-5);
    const tint = largeRoofTint("big", g.footprints[0]!.ring, colours.roof)!;
    expect(tint).not.toBeNull();
    let big = 0;
    let small = 0;
    for (let i = 0; i < p.count; i += 3) {
      if (nor.getY(i) !== 1 || p.getY(i) !== 9) continue;
      if (p.getX(i) < 50) {
        expect(near(i, tint)).toBe(true);
        big++;
      } else {
        expect(near(i, colours.roof)).toBe(true);
        small++;
      }
    }
    expect(big).toBeGreaterThan(0);
    expect(small).toBeGreaterThan(0);
  });

  it("without colours keeps the kind tan and the 30 vertices", () => {
    const g = buildCityGeometry(
      layer({ buildings: fc([feat(poly(square(0, 0)), { height_m: 9, kind: "commercial" })]) }),
      frame,
    );
    expect(pos(g.buildings).count).toBe(30);
    const col = g.buildings.getAttribute("color");
    expect(new THREE.Color().fromBufferAttribute(col, 0).getHexString()).toBe(
      new THREE.Color(KIND_COLOUR.commercial).getHexString(),
    );
  });

  it("prefers display_height_m over height_m, and falls back to height_m without it", () => {
    const g = buildCityGeometry(
      layer({
        buildings: fc([
          feat(poly(square(0, 0)), { height_m: 9, display_height_m: 31.2 }),
          feat(poly(square(30, 0)), { height_m: 12 }),
        ]),
      }),
      frame,
    );
    const p = pos(g.buildings);
    const tops = new Set<number>();
    for (let i = 0; i < p.count; i++) tops.add(Math.round(p.getY(i) * 10) / 10);
    expect([...tops].sort((a, b) => a - b)).toEqual([0, 12, 31.2]);
  });

  it("min_height_m 3 lifts the wall base to y = 3", () => {
    const g = buildCityGeometry(
      layer({ buildings: fc([feat(poly(square(0, 0)), { height_m: 9, min_height_m: 3 })]) }),
      frame,
    );
    g.buildings.computeBoundingBox();
    expect(g.buildings.boundingBox!.min.y).toBeCloseTo(3, 6);
    expect(g.buildings.boundingBox!.max.y).toBeCloseTo(9, 6);
  });

  it("emits position, normal and colour only: no uv attribute (nothing samples wall UVs)", () => {
    const g = buildCityGeometry(
      layer({ buildings: fc([feat(poly(square(0, 0)), { height_m: 9.6, min_height_m: 3.2 })]) }),
      frame,
      { colours: () => ({ wall: "#ff0000", roof: "#00ff00", trim: "#0000ff" }) },
    );
    expect(Object.keys(g.buildings.attributes).sort()).toEqual(["color", "normal", "position"]);
  });

  it("lists the drawn footprints (local ring, display height, base) for the facade layer", () => {
    const g = buildCityGeometry(
      layer({
        buildings: fc([
          feat(poly(square(0, 0)), { id: "a", height_m: 9, display_height_m: 12, kind: "retail" }),
          feat(poly(square(50, 0)), { id: "b", height_m: 6, min_height_m: 2 }),
          feat(poly([frame.toLonLat(0, 0), frame.toLonLat(5, 0), frame.toLonLat(0, 0)]), {
            id: "bad",
          }),
        ]),
      }),
      frame,
      { only: new Set(["a", "b", "bad"]) },
    );
    expect(g.footprints.map((f) => f.id)).toEqual(["a", "b"]);
    const [a, b] = g.footprints;
    expect(a).toMatchObject({ id: "a", kind: "retail", heightM: 12, minHeightM: 0 });
    expect(b).toMatchObject({ id: "b", heightM: 6, minHeightM: 2 });
    expect(a!.ring).toHaveLength(4);
    for (const [x, z] of a!.ring) {
      expect(Math.abs(x) < 1e-3 || Math.abs(x - 10) < 1e-3).toBe(true);
      expect(Math.abs(z) < 1e-3 || Math.abs(z - 10) < 1e-3).toBe(true);
    }
  });

  it("MultiPolygon, 2-point ring and non-finite coordinates are skipped and counted", () => {
    const good = feat(poly(square(0, 0)), { height_m: 9 });
    const multi = feat({ type: "MultiPolygon", coordinates: [[square(20, 0)]] });
    const two = feat(poly([frame.toLonLat(40, 0), frame.toLonLat(50, 0)]));
    const nan = feat(poly([...square(60, 0).slice(0, 3), [Number.NaN, 3]]));
    let g!: ReturnType<typeof buildCityGeometry>;
    expect(() => {
      g = buildCityGeometry(layer({ buildings: fc([good, multi, two, nan]) }), frame);
    }).not.toThrow();
    expect(g.skipped).toBe(3);
    expect(pos(g.buildings).count).toBe(30);
  });

  it("a zero-area footprint is skipped and counted", () => {
    const line = [0, 5, 10, 0].map((x) => frame.toLonLat(x, 0));
    const g = buildCityGeometry(layer({ buildings: fc([feat(poly(line))]) }), frame);
    expect(g.skipped).toBe(1);
    expect(pos(g.buildings).count).toBe(0);
  });

  it("empty or null layer gives empty geometries", () => {
    for (const l of [null, undefined, layer()]) {
      const g = buildCityGeometry(l, frame);
      expect(g.skipped).toBe(0);
      expect(pos(g.buildings).count).toBe(0);
      expect(pos(g.parks).count).toBe(0);
      expect(pos(g.water).count).toBe(0);
    }
  });

  it("parks sit at PARK_Y and water at WATER_Y, never in the flood colour", () => {
    const g = buildCityGeometry(
      layer({
        parks: fc([feat(poly(square(30, 0)))]),
        water: fc([feat(poly(square(60, 0)))]),
      }),
      frame,
    );
    expect(pos(g.parks).count).toBeGreaterThan(0);
    expect(pos(g.water).count).toBeGreaterThan(0);
    for (let i = 0; i < pos(g.parks).count; i++) expect(pos(g.parks).getY(i)).toBeCloseTo(PARK_Y);
    for (let i = 0; i < pos(g.water).count; i++) expect(pos(g.water).getY(i)).toBeCloseTo(WATER_Y);
    const flood = new THREE.Color(WATER_COLOR);
    const col = g.water.getAttribute("color");
    const c = new THREE.Color(col.getX(0), col.getY(0), col.getZ(0));
    expect(c.getHex()).not.toBe(flood.getHex());
  });

  it("water holes are not filled", () => {
    const outer = square(0, 0, 100);
    const hole = square(40, 40, 20, true);
    const g = buildCityGeometry(
      layer({ water: fc([feat({ type: "Polygon", coordinates: [outer, hole] })]) }),
      frame,
    );
    let area = 0;
    const p = pos(g.water);
    for (let t = 0; t < p.count; t += 3) {
      area +=
        Math.abs(
          (p.getX(t + 1) - p.getX(t)) * (p.getZ(t + 2) - p.getZ(t)) -
            (p.getX(t + 2) - p.getX(t)) * (p.getZ(t + 1) - p.getZ(t)),
        ) / 2;
    }
    expect(area).toBeCloseTo(100 * 100 - 20 * 20, 0);
  });

  it("vertex colour follows KIND_COLOUR[kind]", () => {
    const g = buildCityGeometry(
      layer({
        buildings: fc([
          feat(poly(square(0, 0)), { height_m: 9, kind: "industrial" }),
          feat(poly(square(30, 0)), { height_m: 9, kind: "residential" }),
        ]),
      }),
      frame,
    );
    const col = g.buildings.getAttribute("color");
    const at = (i: number) => new THREE.Color(col.getX(i), col.getY(i), col.getZ(i)).getHex();
    expect(at(0)).toBe(new THREE.Color(KIND_COLOUR.industrial).getHex());
    expect(at(30)).toBe(new THREE.Color(KIND_COLOUR.residential).getHex());
    expect(at(0)).not.toBe(at(30));
  });

  it("ground covers the building bounds plus a 500 m margin", () => {
    const g = buildCityGeometry(
      layer({ buildings: fc([feat(poly(square(0, 0)), { height_m: 9 })]) }),
      frame,
    );
    expect(g.ground.center[0]).toBeCloseTo(5, 3);
    expect(g.ground.center[1]).toBeCloseTo(5, 3);
    expect(g.ground.size[0]).toBeCloseTo(10 + 1000, 3);
    expect(g.ground.size[1]).toBeCloseTo(10 + 1000, 3);
  });

  describe("only", () => {
    const two = () =>
      layer({
        buildings: fc([
          feat(poly(square(0, 0)), { id: "b1", height_m: 9 }),
          feat(poly(square(50, 0)), { id: "b2", height_m: 12 }),
        ]),
      });

    it("extrudes only the given ids (b1: one 10 m box, 30 vertices)", () => {
      const g = buildCityGeometry(two(), frame, { only: new Set(["b1"]) });
      expect(pos(g.buildings).count).toBe(30);
      g.buildings.computeBoundingBox();
      expect(g.buildings.boundingBox!.max.x).toBeCloseTo(10, 3);
      expect(g.buildings.boundingBox!.max.y).toBeCloseTo(9, 6);
    });

    it("an empty set extrudes nothing; undefined keeps every building", () => {
      expect(pos(buildCityGeometry(two(), frame, { only: new Set() }).buildings).count).toBe(0);
      expect(pos(buildCityGeometry(two(), frame).buildings).count).toBe(60);
      expect(pos(buildCityGeometry(two(), frame, {}).buildings).count).toBe(60);
    });
  });
});

describe("bevelled extrusion (B-T2, AC-B3 buildings)", () => {
  const one = (h = 9, size = 10) =>
    buildBevelled(
      layer({ buildings: fc([feat(poly(square(0, 0, size)), { id: "a", height_m: h })]) }),
      frame,
    );
  const n = (g: THREE.BufferGeometry) => g.getAttribute("normal");

  it("is on by default: radius 0.5 m in 2 segments, negative offset (walls on the outline, top at the height)", () => {
    expect(BUILDING_BEVEL).toEqual({ radiusM: 0.5, segments: 2, chamferM: 0.14, minTurnDeg: 30 });
    const g = one();
    const p = pos(g.buildings);
    let top = Number.NEGATIVE_INFINITY;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < p.count; i++) {
      top = Math.max(top, p.getY(i));
      minX = Math.min(minX, p.getX(i));
      maxX = Math.max(maxX, p.getX(i));
    }
    expect(top).toBeCloseTo(9, 6);
    expect(minX).toBeCloseTo(0, 3);
    expect(maxX).toBeCloseTo(10, 3);
    // The flat cap is the outline inset by the radius.
    for (let i = 0; i < p.count; i++)
      if (Math.abs(p.getY(i) - 9) < 1e-6)
        for (const v of [p.getX(i), p.getZ(i)]) {
          expect(Math.abs(v)).toBeGreaterThan(0.499);
          expect(Math.abs(v)).toBeLessThan(9.501);
        }
  });

  it("bevel bands carry smooth normals: tilted between the wall and the roof, varying along the profile", () => {
    const g = one();
    const nm = n(g.buildings);
    const ups = new Set<number>();
    for (let i = 0; i < nm.count; i++) {
      const y = nm.getY(i);
      if (y > 0.01 && y < 0.999) ups.add(Math.round(y * 1000));
    }
    // 2 segments: the profile normals at 45° (sin = 0.707) and the ends (0 and 1) are shared, so
    // the quarter-round shades continuously from wall to roof.
    expect([...ups]).toContain(707);
  });

  it("convex corners are cut by 0.14 m with normals blending across the cut (no hard 90° corner)", () => {
    const g = one();
    const p = pos(g.buildings);
    const nm = n(g.buildings);
    let diagonal = 0;
    for (let i = 0; i < p.count; i++) {
      // no vertex sits on the OSM corner (0, 0) itself; the nearest is 0.14 m along an edge
      expect(Math.hypot(p.getX(i), p.getZ(i))).toBeGreaterThan(0.139);
      const nx = nm.getX(i);
      const nz = nm.getZ(i);
      if (Math.abs(nm.getY(i)) < 1e-6 && Math.abs(nx) > 0.1 && Math.abs(nz) > 0.1) diagonal++;
    }
    expect(diagonal).toBe(0); // the cut's own corners take the adjacent wall normals (smooth blend)
    const body = bevelBody(
      [
        [0, 0],
        [10, 0],
        [10, -10],
        [0, -10],
      ],
      9,
      BUILDING_BEVEL,
    )!;
    expect(body.wall).toHaveLength(8);
    expect(body.radius).toBeCloseTo(0.5);
  });

  it("a low or thin building gets a smaller radius, and the top still lands on the height", () => {
    const low = one(1);
    const p = pos(low.buildings);
    let top = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i));
    expect(top).toBeCloseTo(1, 6);
    const thin = bevelBody(
      [
        [0, 0],
        [20, 0],
        [20, -0.6],
        [0, -0.6],
      ],
      6,
      BUILDING_BEVEL,
    );
    expect(thin === null || thin.radius < 0.3).toBe(true);
  });

  it("curved outlines (gentle turns) share an averaged normal, so they shade smooth", () => {
    const ring: [number, number][] = [];
    for (let k = 0; k < 24; k++) {
      const a = (-2 * Math.PI * k) / 24;
      ring.push([10 * Math.cos(a), 10 * Math.sin(a)]);
    }
    const body = bevelBody(ring, 12, BUILDING_BEVEL)!;
    expect(body.wall).toHaveLength(24); // 15° turns: no cuts
    for (let k = 0; k < 24; k++) {
      const end = body.nEnd[k]!;
      const start = body.nStart[(k + 1) % 24]!;
      expect(end[0]).toBeCloseTo(start[0], 9);
      expect(end[1]).toBeCloseTo(start[1], 9);
    }
  });

  it("styled: walls in the wall colour, the trim band and every bevel face in trim, the flat cap in the (tinted) roof", () => {
    const colours = { wall: "#ff0000", roof: "#00ff00", trim: "#0000ff" };
    const tint = "#ffaa00";
    const g = buildBevelled(
      layer({ buildings: fc([feat(poly(square(0, 0)), { id: "a", height_m: 9 })]) }),
      frame,
      { colours: () => colours, roofTint: () => tint },
    );
    const p = pos(g.buildings);
    const col = g.buildings.getAttribute("color");
    const hex = (i: number) =>
      `#${new THREE.Color().fromBufferAttribute(col as THREE.BufferAttribute, i).getHexString()}`;
    const seen = { cap: 0, band: 0, trimWall: 0, wall: 0 };
    for (let t = 0; t < p.count; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, t + k));
      const ny = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3()).y;
      const lo = Math.min(a!.y, b!.y, c!.y);
      const h = hex(t);
      for (const k of [1, 2]) expect(hex(t + k)).toBe(h); // one colour per triangle
      if (ny > 0.999) {
        expect(h).toBe(tint);
        seen.cap++;
      } else if (ny > 0.05) {
        expect(h).toBe(colours.trim);
        seen.band++;
      } else if (lo >= 9 - 0.6 - 1e-6) {
        expect(h).toBe(colours.trim);
        seen.trimWall++;
      } else {
        expect(h).toBe(colours.wall);
        seen.wall++;
      }
    }
    expect(Object.values(seen).every((n) => n > 0)).toBe(true);
  });

  it("follows the quality tier: Low plain box, Medium one segment, High two", () => {
    expect(BEVEL_BY_TIER).toEqual({ low: false, medium: { segments: 1 }, high: { segments: 2 } });
    const tris = (tier: "low" | "medium" | "high") =>
      pos(
        buildBevelled(
          layer({ buildings: fc([feat(poly(square(0, 0)), { id: "a", height_m: 9 })]) }),
          frame,
          { bevel: bevelForTier(tier) },
        ).buildings,
      ).count / 3;
    // Low: the plain box (10 triangles); a chamfered square has 8 wall edges, each with 2 wall
    // triangles plus 2 per bevel segment, and a 6-triangle cap.
    expect(tris("low")).toBe(10);
    expect(tris("medium")).toBe(6 + 8 * (2 + 2 * 1));
    expect(tris("high")).toBe(6 + 8 * (2 + 2 * 2));
    expect(bevelForTier("high")).toEqual({ segments: BUILDING_BEVEL.segments });
  });

  it("bevel: false keeps the plain box", () => {
    const g = buildBevelled(
      layer({ buildings: fc([feat(poly(square(0, 0)), { id: "a", height_m: 9 })]) }),
      frame,
      { bevel: false },
    );
    expect(pos(g.buildings).count).toBe(30);
  });
});
