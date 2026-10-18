import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../lib/api";
import type { Placement } from "./assets/fit";
import type { Manifest } from "./assets/manifest";
import type { CityPlan } from "./assets/plan";
import { HERO_CENTRE } from "./bookmarks";
import { poseToCamera } from "./cameraRig";
import {
  CLEARANCE_M,
  createClearance,
  type Obstacle,
  obstaclesFromCity,
  RAMP_SLOPE,
  stepClearance,
  type Vec3,
} from "./clearance";
import { createFrame } from "./frame";

const square = (id: string, cx: number, cz: number, half: number, topM: number): Obstacle => ({
  id,
  ring: [
    [cx - half, cz - half],
    [cx + half, cz - half],
    [cx + half, cz + half],
    [cx - half, cz + half],
  ],
  topM,
});

/** Two towers and an L-shaped (concave) block. */
const city = () =>
  createClearance([
    square("a", 0, 0, 10, 30),
    square("b", 100, 0, 10, 60),
    {
      id: "L",
      ring: [
        [-100, -100],
        [-60, -100],
        [-60, -90],
        [-90, -90],
        [-90, -60],
        [-100, -60],
      ],
      topM: 12,
    },
  ]);

describe("clearance grid lookups", () => {
  it("topAt finds the footprint under a point, concave rings included", () => {
    const c = city();
    expect(c.count).toBe(3);
    expect(c.maxTopM).toBe(60);
    expect(c.topAt(0, 0)).toBe(30);
    expect(c.topAt(9.9, -9.9)).toBe(30);
    expect(c.topAt(10.5, 0)).toBe(0);
    expect(c.topAt(105, 5)).toBe(60);
    expect(c.topAt(-95, -95)).toBe(12);
    // The notch of the L is outside it.
    expect(c.topAt(-75, -75)).toBe(0);
  });

  it("maxRoofNear takes the tallest footprint within the radius", () => {
    const c = city();
    expect(c.maxRoofNear(50, 0, 10)).toBe(0);
    expect(c.maxRoofNear(50, 0, 41)).toBe(60);
    expect(c.maxRoofNear(25, 0, 16)).toBe(30);
    expect(c.maxRoofNear(0, 0, 0)).toBe(30);
  });

  it("floorAt is roof + clearance inside and ramps down outside", () => {
    const c = city();
    expect(c.floorAt(0, 0)).toBeCloseTo(30 + CLEARANCE_M);
    expect(c.floorAt(14, 0)).toBeCloseTo(30 + CLEARANCE_M - RAMP_SLOPE * 4);
    expect(c.floorAt(50, 200)).toBe(0);
    // Continuous across the wall: no pop when panning over the edge.
    expect(Math.abs(c.floorAt(10.01, 0) - c.floorAt(9.99, 0))).toBeLessThan(0.05);
  });

  it("an empty grid never lifts", () => {
    const c = createClearance([]);
    expect(c.floorAt(0, 0)).toBe(0);
    expect(c.clearCameraPose([0, 5, 0], [10, 0, 10]).lifted).toBe(false);
    expect(c.segmentHitsBuilding([0, 1, 0], [100, 1, 0])).toBeNull();
  });

  it("drops bad obstacles", () => {
    const c = createClearance([
      { id: "flat", ring: square("x", 0, 0, 5, 10).ring, topM: 0 },
      {
        id: "line",
        ring: [
          [0, 0],
          [1, 1],
        ],
        topM: 10,
      },
      {
        id: "nan",
        ring: [
          [0, 0],
          [Number.NaN, 1],
          [1, 0],
        ],
        topM: 10,
      },
    ]);
    expect(c.count).toBe(0);
  });
});

