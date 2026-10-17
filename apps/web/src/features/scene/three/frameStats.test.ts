import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameStats } from "./frameStats";

let t = 0;
const now = () => t;
const advance = (ms: number) => {
  t += ms;
  vi.advanceTimersByTime(ms);
};

beforeEach(() => {
  vi.useFakeTimers();
  t = 1000;
});
afterEach(() => vi.useRealTimers());

function setup() {
  const frames = vi.fn();
  const perf = vi.fn();
  return { frames, perf, s: createFrameStats({ frames, perf }, { now }) };
}

describe("createFrameStats", () => {
  it("publishes the first frames at once, then at most every 500 ms with a trailing update", () => {
    const { frames, s } = setup();
    s.frame(1, 0, 10);
    expect(frames).toHaveBeenLastCalledWith(1);
    advance(16);
    s.frame(2, 16, 10);
    advance(16);
    s.frame(3, 16, 10);
    expect(frames).toHaveBeenCalledTimes(1);
    advance(500);
    expect(frames).toHaveBeenLastCalledWith(3);
    expect(frames).toHaveBeenCalledTimes(2);
  });

  it("isolated on-demand frames (dt 0) still publish draw calls; fps keeps its last value", () => {
    const { perf, s } = setup();
    s.frame(1, 0, 12);
    expect(perf).toHaveBeenLastCalledWith({ drawCalls: 12 });
    for (let i = 2; i < 10; i++) {
      advance(100);
      s.frame(i, 100, 20);
    }
    expect(perf).toHaveBeenLastCalledWith({ fps: 10, frameMs: 100, drawCalls: 20 });
    advance(5000);
    s.frame(10, 0, 20); // after an idle spell: the measured fps stays
    expect(perf).toHaveBeenLastCalledWith({ fps: 10, frameMs: 100, drawCalls: 20 });
  });

  it("dispose flushes a pending count", () => {
    const { frames, s } = setup();
    s.frame(1, 0, 1);
    advance(10);
    s.frame(2, 10, 1);
    s.dispose();
    expect(frames).toHaveBeenLastCalledWith(2);
  });
});
