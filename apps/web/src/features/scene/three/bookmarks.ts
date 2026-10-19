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

/**
 * Hero district radius (metres) around HERO_CENTRE: tiles whose centre lies within it get the
 * `HERO_BOOST` cap multiplier (`stream/caps.ts`); HERO_CENTRE also anchors the showroom (ruling P4-P).
 */
export const HERO_RADIUS_M = 1200;

/** Gate camera bookmarks. Heading 0 faces north. */
export const BOOKMARKS: Record<
  BookmarkId,
  { centre: LonLat; rangeM: number; pitchDeg: number; headingDeg: number }
> = {
  "hero-near": { centre: HERO_CENTRE, rangeM: 150, pitchDeg: -40, headingDeg: 0 },
  "hero-mid": { centre: HERO_CENTRE, rangeM: 800, pitchDeg: -45, headingDeg: 0 },
  township: { centre: [101.5099, 3.1813], rangeM: 7000, pitchDeg: -55, headingDeg: 0 },
  // Probe views (P4 any-position budget, ruling P4-F): 800 m over four non-hero precincts. Centre =
  // mean of the precinct's OSM building centroids in buildings.geojson.
  // probe-a / probe-b: the two most-built of the plan's named Elmina precincts (Elmina Valley 3-5,
  // Elmina Green, Business Park). Valley 4, Valley 5 and Business Park have no buildings; Elmina
  // Valley 3 and Elmina Green have 55 each.
  // probe-a: Elmina Valley 3, 55 buildings, ~1.5 km from hero.
  "probe-a": { centre: [101.50863, 3.1666], rangeM: 800, pitchDeg: -45, headingDeg: 0 },
  // probe-b: Elmina Green, 55 buildings, ~3.4 km.
  "probe-b": { centre: [101.49473, 3.20748], rangeM: 800, pitchDeg: -45, headingDeg: 0 },
  // probe-c / probe-d: the two densest non-hero precincts overall.
  // probe-c: Subang Galaksi, 1066 buildings, ~2.6 km.
  "probe-c": { centre: [101.53193, 3.1725], rangeM: 800, pitchDeg: -45, headingDeg: 0 },
  // probe-d: Seksyen U16, 694 buildings, ~2.5 km.
  "probe-d": { centre: [101.5108, 3.15784], rangeM: 800, pitchDeg: -45, headingDeg: 0 },
};

export const DEFAULT_BOOKMARK: BookmarkId = "hero-mid";

/** `?bookmark=hero-near` -> id, else null. */
export function bookmarkFromSearch(search: string): BookmarkId | null {
  const v = new URLSearchParams(search).get("bookmark");
  return v !== null && Object.hasOwn(BOOKMARKS, v) ? (v as BookmarkId) : null;
}
