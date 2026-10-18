import { describe, expect, it, vi } from "vitest";
import { type FrameEnv, mergeQueueOf, sliceWork } from "./idle";

/** A fake clock and frame queue: `step()` runs one frame; items advance the clock by their cost. */
function fakeEnv() {
  let t = 0;
  let queued: (() => void)[] = [];
  const env: FrameEnv = {
    now: () => t,
    frame(cb) {
      queued.push(cb);
      return () => {
        queued = queued.filter((c) => c !== cb);
      };
    },
  };
  /** Runs one frame; returns the ms of work it did. */
  const step = () => {
    const cbs = queued;
    queued = [];
    const t0 = t;
    for (const cb of cbs) cb();
    return t - t0;
  };
  const work = (ms: number, log?: number[], id?: number) => () => {
    t += ms;
    if (log && id !== undefined) log.push(id);
  };
  return { env, step, work, pending: () => queued.length };
}

describe("sliceWork", () => {
  it("never runs more than budgetMs plus one item a frame, and completes every item in order", () => {
    const e = fakeEnv();
    const costs = [3, 3, 3, 5, 1, 7, 2, 2, 9, 0.5, 4];
    const log: number[] = [];
    const done = vi.fn();
    sliceWork(
      costs.map((c, i) => e.work(c, log, i)),
      8,
      { env: e.env, onDone: done },
    );
    // Nothing runs in the calling task.
    expect(log).toEqual([]);
    let frames = 0;
    while (e.pending() > 0 && frames < 100) {
      const before = log.length;
      const ms = e.step();
      frames++;
      const ran = log.slice(before);
      // Everything before the frame's last item fit in the budget: at most budget + one item.
      const last = ran.length > 0 ? (costs[ran.at(-1) as number] as number) : 0;
      expect(ms - last).toBeLessThan(8);
    }
    expect(log).toEqual(costs.map((_, i) => i));
    expect(done).toHaveBeenCalledTimes(1);
    expect(frames).toBeGreaterThan(1);
  });

  it("a frame runs at least one item, even a slow one; cancel stops it", () => {
    const e = fakeEnv();
    const log: number[] = [];
    const cancel = sliceWork([e.work(20, log, 0), e.work(1, log, 1), e.work(1, log, 2)], 8, {
      env: e.env,
    });
    expect(e.step()).toBe(20);
    expect(log).toEqual([0]);
    cancel();
    e.step();
    expect(log).toEqual([0]);
  });
});

describe("mergeQueueOf", () => {
  it("builds at once while merges are cheap, then slices every rebuild after one slow run", () => {
    const e = fakeEnv();
    const q = mergeQueueOf({}, 8, e.env);
    const log: number[] = [];
    q.run("roads", e.work(2, log, 1));
    expect(log).toEqual([1]);
    expect(q.sliced).toBe(false);
    q.run("signs", e.work(30, log, 2)); // the cold first sign build
    expect(q.sliced).toBe(true);
    q.run("roads", e.work(5, log, 3));
    q.run("kits", e.work(5, log, 4));
    q.run("lamps", e.work(1, log, 5));
    expect(log).toEqual([1, 2]);
    expect(e.step()).toBe(10); // roads + kits (8 ms used), lamps next frame
    expect(log).toEqual([1, 2, 3, 4]);
    expect(e.step()).toBe(1);
    expect(log).toEqual([1, 2, 3, 4, 5]);
    expect(e.pending()).toBe(0);
  });

  it("a newer rebuild of a slot replaces the waiting one; a cancelled rebuild never runs", () => {
    const e = fakeEnv();
    const q = mergeQueueOf({}, 8, e.env);
    q.note(9);
    const log: number[] = [];
    q.run("roads", e.work(1, log, 1));
    q.run("roads", e.work(1, log, 2));
    const cancel = q.run("signs", e.work(1, log, 3));
    cancel();
    e.step();
    expect(log).toEqual([2]);
  });

  it("runSteps: a sliced rebuild spreads its steps over frames (budget + one step) and swaps in only at the end", () => {
    const e = fakeEnv();
    const q = mergeQueueOf({}, 8, e.env);
    q.note(20);
    const log: number[] = [];
    const steps = Array.from({ length: 10 }, (_, i) => e.work(3, log, i));
    const done = vi.fn();
    q.runSteps("signs", { steps, done });
    let frames = 0;
    while (e.pending() > 0 && frames < 50) {
      const before = log.length;
      const ms = e.step();
      frames++;
      // At most the budget plus one 3 ms step.
      expect(ms).toBeLessThanOrEqual(8 + 3);
      if (log.length < 10) expect(done).not.toHaveBeenCalled();
      expect(log.length - before).toBeLessThanOrEqual(3);
    }
    expect(log).toEqual(steps.map((_, i) => i));
    expect(done).toHaveBeenCalledTimes(1);
    expect(frames).toBeGreaterThanOrEqual(4);
  });

  it("runSteps: a newer job for the slot cancels the half-built one; cheap merges run whole at once", () => {
    const e = fakeEnv();
    const q = mergeQueueOf({}, 8, e.env);
    const now: number[] = [];
    q.runSteps("kits", { steps: [e.work(1, now, 1), e.work(1, now, 2)], done: e.work(0, now, 3) });
    expect(now).toEqual([1, 2, 3]);
    q.note(9);
    const log: number[] = [];
    const cancelled = vi.fn();
    const first = {
      steps: Array.from({ length: 6 }, (_, i) => e.work(3, log, i)),
      done: vi.fn(),
      cancel: cancelled,
    };
    q.runSteps("kits", first);
    e.step(); // 3 of 6 steps
    q.runSteps("kits", { steps: [e.work(1, log, 10)], done: e.work(0, log, 11) });
    expect(cancelled).toHaveBeenCalledTimes(1);
    while (e.pending() > 0) e.step();
    expect(first.done).not.toHaveBeenCalled();
    expect(log).toEqual([0, 1, 2, 10, 11]);
  });

  it("is one queue per owner", () => {
    const owner = {};
    expect(mergeQueueOf(owner)).toBe(mergeQueueOf(owner));
    expect(mergeQueueOf({})).not.toBe(mergeQueueOf(owner));
  });
});
