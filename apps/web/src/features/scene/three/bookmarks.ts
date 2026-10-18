import type { LonLat } from "../geo";

export type BookmarkId = "hero-near" | "hero-mid" | "township";

/** Elmina City Centre / Urban Park, Persiaran Garcinia. */
export const HERO_CENTRE: LonLat = [101.5095, 3.1805];

/** Hero district radius (metres) around HERO_CENTRE: road ribbons and props are drawn within it. */
export const HERO_RADIUS_M = 1200;

/** Gate camera bookmarks. Heading 0 faces north. */
export const BOOKMARKS: Record<
  BookmarkId,
  { centre: LonLat; rangeM: number; pitchDeg: number; headingDeg: number }
> = {
  "hero-near": { centre: HERO_CENTRE, rangeM: 150, pitchDeg: -40, headingDeg: 0 },
  "hero-mid": { centre: HERO_CENTRE, rangeM: 800, pitchDeg: -45, headingDeg: 0 },
  township: { centre: [101.5099, 3.1813], rangeM: 7000, pitchDeg: -55, headingDeg: 0 },
};

export const DEFAULT_BOOKMARK: BookmarkId = "hero-mid";

/** `?bookmark=hero-near` -> id, else null. */
export function bookmarkFromSearch(search: string): BookmarkId | null {
  const v = new URLSearchParams(search).get("bookmark");
  return v !== null && Object.hasOwn(BOOKMARKS, v) ? (v as BookmarkId) : null;
}
