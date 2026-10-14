export type EdgeStatus = "ok" | "unknown" | "blocked" | "flooded_likely" | "flooded_possible";

export interface StatusStyle {
  color: string;
  dashed: boolean;
  label: string;
  width: number;
}

const S: Record<EdgeStatus, StatusStyle> = {
  ok: { color: "#1B873F", dashed: false, label: "Checked", width: 4 },
  unknown: { color: "#B7791F", dashed: true, label: "Not checked yet", width: 4 },
  blocked: { color: "#C53030", dashed: false, label: "Not passable", width: 4 },
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
