import { measure } from "../stream/streamer";

/** Runs `fn` when the main thread is idle (at most 500 ms later); returns a cancel function. */
export function whenIdle(fn: () => void): () => void {
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (h: number) => void;
  };
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const h = w.requestIdleCallback(fn, { timeout: 500 });
    return () => w.cancelIdleCallback?.(h);
  }
  const t = setTimeout(fn, 0);
  return () => clearTimeout(t);
}

/** The clock and frame scheduler of the time slicers (fake in tests). */
export interface FrameEnv {
  now(): number;
  /** Calls `cb` on the next frame; returns a cancel function. */
  frame(cb: () => void): () => void;
}

export const frameEnv: FrameEnv = {
  now: () => performance.now(),
  frame(cb) {
    const g = globalThis as typeof globalThis & {
      requestAnimationFrame?: (cb: () => void) => number;
      cancelAnimationFrame?: (h: number) => void;
    };
    if (g.requestAnimationFrame && g.cancelAnimationFrame) {
      const h = g.requestAnimationFrame(cb);
      return () => g.cancelAnimationFrame?.(h);
    }
    const t = setTimeout(cb, 16);
    return () => clearTimeout(t);
  },
};

/** User Timing name of one frame's slice of sliced work (one main-thread task's share). */
export const SLICE_MEASURE = "tl:stream-slice";

/**
 * Drains `next()` across frames, starting on the next frame: each frame runs items until it has
 * used `budgetMs` (so at most `budgetMs` plus one item), then yields to the next frame. A throwing
 * item is reported and skipped. `onIdle` runs when `next()` is empty. Returns a cancel function.
 */
function drain(
  next: () => (() => void) | undefined,
  budgetMs: number,
  env: FrameEnv,
  onIdle?: () => void,
): () => void {
  let cancelled = false;
  let cancelFrame: (() => void) | null = null;
  const run = () => {
    cancelFrame = null;
    if (cancelled) return;
    const t0 = env.now();
    let item = next();
    while (item) {
      try {
        item();
      } catch (err) {
        console.warn(`city: sliced build failed: ${String(err)}`);
      }
      if (env.now() - t0 >= budgetMs) break;
      item = next();
    }
    measure(SLICE_MEASURE, t0);
    if (cancelled) return;
    if (item === undefined) onIdle?.();
    else cancelFrame = env.frame(run);
  };
  cancelFrame = env.frame(run);
  return () => {
    cancelled = true;
    cancelFrame?.();
    cancelFrame = null;
  };
}

/**
 * Runs `steps` in order across frames (none in the calling task): each frame processes steps until
 * it has used `budgetMs`, so no frame runs more than `budgetMs` plus one step. `onDone` runs after
 * the last step (swap a layer in there, so it shows only when complete). Returns a cancel function.
 */
export function sliceWork(
  steps: ReadonlyArray<() => void>,
  budgetMs = 8,
  opts: { onDone?: () => void; env?: FrameEnv } = {},
): () => void {
  let i = 0;
  let done = false;
  const next = () => {
    if (i < steps.length) return steps[i++];
    if (!done) {
      done = true;
      return opts.onDone ?? (() => {});
    }
    return undefined;
  };
  return drain(next, budgetMs, opts.env ?? frameEnv);
}

/** A layer rebuild in steps: `done` swaps the layer in after the last step; `cancel` drops it. */
export interface SliceJob {
  steps: ReadonlyArray<() => void>;
  done: () => void;
  cancel?: () => void;
}

/** Merged-layer rebuilds of one scene (see `mergeQueueOf`). */
export interface MergeQueue {
  /** True once a measured merge or layer build took more than the budget: rebuilds are sliced. */
  readonly sliced: boolean;
  /**
   * Rebuilds the layer in `slot` with `build` (which builds and swaps the layer in): at once while
   * the merges are cheap, else as one item on a later frame. Returns a cancel function.
   */
  run(slot: string, build: () => void): () => void;
  /**
   * Rebuilds the layer in `slot` from `job`'s steps: at once while the merges are cheap, else
   * spread over frames (within the slice budget), `done` swapping it in when complete. A newer job
   * for the slot replaces a waiting one (its `cancel` runs). Returns a cancel function.
   */
  runSteps(slot: string, job: SliceJob): () => void;
  /** A measured merge or build time: above the budget, later rebuilds are sliced. */
  note(ms: number): void;
}

const queues = new WeakMap<object, MergeQueue>();

/**
 * The scene's merge queue (one per engine): the streamed layers' rebuilds (roads, ground decor,
 * kits, lamp pools, signs) after a published `active` list. The first measured run above
 * `budgetMs` (in practice the cold first merge) switches the session to sliced rebuilds: a layer's
 * rebuild becomes its steps (kits: one key each; signs: a few signs each), drained at most
 * `budgetMs` (plus one step) a frame, and the layer swaps in when its last step completes (the old
 * one stays drawn until then).
 */
export function mergeQueueOf(owner: object, budgetMs = 8, env: FrameEnv = frameEnv): MergeQueue {
  let q = queues.get(owner);
  if (q) return q;
  let sliced = false;
  interface Live extends SliceJob {
    i: number;
  }
  const pending = new Map<string, Live>();
  let draining = false;
  const next = (): (() => void) | undefined => {
    const first = pending.entries().next();
    if (first.done) return undefined;
    const [slot, job] = first.value;
    if (job.i < job.steps.length) {
      const step = job.steps[job.i++] as () => void;
      return step;
    }
    pending.delete(slot);
    return job.done;
  };
  const note = (ms: number) => {
    if (ms > budgetMs) sliced = true;
  };
  const runSteps = (slot: string, job: SliceJob) => {
    if (!sliced) {
      const t0 = env.now();
      for (const step of job.steps) step();
      job.done();
      note(env.now() - t0);
      return () => {};
    }
    const old = pending.get(slot);
    if (old) {
      pending.delete(slot);
      old.cancel?.();
    }
    const live: Live = { ...job, i: 0 };
    pending.set(slot, live);
    if (!draining) {
      draining = true;
      drain(next, budgetMs, env, () => {
        draining = false;
      });
    }
    return () => {
      if (pending.get(slot) !== live) return;
      pending.delete(slot);
      live.cancel?.();
    };
  };
  q = {
    get sliced() {
      return sliced;
    },
    note,
    runSteps,
    run: (slot, build) => runSteps(slot, { steps: [], done: build }),
  };
  queues.set(owner, q);
  return q;
}
