import type { Site } from "@tl/api-client";

export type HomeView = { lon: number; lat: number; range_m: number };

const DEFAULT_RANGE_M = 6000;
const FALLBACK: HomeView = { lon: 101.5099, lat: 3.1813, range_m: DEFAULT_RANGE_M };

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Where the initial camera looks: scene.home, else site.center, else the Elmina constants. */
export function homeView(site: Pick<Site, "center" | "scene"> | null | undefined): HomeView {
  const h = site?.scene?.home;
  if (h && num(h.lon) && num(h.lat)) {
    return {
      lon: h.lon,
      lat: h.lat,
      range_m: num(h.range_m) && h.range_m > 0 ? h.range_m : DEFAULT_RANGE_M,
    };
  }
  const c = site?.center;
  if (c && num(c[0]) && num(c[1])) return { lon: c[0], lat: c[1], range_m: DEFAULT_RANGE_M };
  return { ...FALLBACK };
}

/** Re-frame to the site's home only once, and never after the user moved the camera. */
export const shouldReframe = (f: { moved: boolean; reframed: boolean }) => !f.moved && !f.reframed;
