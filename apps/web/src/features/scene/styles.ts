export type EdgeStatus =
  | "ok"
  | "verified"
  | "likely_ok"
  | "not_a_road"
  | "unknown"
  | "blocked"
  | "flooded_likely"
  | "flooded_possible";

export interface StatusStyle {
  color: string;
  dashed: boolean;
  /** Dotted pattern (blocked) so it differs from ok by more than colour. */
  dotted?: boolean;
  label: string;
  width: number;
  /** Below 1 only for the no-known-barrier network, so the 3D city stays visible under it. */
  alpha?: number;
}

const S: Record<EdgeStatus, StatusStyle> = {
  ok: { color: "#1B873F", dashed: false, label: "No known barrier", width: 2, alpha: 0.6 },
  verified: { color: "#1B873F", dashed: false, label: "Verified", width: 2 },
  likely_ok: { color: "#319795", dashed: true, label: "Likely OK (estimated)", width: 2 },
  not_a_road: { color: "#718096", dashed: false, label: "Not a road", width: 1, alpha: 0.4 },
  unknown: { color: "#B7791F", dashed: true, label: "Not checked yet", width: 4 },
  blocked: { color: "#C53030", dashed: false, dotted: true, label: "Not passable", width: 5 },
  flooded_likely: {
    color: "#C53030",
    dashed: false,
    label: "Likely flooded (indicative)",
    width: 6,
  },
  flooded_possible: {
    color: "#DD6B20",
    dashed: true,
    label: "Possibly flooded (indicative)",
    width: 5,
  },
};

export const statusStyle = (s: EdgeStatus): StatusStyle => S[s];
export const ROUTE_STYLE = { color: "#2B6CB0", width: 8, label: "Suggested route" };
export const WATER_COLOR = "#1e6fb8";
/**
 * Journey trip ribbon (route data): the white casing under the ribbon and the event pin face. An
 * off-white, not #ffffff: drawn unlit in the canvas, pure white was clipped white on ~1% of the
 * frame in the follow camera (AC-B6, B-T4 fix round 1); every channel stays under 254.
 */
export const JOURNEY_RIBBON_STYLE = { casing: "#f2efe8", pinFace: "#f2efe8" } as const;

/**
 * Navigation compare ribbons (demo polish B8, prototype colours; the overlay pills and tags use the
 * same): the fastest route orange, the recommended green, a not-checked run purple (UNKNOWN), the
 * fastest route's stop edge red (a known FAIL).
 */
export const COMPARE_RIBBON_STYLE = {
  fastest: "#e07a3a",
  recommended: "#2fa97c",
  unchecked: "#8b7fd6",
  stop: "#d2544f",
} as const;

/** Cesium PolylineDash params per patterned status (16-bit on/off mask over dashLength px). */
export const CESIUM_DASH: Partial<Record<EdgeStatus, { dashLength: number; dashPattern: number }>> =
  {
    blocked: { dashLength: 12, dashPattern: 0xf000 }, // dotted: 3px on / 9px off
    likely_ok: { dashLength: 12, dashPattern: 0xcccc }, // thin short dashes
    unknown: { dashLength: 16, dashPattern: 0xfff0 }, // long dashes
    flooded_possible: { dashLength: 16, dashPattern: 0xff00 }, // medium dashes
  };

/** T-028 road-name tags on the Stylised map: neutral, or the closed-course red for roads an
 * answer closes or a proposed course uses (the same red as COURSE_STYLE). */
export const ROAD_LABEL_STYLE = {
  bg: "rgba(255,255,255,0.85)",
  text: "#33363b",
  hotBg: "#C53030",
  hotText: "#ffffff",
} as const;
