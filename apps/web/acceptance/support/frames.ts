import type { Page } from "@playwright/test";
import { HOOK } from "./bookmarks";

/** `measure()` result of the app hook: frame gaps summarised + the last `three/frameStats.ts` sample. */
export interface FrameStats {
  frames: number;
  medianFps: number;
  meanFps: number;
  p95FrameMs: number;
  perf: { fps?: number; frameMs?: number; drawCalls?: number; tris?: number } | null;
  seconds: number;
  orbitDegPerSec: number;
}

/**
 * Frame stats over `seconds` while the camera orbits its target at `orbitDegPerSec` (default 20°/s,
 * a slow turntable). The frame gaps come from the engine's `onFrame` (idle gaps dropped as in
 * `three/frameStats.ts`), and the perf sample from `createFrameStats` itself.
 */
export async function captureFrameStats(
  page: Page,
  seconds: number,
  orbitDegPerSec = 20,
): Promise<FrameStats> {
  const r = await page.evaluate(
    ({ h, seconds, orbit }) => {
      const api = (window as unknown as Record<string, unknown>)[h] as
        | { measure(s: number, o: number): Promise<Omit<FrameStats, "seconds" | "orbitDegPerSec">> }
        | undefined;
      if (!api) throw new Error(`${h} missing: load the map with ?acceptance=1`);
      return api.measure(seconds, orbit);
    },
    { h: HOOK, seconds, orbit: orbitDegPerSec },
  );
  return { ...r, seconds, orbitDegPerSec };
}
