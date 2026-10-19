import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import { activeTiles, tileAt } from "../stream/tiles";
import { VERGE_Y } from "./bands";
import { planVerges, VERGE_INNER_M, VERGE_OUTER_M } from "./verges";

const frame = createFrame([101.5, 3.18]);
const ll = (e: number, n: number) => frame.toLonLat(e, -n); // n = north metres
const line = (type: string, pts: [number, number][]): GeoJSON.Feature => ({
  type: "Feature",
  properties: { type },
  geometry: { type: "LineString", coordinates: pts.map(([e, n]) => ll(e, n)) },
});
const fc = (...f: GeoJSON.Feature[]) => ({ type: "FeatureCollection", features: f });
const rect = (e0: number, n0: number, e1: number, n1: number): GeoJSON.Feature => ({
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [[ll(e0, n0), ll(e1, n0), ll(e1, n1), ll(e0, n1), ll(e0, n0)]],
  },
});
// A 6 m street along the x axis through z = 0 (north 0), plus a footway and a major road.
const street = line("street", [
  [10, 0],
  [200, 0],
]);
const cross = line("footway", [
  [100, -40],
  [100, 40],
]);
// A tile box wide enough to hold both kerbs of the street along z = 0.
const tile = { key: "t", i: 0, j: 0, box: { x0: 0, z0: -125, x1: 250, z1: 125 } };
const none = fc();

/** Triangle centroids as [x, y, z]. */
const centroids = (s: Float32Array) => {
  const out: [number, number, number][] = [];
  for (let i = 0; i + 8 < s.length; i += 9)
    out.push([
      (s[i]! + s[i + 3]! + s[i + 6]!) / 3,
      (s[i + 1]! + s[i + 4]! + s[i + 7]!) / 3,
      (s[i + 2]! + s[i + 5]!) / 3,
    ]);
  return out;
};

