import { describe, expect, it, vi } from "vitest";
import {
  BUBBLE_FADE_S,
  BUBBLE_MAX_STEP_S,
  BUBBLE_RADIUS_M,
  bubbleFocus,
  createBubbleFader,
  createDetailBubble,
  inBubble,
} from "./detailBubble";

describe("AC-B9 bubble membership", () => {
  const target = { x: 10, z: 20 };
  it("focus is the hero in follow mode while a journey is loaded, else the camera target", () => {
    const hero = { x: 500, z: -40 };
    expect(bubbleFocus({ camMode: "follow", playing: true, hero, target })).toEqual([500, -40]);
    expect(bubbleFocus({ camMode: "overview", playing: true, hero, target })).toEqual([10, 20]);
    expect(bubbleFocus({ camMode: "free", playing: true, hero, target })).toEqual([10, 20]);
    expect(bubbleFocus({ camMode: "follow", playing: false, hero, target })).toEqual([10, 20]);
    expect(bubbleFocus({ camMode: "follow", playing: true, hero: null, target })).toEqual([10, 20]);
    expect(
      bubbleFocus({ camMode: "follow", playing: true, hero: { x: Number.NaN, z: 0 }, target }),
    ).toEqual([10, 20]);
  });

  it("inside means within 150 m of the focus", () => {
    expect(BUBBLE_RADIUS_M).toBe(150);
    expect(inBubble([0, 0], 149.9, 0)).toBe(true);
    expect(inBubble([0, 0], 106, 106)).toBe(true);
    expect(inBubble([0, 0], 150.1, 0)).toBe(false);
    expect(inBubble(null, 0, 0)).toBe(false);
  });

  it("the registry tells clients at once and when the focus moves >= 1 m or is cleared", () => {
    const b = createDetailBubble();
    const c = vi.fn();
    const off = b.register(c);
    expect(c).toHaveBeenLastCalledWith({ focus: null, radiusM: 150 });
    b.setFocus([0, 0]);
    b.setFocus([0.5, 0]);
    expect(c).toHaveBeenCalledTimes(2);
    b.setFocus([2, 0]);
    expect(c).toHaveBeenLastCalledWith({ focus: [2, 0], radiusM: 150 });
    expect(b.contains(100, 0)).toBe(true);
    expect(b.contains(200, 0)).toBe(false);
    b.setFocus(null);
    expect(c).toHaveBeenLastCalledWith({ focus: null, radiusM: 150 });
    off();
    b.setFocus([5, 5]);
    expect(c).toHaveBeenCalledTimes(4);
  });
});

describe("AC-B9 fade at the bubble edge: >= 0.5 s, no single-frame pop", () => {
  /** Runs frames every `dtMs` until the weight reaches `target`; returns the weights. */
  const run = (
    f: ReturnType<typeof createBubbleFader>,
    inside: boolean,
    t0: number,
    dtMs: number,
  ) => {
    const ws: number[] = [];
    let t = t0;
    for (let i = 0; i < 1000; i++) {
      f.begin();
      ws.push(f.weight("a", inside, t));
      if (ws.at(-1) === (inside ? 1 : 0)) break;
      t += dtMs;
    }
    return { ws, t };
  };

  it("fades in over 0.5 s at 60 fps, every frame step <= dt / 0.5 s", () => {
    expect(BUBBLE_FADE_S).toBeGreaterThanOrEqual(0.5);
    const f = createBubbleFader();
    const { ws, t } = run(f, true, 1000, 1000 / 60);
    expect(ws[0]).toBe(0);
    expect(t - 1000).toBeGreaterThanOrEqual(BUBBLE_FADE_S * 1000 - 1);
    for (let i = 1; i < ws.length; i++)
      expect(ws[i]! - ws[i - 1]!).toBeLessThanOrEqual(1 / 60 / 0.5 + 1e-9);
    expect(f.fading()).toBe(false);
    // and out again
    const out = run(f, false, t, 1000 / 60);
    expect(out.t - t).toBeGreaterThanOrEqual(BUBBLE_FADE_S * 1000 - 1);
  });

  it("a long frame gap never pops: one frame moves at most MAX_STEP / FADE", () => {
    const f = createBubbleFader();
    f.begin();
    f.weight("a", true, 0);
    f.begin();
    const w = f.weight("a", true, 5000);
    expect(w).toBeCloseTo(BUBBLE_MAX_STEP_S / BUBBLE_FADE_S, 9);
    expect(w).toBeLessThan(0.5);
    // so a fade always spans at least FADE / MAX_STEP frames
    const { ws } = run(f, true, 10_000, 2000);
    expect(ws.length).toBeGreaterThanOrEqual(BUBBLE_FADE_S / BUBBLE_MAX_STEP_S - 1);
  });

  it("prune forgets keys that faded out and were not asked this pass", () => {
    const f = createBubbleFader();
    f.begin();
    f.weight("a", false, 0);
    f.weight("b", true, 0);
    f.begin();
    f.weight("b", true, 50);
    f.prune();
    expect(f.size()).toBe(1);
  });
});
