import type { Page } from "@playwright/test";

/**
 * Journey player helpers. They drive `window.__journey`, the player's test and recording hook, with
 * the prototype's API (docs/03-product/prototypes/resident-journey/index.html):
 * `{ total, phases, seek(s), play(), pause(), setCam(mode) }`. It is installed in dev builds and with
 * the ?demo=1 preset only; without it every call throws a clear "not available" error.
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
      `window.${JOURNEY_HOOK}${"method" in r ? `.${method}` : ""} is not available: it is installed in dev builds and with the ?demo=1 preset only (is this a production build, or did the journey answer land?)`,
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
        `window.${JOURNEY_HOOK} is not available: it is installed in dev builds and with the ?demo=1 preset only (is this a production build, or did the journey answer land?)`,
      );
    return { total: r.total, phases: Array.isArray(r.phases) ? r.phases : [] };
  },
};

/** The §2 demo question (packages/agent/tests/test_journey_answer.py DEMO_Q). */
export const DEMO_QUESTION =
  "My mum uses a walker. Can she walk from Harmoni 1 to Lakeside Mall Car Park B?";

/**
 * Asks the demo question with the older_adult_rest profile (mock LLM) and waits until the journey
 * overlay shows (the "Simulation" label). Call after `openScene`; the profile is stored before the
 * next reload, so a fresh page picks it up.
 */
export async function askDemoJourney(page: Page): Promise<void> {
  await page.evaluate(() => {
    try {
      localStorage.setItem("tl.profile", "older_adult_rest");
    } catch {
      /* the profile picker default is checked below */
    }
  });
  await page.reload();
  const show = page.getByRole("button", { name: "Show assistant" });
  if (await show.isVisible()) await show.click();
  await page.getByRole("textbox", { name: "Your question" }).fill(DEMO_QUESTION);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByTestId("journey-sim-label").waitFor({ state: "visible", timeout: 60_000 });
}

/** True once the journey player hook is installed (D-T8). */
export async function hasJourneyHook(page: Page): Promise<boolean> {
  return page.evaluate((h) => h in window, JOURNEY_HOOK);
}
