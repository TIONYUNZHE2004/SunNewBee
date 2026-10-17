import { describe, expect, it, vi } from "vitest";
import { createMotionClock, motionActive } from "./clock";

function rafClock() {
  let t = 0;
  const q = new Map<number, () => void>();
  let id = 0;
  return {
    now: () => t,
    raf: (cb: () => void) => {
      q.set(++id, cb);
      return id;
    },
    caf: (i: number) => q.delete(i),
    frame(ms: number) {
      t += ms;
      const run = [...q.values()];
      q.clear();
      for (const cb of run) cb();
    },
    pending: () => q.size,
  };
}

describe("motion clock", () => {
  it("renders at most 30 times a second while active", () => {
    const c = rafClock();
    const requestRender = vi.fn();
    const clock = createMotionClock({ fps: 30, requestRender, onTick: vi.fn(), ...c });
    clock.setActive(true);
    for (let i = 0; i < 60; i++) c.frame(1000 / 60); // one second at 60 Hz
    expect(requestRender.mock.calls.length).toBeGreaterThanOrEqual(29);
    expect(requestRender.mock.calls.length).toBeLessThanOrEqual(31);
  });
  it("schedules nothing while inactive", () => {
    const c = rafClock();
    const requestRender = vi.fn();
    const clock = createMotionClock({ requestRender, onTick: vi.fn(), ...c });
    clock.setActive(true);
    c.frame(16);
    clock.setActive(false);
    c.frame(16);
    expect(c.pending()).toBe(0);
    const n = requestRender.mock.calls.length;
    c.frame(1000);
    expect(requestRender.mock.calls.length).toBe(n);
  });
  it("keeps running when a tick throws (the error surfaces, the loop does not stall)", () => {
    const c = rafClock();
    const requestRender = vi.fn();
    let n = 0;
    const onTick = vi.fn(() => {
      if (n++ === 0) throw new Error("boom");
    });
    const clock = createMotionClock({ requestRender, onTick, ...c });
    clock.setActive(true);
    expect(() => c.frame(40)).toThrow("boom");
    expect(requestRender).toHaveBeenCalledTimes(1); // the failed tick still renders
    expect(c.pending()).toBe(1);
    c.frame(40);
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(requestRender).toHaveBeenCalledTimes(2);
  });
  it("motionActive needs enabled, visible, on screen and no reduced motion", () => {
    expect(motionActive({ enabled: true, visible: true, onScreen: true, reduced: false })).toBe(
      true,
    );
    expect(motionActive({ enabled: true, visible: false, onScreen: true, reduced: false })).toBe(
      false,
    );
    expect(motionActive({ enabled: true, visible: true, onScreen: false, reduced: false })).toBe(
      false,
    );
    expect(motionActive({ enabled: false, visible: true, onScreen: true, reduced: false })).toBe(
      false,
    );
    expect(motionActive({ enabled: true, visible: true, onScreen: true, reduced: true })).toBe(
      false,
    );
  });
});
