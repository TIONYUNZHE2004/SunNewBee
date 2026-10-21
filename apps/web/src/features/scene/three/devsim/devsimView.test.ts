import { describe, expect, it } from "vitest";
import plan from "../../../devsim/fixtures/plan.provisional.json";
import type { DevelopmentPlan } from "../../../devsim/types";
import { createClearance } from "../clearance";
import { createFrame } from "../frame";
import { LIGHT_PRESETS } from "../lighting";
import { speakerGlow, spotBoost } from "./cast";
import {
  DEVSIM_FOV_DEG,
  devsimCamera,
  devsimGrade,
  devsimMoodSource,
  devsimMoodWeights,
} from "./devsimView";
import { inRing, siteGeom, TOWER_STOREY_M } from "./geom";
import { stateAt } from "./state";

const P = plan as DevelopmentPlan;
const frame = createFrame([101.5076, 3.1794]);
const geom = siteGeom(P, frame);

describe("devsim lighting from the sim sun", () => {
  it("day up high, dusk near the horizon, night well below; weights sum to 1", () => {
    const w = (e: number) => devsimMoodWeights({ phase01: 0.5, elevation: e, isNight: e < 0 });
    expect(w(1).day).toBe(1);
    expect(w(-0.4).night).toBe(1);
    expect(w(0.0).dusk).toBeGreaterThan(0.3);
    for (const e of [-0.5, -0.1, 0, 0.1, 0.3, 1]) {
      const x = w(e);
      expect(x.day + x.dusk + x.night).toBeCloseTo(1, 9);
    }
  });

  it("the key light uses the sim time of day", () => {
    expect(devsimMoodSource({ phase01: 0.5, elevation: 1, isNight: false })).toEqual({
      kind: "day",
      t: 720,
    });
  });

  it("Construction alternates day and night moods (10 cycles)", () => {
    let flips = 0;
    let prev: boolean | null = null;
    for (let t = 4; t < 32; t += 0.05) {
      const night = devsimMoodWeights(stateAt(t, P).sun).night > 0.5;
      if (prev !== null && night !== prev) flips++;
      prev = night;
    }
    expect(flips).toBeGreaterThanOrEqual(18);
  });
});

describe("devsim lighting follows the prototype palette (gate 2: 18:45 was lit like midday)", () => {
  it("18:45 on Day 30 is dusk, Construction nights are night, midday is day", () => {
    const w = (t: number) => devsimMoodWeights(stateAt(t, P).sun);
    expect(w(60).dusk).toBeGreaterThan(0.9);
    expect(w(11).night).toBe(1);
    expect(w(37).night).toBeGreaterThan(0.6);
    expect(w(54).day).toBe(1);
  });

  it("the devsim grade darkens dusk and night, and leaves the day alone", () => {
    const base = LIGHT_PRESETS.night;
    const night = devsimGrade(base, { day: 0, dusk: 0, night: 1 });
    expect(night.exposure).toBeLessThan(base.exposure * 0.6);
    expect(night.envIntensity).toBeLessThan(base.envIntensity);
    expect(devsimGrade(LIGHT_PRESETS.day, { day: 1, dusk: 0, night: 0 })).toEqual(
      LIGHT_PRESETS.day,
    );
  });

  it("Spotlight Residents grow with distance in the wide beats only (gate 2 loop 2)", () => {
    expect(spotBoost(40)).toBe(1);
    expect(spotBoost(120)).toBeGreaterThan(1.5);
    expect(spotBoost(250)).toBeCloseTo(2.4, 9);
  });

  it("the speaker's backlight is off by day and on at dusk and night", () => {
    const g = (t: number) => speakerGlow(stateAt(t, P).sun);
    expect(g(54)).toBe(0);
    expect(g(37)).toBeGreaterThan(0.9);
    expect(g(60)).toBeGreaterThan(0.9);
  });
});

describe("devsim camera (Q2)", () => {
  it("never inside the tower or a city building at any 0.25 s step", () => {
    // a city block right under the closest beat's camera, plus the tower
    const c0 = devsimCamera(stateAt(40, P), frame, geom, 0, null);
    const box = (x: number, z: number, top: number) => ({
      id: "b",
      ring: [
        [x - 15, z - 15],
        [x + 15, z - 15],
        [x + 15, z + 15],
        [x - 15, z + 15],
      ] as [number, number][],
      topM: top,
    });
    const grid = createClearance([box(c0.position[0], c0.position[2], 60)]);
    for (let t = 0; t <= P.total_s; t += 0.25) {
      const s = stateAt(t, P);
      const top = Math.max(0, s.floorsBuilt) * TOWER_STOREY_M;
      const cam = devsimCamera(s, frame, geom, top, grid);
      const [x, y, z] = cam.position;
      expect(grid.topAt(x, z) > y, `city building at t=${t}`).toBe(false);
      expect(top > 0 && y < top && inRing(geom.ring, x, z), `tower at t=${t}`).toBe(false);
    }
  });

  it("follows StateAt.camera: target to local, offset east/north/up", () => {
    const s = stateAt(12, P);
    const cam = devsimCamera(s, frame, geom, 0, null);
    const [tx, tz] = frame.toLocal(s.camera.target[0], s.camera.target[1]);
    expect(cam.look[0]).toBeCloseTo(tx, 6);
    expect(cam.look[2]).toBeCloseTo(tz, 6);
    expect(cam.position[0] - tx).toBeCloseTo(s.camera.offset[0], 6);
    expect(cam.position[2] - tz).toBeCloseTo(-s.camera.offset[1], 6);
  });

  it("is a pure function of t: a seek from anywhere gives the same pose and pinned fov", () => {
    const at = (t: number) => devsimCamera(stateAt(t, P), frame, geom, 40, null);
    const want = at(24);
    for (const from of [0, 23.9, 30, 66, 10]) {
      at(from);
      expect(at(24)).toEqual(want);
    }
    expect(want.fovDeg).toBe(DEVSIM_FOV_DEG);
  });
});
