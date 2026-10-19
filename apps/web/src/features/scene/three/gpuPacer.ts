/**
 * GPU frame pacing (ITER2 AC-D18). The render loop never runs more than `maxInFlight` frames ahead
 * of the GPU: each rendered frame ends with a fence, and a frame does not start while the oldest of
 * `maxInFlight` fences is unsignalled (the loop tries again at the next animation frame, without
 * blocking). Without it, in the dive's GPU-heavy frames the main thread queued frames until the
 * command buffer was full and then blocked 160-360 ms in whatever GL call came next (a buffer
 * upload, a draw). Fence status is polled, never waited on. A fence older than `giveUpMs` is
 * dropped, so a lost context never stalls the loop.
 */
export interface GpuPacer {
  /** Whether a frame may be rendered now (polls and retires signalled fences). */
  ready(now: number): boolean;
  /** Call after a frame's draw calls: fences them. */
  submitted(now: number): void;
  /** Frames skipped while waiting, and the longest wait (ms), for diagnostics. */
  readonly stats: { skipped: number; longestWaitMs: number };
  dispose(): void;
}

type FenceGl = Pick<
  WebGL2RenderingContext,
  | "fenceSync"
  | "getSyncParameter"
  | "deleteSync"
  | "flush"
  | "SYNC_GPU_COMMANDS_COMPLETE"
  | "SYNC_STATUS"
  | "SIGNALED"
>;

export const GPU_MAX_IN_FLIGHT = 2;
export const GPU_FENCE_GIVE_UP_MS = 1000;
/**
 * Pacing applies only to a continuously rendering loop: a frame that comes this long (ms) after the
 * last rendered one (a render on demand after an idle spell: a seek, a toggle) always renders.
 */
export const GPU_IDLE_GAP_MS = 50;
/** Never wait longer than this (ms) for the GPU: then the frame renders anyway. */
export const GPU_MAX_WAIT_MS = 100;
/** User Timing name of one wait for the GPU (from the first skipped frame to the next render). */
export const GPU_PACED_MEASURE = "tl:gpu-paced";

export function createGpuPacer(
  gl: Partial<FenceGl> | null | undefined,
  opts: { maxInFlight?: number; giveUpMs?: number } = {},
): GpuPacer {
  const max = opts.maxInFlight ?? GPU_MAX_IN_FLIGHT;
  const giveUp = opts.giveUpMs ?? GPU_FENCE_GIVE_UP_MS;
  const ok =
    !!gl &&
    typeof gl.fenceSync === "function" &&
    typeof gl.getSyncParameter === "function" &&
    typeof gl.deleteSync === "function";
  const fences: { s: WebGLSync; at: number }[] = [];
  let waitFrom: number | null = null;
  let lastSubmit = Number.NEGATIVE_INFINITY;
  const stats = { skipped: 0, longestWaitMs: 0 };
  const g = gl as FenceGl;
  const retire = (now: number) => {
    while (fences.length > 0) {
      const f = fences[0] as { s: WebGLSync; at: number };
      const done = g.getSyncParameter(f.s, g.SYNC_STATUS) === g.SIGNALED;
      if (!done && now - f.at < giveUp) break;
      g.deleteSync(f.s);
      fences.shift();
    }
  };
  return {
    stats,
    ready(now) {
      if (!ok) return true;
      retire(now);
      const go =
        fences.length < max ||
        now - lastSubmit >= GPU_IDLE_GAP_MS ||
        (waitFrom !== null && now - waitFrom >= GPU_MAX_WAIT_MS);
      if (go) {
        if (waitFrom !== null) {
          const ms = now - waitFrom;
          stats.longestWaitMs = Math.max(stats.longestWaitMs, ms);
          try {
            performance.measure(GPU_PACED_MEASURE, { start: waitFrom, end: now });
          } catch {
            /* User Timing unavailable */
          }
          waitFrom = null;
        }
        return true;
      }
      waitFrom ??= now;
      stats.skipped++;
      return false;
    },
    submitted(now) {
      if (!ok) return;
      lastSubmit = now;
      const s = g.fenceSync(g.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (s) fences.push({ s, at: now });
      // sent to the GPU now: an unflushed fence of the last frame before an idle spell would only
      // reach the GPU with the next frame's commands, and that frame waits for it
      g.flush?.();
    },
    dispose() {
      if (!ok) return;
      for (const f of fences.splice(0)) g.deleteSync(f.s);
    },
  };
}