describe("segment tests", () => {
  it("segmentHitsBuilding reports the first column below its roof", () => {
    const c = city();
    const hit = c.segmentHitsBuilding([-50, 20, 0], [150, 20, 0]);
    expect(hit?.id).toBe("a");
    expect(hit?.s).toBeCloseTo(40 / 200);
    // Above both roofs: clear. Between the roofs in height: only the tall one.
    expect(c.segmentHitsBuilding([-50, 70, 0], [150, 70, 0])).toBeNull();
    expect(c.segmentHitsBuilding([-50, 45, 0], [150, 45, 0])?.id).toBe("b");
    // Descending line: enters b's column part-way.
    const d = c.segmentHitsBuilding([60, 100, 0], [140, 20, 0]);
    expect(d?.id).toBe("b");
    expect(d?.s).toBeCloseTo(0.5);
    // Margin raises the roof.
    expect(c.segmentHitsBuilding([-50, 31, 0], [50, 31, 0])).toBeNull();
    expect(c.segmentHitsBuilding([-50, 31, 0], [50, 31, 0], 2)?.id).toBe("a");
  });

  it("segmentLiftM lifts over a building between camera and target, never for the target's own", () => {
    const c = city();
    // Camera at x=-60, target on the ground at x=60: tower a (x -10..10) is in between.
    const need = c.segmentLiftM([-60, 5, 0], [60, 0, 0]);
    // The far edge (x=10) is at s = 70/120; the line must be at 32 m there.
    const s = 70 / 120;
    expect(need).toBeCloseTo((30 + CLEARANCE_M) / (1 - s));
    // Lifted to that height, the segment clears the roof by the clearance.
    expect(c.segmentHitsBuilding([-60, need, 0], [60, 0, 0], CLEARANCE_M - 1e-6)).toBeNull();
    // The target inside tower b: b is the subject and never lifts.
    expect(c.segmentLiftM([60, 5, 0], [100, 0, 0])).toBe(0);
    // A building only near the target (beyond the near share) does not lift.
    expect(c.segmentLiftM([-200, 5, 0], [15, 0, 0])).toBe(0);
  });

  it("clearCameraPose keeps x and z and only raises y", () => {
    const c = city();
    const cam: Vec3 = [0, 10, 0];
    const r = c.clearCameraPose(cam, [60, 0, 60]);
    expect(r.position[0]).toBe(0);
    expect(r.position[2]).toBe(0);
    expect(r.position[1]).toBeGreaterThanOrEqual(30 + CLEARANCE_M);
    expect(r.lifted).toBe(true);
    const high = c.clearCameraPose([0, 500, 0], [60, 0, 60]);
    expect(high.lifted).toBe(false);
    expect(high.position[1]).toBe(500);
  });
});

describe("stepClearance (rig easing)", () => {
  it("applies the floor at once and eases the segment lift", () => {
    const c = city();
    // Inside tower a below its roof: hard floor in one step.
    const a = stepClearance(c, [0, 5, 0], [60, 0, 0], 16, false);
    expect(a.y).toBeGreaterThanOrEqual(32);
    // Segment lift only (camera outside, low): eased, not settled after one frame.
    const cam: Vec3 = [-60, 5, 0];
    const goal = c.clearCameraPose(cam, [60, 0, 0]).position[1];
    const s1 = stepClearance(c, cam, [60, 0, 0], 16, false);
    expect(s1.settled).toBe(false);
    expect(s1.y).toBeGreaterThan(5);
    expect(s1.y).toBeLessThan(goal);
    // Converges.
    let y = s1.y;
    for (let i = 0; i < 200; i++) {
      const s = stepClearance(c, [-60, y, 0], [60, 0, 0], 16, false);
      y = s.y;
      if (s.settled) break;
    }
    expect(y).toBeCloseTo(goal, 1);
    // Reduced motion: at once.
    const r = stepClearance(c, cam, [60, 0, 0], 16, true);
    expect(r).toEqual({ y: goal, settled: true });
  });

  it("random poses around towers never end inside a footprint below roof + clearance", () => {
    const c = city();
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 2000; i++) {
      const cam: Vec3 = [rnd() * 260 - 130, rnd() * 80, rnd() * 260 - 130];
      const tgt: Vec3 = [rnd() * 260 - 130, 0, rnd() * 260 - 130];
      const { y } = stepClearance(c, cam, tgt, 16, false);
      const top = c.topAt(cam[0], cam[2]);
      if (top > 0) expect(y).toBeGreaterThanOrEqual(top + CLEARANCE_M - 1e-9);
      expect(y).toBeGreaterThanOrEqual(cam[1]);
    }
  });
});

