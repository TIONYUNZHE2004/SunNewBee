export const NO_DATA_LABEL = "No mapped connection (data gap)";

/** Words for a route/reachability status. no_data means we have no mapped connection, not that
 * the way is blocked, so it never reads "Not reachable" or "Blocked". */
export function routeStatusLabel(status: string): string {
  if (status === "closed") return CLOSED_LABEL;
  if (status === "no_data") return NO_DATA_LABEL;
  if (status === "blocked") return "Not passable";
  if (status === "likely_ok") return "Likely OK (estimated)";
  return status.replaceAll("_", " ");
}

/** A staff-reported closure on the centre's place: never reachable (Task 55). */
export const CLOSED_LABEL = "Closed (staff report)";
export const PARTLY_LABEL = "Reachable, some paths not yet checked";

export function centreReachLabel(c: { reachable: boolean; route_status: string }): string {
  if (c.route_status === "closed") return CLOSED_LABEL;
  if (c.route_status === "no_data" || c.route_status === "blocked")
    return routeStatusLabel(c.route_status);
  if (!c.reachable) return routeStatusLabel(c.route_status);
  if (c.route_status === "likely_ok") return "Reachable, estimated from map data";
  return c.route_status === "partly_unverified" ? PARTLY_LABEL : "Reachable";
}

/** Map marker text and colour for an evacuation centre. no_data is neutral grey; only
 * blocked (or an unreachable centre with a known status) is red. */
export function centreMapMarker(c: { reachable: boolean; route_status: string }): {
  text: string;
  color: string;
} {
  if (c.route_status === "closed") return { text: CLOSED_LABEL, color: "#6B7280" };
  if (c.route_status === "no_data") return { text: "No mapped connection", color: "#6B7280" };
  if (c.reachable && c.route_status === "likely_ok")
    return { text: "Reachable, estimated from map data", color: "#319795" };
  if (c.reachable && c.route_status === "partly_unverified")
    return { text: PARTLY_LABEL, color: "#B7791F" };
  if (c.reachable) return { text: "Reachable", color: "#1B873F" };
  return { text: "Not reachable", color: "#C53030" };
}
