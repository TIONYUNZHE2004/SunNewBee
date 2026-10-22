import { describe, expect, it } from "vitest";
import elmina from "../../../devsim/fixtures/plan.elmina.json";
import { BUILD_CAM_KEYS, cameraSiteWeight } from "../../../devsim/timeline";
import type { DevelopmentPlan } from "../../../devsim/types";
import {
  CLEAR_GLIDE_MS,
  type DevsimCameraPose,
  FRAME_INSET,
  framingOffset,
  glideRect,
  projectPose,
} from "./devsimView";

const plan = elmina as unknown as DevelopmentPlan;
const size: [number, number] = [922, 800];
// looking north at the origin from 200 m south, 120 m up
const pose: DevsimCameraPose = { position: [0, 120, 200], look: [0, 0, 0], fovDeg: 38 };
/** Where `p` is drawn with the view offset `off` (the engine's setViewOffset). */
const drawn = (p: [number, number, number], off: readonly [number, number] | null) => {
  const s = projectPose(pose, size, p) as [number, number];
  return off ? [s[0] - off[0], s[1] - off[1]] : s;
};
const inside = (q: number[], r: { x: number; y: number; w: number; h: number }) =>
  (q[0] as number) >= r.x &&
  (q[0] as number) <= r.x + r.w &&
  (q[1] as number) >= r.y &&
  (q[1] as number) <= r.y + r.h;

describe("framingOffset (V2 fix B-a: the beat's subject in the clear map area)", () => {
  it("without a clear area: no offset (the panel's applies)", () => {
    expect(framingOffset({ pose, size, clear: null, site: [0, 0, 0], siteWeight: 1 })).toBeNull();
  });

  it("a beat aimed at the site puts the site at the clear area's centre (7 s / 21 s / 36 s areas)", () => {
    const areas = [
      { x: 460, y: 0, w: 462, h: 588 }, // 7 s: right of the left stack
      { x: 0, y: 210, w: 922, h: 378 }, // 21 s: below the HUD, above the bars
      { x: 0, y: 236, w: 508, h: 256 }, // 36 s: left of the brief
    ];
    for (const clear of areas) {
      const off = framingOffset({ pose, size, clear, site: [0, 0, 0], siteWeight: 1 });
      const q = drawn([0, 0, 0], off);
      expect(q[0]).toBeCloseTo(clear.x + clear.w / 2, 3);
      expect(q[1]).toBeCloseTo(clear.y + clear.h / 2, 3);
    }
  });

  it("a beat aimed between the site and a person centres their midpoint, keeping the site inside the clear area", () => {
    const clear = { x: 460, y: 0, w: 462, h: 588 };
    // the site 60 m west of the look point (drawn far left of it)
    const site: [number, number, number] = [-60, 0, 0];
    const off = framingOffset({ pose, size, clear, site, siteWeight: 1 });
    const s = drawn(site, off);
    const inner = {
      x: clear.x + clear.w * FRAME_INSET,
      y: clear.y + clear.h * FRAME_INSET,
      w: clear.w * (1 - 2 * FRAME_INSET),
      h: clear.h * (1 - 2 * FRAME_INSET),
    };
    expect(inside(s, inner)).toBe(true);
    // and the look point (the person) is still drawn in the clear area
    expect(inside(drawn([0, 0, 0], off), clear)).toBe(true);
  });

  it("a beat aimed at a person (weight 0) centres the look point, wherever the site is", () => {
    const clear = { x: 0, y: 236, w: 508, h: 256 };
    const off = framingOffset({ pose, size, clear, site: [500, 0, -500], siteWeight: 0 });
    const q = drawn([0, 0, 0], off);
    expect(q[0]).toBeCloseTo(254, 3);
    expect(q[1]).toBeCloseTo(364, 3);
  });
});

describe("cameraSiteWeight (45 s plan)", () => {
  it("1 on site beats (hoarding, tower, Daily Life), 0 on Farid and the door, eased between", () => {
    expect(cameraSiteWeight(7, plan)).toBe(1);
    expect(cameraSiteWeight(21, plan)).toBe(1);
    expect(cameraSiteWeight(36, plan)).toBe(1);
    expect(cameraSiteWeight(15, plan)).toBe(0); // Farid
    expect(cameraSiteWeight(30, plan)).toBe(0); // the door
    const mid = cameraSiteWeight(27.4, plan);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // continuous: no jump between two close times inside a fly
    for (let t = 26.6; t < 28.2; t += 0.05)
      expect(Math.abs(cameraSiteWeight(t + 0.05, plan) - cameraSiteWeight(t, plan))).toBeLessThan(
        0.2,
      );
    expect(BUILD_CAM_KEYS.length).toBeGreaterThan(0);
  });
});

describe("glideRect", () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  const b = { x: 100, y: 0, w: 100, h: 100 };
  it("snaps when paused or first set; glides while playing", () => {
    expect(glideRect(a, b, 16, false)).toEqual(b);
    expect(glideRect(null, b, 16, true)).toEqual(b);
    const g = glideRect(a, b, CLEAR_GLIDE_MS, true) as typeof a;
    expect(g.x).toBeCloseTo(100 * (1 - Math.exp(-1)), 6);
    expect(glideRect(a, null, 16, true)).toBeNull();
  });
});