describe("obstaclesFromCity", () => {
  const frame = createFrame([101.5, 3.18]);
  const ll = (x: number, z: number) => frame.toLonLat(x, z);
  const poly = (id: string, pts: [number, number][], props: Record<string, unknown> = {}) => ({
    type: "Feature",
    properties: { id, ...props },
    geometry: {
      type: "Polygon",
      coordinates: [[...pts, pts[0] as [number, number]].map(([x, z]) => ll(x, z))],
    },
  });

  it("takes every footprint at its display height and every placed box at its fitted size", () => {
    const layer = {
      buildings: {
        type: "FeatureCollection",
        features: [
          poly(
            "b1",
            [
              [0, 0],
              [20, 0],
              [20, 20],
              [0, 20],
            ],
            { height_m: 9, display_height_m: 12 },
          ),
        ],
      },
    } as unknown as BuildingsLayer;
    const unit: Placement = {
      id: "b2",
      asset: "tower",
      variant: "v",
      x: 100,
      z: 0,
      yaw: Math.PI / 2,
      sx: 1,
      sy: 1.5,
      sz: 1,
      palette: ["#000", "#000", "#000"],
    };
    const manifest = {
      assets: { tower: { variants: { v: { size: [10, 40, 30], lods: [] } } } },
    } as unknown as Manifest;
    const plan = {
      placements: new Map([["tower/v", [unit]]]),
      extrude: new Set(["b1"]),
      landmarks: [],
      stats: { placed: 1, units: 1, fallback: {} },
    } as unknown as CityPlan;
    const obs = obstaclesFromCity(layer, frame, plan, manifest);
    expect(obs.map((o) => o.id)).toEqual(["b1", "b2"]);
    expect(obs[0]?.topM).toBe(12);
    expect(obs[1]?.topM).toBe(60);
    const c = createClearance(obs);
    expect(c.topAt(10, 10)).toBe(12);
    // Yaw 90 degrees: the 10 m (x) by 30 m (z) box lies 30 m along x, 10 m along z.
    expect(c.topAt(114, 0)).toBe(60);
    expect(c.topAt(100, 8)).toBe(0);
  });
});

// The Elmina seed (skipped when the seed is not checked out).
const SEED = new URL("../../../../../../data/seed/elmina/base/buildings.geojson", import.meta.url);
describe.skipIf(!existsSync(SEED))("seed footprints", () => {
  const layer = { buildings: JSON.parse(readFileSync(SEED, "utf8")) } as unknown as BuildingsLayer;
  const frame = createFrame(HERO_CENTRE);
  const obs = obstaclesFromCity(layer, frame);
  const c = createClearance(obs);

  it("indexes the seed buildings and finds each footprint's own roof at its centroid", () => {
    expect(c.count).toBeGreaterThan(1000);
    let checked = 0;
    for (const o of obs.slice(0, 400)) {
      // A point well inside: the centroid of a convex-ish ring; skip rings where it falls outside.
      const n = o.ring.length;
      const cx = o.ring.reduce((s, p) => s + p[0], 0) / n;
      const cz = o.ring.reduce((s, p) => s + p[1], 0) / n;
      if (createClearance([o]).topAt(cx, cz) === 0) continue;
      checked++;
      const top = c.topAt(cx, cz);
      expect(top).toBeGreaterThanOrEqual(o.topM);
      expect(c.floorAt(cx, cz)).toBeGreaterThanOrEqual(top + CLEARANCE_M - 1e-9);
    }
    expect(checked).toBeGreaterThan(300);
  });

  it("hero-district orbit poses: the cleared camera is never inside a footprint below roof + 2 m", () => {
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    let lifted = 0;
    const t0 = performance.now();
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const p = poseToCamera({
        target: [rnd() * 1200 - 600, rnd() * 1200 - 600],
        rangeM: 30 + rnd() * 300,
        pitchDeg: -5 - rnd() * 60,
        headingDeg: rnd() * 360,
      });
      const r = c.clearCameraPose(p.position, p.target);
      if (r.lifted) lifted++;
      const [x, y, z] = r.position;
      const top = c.topAt(x, z);
      if (top > 0) expect(y).toBeGreaterThanOrEqual(top + CLEARANCE_M - 1e-9);
    }
    const msPer = (performance.now() - t0) / N;
    expect(lifted).toBeGreaterThan(0);
    // Fast enough for every frame (generous for CI machines).
    expect(msPer).toBeLessThan(2);
  });
});
