import type { Page } from "@playwright/test";

/**
 * The five evaluation bookmarks (spec §3 "Phase A acceptance criteria"): fixed camera poses for
 * before/after screenshots at 1440×900, High quality. Heading 0 faces north, 90 east.
 * Poses come from the Elmina seed (19 Oct 2026); the ids/coordinates are display poses only.
 */
export const BOOKMARK_NAMES = ["overview", "hero-mid", "street", "link-low", "night-mid"] as const;
export type BookmarkName = (typeof BOOKMARK_NAMES)[number];
export type Theme = "day" | "night";

export interface AcceptanceBookmark {
  /** Camera target [lon, lat]. */
  centre: [number, number];
  rangeM: number;
  pitchDeg: number;
  headingDeg: number;
  theme: Theme;
  note: string;
}

/** Elmina City Centre / Urban Park (same as `three/bookmarks.ts` HERO_CENTRE). */
const HERO: [number, number] = [101.5095, 3.1805];

export const ACCEPTANCE_BOOKMARKS: Record<BookmarkName, AcceptanceBookmark> = {
  overview: {
    // `three/bookmarks.ts` "township": the whole site extent.
    centre: [101.5099, 3.1813],
    rangeM: 7000,
    pitchDeg: -55,
    headingDeg: 0,
    theme: "day",
    note: "Full-city overview (the `township` gate bookmark).",
  },
  "hero-mid": {
    centre: HERO,
    rangeM: 800,
    pitchDeg: -45,
    headingDeg: 0,
    theme: "day",
    note: "Mid-range over the hero district (the `hero-mid` gate bookmark).",
  },
  street: {
    // A walk.geojson vertex mid-way along Persiaran Tamarind, which runs NW (101.5053, 3.1877) to
    // SE (101.5129, 3.1810): bearing about 131 degrees, so the camera looks down the street.
    centre: [101.509689, 3.184291],
    rangeM: 60,
    pitchDeg: -15,
    headingDeg: 131,
    theme: "day",
    note: "Street level on Persiaran Tamarind, looking south-east along it.",
  },
  "link-low": {
    // Mean centroid of the link_intermediate / link_long buildings of Elmina Valley 1 and 2, the
    // link-house precincts south of Elmina Urban Park (park point 101.509555, 3.179987).
    centre: [101.5135, 3.1768],
    rangeM: 350,
    pitchDeg: -10,
    headingDeg: 180,
    theme: "day",
    note: "Low angle (pitch -10) over the link houses south of Urban Park, looking south.",
  },
  "night-mid": {
    centre: HERO,
    rangeM: 800,
    pitchDeg: -45,
    headingDeg: 0,
    theme: "night",
    note: "Night, mid-range (the hero-mid pose with the Night theme).",
  },
};

/** The page URL: `?acceptance=1` exposes the test hook even in a production build. */
export const bookmarkUrl = (): string => "/?acceptance=1";

/** The window hook the app installs (`src/features/scene/three/scene/useAcceptanceHook.ts`). */
export const HOOK = "__tlAcceptance";

const SCENE = '[data-testid="three-scene"]';

/**
 * Loads the map with High quality forced (`tl.quality=high`) and the given theme (`tl.theme`), and
 * waits for the Three.js stylised scene and the acceptance hook. Init scripts run in order on every
 * navigation, so a later call's theme wins.
 */
export async function openScene(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((t: string) => {
    try {
      localStorage.setItem("tl.quality", "high");
      localStorage.setItem("tl.theme", t);
    } catch {
      /* storage unavailable: the harness fails on the quality check below */
    }
  }, theme);
  await page.goto(bookmarkUrl());
  const scene = page.locator(SCENE);
  await scene.waitFor({ state: "visible", timeout: 60_000 }).catch(() => {
    throw new Error(
      "No Three.js stylised scene: is the dev server on the Elmina seed (buildings) with WebGL? " +
        "The acceptance harness never uses Realistic (billable Google tiles).",
    );
  });
  await page.waitForFunction((h) => h in window, HOOK, { timeout: 60_000 });
  const theme0 = await page.evaluate(() => document.documentElement.dataset.theme);
  if (theme0 !== theme) throw new Error(`theme is ${theme0}, expected ${theme}`);
}

/** The theme each page was loaded with. */
const loaded = new WeakMap<Page, Theme>();

/** Moves the camera to a bookmark (reloading when its theme differs) and waits for the scene to settle. */
export async function gotoBookmark(page: Page, name: BookmarkName): Promise<AcceptanceBookmark> {
  const b = ACCEPTANCE_BOOKMARKS[name];
  if (loaded.get(page) !== b.theme || !(await page.evaluate((h) => h in window, HOOK))) {
    await openScene(page, b.theme);
    loaded.set(page, b.theme);
  }
  await page.evaluate(
    ({ h, p }) => {
      const api = (window as unknown as Record<string, { setPose(p: unknown): void }>)[h];
      api?.setPose(p);
    },
    {
      h: HOOK,
      p: {
        lon: b.centre[0],
        lat: b.centre[1],
        rangeM: b.rangeM,
        pitchDeg: b.pitchDeg,
        headingDeg: b.headingDeg,
      },
    },
  );
  await settle(page);
  return b;
}

/**
 * Waits until streaming is quiet: the scene's tile / asset / instance attributes unchanged for
 * `quietMs` (max `timeoutMs`), then two animation frames.
 */
export async function settle(page: Page, quietMs = 2500, timeoutMs = 45_000): Promise<void> {
  const scene = page.locator(SCENE);
  const snap = () =>
    scene.evaluate((el) =>
      ["data-tiles", "data-assets", "data-instances", "data-fallback", "data-markers"]
        .map((a) => el.getAttribute(a))
        .join("|"),
    );
  const t0 = Date.now();
  let last = await snap();
  let since = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(250);
    const now = await snap();
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) break;
  }
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}
