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

/** Merged-layer rebuilds of one scene (see `mergeQueueOf`). */
export interface MergeQueue {
  /** True once a measured merge or layer build took more than the budget: rebuilds are sliced. */
  readonly sliced: boolean;
  /**
   * Rebuilds the layer in `slot` with `build` (which builds and swaps the layer in): at once while
   * the merges are cheap, else on a later frame within the slice budget, replacing any rebuild of
   * that slot still waiting. Returns a cancel function (for the effect cleanup).
   */
  run(slot: string, build: () => void): () => void;
  /** A measured merge or build time: above the budget, later rebuilds are sliced. */
  note(ms: number): void;
}

const queues = new WeakMap<object, MergeQueue>();

/**
 * The scene's merge queue (one per engine): the streamed layers' rebuilds (roads, ground decor,
 * kits, lamp pools, signs) after a published `active` list. The first measured run above
 * `budgetMs` (in practice the cold first merge) switches the session to sliced rebuilds: each
 * layer's rebuild becomes one item drained by `drain`, at most `budgetMs` (plus one item) a frame,
 * and each layer swaps in when its own build completes (the old one stays drawn until then).
 */
export function mergeQueueOf(owner: object, budgetMs = 8, env: FrameEnv = frameEnv): MergeQueue {
  let q = queues.get(owner);
  if (q) return q;
  let sliced = false;
  const pending = new Map<string, () => void>();
  let stop: (() => void) | null = null;
  const next = () => {
    const first = pending.entries().next();
    if (first.done) return undefined;
    pending.delete(first.value[0]);
    return first.value[1];
  };
  q = {
    get sliced() {
      return sliced;
    },
    note(ms) {
      if (ms > budgetMs) sliced = true;
    },
    run(slot, build) {
      if (!sliced) {
        const t0 = env.now();
        build();
        q?.note(env.now() - t0);
        return () => {};
      }
      pending.delete(slot);
      pending.set(slot, build);
      stop ??= drain(next, budgetMs, env, () => {
        stop = null;
      });
      return () => {
        if (pending.get(slot) === build) pending.delete(slot);
      };
    },
  };
  queues.set(owner, q);
  return q;
}
