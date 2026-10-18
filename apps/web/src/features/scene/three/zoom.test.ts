import { describe, expect, it } from "vitest";
import { LIMITS } from "./cameraRig";
import {
  attachWheelZoom,
  createZoomTween,
  MAX_NOTCH_CHANGE,
  normaliseDelta,
  SMOOTH_FRAMES,
  zoomStep,
} from "./zoom";

const { minRangeM: MIN, maxRangeM: MAX } = LIMITS;

function notchesIn(from: number, stop: (r: number) => boolean, dy: number) {
  let r = from;
  let n = 0;
  let worst = 0;
  while (!stop(r) && n < 1000) {
    const next = zoomStep(r, dy, MIN, MAX);
    worst = Math.max(worst, Math.abs(next - r) / r);
    r = next;
    n++;
  }
  return { n, worst, r };
}

describe("zoomStep (AC-A7)", () => {
  it("takes 15-25 notches from max range to street level, each at most 20%", () => {
    // 9000 m -> 30 m is a 300x span: 0.8^25 = 1/265, so the exact floor needs 26 notches at 20%.
    // Street level = within 20% of the floor (36 m): 25 notches.
    const near = notchesIn(MAX, (r) => r <= MIN * 1.2, -100);
    expect(near.n).toBeGreaterThanOrEqual(15);
    expect(near.n).toBeLessThanOrEqual(25);
    expect(near.worst).toBeLessThanOrEqual(MAX_NOTCH_CHANGE + 1e-9);
    const exact = notchesIn(MAX, (r) => r <= MIN, -100);
    expect(exact.n).toBe(26);
    expect(exact.r).toBe(MIN);
    expect(exact.worst).toBeLessThanOrEqual(MAX_NOTCH_CHANGE + 1e-9);
  });

  it("is exponential: the step is proportional to the current range", () => {
    for (const r of [40, 400, 4000]) {
      expect((r - zoomStep(r, -100)) / r).toBeCloseTo(0.2, 9);
    }
  });

  it("is monotonic and zoom out inverts zoom in", () => {
    let prev = 5000;
    for (let i = 0; i < 10; i++) {
      const n = zoomStep(prev, -100);
      expect(n).toBeLessThan(prev);
      prev = n;
    }
    expect(zoomStep(zoomStep(1000, -100), 100)).toBeCloseTo(1000, 6);
    expect(zoomStep(1000, 0)).toBe(1000);
    expect(zoomStep(1000, 40)).toBeGreaterThan(1000);
    expect(zoomStep(1000, 40)).toBeLessThan(zoomStep(1000, 100));
  });

  it("never exceeds one notch for huge deltas and clamps to the limits", () => {
    expect(zoomStep(1000, -5000)).toBeCloseTo(800, 9);
    expect(zoomStep(1000, 5000)).toBeCloseTo(1250, 9);
    expect(zoomStep(MIN, -100)).toBe(MIN);
    expect(zoomStep(MAX, 100)).toBe(MAX);
    expect(zoomStep(8000, 100)).toBe(MAX);
  });

  it("handles trackpad deltas: ten 10 px events about equal one notch", () => {
    let r = 1000;
    for (let i = 0; i < 10; i++) r = zoomStep(r, -10);
    expect(r).toBeCloseTo(800, 6);
  });

  it("normalises line and page delta modes", () => {
    expect(normaliseDelta(3, 1)).toBeCloseTo(100, 9);
    expect(normaliseDelta(1, 2)).toBe(100);
    expect(normaliseDelta(-100, 0)).toBe(-100);
  });
});

describe("createZoomTween", () => {
  it("spreads one notch over at least 4 frames and lands on the target", () => {
    const t = createZoomTween();
    t.push(0.8);
    const steps: number[] = [];
    while (t.active) steps.push(t.tick());
    expect(steps.length).toBe(SMOOTH_FRAMES);
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps.filter((s) => s !== 1).length).toBeGreaterThanOrEqual(4);
    expect(steps.reduce((a, b) => a * b, 1)).toBeCloseTo(0.8, 12);
    expect(t.tick()).toBe(1);
  });

  it("composes quick notches and reports the pending factor", () => {
    const t = createZoomTween();
    t.push(0.8);
    t.tick();
    t.push(0.8);
    let total = 1;
    total *= t.pending;
    expect(total).toBeGreaterThan(0.64 * 0.99);
    expect(total).toBeLessThan(0.8 * 1.001);
  });

  it("applies at once with 1 frame (reduced motion)", () => {
    const t = createZoomTween();
    t.push(0.8, 1);
    expect(t.tick()).toBeCloseTo(0.8, 12);
    expect(t.active).toBe(false);
  });
});

describe("attachWheelZoom", () => {
  const rig = (reduced: boolean) => {
    const listeners: ((e: WheelEvent) => void)[] = [];
    const queue: (() => void)[] = [];
    const canvas = {
      addEventListener: (_t: string, l: (e: WheelEvent) => void) => listeners.push(l),
      removeEventListener: () => {},
    } as unknown as HTMLElement;
    let range = 1000;
    const applied: number[] = [];
    attachWheelZoom({
      canvas,
      range: () => range,
      apply: (f) => {
        range *= f;
        applied.push(f);
      },
      reducedMotion: () => reduced,
      minM: MIN,
      maxM: MAX,
      raf: (cb) => queue.push(cb),
    });
    const wheel = (deltaY: number) =>
      listeners[0]?.({
        deltaY,
        deltaMode: 0,
        clientX: 1,
        clientY: 2,
        preventDefault() {},
        stopPropagation() {},
      } as unknown as WheelEvent);
    const frame = () => {
      for (const cb of queue.splice(0)) cb();
    };
    return { wheel, frame, applied, range: () => range };
  };

  it("smooths one notch over >= 4 frames", () => {
    const r = rig(false);
    r.wheel(-100);
    expect(r.applied.length).toBe(0);
    for (let i = 0; i < 10; i++) r.frame();
    expect(r.applied.length).toBeGreaterThanOrEqual(4);
    expect(r.range()).toBeCloseTo(800, 6);
  });

  it("applies in one frame under reduced motion, still one bounded step", () => {
    const r = rig(true);
    r.wheel(-5000);
    expect(r.applied.length).toBe(1);
    expect(r.range()).toBeCloseTo(800, 6);
  });
});
