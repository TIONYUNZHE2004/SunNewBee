import type { Page } from "@playwright/test";

/**
 * The five evaluation bookmarks (spec §3 "Phase A acceptance criteria"): fixed camera poses for
 * before/after screenshots at 1440×900, High quality. Heading 0 faces north, 90 east.
 * Poses come from the Elmina seed (19 Oct 2026); the ids/coordinates are display poses only.
 */
export const BOOKMARK_NAMES = ["overview", "hero-mid", "street", "link-low", "night-mid"] as const;
export type BookmarkName = (typeof BOOKMARK_NAMES)[number];
/** Map mood a capture loads with (`tl.theme`); dusk is used by AC-B6 (B-T4). */
export type Theme = "day" | "dusk" | "night";

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
    // A-T5: with a slab, `gotoBookmark` asks the app for the overview derived from the outline at
    // runtime (hook `overviewPose()`: the whole slab at max range) and uses this entry only as the
    // fallback without an outline (`three/bookmarks.ts` "township", the site extent).
    centre: [101.5099, 3.1813],
    rangeM: 7000,
    pitchDeg: -55,
    headingDeg: 0,
    theme: "day",
    note: "Whole-slab overview (derived from the outline at runtime; fallback: the site extent).",
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
    // Mid-point of a 128 m straight of Persiaran Tamarind (walk.geojson seg-1346155031-0, bearing
    // 144), looking south-east along it. The street is lined with trees, so the camera stays under
    // the canopies: eye height about 3 m (range 30 at pitch -6). Chosen from 16 points along the
    // street x 5 poses (A-T0 fix round 1): road share 0.35, road pixels showing asphalt 0.96.
    centre: [101.50877, 3.185719],
    rangeM: 30,
    pitchDeg: -6,
    headingDeg: 144,
    theme: "day",
    note: "Street level on Persiaran Tamarind, under the street trees, looking south-east along it.",
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

/**
 * The street bookmark must show the street: the road share of the map-area pick samples, and the
 * share of road samples that show asphalt (grey, saturation <= 0.18, luminance <= 0.35) rather than
 * canopy drawn over them or bare ground where roads have not streamed in.
 */
export const STREET_CHECK = { minRoadShare: 0.2, minAsphalt: 0.6, maxSat: 0.18, maxLuma: 0.35 };

/**
 * The page URL: `?acceptance=1` exposes the test hook even in a production build; `sun=pinned`
 * lights the scene at the pinned sun time (10:30 MYT, fixed date: `three/sunClock.ts`), so day
 * shadows do not depend on the hour of the run (B-T4 fix round 1 ruling).
 */
export const bookmarkUrl = (): string => "/?acceptance=1&sun=pinned";

/** The window hook the app installs (`src/features/scene/three/scene/useAcceptanceHook.ts`). */
export const HOOK = "__tlAcceptance";

const SCENE = '[data-testid="three-scene"]';

/** WebGL renderers that are software rasterisers: frame times from them say nothing about a GPU. */
export const SOFTWARE_GPU = /SwiftShader|llvmpipe|Basic Render/i;

export interface Gpu {
  vendor: string;
  renderer: string;
}

/** The scene's unmasked WebGL vendor / renderer (from the engine's own context). */
export async function sceneGpu(page: Page): Promise<Gpu> {
  return page.evaluate((h) => {
    const api = (window as unknown as Record<string, { gpu(): Gpu } | undefined>)[h];
    if (!api) throw new Error(`${h} missing: load the map with ?acceptance=1`);
    return api.gpu();
  }, HOOK);
}

/**
 * Loads the map for a capture and returns the GPU it renders on:
 * - High quality forced (`tl.quality=high`) and the given theme (`tl.theme`);
 * - the assistant panel closed (`tl.panel.open=false`) and the camera tips dismissed
 *   (`tl.camera.hint=dismissed`), so the map fills the frame; the map's own notes (e.g.
 *   "Decorative details are illustrative.") stay;
 * - waits for the Three.js stylised scene and the acceptance hook;
 * - throws on a software renderer (SwiftShader, llvmpipe, Microsoft Basic Render).
 * Init scripts run in order on every navigation, so a later call's theme wins.
 */
export async function openScene(page: Page, theme: Theme): Promise<Gpu> {
  await page.addInitScript((t: string) => {
    try {
      localStorage.setItem("tl.quality", "high");
      localStorage.setItem("tl.theme", t);
      localStorage.setItem("tl.panel.open", "false");
      localStorage.setItem("tl.camera.hint", "dismissed");
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
  const tips = page.getByRole("button", { name: "Dismiss camera tips" });
  if (await tips.isVisible()) await tips.click();
  const gpu = await sceneGpu(page);
  if (SOFTWARE_GPU.test(gpu.renderer))
    throw new Error(`software WebGL renderer (${gpu.renderer}): frame times would be meaningless`);
  return gpu;
}

interface GeoPoseJson {
  lon: number;
  lat: number;
  rangeM: number;
  pitchDeg: number;
  headingDeg: number;
}

/** The theme each page was loaded with. */
const loaded = new WeakMap<Page, Theme>();

/** Moves the camera to a bookmark (reloading when its theme differs) and waits for the scene to settle. */
export async function gotoBookmark(page: Page, name: BookmarkName): Promise<AcceptanceBookmark> {
  let b = ACCEPTANCE_BOOKMARKS[name];
  if (loaded.get(page) !== b.theme || !(await page.evaluate((h) => h in window, HOOK))) {
    await openScene(page, b.theme);
    loaded.set(page, b.theme);
  }
  if (name === "overview") {
    // The overview is derived from the outline at runtime (A-T5); wait for the slab's camera fit.
    const derived = await page
      .waitForFunction(
        (h) =>
          (window as unknown as Record<string, { overviewPose?(): unknown } | undefined>)[
            h
          ]?.overviewPose?.() ?? null,
        HOOK,
        { timeout: 30_000 },
      )
      .then((j) => j.jsonValue() as Promise<GeoPoseJson>)
      .catch(() => null);
    if (derived)
      b = {
        ...b,
        centre: [derived.lon, derived.lat],
        rangeM: derived.rangeM,
        pitchDeg: derived.pitchDeg,
        headingDeg: derived.headingDeg,
        note: `${b.note} Derived: overviewPose(fit).`,
      };
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
 * Waits until streaming is quiet: the scene's tile / asset / instance attributes and the road
 * layer's vertex count unchanged for
 * `quietMs` (max `timeoutMs`), then two animation frames.
 */
export async function settle(page: Page, quietMs = 2500, timeoutMs = 45_000): Promise<void> {
  const scene = page.locator(SCENE);
  const snap = () =>
    scene.evaluate(
      (el, h) =>
        [
          ...["data-tiles", "data-assets", "data-instances", "data-fallback", "data-markers"].map(
            (a) => el.getAttribute(a),
          ),
          // The road layer streams in after the tiles (idle merge queue).
          (window as unknown as Record<string, { roadVertices(): number }>)[h]?.roadVertices(),
        ].join("|"),
      HOOK,
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
