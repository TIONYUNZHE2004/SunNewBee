import type { Page } from "@playwright/test";

/**
 * Journey player helpers (used from Phase D). They drive `window.__journey`, the player's test and
 * recording hook, with the prototype's API (docs/03-product/prototypes/resident-journey/index.html):
 * `{ total, phases, seek(s), play(), pause(), setCam(mode) }`. Until the Phase D player installs it,
 * every call throws a clear "not available" error.
 */
export const JOURNEY_HOOK = "__journey";
export type JourneyCam = "follow" | "overview" | "free";

export interface JourneyInfo {
  /** Timeline length in seconds. */
  total: number;
  phases: unknown[];
}

async function call(page: Page, method: string, arg?: unknown): Promise<unknown> {
  const r = await page.evaluate(
    ({ h, method, arg }) => {
      const j = (window as unknown as Record<string, Record<string, unknown> | undefined>)[h];
      if (!j) return { missing: true as const };
      const f = j[method];
      if (typeof f !== "function") return { missing: true as const, method };
      return { value: (f as (a?: unknown) => unknown).call(j, arg) ?? null };
    },
    { h: JOURNEY_HOOK, method, arg },
  );
  if ("missing" in r)
    throw new Error(
      `window.${JOURNEY_HOOK}${"method" in r ? `.${method}` : ""} is not available: the journey player lands in Phase D`,
    );
  return r.value;
}

export const journey = {
  /** Jump the timeline to `seconds`. */
  seek: (page: Page, seconds: number) => call(page, "seek", seconds).then(() => undefined),
  play: (page: Page) => call(page, "play").then(() => undefined),
  pause: (page: Page) => call(page, "pause").then(() => undefined),
  setCam: (page: Page, mode: JourneyCam) => call(page, "setCam", mode).then(() => undefined),
  async info(page: Page): Promise<JourneyInfo> {
    const r = await page.evaluate((h) => {
      const j = (window as unknown as Record<string, { total?: unknown; phases?: unknown }>)[h];
      return j ? { total: j.total, phases: j.phases } : null;
    }, JOURNEY_HOOK);
    if (!r || typeof r.total !== "number")
      throw new Error(
        `window.${JOURNEY_HOOK} is not available: the journey player lands in Phase D`,
      );
    return { total: r.total, phases: Array.isArray(r.phases) ? r.phases : [] };
  },
};
