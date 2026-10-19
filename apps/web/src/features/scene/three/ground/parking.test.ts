import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseManifest } from "../assets/manifest";
import { createFrame } from "../frame";
import { distSeg, distToPoly, inPoly, type P, type Poly, polygonsOf } from "../props/polyGeom";
import { tileAt } from "../stream/tiles";
import {
  AISLE_M,
  CARS_SHARE,
  LOT_INSET_M,
  planParking,
  STALL_D_M,
  STALL_STRIDE,
  STALL_W_M,
} from "./parking";

const manifest = parseManifest(
  JSON.parse(
    readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
  ),
).manifest!;
const frame = createFrame([101.5, 3.18]);
const ll = (x: number, z: number) => frame.toLonLat(x, z);
const feat = (pts: [number, number][]) =>
  ({
    type: "Feature",
    properties: { class: "parking" },
    geometry: { type: "Polygon", coordinates: [[...pts, pts[0]!].map(([x, z]) => ll(x, z))] },
  }) as unknown as GeoJSON.Feature;
const rect = (x0: number, z0: number, w: number, h: number) =>
  feat([
    [x0, z0],
    [x0 + w, z0],
    [x0 + w, z0 + h],
    [x0, z0 + h],
  ]);
const street = (pts: [number, number][], type = "street") => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { type },
      geometry: { type: "LineString", coordinates: pts.map(([x, z]) => ll(x, z)) },
    },
  ],
});
const polyOf = (f: GeoJSON.Feature): Poly => polygonsOf(f.geometry, frame)[0]!;
const stallsOf = (s: Float32Array) =>
  Array.from({ length: s.length / STALL_STRIDE }, (_, i) => ({
    x: s[i * STALL_STRIDE]!,
    z: s[i * STALL_STRIDE + 1]!,
    yaw: s[i * STALL_STRIDE + 2]!,
  }));

const tile = tileAt(100, 100);
const LOT = rect(20, 20, 140, 100); // 14,000 m2 inside tile 0,0
const BIG = rect(10, 10, 160, 180); // 28,800 m2
const opts = { m: manifest };

