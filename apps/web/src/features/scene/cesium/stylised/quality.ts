export type Tier = "high" | "medium" | "low";

export interface TierSpec {
  shadows: "soft" | "hard" | "off";
  shadowMapSize: number;
  ao: "on" | "low" | "off";
  bloom: boolean;
  maxPixelRatio: number;
  birds: number;
  clouds: number;
  /** Small details (roof clutter, lamps, light pools) are drawn within this camera distance. */
  detailRangeM: number;
}

export const TIERS: Record<Tier, TierSpec> = {
  high: {
    shadows: "soft",
    shadowMapSize: 2048,
    ao: "on",
    bloom: true,
    maxPixelRatio: 2,
    birds: 5,
    clouds: 10,
    detailRangeM: 3000,
  },
  medium: {
    shadows: "hard",
    shadowMapSize: 1024,
    ao: "low",
    bloom: true,
    maxPixelRatio: 1.5,
    birds: 3,
    clouds: 6,
    detailRangeM: 1500,
  },
  low: {
    shadows: "off",
    shadowMapSize: 0,
    ao: "off",
    bloom: false,
    maxPixelRatio: 1,
    birds: 3,
    clouds: 0,
    detailRangeM: 0,
  },
};

const DISCRETE = /nvidia|geforce|rtx|gtx|quadro|radeon (rx|pro)|\brx \d|apple m\d (pro|max|ultra)/i;
const SOFTWARE = /swiftshader|llvmpipe|software|basic render/i;

export function pickTier(gpu: string | undefined, memGb: number | undefined): Tier {
  if (gpu && SOFTWARE.test(gpu)) return "low";
  if (memGb !== undefined && memGb <= 2) return "low";
  if (gpu && DISCRETE.test(gpu)) return "high";
  return "medium";
}

export const lowerTier = (t: Tier): Tier => (t === "high" ? "medium" : "low");

/** Median frame time over `windowMs` of camera movement; below `minFps` calls onDrop once per window. */
export function createFrameMonitor(onDrop: () => void, { windowMs = 3000, minFps = 24 } = {}) {
  let samples: number[] = [];
  let elapsed = 0;
  return {
    sample(dtMs: number, moving: boolean) {
      if (!moving || dtMs <= 0) return;
      const dt = Math.min(dtMs, 1000); // a very slow frame still counts as slow
      samples.push(dt);
      elapsed += dt;
      if (elapsed < windowMs) return;
      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] as number;
      samples = [];
      elapsed = 0;
      if (1000 / median < minFps) onDrop();
    },
  };
}

/** GPU name when the browser exposes it (WEBGL_debug_renderer_info). */
export function gpuName(
  gl: WebGLRenderingContext | WebGL2RenderingContext | undefined,
): string | undefined {
  try {
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Feeds a frame monitor from render events. Under requestRenderMode frames only happen on demand,
 * so the gap since the previous frame includes idle time: restart the clock when movement resumes
 * after an idle spell, so the pause is not counted as one slow frame.
 */
export function createFrameSampler(
  monitor: { sample(dtMs: number, moving: boolean): void },
  idleMs = 300,
) {
  let last = Number.NEGATIVE_INFINITY;
  let lastMove = Number.NEGATIVE_INFINITY;
  return {
    moved(now: number) {
      if (now - lastMove >= idleMs) last = now;
      lastMove = now;
    },
    frame(now: number) {
      if (last !== Number.NEGATIVE_INFINITY) monitor.sample(now - last, now - lastMove < idleMs);
      last = now;
    },
  };
}
