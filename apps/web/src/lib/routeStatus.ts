export const NO_DATA_LABEL = "No mapped connection (data gap)";

/** Words for a route/reachability status. no_data means we have no mapped connection, not that
 * the way is blocked, so it never reads "Not reachable" or "Blocked". */
export function routeStatusLabel(status: string): string {
  if (status === "no_data") return NO_DATA_LABEL;
  if (status === "blocked") return "Not passable";
  return status.replaceAll("_", " ");
}

export function centreReachLabel(c: { reachable: boolean; route_status: string }): string {
  if (c.route_status === "no_data" || c.route_status === "blocked")
    return routeStatusLabel(c.route_status);
  return c.reachable ? "Reachable" : "Not reachable";
}
