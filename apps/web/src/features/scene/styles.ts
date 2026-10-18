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

/** Cesium PolylineDash params per patterned status (16-bit on/off mask over dashLength px). */
export const CESIUM_DASH: Partial<Record<EdgeStatus, { dashLength: number; dashPattern: number }>> =
  {
    blocked: { dashLength: 12, dashPattern: 0xf000 }, // dotted: 3px on / 9px off
    likely_ok: { dashLength: 12, dashPattern: 0xcccc }, // thin short dashes
    unknown: { dashLength: 16, dashPattern: 0xfff0 }, // long dashes
    flooded_possible: { dashLength: 16, dashPattern: 0xff00 }, // medium dashes
  };
