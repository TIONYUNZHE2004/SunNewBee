import { describe, expect, it } from "vitest";
import {
  clampPitch,
  clampToBounds,
  keyAction,
  LIMITS,
  moveVector,
  orbitStep,
  STEP,
} from "./cameraMath";

const deg = (d: number) => (d * Math.PI) / 180;

describe("clampPitch", () => {
  it("never tilts closer than 5 degrees to the horizon, nor past straight down", () => {
    expect(clampPitch(deg(10))).toBeCloseTo(LIMITS.maxPitchRad);
    expect(clampPitch(deg(-3))).toBeCloseTo(LIMITS.maxPitchRad);
    expect(clampPitch(deg(-40))).toBeCloseTo(deg(-40));
    expect(clampPitch(deg(-120))).toBeCloseTo(deg(-90));
  });
});

describe("orbitStep", () => {
  it("adds heading (wrapped to 0..2pi) and pitch, clamps pitch and range", () => {
    const h = { heading: deg(350), pitch: deg(-35), range: 1200 };
    const r = orbitStep(h, deg(20), deg(-10));
    expect(r.heading).toBeCloseTo(deg(10));
    expect(r.pitch).toBeCloseTo(deg(-45));
    expect(r.range).toBe(1200);
    expect(orbitStep(h, 0, deg(60)).pitch).toBeCloseTo(LIMITS.maxPitchRad);
    expect(orbitStep(h, 0, 0, 1e-6).range).toBe(LIMITS.minRangeM);
    expect(orbitStep(h, 0, 0, 1e6).range).toBe(LIMITS.maxRangeM);
  });
});

describe("moveVector", () => {
  it("forward follows the heading, right is 90 degrees clockwise of it", () => {
    const [e1, n1] = moveVector(0, 0, 10); // facing north
    expect(e1).toBeCloseTo(0);
    expect(n1).toBeCloseTo(10);
    const [e2, n2] = moveVector(deg(90), 0, 10); // facing east
    expect(e2).toBeCloseTo(10);
    expect(n2).toBeCloseTo(0);
    const [e3, n3] = moveVector(0, 10, 0); // right while facing north = east
    expect(e3).toBeCloseTo(10);
    expect(n3).toBeCloseTo(0);
  });
});

describe("clampToBounds", () => {
  const bbox: [number, number, number, number] = [101.46, 3.15, 101.53, 3.24];
  it("keeps points inside the bbox plus margin", () => {
    expect(clampToBounds(101.5, 3.2, bbox, 5000)).toEqual([101.5, 3.2]);
    const [lon, lat] = clampToBounds(102.5, 2.0, bbox, 5000);
    expect(lon).toBeCloseTo(101.53 + 5000 / (111_320 * Math.cos(deg(3.195))), 4);
    expect(lat).toBeCloseTo(3.15 - 5000 / 111_320, 4);
  });
});

describe("keyAction", () => {
  it("maps WASD/arrows, Q/E, R/F and +/-", () => {
    expect(keyAction("w")).toEqual({ kind: "move", right: 0, forward: 1 });
    expect(keyAction("ArrowLeft")).toEqual({ kind: "move", right: -1, forward: 0 });
    expect(keyAction("q")).toEqual({ kind: "orbit", dHeading: -STEP.orbitRad, dPitch: 0 });
    expect(keyAction("R")).toEqual({ kind: "orbit", dHeading: 0, dPitch: STEP.tiltRad });
    expect(keyAction("+")).toEqual({ kind: "zoom", factor: STEP.zoomIn });
    expect(keyAction("-")).toEqual({ kind: "zoom", factor: STEP.zoomOut });
    expect(keyAction("Enter")).toBeNull();
  });
});
