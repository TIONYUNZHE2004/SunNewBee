import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../lib/api";
import type { Placement } from "./assets/fit";
import type { Manifest } from "./assets/manifest";
import type { CityPlan } from "./assets/plan";
import { HERO_CENTRE } from "./bookmarks";
import { poseToCamera } from "./cameraRig";
import { buildCityGeometry } from "./cityMesh";
import {
  CLEARANCE_M,
  createClearance,
  createLift,
  MAX_SKIRT_M,
  type Obstacle,
  obstaclesFromCity,
  PAD_M,
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

  it("floorAt is roof + clearance inside a footprint and its pad, 0 beyond (no long ramp)", () => {
    const c = city();
    expect(c.floorAt(0, 0)).toBeCloseTo(30 + CLEARANCE_M);
    expect(c.floorAt(10 + PAD_M * 0.9, 0)).toBeCloseTo(30 + CLEARANCE_M);
    expect(c.floorAt(10 + PAD_M + 0.1, 0)).toBe(0);
    expect(c.floorAt(50, 200)).toBe(0);
  });

  it("a 3 m street camera 6 m from a 30 m wall is not lifted (review A-T7 r1)", () => {
    const c = city();
    // Tower a's east wall is at x = 10; the camera stands at x = 16, looking north along the wall.
    const r = c.clearCameraPose([16, 3, 0], [16, 0, -60]);
    expect(r.lifted).toBe(false);
    expect(r.position[1]).toBe(3);
    // Looking away from the wall too.
    expect(c.clearCameraPose([16, 3, 0], [76, 0, 0]).lifted).toBe(false);
  });

  it("an optional short skirt ramps beyond the pad, capped at MAX_SKIRT_M, and can be dropped per call", () => {
    const c = createClearance([square("a", 0, 0, 10, 30)], { skirtM: 8 });
    const peak = 30 + CLEARANCE_M;
    expect(c.floorAt(10 + PAD_M + 4, 0)).toBeCloseTo(peak / 2);
    expect(c.floorAt(10 + PAD_M + 8.1, 0)).toBe(0);
    expect(c.floorAt(10 + PAD_M + 4, 0, 0)).toBe(0);
    expect(c.clearCameraPose([10 + PAD_M + 4, 3, 0], [60, 0, 0], { skirtM: 0 }).lifted).toBe(false);
    const big = createClearance([square("a", 0, 0, 10, 30)], { skirtM: 100 });
    expect(big.floorAt(10 + PAD_M + MAX_SKIRT_M + 0.1, 0)).toBe(0);
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

describe("createLift (eased lift state)", () => {
  it("applies the floor at once and eases the segment lift up", () => {
    const c = city();
    // Inside tower a below its roof: hard floor on an eased step.
    const l0 = createLift();
    l0.step(c, [-200, 300, 0], [-150, 0, 0], 16, false);
    expect(l0.step(c, [0, 5, 0], [60, 0, 0], 16, false).y).toBeGreaterThanOrEqual(32);
    // Segment lift only (camera outside, low): eased, not settled after one frame.
    const l = createLift();
    l.step(c, [-60, 5, 200], [60, 0, 200], 16, false); // history: nothing in the way
    const cam: Vec3 = [-60, 5, 0];
    const goal = c.clearCameraPose(cam, [60, 0, 0]).position[1];
    const s1 = l.step(c, cam, [60, 0, 0], 16, false);
    expect(s1.settled).toBe(false);
    expect(s1.y).toBeGreaterThan(5);
    expect(s1.y).toBeLessThan(goal);
    let last = s1;
    for (let i = 0; i < 200 && !last.settled; i++) last = l.step(c, cam, [60, 0, 0], 16, false);
    expect(last.y).toBe(goal);
    // Reduced motion: at once.
    const r = createLift();
    r.step(c, [-60, 5, 200], [60, 0, 200], 16, true);
    expect(r.step(c, cam, [60, 0, 0], 16, true)).toEqual({
      y: goal,
      liftM: goal - 5,
      settled: true,
    });
  });

  it("keeps the eased lift across frames that re-apply the base pose (rig flights)", () => {
    const c = city();
    const l = createLift();
    l.step(c, [-60, 5, 200], [60, 0, 200], 16, false);
    const goal = c.clearCameraPose([-60, 5, 0], [60, 0, 0]).position[1];
    // A flight re-applies the same unlifted tween pose every frame: the lift still converges.
    let s = l.step(c, [-60, 5, 0], [60, 0, 0], 16, false);
    for (let i = 0; i < 120; i++) s = l.step(c, [-60, 5, 0], [60, 0, 0], 16, false);
    expect(s.y).toBeCloseTo(goal, 1);
  });

  it("reset() (a teleport) applies the new lift at once instead of easing from the old place", () => {
    const c = city();
    const l = createLift();
    l.step(c, [-60, 5, 200], [60, 0, 200], 16, false); // nothing in the way: lift 0
    const goal = c.clearCameraPose([-60, 5, 0], [60, 0, 0]).position[1];
    expect(l.step(c, [-60, 5, 0], [60, 0, 0], 16, false).y).toBeLessThan(goal); // eased
    l.step(c, [-60, 5, 200], [60, 0, 200], 16, true); // back to lift 0
    l.reset();
    expect(l.step(c, [-60, 5, 0], [60, 0, 0], 16, false).y).toBe(goal); // at once
  });

  it("eases back down when the obstacle is gone, and never ratchets the base", () => {
    const c = city();
    const l = createLift();
    l.step(c, [-60, 5, 0], [60, 0, 0], 16, true); // lifted at once
    const down1 = l.step(c, [-60, 5, 200], [60, 0, 200], 16, false);
    expect(down1.y).toBeGreaterThan(5);
    expect(down1.settled).toBe(false);
    let s = down1;
    for (let i = 0; i < 200 && !s.settled; i++)
      s = l.step(c, [-60, 5, 200], [60, 0, 200], 16, false);
    expect(s.y).toBe(5);
    expect(s.liftM).toBe(0);
  });

  it("random poses around towers never end inside a footprint below roof + clearance, never over-lift", () => {
    const c = city();
    const l = createLift();
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    let prevLift = 0;
    for (let i = 0; i < 2000; i++) {
      const cam: Vec3 = [rnd() * 260 - 130, rnd() * 80, rnd() * 260 - 130];
      const tgt: Vec3 = [rnd() * 260 - 130, 0, rnd() * 260 - 130];
      const goal = c.clearCameraPose(cam, tgt).position[1];
      const { y, liftM } = l.step(c, cam, tgt, 16, false);
      const top = c.topAt(cam[0], cam[2]);
      if (top > 0) expect(y).toBeGreaterThanOrEqual(top + CLEARANCE_M - 1e-9);
      // Never above both the goal and the previous (decaying) lift.
      expect(y).toBeLessThanOrEqual(Math.max(goal, cam[1] + prevLift) + 1e-9);
      prevLift = liftM;
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

  it("uses the drawn geometry bounds (boxOf) over the manifest size: off-centre and taller", () => {
    const unit: Placement = {
      id: "m",
      asset: "mall",
      variant: "osm",
      x: 0,
      z: 0,
      yaw: 0,
      sx: 2,
      sy: 1,
      sz: 1,
      palette: ["#000", "#000", "#000"],
    };
    const manifest = {
      assets: { mall: { variants: { osm: { size: [10, 9, 10], lods: [] } } } },
    } as unknown as Manifest;
    const plan = {
      placements: new Map(),
      extrude: new Set(),
      landmarks: [unit],
      stats: { placed: 0, units: 0, fallback: {} },
    } as unknown as CityPlan;
    const boxOf = () => ({ minX: 0, maxX: 10, minZ: -5, maxZ: 5, maxY: 11.5 });
    const c = createClearance(obstaclesFromCity(null, frame, plan, manifest, boxOf));
    // x from 0 to 20 (scale 2), top 11.5 (not the manifest's 9).
    expect(c.topAt(15, 0)).toBe(11.5);
    expect(c.topAt(-3, 0)).toBe(0);
    // Without boxOf: the manifest size centred on the origin.
    const m = createClearance(obstaclesFromCity(null, frame, plan, manifest));
    expect(m.topAt(-3, 0)).toBe(9);
  });
});

// The Elmina seed (skipped when the seed is not checked out).
const SEED = new URL("../../../../../../data/seed/elmina/base/buildings.geojson", import.meta.url);
describe.skipIf(!existsSync(SEED))("seed footprints", () => {
  const layer = { buildings: JSON.parse(readFileSync(SEED, "utf8")) } as unknown as BuildingsLayer;
  const frame = createFrame(HERO_CENTRE);
  const obs = obstaclesFromCity(layer, frame);
  const c = createClearance(obs);

  it("independent check: every extruded vertex of buildCityGeometry is under the grid's roof", () => {
    const g = buildCityGeometry(layer, frame);
    const pos = g.buildings.getAttribute("position");
    const { starts } = g.faces;
    let checked = 0;
    let worst = Number.NEGATIVE_INFINITY;
    g.footprints.forEach((fp, i) => {
      const t0 = starts[i] as number;
      const t1 = (starts[i + 1] as number | undefined) ?? pos.count / 3;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let v = t0 * 3; v < t1 * 3; v++) maxY = Math.max(maxY, pos.getY(v));
      // An interior sample: the ring centroid, when it falls inside the drawn ring.
      const n = fp.ring.length;
      const cx = fp.ring.reduce((a, p) => a + p[0], 0) / n;
      const cz = fp.ring.reduce((a, p) => a + p[1], 0) / n;
      if (createClearance([{ id: fp.id, ring: fp.ring, topM: 1 }]).topAt(cx, cz) === 0) return;
      checked++;
      worst = Math.max(worst, maxY - c.topAt(cx, cz));
    });
    expect(checked).toBeGreaterThan(5000);
    // The drawn mesh never rises above the grid's roof at that point (float tolerance).
    expect(worst).toBeLessThanOrEqual(1e-3);
  });

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