describe("planParking", () => {
  it("draws stalls and cars only inside the parking polygon, inset 1 m", () => {
    const { stalls, cars } = planParking([LOT], tile, frame, 5000, opts);
    const poly = polyOf(LOT);
    const list = stallsOf(stalls);
    expect(list.length).toBeGreaterThan(100);
    for (const s of list) {
      expect(inPoly(s.x, s.z, poly)).toBe(true);
      // The stall's four corners stay inside by the inset.
      const hx = Math.sin(s.yaw);
      const hz = Math.cos(s.yaw);
      for (const sa of [-1, 1])
        for (const sb of [-1, 1]) {
          const cx = s.x + hz * sa * (STALL_W_M / 2) + hx * sb * (STALL_D_M / 2);
          const cz = s.z - hx * sa * (STALL_W_M / 2) + hz * sb * (STALL_D_M / 2);
          expect(inPoly(cx, cz, poly)).toBe(true);
          expect(distToPoly(cx, cz, poly)).toBeGreaterThanOrEqual(LOT_INSET_M - 1e-3);
        }
    }
    expect(cars.length).toBeGreaterThan(0);
    for (const c of cars) expect(inPoly(c.x, c.z, poly)).toBe(true);
  });

  it("lays rows along the long axis with 6 m aisles between them", () => {
    const { stalls } = planParking([LOT], tile, frame, 5000, opts);
    const zs = [...new Set(stallsOf(stalls).map((s) => Math.round(s.z * 10) / 10))].sort(
      (a, b) => a - b,
    );
    // Rows are 5 m deep: consecutive row centres are 5 m apart (back to back) or 5 + 6 m (aisle).
    const gaps = zs.slice(1).map((z, i) => Math.round((z - zs[i]!) * 10) / 10);
    expect(gaps.length).toBeGreaterThan(2);
    for (const g of gaps)
      expect([STALL_D_M, STALL_D_M + AISLE_M].some((e) => Math.abs(e - g) < 0.2)).toBe(true);
    expect(gaps.some((g) => Math.abs(g - (STALL_D_M + AISLE_M)) < 0.2)).toBe(true);
  });

  it("works on a rotated lot too", () => {
    const f = feat([
      [100, 20],
      [190, 110],
      [160, 140],
      [70, 50],
    ]);
    const { stalls } = planParking([f], tile, frame, 5000, opts);
    const poly = polyOf(f);
    expect(stalls.length).toBeGreaterThan(0);
    for (const s of stallsOf(stalls)) expect(inPoly(s.x, s.z, poly)).toBe(true);
  });

  it("keeps stalls and cars off every ribbon", () => {
    const walk = street([
      [10, 70],
      [170, 70],
    ]);
    const half = 3;
    const { stalls, cars } = planParking([LOT], tile, frame, 5000, { m: manifest, roads: walk });
    const without = planParking([LOT], tile, frame, 5000, opts);
    expect(stalls.length).toBeLessThan(without.stalls.length);
    const a = frame.toLocal(...(ll(10, 70) as [number, number])) as P;
    const b = frame.toLocal(...(ll(170, 70) as [number, number])) as P;
    for (const s of stallsOf(stalls)) expect(distSeg(s.x, s.z, a, b)).toBeGreaterThan(half);
    for (const c of cars) expect(distSeg(c.x, c.z, a, b)).toBeGreaterThan(half);
  });

  it("holds a car in a fixed share of stalls (ruling P4-AF: never mood-dependent)", () => {
    const { stalls, cars } = planParking([BIG], tile, frame, 100000, opts);
    const n = stalls.length / STALL_STRIDE;
    expect(n).toBeGreaterThan(800);
    expect(cars.length / n).toBeGreaterThan(CARS_SHARE - 0.05);
    expect(cars.length / n).toBeLessThan(CARS_SHARE + 0.05);
    expect(CARS_SHARE).toBeCloseTo(0.7);
  });

  it("parks hatchbacks, sedans and MPVs of the vehicles kit, all decorative", () => {
    const { cars } = planParking([BIG], tile, frame, 100000, opts);
    expect(new Set(cars.map((c) => c.variant))).toEqual(new Set(["hatchback", "sedan", "mpv"]));
    expect(manifest.assets.vehicles?.decorative).toBe(true);
    for (const c of cars) {
      expect(c.asset).toBe("vehicles");
      expect(c.id.startsWith("pk:")).toBe(true);
    }
  });

  it("is capped by cap, nearest stalls first, and cap 0 plans nothing", () => {
    const some = planParking([LOT], tile, frame, 40, opts);
    expect(some.stalls.length / STALL_STRIDE).toBe(40);
    expect(some.cars.length).toBeLessThanOrEqual(40);
    const none = planParking([LOT], tile, frame, 0, opts);
    expect(none.stalls.length).toBe(0);
    expect(none.cars).toEqual([]);
  });

  it("splits a lot across a tile edge without double-placing, and is deterministic", () => {
    const f = rect(150, 20, 200, 100); // straddles x = 250
    const a = planParking([f], tileAt(100, 100), frame, 100000, opts);
    const b = planParking([f], tileAt(300, 100), frame, 100000, opts);
    const again = planParking([f], tileAt(100, 100), frame, 100000, opts);
    expect(a.stalls.length).toBeGreaterThan(0);
    expect(b.stalls.length).toBeGreaterThan(0);
    for (const s of stallsOf(a.stalls)) expect(s.x).toBeLessThan(250);
    for (const s of stallsOf(b.stalls)) expect(s.x).toBeGreaterThanOrEqual(250);
    const ids = new Set(a.cars.map((c) => c.id));
    for (const c of b.cars) expect(ids.has(c.id)).toBe(false);
    expect([...again.stalls]).toEqual([...a.stalls]);
    expect(again.cars).toEqual(a.cars);
  });

  it("plans nothing for a tile with no lot and nothing for non-polygon features", () => {
    expect(planParking([LOT], tileAt(900, 900), frame, 100, opts).stalls.length).toBe(0);
    const pt = {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: ll(50, 50) },
    } as unknown as GeoJSON.Feature;
    expect(planParking([pt], tile, frame, 100, opts).stalls.length).toBe(0);
  });
});
