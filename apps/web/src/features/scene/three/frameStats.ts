/** Frame gaps over this are idle time under render-on-demand, not slow frames. */
const IDLE_GAP_MS = 500;
const WINDOW = 30;

export interface PerfSample {
  fps: number;
  frameMs: number;
  drawCalls: number;
}

/**
 * Throttled publishing for render-on-demand frames.
 * - `frames(n)`: the running frame count, published at once on the first frame after a quiet spell
 *   (leading edge) and then at most every `framesMs`, with a trailing update so the last count
 *   always lands.
 * - `perf(sample)`: fps / frame time from consecutive (non-idle) frames, at most every `perfMs`.
 *   Draw calls are published even when there is no fps yet; fps keeps its last measured value at
 *   rest (as on the Cesium map).
 */
export function createFrameStats(
  out: { frames(n: number): void; perf(p: Partial<PerfSample>): void },
  { framesMs = 500, perfMs = 250, now = () => performance.now() } = {},
) {
  const recent: number[] = [];
  let lastFrames = Number.NEGATIVE_INFINITY;
  let lastPerf = Number.NEGATIVE_INFINITY;
  let pending = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flushFrames = () => {
    timer = undefined;
    lastFrames = now();
    out.frames(pending);
  };

  return {
    frame(count: number, dtMs: number, drawCalls: number) {
      pending = count;
      const t = now();
      if (timer === undefined) {
        const wait = framesMs - (t - lastFrames);
        if (wait <= 0) flushFrames();
        else timer = setTimeout(flushFrames, wait);
      }
      if (dtMs > 0 && dtMs <= IDLE_GAP_MS) {
        recent.push(dtMs);
        if (recent.length > WINDOW) recent.shift();
      }
      if (t - lastPerf < perfMs) return;
      lastPerf = t;
      if (recent.length === 0) {
        out.perf({ drawCalls });
        return;
      }
      const frameMs = recent.reduce((a, b) => a + b, 0) / recent.length;
      out.perf({ fps: 1000 / frameMs, frameMs, drawCalls });
    },
    /** Publishes any pending frame count now and stops the timer. */
    dispose() {
      if (timer === undefined) return;
      clearTimeout(timer);
      flushFrames();
    },
  };
}
