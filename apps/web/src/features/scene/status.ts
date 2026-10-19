import type { EdgeStatus } from "./styles";

const CANONICAL: EdgeStatus[] = [
  "ok",
  "verified",
  "likely_ok",
  "not_a_road",
  "unknown",
  "blocked",
  "flooded_likely",
  "flooded_possible",
];

/** Single source of truth for edge status across Cesium, Mapbox and the list. */
export function mapStatus(props: Record<string, unknown> | null | undefined): EdgeStatus {
  const p = props ?? {};
  for (const v of [p.status_for_profile, p.status]) {
    if (v === "closed") return "blocked";
    if (CANONICAL.includes(v as EdgeStatus)) return v as EdgeStatus;
  }
  if (p.flood_class === "likely_flooded") return "flooded_likely";
  if (p.flood_class === "possible") return "flooded_possible";
  return "unknown"; // never present unverified data as checked
}
