import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createViewFit, safeRectOf } from "../../../journey/three/viewFit";
import {
  type CamPoseLike,
  fitSafe,
  holdFitWeight,
  insideSafe,
  pullBack,
  SAFE_FIT,
  type Subject,
  turnCamera,
} from "./safeFrame";

/** The acceptance map area (1440 x 900 page, map ~920 x 875) with the top stack ending at 235 px. */
const SIZE: [number, number] = [920, 875];
const VP = { w: 920, h: 860, top: 235 };

function view() {
  const cam = new THREE.PerspectiveCamera(45, SIZE[0] / SIZE[1], 0.5, 30000);
  cam.updateProjectionMatrix();
  return createViewFit(cam, SIZE, safeRectOf(VP));
}

/** A follow-like pose 10 m back, 6 m up, looking at a point near the ground. */
const POSE: CamPoseLike = { pos: [0, 6, 10], look: [0, 0.6, -2] };
/** Her body and a marker 5 m over the route point next to her (the gate's hold-6 case). */
const SUBJECTS: Subject[] = [
  { p: [0, 0.1, 0], padPx: 8 },
  { p: [0, 2.3, 0], padPx: 8 },
  { p: [1, 0.3, -1], padPx: 12 },
  { p: [1, 5, -1], padPx: 36 },
];

describe("safeFrame (UI-safe hold framing)", () => {
  it("turnCamera: + yaw moves the image right, + pitch moves it down; distance kept", () => {
    const v = view();
    const p0 = v.project(POSE, [0, 1, 0]) as [number, number];
    const right = v.project(turnCamera(POSE, 0.05, 0), [0, 1, 0]) as [number, number];
    const down = v.project(turnCamera(POSE, 0, 0.05), [0, 1, 0]) as [number, number];
    expect(right[0]).toBeGreaterThan(p0[0] + 5);
    expect(down[1]).toBeGreaterThan(p0[1] + 5);
    const t = turnCamera(POSE, 0.3, 0.2);
    const d0 = Math.hypot(...POSE.look.map((x, i) => x - (POSE.pos[i] as number)));
    const d1 = Math.hypot(...t.look.map((x, i) => x - (t.pos[i] as number)));
    expect(d1).toBeCloseTo(d0, 6);
    expect(t.pos).toEqual(POSE.pos);
  });

  it("never tilts above the look-down limit", () => {
    const t = turnCamera(POSE, 0, 2);
    const d = t.look.map((x, i) => x - (t.pos[i] as number));
    expect((d[1] as number) / Math.hypot(...d)).toBeLessThanOrEqual(SAFE_FIT.maxUpSlope + 1e-9);
  });

  it("the marker under the header is brought inside the safe area", () => {
    const v = view();
    const mk = v.project(POSE, [1, 5, -1]) as [number, number];
    expect(mk[1]).toBeLessThan(VP.top); // the failing case: the marker sits under the top stack
    const fit = fitSafe(POSE, SUBJECTS, v);
    expect(insideSafe(fit, SUBJECTS, v)).toBe(true);
    // turned (and maybe pulled back) only: the look point stays on the far side of her
    expect(Math.hypot(fit.pos[0] - POSE.pos[0], fit.pos[2] - POSE.pos[2])).toBeLessThan(10);
  });

  it("a pose already inside is unchanged; the fit is deterministic", () => {
    const v = view();
    const low: Subject[] = [{ p: [0, 0.5, -2], padPx: 8 }];
    expect(insideSafe(POSE, low, v)).toBe(true);
    expect(fitSafe(POSE, low, v)).toEqual(POSE);
    expect(fitSafe(POSE, SUBJECTS, v)).toEqual(fitSafe(POSE, SUBJECTS, view()));
  });

  it("a box taller than the safe band is pulled back (at most maxPull)", () => {
    const v = view();
    const close: CamPoseLike = { pos: [0, 3, 6], look: [0, 1, -1] };
    const tall: Subject[] = [
      { p: [0, 0.1, 0], padPx: 8 },
      { p: [0, 4.5, 0], padPx: 36 },
    ];
    const fit = fitSafe(close, tall, v);
    const d0 = Math.hypot(...close.pos.map((x, i) => x - (close.look[i] as number)));
    const d1 = Math.hypot(...fit.pos.map((x, i) => x - (fit.look[i] as number)));
    expect(d1).toBeGreaterThan(d0);
    expect(d1).toBeLessThanOrEqual(d0 * SAFE_FIT.maxPull + 1e-6);
    expect(insideSafe(fit, tall, v)).toBe(true);
  });

  it("pullBack keeps the look point", () => {
    const p = pullBack(POSE, 1.5);
    expect(p.look).toEqual(POSE.look);
  });

  it("the hold weight eases in and out and is 1 mid-hold", () => {
    expect(holdFitWeight(10, 10, 14)).toBe(0);
    expect(holdFitWeight(12, 10, 14)).toBe(1);
    expect(holdFitWeight(14, 10, 14)).toBe(0);
    const a = holdFitWeight(10.3, 10, 14);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });

  it("safeRectOf excludes the top stack and the bottom controls", () => {
    const s = safeRectOf(VP);
    expect(s.t).toBeGreaterThan(VP.top);
    expect(s.b).toBeLessThan(VP.h);
    expect(s.r).toBeLessThan(VP.w);
  });
});