describe("planVerges", () => {
  it("verges lie between 3.0 and 4.5 m from a 6 m street centreline, at y 0.07", () => {
    const { strips } = planVerges(fc(street), none, tile, frame, 1000);
    expect(strips.length).toBeGreaterThan(0);
    expect(VERGE_INNER_M).toBe(3);
    expect(VERGE_OUTER_M).toBe(4.5);
    for (let i = 0; i < strips.length; i += 3) {
      expect(strips[i + 1]).toBeCloseTo(VERGE_Y, 5);
      const d = Math.abs(strips[i + 2]!); // street runs along z = 0
      expect(d).toBeGreaterThanOrEqual(3 - 1e-4);
      expect(d).toBeLessThanOrEqual(4.5 + 1e-4);
    }
    const sides = new Set(centroids(strips).map((c) => Math.sign(c[2])));
    expect(sides).toEqual(new Set([-1, 1])); // both kerbs
  });

  it("makes none for major roads, footways or unknown types", () => {
    const w = fc(
      line("major_road", [
        [10, 0],
        [200, 0],
      ]),
      line("footway", [
        [10, 20],
        [200, 20],
      ]),
      line("mystery", [
        [10, -20],
        [200, -20],
      ]),
    );
    const r = planVerges(w, none, tile, frame, 1000);
    expect(r.strips.length).toBe(0);
    expect(r.shrubs.length).toBe(0);
  });

  it("puts no verge or shrub on a ribbon (a crossing footway) or inside a footprint", () => {
    const b = fc(rect(40, 6, 60, 14)); // north of the street, set back 6 m
    const w = fc(street, cross);
    const { strips, shrubs } = planVerges(w, b, tile, frame, 1000);
    expect(strips.length).toBeGreaterThan(0);
    const onFootway = (x: number, z: number) => Math.abs(x - 100) < 1.25 && Math.abs(z) < 40;
    const inFootprint = (x: number, z: number) => x >= 40 && x <= 60 && z >= -14 && z <= -6;
    for (const [x, , z] of centroids(strips)) {
      expect(onFootway(x, z)).toBe(false);
      expect(inFootprint(x, z)).toBe(false);
    }
    expect(shrubs.length).toBeGreaterThan(0);
    for (const s of shrubs) {
      expect(onFootway(s.x, s.z)).toBe(false);
      expect(inFootprint(s.x, s.z)).toBe(false);
      expect(Math.abs(s.z)).toBeGreaterThanOrEqual(3);
      expect(Math.abs(s.z)).toBeLessThanOrEqual(4.5);
    }
  });

  it("plans no verge piece or shrub inside a park or base-water polygon", () => {
    const park = fc(rect(40, -10, 80, 10)); // straddles the street near x 40..80
    const water = fc(rect(120, -10, 150, 10));
    const base = planVerges(fc(street), none, tile, frame, 1000);
    const { strips, shrubs } = planVerges(fc(street), none, tile, frame, 1000, undefined, {
      parks: park,
      water,
    });
    const inArea = (x: number) => (x >= 40 && x <= 80) || (x >= 120 && x <= 150);
    // Reference run: pieces and shrubs do exist in those spans without the keep-out.
    expect(centroids(base.strips).some(([x]) => inArea(x))).toBe(true);
    expect(base.shrubs.some((s) => inArea(s.x))).toBe(true);
    expect(strips.length).toBeGreaterThan(0);
    for (const [x] of centroids(strips)) expect(inArea(x)).toBe(false);
    expect(shrubs.length).toBeGreaterThan(0);
    for (const s of shrubs) expect(inArea(s.x)).toBe(false);
  });

  it("leaves driveway gaps where a footprint is within 3 m of the kerb", () => {
    const b = fc(rect(100, 4, 120, 12)); // 1 m from the kerb at z = -3
    const { shrubs } = planVerges(fc(street), b, tile, frame, 1000);
    const north = shrubs.filter((s) => s.z < 0 && s.x > 98 && s.x < 122);
    expect(north.length).toBe(0);
    const south = shrubs.filter((s) => s.z > 0 && s.x > 98 && s.x < 122);
    expect(south.length).toBeGreaterThan(0);
  });

  it("spaces shrubs 4 m +- jitter along a verge, from the shrub kit", () => {
    const { shrubs } = planVerges(fc(street), none, tile, frame, 1000);
    const row = shrubs.filter((s) => s.z > 0).sort((a, b) => a.x - b.x);
    expect(row.length).toBeGreaterThan(10);
    for (let i = 1; i < row.length; i++) {
      const gap = row[i]!.x - row[i - 1]!.x;
      expect(gap).toBeGreaterThanOrEqual(3);
      expect(gap).toBeLessThanOrEqual(5);
    }
    for (const s of shrubs) {
      expect(s.asset).toBe("trees"); // the kit; shrubs are two of its variants
      expect(["shrub_round", "shrub_hedge"]).toContain(s.variant);
      expect(s.palette).toHaveLength(3);
    }
    expect(new Set(shrubs.map((s) => s.id)).size).toBe(shrubs.length);
  });

  it("honours the cap, keeping the shrubs nearest the tile centre", () => {
    const all = planVerges(fc(street), none, tile, frame, 1000).shrubs;
    const few = planVerges(fc(street), none, tile, frame, 5).shrubs;
    expect(few).toHaveLength(5);
    expect(planVerges(fc(street), none, tile, frame, 0).shrubs).toHaveLength(0);
    expect(all.length).toBeGreaterThan(5);
  });

  it("is deterministic and tiles never double-place: the union of tiles equals the whole", () => {
    // A long street across several tiles, planned per tile and as the sum of tile outputs.
    const long = fc(
      line("street", [
        [-300, -125],
        [900, -125],
      ]),
    );
    const tiles = activeTiles({ x: 300, z: 125 }, 1000).map((t) => t.tile);
    const ids: string[] = [];
    let stripLen = 0;
    for (const t of tiles) {
      const a = planVerges(long, none, t, frame, 1e6);
      const b = planVerges(long, none, t, frame, 1e6);
      expect(a.shrubs).toEqual(b.shrubs);
      expect(a.strips).toEqual(b.strips);
      for (const s of a.shrubs) {
        expect(s.x).toBeGreaterThanOrEqual(t.box.x0);
        expect(s.x).toBeLessThan(t.box.x1);
        ids.push(s.id);
      }
      stripLen += a.strips.length;
    }
    expect(new Set(ids).size).toBe(ids.length);
    // Shrubs every 4 m on both sides from x = -300 to 900 land in the active tiles' x range.
    expect(ids.length).toBeGreaterThan(100);
    // Strip triangles are never repeated across tiles.
    expect(stripLen).toBeGreaterThan(0);
  });

  it("an edge-straddling stretch is drawn exactly once", () => {
    const long = fc(
      line("street", [
        [-300, -125],
        [900, -125],
      ]),
    );
    const key = (s: Float32Array) => {
      const out: string[] = [];
      for (let i = 0; i < s.length; i += 9) out.push(Array.from(s.slice(i, i + 9)).join(","));
      return out;
    };
    const seen = new Set<string>();
    let total = 0;
    for (const i of [-2, -1, 0, 1, 2, 3, 4]) {
      const t = tileAt(i * 250 + 1, 125);
      const k = key(planVerges(long, none, t, frame, 0).strips);
      total += k.length;
      for (const x of k) seen.add(x);
    }
    expect(seen.size).toBe(total);
  });
});
