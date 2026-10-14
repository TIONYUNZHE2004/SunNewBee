export const NO_DATA_LABEL = "No mapped connection (data gap)";

/** Words for a route/reachability status. no_data means we have no mapped connection, not that
 * the way is blocked, so it never reads "Not reachable" or "Blocked". */
export function routeStatusLabel(status: string): string {
  if (status === "no_data") return NO_DATA_LABEL;
  if (status === "blocked") return "Not passable";
  return status.replaceAll("_", " ");
}

export const PARTLY_LABEL = "Reachable, some paths not yet checked";

export function centreReachLabel(c: { reachable: boolean; route_status: string }): string {
  if (c.route_status === "no_data" || c.route_status === "blocked")
    return routeStatusLabel(c.route_status);
  if (!c.reachable) return routeStatusLabel(c.route_status);
  return c.route_status === "partly_unverified" ? PARTLY_LABEL : "Reachable";
}

/** Map marker text and colour for an evacuation centre. no_data is neutral grey; only
 * blocked (or an unreachable centre with a known status) is red. */
export function centreMapMarker(c: { reachable: boolean; route_status: string }): {
  text: string;
  color: string;
} {
  if (c.route_status === "no_data") return { text: "No mapped connection", color: "#6B7280" };
  if (c.reachable && c.route_status === "partly_unverified")
    return { text: PARTLY_LABEL, color: "#B7791F" };
  if (c.reachable) return { text: "Reachable", color: "#1B873F" };
  return { text: "Not reachable", color: "#C53030" };
}
