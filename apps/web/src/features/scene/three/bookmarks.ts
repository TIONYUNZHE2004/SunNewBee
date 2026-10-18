import type { LonLat } from "../geo";

export type BookmarkId =
  | "hero-near"
  | "hero-mid"
  | "township"
  | "probe-a"
  | "probe-b"
  | "probe-c"
  | "probe-d";

/** Elmina City Centre / Urban Park, Persiaran Garcinia. */
export const HERO_CENTRE: LonLat = [101.5095, 3.1805];

/** Hero district radius (metres) around HERO_CENTRE: road ribbons and props are drawn within it. */
export const HERO_RADIUS_M = 1200;

/**
 * Probe views (P4 any-position budget): mid range (800 m) over four non-hero precincts, chosen as
 * the non-hero precincts with the most OSM buildings in buildings.geojson (centre = mean of that
 * precinct's building centroids; Elmina Valley 3-5, Green and Business Park have far fewer):
 *  - probe-a  Subang Galaksi          1066 buildings  [101.53193, 3.1725]   ~2.6 km from hero
 *  - probe-b  Seksyen U16              694 buildings  [101.5108, 3.15784]   ~2.5 km
 *  - probe-c  Kampung Melayu Subang    655 buildings  [101.53077, 3.15567]  ~3.6 km
 *  - probe-d  Seksyen U18              344 buildings  [101.53478, 3.19314]  ~3.1 km
 * (Seksyen U5, 471, is skipped: it sits ~0.5 km from probe-a, so the two views would overlap.)
 */

/** Gate camera bookmarks. Heading 0 faces north. */
export const BOOKMARKS: Record<
  BookmarkId,
  { centre: LonLat; rangeM: number; pitchDeg: number; headingDeg: number }
> = {
  "hero-near": { centre: HERO_CENTRE, rangeM: 150, pitchDeg: -40, headingDeg: 0 },
  "hero-mid": { centre: HERO_CENTRE, rangeM: 800, pitchDeg: -45, headingDeg: 0 },
  township: { centre: [101.5099, 3.1813], rangeM: 7000, pitchDeg: -55, headingDeg: 0 },
  "probe-a": { centre: [101.53193, 3.1725], rangeM: 800, pitchDeg: -45, headingDeg: 0 },
  "probe-b": { centre: [101.5108, 3.15784], rangeM: 800, pitchDeg: -45, headingDeg: 0 },
  "probe-c": { centre: [101.53077, 3.15567], rangeM: 800, pitchDeg: -45, headingDeg: 0 },
  "probe-d": { centre: [101.53478, 3.19314], rangeM: 800, pitchDeg: -45, headingDeg: 0 },
};

export const DEFAULT_BOOKMARK: BookmarkId = "hero-mid";

/** `?bookmark=hero-near` -> id, else null. */
export function bookmarkFromSearch(search: string): BookmarkId | null {
  const v = new URLSearchParams(search).get("bookmark");
  return v !== null && Object.hasOwn(BOOKMARKS, v) ? (v as BookmarkId) : null;
}
