import type { Page } from "@playwright/test";
import { HOOK } from "./bookmarks";

/** Uncapped frame time: frames rendered back to back with `gl.finish()` (CPU + GPU, no vsync). */
export interface UncappedStats {
  frames: number;
  medianFrameMs: number;
  p95FrameMs: number;
  /** 1000 / median frame ms: the frame rate the scene could reach without the display cap. */
  fps: number;
}

export interface FrameStats {
  /**
   * Display-paced (rAF) orbit: what a viewer sees. Capped by the display / headless BeginFrame
   * rate (about 60 Hz here), so it cannot show headroom above 60.
   */
  display: {
    frames: number;
    medianFps: number;
    meanFps: number;
    p95FrameMs: number;
    /** The last throttled sample from `three/frameStats.ts` (as on the perf line). */
    perf: { fps?: number; frameMs?: number; drawCalls?: number; tris?: number } | null;
    seconds: number;
    orbitDegPerSec: number;
  };
  /** The same orbit speed per 60 Hz frame, rendered uncapped: the headroom number. */
  uncapped: UncappedStats & { orbitDegPerFrame: number };
}

type Hook = {
  measure(s: number, o: number): Promise<Omit<FrameStats["display"], "seconds" | "orbitDegPerSec">>;
  measureUncapped(frames: number, degPerFrame: number): UncappedStats;
};

/**
 * Frame stats while the camera orbits its target at `orbitDegPerSec` (default 20°/s, a slow
 * turntable):
 * - `display`: `seconds` of rAF-paced frames; gaps from the engine's `onFrame` (idle gaps dropped
 *   as in `three/frameStats.ts`), plus the `createFrameStats` perf sample;
 * - `uncapped`: `uncappedFrames` frames rendered synchronously (`engine.renderNow` + `gl.finish`),
 *   timing CPU + GPU work without the vsync wait.
 * The camera pose is restored afterwards.
 */
export async function captureFrameStats(
  page: Page,
  seconds: number,
  orbitDegPerSec = 20,
  uncappedFrames = 240,
): Promise<FrameStats> {
  const degPerFrame = orbitDegPerSec / 60;
  const r = await page.evaluate(
    async ({ h, seconds, orbit, n, step }) => {
      const api = (window as unknown as Record<string, unknown>)[h] as Hook | undefined;
      if (!api) throw new Error(`${h} missing: load the map with ?acceptance=1`);
      const display = await api.measure(seconds, orbit);
      const uncapped = api.measureUncapped(n, step);
      return { display, uncapped };
    },
    { h: HOOK, seconds, orbit: orbitDegPerSec, n: uncappedFrames, step: degPerFrame },
  );
  return {
    display: { ...r.display, seconds, orbitDegPerSec },
    uncapped: { ...r.uncapped, orbitDegPerFrame: degPerFrame },
  };
}
